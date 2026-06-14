// The TRUST verb. An attestation is a signed statement about a counterparty,
// REQUIRING a reference to a real, released settlement between the attester and
// the subject. This is the anti-Sybil rule, enforced: free attestations are
// worthless; weight is bought with settled value, which is expensive to forge.
//
// Trust is computed by the CONSUMER, never dictated by a central score: an
// agent downloads raw attestations, verifies each, discards the unbacked, and
// weights by settled value with its own policy.

import { publicKeyFromDid, type Identity } from "../identity";
import { verifySettlement, type SettlementRecord } from "../settle/rail";
import { DOMAIN, signEd25519, verifyEd25519 } from "../signing";

export interface Attestation {
  v: string;
  subject: string; // the party being attested about (the payee)
  issued_by: string; // the attester (the payer)
  settlement: SettlementRecord; // the settlement that backs and pays for this attestation
  rating: number; // [0,1]
  claim?: string;
  ts: number;
  sig: string;
}

export function createAttestation(
  issuer: Identity,
  params: { subject: string; settlement: SettlementRecord; rating: number; claim?: string },
): Attestation {
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
    const pub = publicKeyFromDid(att.issued_by);
    if (!verifyEd25519(DOMAIN.attestation, base, sig, pub)) {
      return { ok: false, reason: "bad attestation signature" };
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
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

// Consumer-computed trust: verify each, dedupe by settlement (so one payment
// cannot be reused to inflate), weight rating by settled value.
export function computeTrust(attestations: Attestation[]): {
  score: number;
  count: number;
  totalValue: number;
} {
  let weighted = 0;
  let totalValue = 0;
  let count = 0;
  const seen = new Set<string>();
  for (const att of attestations) {
    if (!verifyAttestation(att).ok) continue; // unbacked => zero weight
    const id = att.settlement.escrowId;
    if (seen.has(id)) continue; // one settlement backs at most one attestation
    seen.add(id);
    const w = att.settlement.amount;
    weighted += att.rating * w;
    totalValue += w;
    count++;
  }
  return { score: totalValue > 0 ? weighted / totalValue : 0, count, totalValue };
}
