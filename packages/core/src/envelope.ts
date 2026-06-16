// The Envelope: the thin universal waist. Every Aleph message is a signed,
// addressed, stateless Envelope between two DIDs, carrying one of five types.
// This is the "IP packet" of the agentic web. Signatures are domain-separated
// (an envelope signature cannot be reused as a grant/attestation/…).

import { randomUUID } from "node:crypto";
import { type Identity } from "./identity";
import { DOMAIN, signWith, verifyByDid, type Signer } from "./signing";

export const PROTOCOL_VERSION = "aleph/0.1";

export type EnvelopeType = "RESOLVE" | "INVOKE" | "RECEIPT" | "ATTEST" | "SETTLE";

export interface Envelope {
  v: string;
  from: string;
  to: string;
  type: EnvelopeType;
  nonce: string;
  ts: number;
  body: Record<string, unknown>;
  sig?: string;
}

export function createEnvelope(
  params: { from: string; to: string; type: EnvelopeType; body: Record<string, unknown> },
  // Ed25519 key (the common case) or any Signer (secp256k1 did:key / did:pkh).
  privateKey: Identity["privateKey"] | Signer,
): Envelope {
  // Build the unsigned Envelope, sign its domain-separated canonical form.
  const env: Envelope = {
    v: PROTOCOL_VERSION,
    from: params.from,
    to: params.to,
    type: params.type,
    nonce: randomUUID(),
    ts: Date.now(),
    body: params.body,
  };
  env.sig = signWith(privateKey, DOMAIN.envelope, env);
  return env;
}

export function verifyEnvelope(env: Envelope): { ok: boolean; reason?: string } {
  if (!env.sig) return { ok: false, reason: "missing signature" };
  if (env.v.split("/")[0] !== "aleph") return { ok: false, reason: "unknown protocol family" };
  const { sig, ...unsigned } = env;
  try {
    // Suite-agnostic: the signer's DID declares Ed25519 or secp256k1.
    const ok = verifyByDid(env.from, DOMAIN.envelope, unsigned, sig);
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
