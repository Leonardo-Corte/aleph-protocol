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
import { isDidPkh, parseDidPkh } from "../pkh";
import { verifySettlement, type SettlementRecord } from "../settle/rail";
import { DOMAIN, signEd25519, isSigner, verifyByDid, type Signer } from "../signing";

// An on-chain settlement (e.g. AlephEscrow via the EVM rail). Structurally
// described here so core stays viem-free; the EVM rail's record satisfies it.
// Its authenticity is proven by RE-READING THE CHAIN (async), not a signature,
// and its payer/payee are blockchain ADDRESSES — bound to the attester/subject
// DIDs only when those are did:pkh (the on-chain identity).
export interface OnChainSettlementRef {
  rail: "evm";
  escrowId: string;
  payer: string; // 0x address
  payee: string; // 0x address
  amount: string; // base units (decimal string)
  status: "released" | "refunded";
  chainId: number;
  escrowAddress: string;
  txHash: string;
  ts: number;
}

export type AttestationSettlement = SettlementRecord | OnChainSettlementRef;

export function isOnChainSettlement(s: AttestationSettlement): s is OnChainSettlementRef {
  return (s as OnChainSettlementRef).rail === "evm";
}

// The settled value as a number, regardless of rail (the reference rail stores a
// number; the on-chain rail a base-units decimal string).
export function settledAmount(s: AttestationSettlement): number {
  return typeof s.amount === "number" ? s.amount : Number(s.amount);
}

export interface Attestation {
  v: string;
  subject: string; // the party being attested about (the payee)
  issued_by: string; // the attester (the payer)
  settlement: AttestationSettlement; // the settlement that backs and pays for this attestation
  rating: number; // [0,1] — 0 is a fully negative attestation, 1 a fully positive one
  claim?: string;
  ts: number;
  sig: string;
}

export function createAttestation(
  issuer: Identity | Signer,
  params: {
    subject: string;
    settlement: AttestationSettlement;
    rating: number;
    claim?: string;
    ts?: number; // override the timestamp (e.g. importing history); default now
  },
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
    ts: params.ts ?? Date.now(),
  };
  const sig = isSigner(issuer)
    ? issuer.sign(DOMAIN.attestation, base)
    : signEd25519(DOMAIN.attestation, base, issuer.privateKey);
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
  // On-chain settlements cannot be verified synchronously — their authenticity
  // is the chain itself. Reject here (so sync computeTrust never counts an
  // unverified on-chain ref) and verify them via verifyAttestationOnChain.
  if (isOnChainSettlement(s)) {
    return { ok: false, reason: "on-chain settlement requires async chain verification" };
  }
  const sv = verifySettlement(s);
  if (!sv.ok) return { ok: false, reason: "settlement invalid: " + sv.reason };
  if (s.status !== "released") return { ok: false, reason: "settlement not released" };
  if (s.payer !== att.issued_by) return { ok: false, reason: "attester is not the payer" };
  if (s.payee !== att.subject) return { ok: false, reason: "subject is not the payee" };
  if (s.amount <= 0) return { ok: false, reason: "zero-value settlement" };
  return { ok: true };
}

// Verify an on-chain-backed attestation: signature + rating + the did:pkh
// address binding (the attester's DID address IS the escrow payer; the subject's
// IS the payee), then RE-READ THE CHAIN via the injected verifier to confirm the
// escrow is real and released. A reference-rail attestation falls back to the
// sync check. This is the path the node's /attest and computeTrustAsync use when
// settlement is on-chain — a fabricated reference is rejected by reading the chain.
export async function verifyAttestationOnChain(
  att: Attestation,
  readChain: (s: OnChainSettlementRef) => Promise<{ ok: boolean; reason?: string }>,
): Promise<{ ok: boolean; reason?: string }> {
  const s = att.settlement;
  if (!isOnChainSettlement(s)) return verifyAttestation(att);

  const { sig, ...base } = att;
  try {
    if (!verifyByDid(att.issued_by, DOMAIN.attestation, base, sig)) {
      return { ok: false, reason: "bad attestation signature" };
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (!(att.rating >= 0 && att.rating <= 1)) return { ok: false, reason: "rating out of range" };
  if (s.status !== "released") return { ok: false, reason: "settlement not released" };
  if (!(Number(s.amount) > 0)) return { ok: false, reason: "zero-value settlement" };

  // DID↔address binding (needs did:pkh on both sides): "who I am" == "who paid".
  try {
    if (parseDidPkh(att.issued_by).address !== s.payer.toLowerCase()) {
      return { ok: false, reason: "attester DID address is not the on-chain payer" };
    }
    if (parseDidPkh(att.subject).address !== s.payee.toLowerCase()) {
      return { ok: false, reason: "subject DID address is not the on-chain payee" };
    }
  } catch {
    return { ok: false, reason: "on-chain attestation requires did:pkh attester and subject" };
  }

  // Finally, the chain itself: the escrow exists, released, with these parties.
  return readChain(s);
}

// True iff the DID can be bound to an on-chain address (did:pkh). Exported so
// callers can require it before an on-chain attestation.
export function bindsOnChain(did: string): boolean {
  return isDidPkh(did);
}

// --- Revocation --------------------------------------------------------------
// An issuer who attested in error can publish a signed revocation referencing
// the attestation (by its signature). Only the ORIGINAL issuer can revoke its
// own attestation: the revocation is signed by the same DID, and computeTrust
// only honours a revocation whose issuer matches the attestation's issuer.

export interface Revocation {
  v: string;
  attestation_sig: string; // the sig of the attestation being revoked (its unique id)
  issued_by: string; // must equal the revoked attestation's issued_by
  ts: number;
  sig: string;
}

export function createRevocation(issuer: Identity, attestationSig: string): Revocation {
  const base = {
    v: "aleph/0.1",
    attestation_sig: attestationSig,
    issued_by: issuer.did,
    ts: Date.now(),
  };
  const sig = signEd25519(DOMAIN.revocation, base, issuer.privateKey);
  return { ...base, sig };
}

export function verifyRevocation(rev: Revocation): { ok: boolean; reason?: string } {
  const { sig, ...base } = rev;
  try {
    if (!verifyByDid(rev.issued_by, DOMAIN.revocation, base, sig)) {
      return { ok: false, reason: "bad revocation signature" };
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
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
export function computeTrust(
  attestations: Attestation[],
  policy: TrustPolicy = {},
  revocations: Revocation[] = [],
): TrustScore {
  // Synchronous path: verify each attestation against the in-memory reference
  // rail (signature + structural + settlement signature), then score.
  return score(
    attestations.filter((att) => verifyAttestation(att).ok),
    policy,
    revocations,
  );
}

// A consumer-injected hook that decides whether an attestation counts — e.g. by
// re-reading a blockchain to confirm its settlement is real. Returning ok=false
// excludes the attestation, so a FABRICATED settlement reference earns nothing.
// core stays I/O-free: the chain reader lives in the rail package that owns it.
export type AttestationVerifier = (att: Attestation) => Promise<{ ok: boolean; reason?: string }>;

// Asynchronous trust: identical scoring to computeTrust, but an injected
// verifier owns the "does this attestation count?" decision. The default is the
// sync verifyAttestation (in-memory rail); an on-chain rail supplies a verifier
// that re-reads the chain, satisfying "trust computed from on-chain-verified
// settlements — a fabricated reference is rejected by reading the chain".
export async function computeTrustAsync(
  attestations: Attestation[],
  opts: { policy?: TrustPolicy; revocations?: Revocation[]; verifier?: AttestationVerifier } = {},
): Promise<TrustScore> {
  const verifier = opts.verifier ?? ((att: Attestation) => Promise.resolve(verifyAttestation(att)));
  const verified: Attestation[] = [];
  for (const att of attestations) {
    if ((await verifier(att)).ok) verified.push(att);
  }
  return score(verified, opts.policy ?? {}, opts.revocations ?? []);
}

// The scoring kernel: takes already-VERIFIED attestations and applies dedupe,
// revocation, issuer grouping, decay, diversity weight, and confidence. Shared
// by the sync and async entry points so the policy lives in exactly one place.
function score(verified: Attestation[], policy: TrustPolicy, revocations: Revocation[]): TrustScore {
  const now = policy.now ?? Date.now();
  const halfLife = policy.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const decay = policy.decay ?? ((age: number) => Math.pow(0.5, age / halfLife));
  const issuerWeight = policy.issuerWeight ?? DEFAULT_TRUST_POLICY.issuerWeight;
  const k = policy.confidenceScale ?? DEFAULT_CONFIDENCE_SCALE;

  // A revocation only bites if it is validly signed; the issuer-match check is
  // applied per attestation below (only the original issuer can revoke its own).
  const revokedBy = new Map<string, string>(); // attestation_sig -> revoker DID
  for (const rev of revocations) {
    if (verifyRevocation(rev).ok) revokedBy.set(rev.attestation_sig, rev.issued_by);
  }

  const seen = new Set<string>(); // settlement ids — dedupe so a payment counts once
  const byIssuer = new Map<string, { dvalue: number; weightedRating: number; rawValue: number; n: number }>();
  let count = 0;
  let totalValue = 0;

  for (const att of verified) {
    if (revokedBy.get(att.sig) === att.issued_by) continue; // revoked by its own issuer
    const id = att.settlement.escrowId;
    if (seen.has(id)) continue;
    seen.add(id);
    const age = Math.max(0, now - att.ts);
    const d = Math.min(1, Math.max(0, decay(age)));
    const amount = settledAmount(att.settlement);
    const dv = amount * d;
    const g = byIssuer.get(att.issued_by) ?? { dvalue: 0, weightedRating: 0, rawValue: 0, n: 0 };
    g.dvalue += dv;
    g.weightedRating += att.rating * dv;
    g.rawValue += amount;
    g.n += 1;
    byIssuer.set(att.issued_by, g);
    count++;
    totalValue += amount;
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
