// The Envelope: the thin universal waist. Every Aleph message is a signed,
// addressed, stateless Envelope between two DIDs, carrying one of five types.
// This is the "IP packet" of the agentic web.

import { sign, verify, randomUUID } from "node:crypto";
import { canonicalize } from "./canonical";
import { publicKeyFromDid, type Identity } from "./identity";

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
  privateKey: Identity["privateKey"],
): Envelope {
  // Build the unsigned Envelope, sign its canonical form, then attach the sig.
  const env: Envelope = {
    v: PROTOCOL_VERSION,
    from: params.from,
    to: params.to,
    type: params.type,
    nonce: randomUUID(),
    ts: Date.now(),
    body: params.body,
  };
  const signature = sign(null, Buffer.from(canonicalize(env)), privateKey);
  env.sig = signature.toString("base64url");
  return env;
}

export function verifyEnvelope(env: Envelope): { ok: boolean; reason?: string } {
  if (!env.sig) return { ok: false, reason: "missing signature" };
  if (env.v.split("/")[0] !== "aleph") return { ok: false, reason: "unknown protocol family" };
  const { sig, ...unsigned } = env;
  try {
    const pub = publicKeyFromDid(env.from);
    const ok = verify(null, Buffer.from(canonicalize(unsigned)), pub, Buffer.from(sig, "base64url"));
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
