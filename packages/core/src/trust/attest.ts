// The TRUST verb. An attestation is a signed statement about a counterparty,
// REQUIRING a reference to a real, released settlement between the attester and
// the subject. This is the anti-Sybil rule, enforced: free attestations are
// worthless; weight is bought with settled value, which is expensive to forge.
//
// Trust is computed by the CONSUMER, never dictated by a central score: an
// agent downloads raw attestations, verifies each, discards the unbacked, and
// scores them with a policy IT controls. The protocol ships a sane default
// (diversity-weighted + time-decayed); agents may override every knob.

import { type Identity } from "../identity";
import { verifySettlement, type SettlementRecord } from "../settle/rail";
import { DOMAIN, signEd25519, verifyByDid } from "../signing";

export interface Attestation {
  v: string;
  subject: string; // the party being attested about (the payee)
  issued_by: string; // the attester (the payer)
  settlement: SettlementRecord; // the settlement that backs and pays for this attestation
  rating: number; // [0,1] — 0 is a fully negative attestation, 1 a fully positive one
  claim?: string;
  ts: number;
  sig: string;
}

export function createAttestation(
  issuer: Identity,
  params: { subject: string; settlement: SettlementRecord; rating: number; claim?: string },
): Attestation {
  // A negative attestation is rating→0, never rating<0: the trust function
  // weights ratings in [0,1], so out-of-range values would silently distort it.
  if (!(params.rating >= 0 && params.rating <= 1)) {
    throw new Error("rating must be in [0,1]");
  }
  const base = {
    v: "aleph/0.1",
    subject: params.subject,
    issued_by: issuer.did,
    settlement: params.settlement,
    rating: params.rating,
    claim: params.claim,
    ts: Date.now(),
  };
  const sig = signEd25519(DOMAIN.attestation, base, issuer.privateKey);
  return { ...base, sig };
}

// An attestation counts ONLY if backed by a valid, released, non-trivial
// settlement between exactly the attester (payer) and the subject (payee).
export function verifyAttestation(att: Attestation): { ok: boolean; reason?: string } {
  const { sig, ...base } = att;
  try {
    if (!verifyByDid(att.issued_by, DOMAIN.attestation, base, sig)) {
      return { ok: false, reason: "bad attestation signature" };
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (!(att.rating >= 0 && att.rating <= 1)) {
    return { ok: false, reason: "rating out of range" };
  }

  const s = att.settlement;
  if (!s) return { ok: false, reason: "no settlement backing" };
  const sv = verifySettlement(s);
  if (!sv.ok) return { ok: false, reason: "settlement invalid: " + sv.reason };
  if (s.status !== "released") return { ok: false, reason: "settlement not released" };
  if (s.payer !== att.issued_by) return { ok: false, reason: "attester is not the payer" };
  if (s.payee !== att.subject) return { ok: false, reason: "subject is not the payee" };
  if (s.amount <= 0) return { ok: false, reason: "zero-value settlement" };
  return { ok: true };
}

// --- The trust policy (consumer-controlled, default specified) ---------------

export interface TrustPolicy {
  // Diminishing-returns weight for an issuer's total (decayed) settled value.
  // Default log(1+v): repeated business from the SAME payer saturates, so a
  // wash-trader recycling a few counterparties cannot inflate trust by volume.
  issuerWeight?: (decayedValueFromIssuer: number) => number;
  // Time-decay multiplier in [0,1] for an attestation of the given age (ms).
  // Default: exponential half-life (recent custom outweighs ancient custom).
  decay?: (ageMs: number) => number;
  // Half-life for the DEFAULT decay (ms). Ignored if `decay` is supplied.
  halfLifeMs?: number;
  // Confidence scale k in confidence = 1 - exp(-W/k): larger k demands more
  // independent evidence to be confident. Default 5.
  confidenceScale?: number;
  // Reference time (ms epoch) for decay. Default Date.now(); inject for tests.
  now?: number;
}

export interface IssuerBreakdown {
  issuer: string; // the attesting DID
  value: number; // raw (undecayed) settled value from this issuer
  weight: number; // issuerWeight(decayed value) — contribution to total weight W
  rating: number; // decayed-value-weighted mean rating from this issuer ∈ [0,1]
  n: number; // counted attestations from this issuer
}

export interface TrustScore {
  reputation: number; // score * confidence ∈ [0,1) — the single comparable ranking value
  score: number; // diversity-weighted mean rating ∈ [0,1]
  confidence: number; // 1 - exp(-W/k) ∈ [0,1) — grows with independent, recent evidence
  count: number; // counted attestations (verified, deduped, non-revoked)
  distinctIssuers: number;
  totalValue: number; // raw settled value backing counted attestations
  weight: number; // W = Σ issuer weights (decayed) — the auditable evidence mass
  perIssuer: IssuerBreakdown[]; // every input exposed so the policy is auditable
}

const DAY_MS = 86_400_000;
export const DEFAULT_HALF_LIFE_MS = 180 * DAY_MS;
export const DEFAULT_CONFIDENCE_SCALE = 5;

// The specified default policy. Exposed so consumers can see exactly what they
// are overriding, and so docs/tests reference a single source of truth.
export const DEFAULT_TRUST_POLICY: Required<Omit<TrustPolicy, "now" | "decay">> = {
  issuerWeight: (v) => Math.log1p(v),
  halfLifeMs: DEFAULT_HALF_LIFE_MS,
  confidenceScale: DEFAULT_CONFIDENCE_SCALE,
};

// Consumer-computed trust. Verify each attestation, dedupe by settlement (one
// payment backs at most one attestation), GROUP BY ISSUER and apply per-issuer
// diminishing returns (so 100 attestations from one payer ≪ 100 distinct
// payers), decay by age, and fold confidence in. The result is fully auditable:
// `perIssuer` exposes every input the score is built from.
export function computeTrust(attestations: Attestation[], policy: TrustPolicy = {}): TrustScore {
  const now = policy.now ?? Date.now();
  const halfLife = policy.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const decay = policy.decay ?? ((age: number) => Math.pow(0.5, age / halfLife));
  const issuerWeight = policy.issuerWeight ?? DEFAULT_TRUST_POLICY.issuerWeight;
  const k = policy.confidenceScale ?? DEFAULT_CONFIDENCE_SCALE;

  const seen = new Set<string>(); // settlement ids — dedupe so a payment counts once
  const byIssuer = new Map<string, { dvalue: number; weightedRating: number; rawValue: number; n: number }>();
  let count = 0;
  let totalValue = 0;

  for (const att of attestations) {
    if (!verifyAttestation(att).ok) continue; // unbacked / invalid => zero weight
    const id = att.settlement.escrowId;
    if (seen.has(id)) continue;
    seen.add(id);
    const age = Math.max(0, now - att.ts);
    const d = Math.min(1, Math.max(0, decay(age)));
    const dv = att.settlement.amount * d;
    const g = byIssuer.get(att.issued_by) ?? { dvalue: 0, weightedRating: 0, rawValue: 0, n: 0 };
    g.dvalue += dv;
    g.weightedRating += att.rating * dv;
    g.rawValue += att.settlement.amount;
    g.n += 1;
    byIssuer.set(att.issued_by, g);
    count++;
    totalValue += att.settlement.amount;
  }

  let weight = 0;
  let scoreNum = 0;
  const perIssuer: IssuerBreakdown[] = [];
  for (const [issuer, g] of byIssuer) {
    const w = issuerWeight(g.dvalue);
    const rating = g.dvalue > 0 ? g.weightedRating / g.dvalue : 0;
    weight += w;
    scoreNum += w * rating;
    perIssuer.push({ issuer, value: g.rawValue, weight: w, rating, n: g.n });
  }

  const score = weight > 0 ? scoreNum / weight : 0;
  const confidence = weight > 0 ? 1 - Math.exp(-weight / k) : 0;
  return {
    reputation: score * confidence,
    score,
    confidence,
    count,
    distinctIssuers: byIssuer.size,
    totalValue,
    weight,
    perIssuer,
  };
}
