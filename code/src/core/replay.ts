// Receive-side hardening for the thin waist: a stateful guard that wraps the
// pure signature check with replay protection (nonce window), clock-skew
// rejection, and major-version checking. Nodes and registries run every
// inbound Envelope through verifyReceived before acting on it.

import { verifyEnvelope, PROTOCOL_VERSION, type Envelope } from "./envelope.ts";
import type { AlephErrorCode } from "./errors.ts";

const OUR_MAJOR = (PROTOCOL_VERSION.split("/")[1] ?? "").split(".")[0]; // "0"

// Remembers (from, nonce) pairs within a sliding window so a captured Envelope
// cannot be replayed.
export class NonceStore {
  private seen: Map<string, number>;
  private windowMs: number;

  constructor(windowMs = 600_000) {
    this.seen = new Map();
    this.windowMs = windowMs;
  }

  checkAndRecord(from: string, nonce: string, ts: number): boolean {
    this.gc();
    const key = from + "|" + nonce;
    if (this.seen.has(key)) return false;
    this.seen.set(key, ts);
    return true;
  }

  private gc(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [k, ts] of this.seen) if (ts < cutoff) this.seen.delete(k);
  }
}

export function verifyReceived(
  env: Envelope,
  opts: { nonceStore: NonceStore; skewMs?: number },
): { ok: boolean; code?: AlephErrorCode; reason?: string } {
  const sig = verifyEnvelope(env);
  if (!sig.ok) return { ok: false, code: "ENVELOPE_INVALID", reason: sig.reason };

  const major = (env.v.split("/")[1] ?? "").split(".")[0];
  if (major !== OUR_MAJOR) {
    return { ok: false, code: "VERSION_UNSUPPORTED", reason: "unsupported major version: " + env.v };
  }

  const skew = opts.skewMs ?? 300_000;
  if (typeof env.ts !== "number" || Math.abs(Date.now() - env.ts) > skew) {
    return { ok: false, code: "CLOCK_SKEW", reason: "timestamp outside skew window" };
  }

  if (typeof env.nonce !== "string" || !opts.nonceStore.checkAndRecord(env.from, env.nonce, env.ts)) {
    return { ok: false, code: "REPLAY", reason: "nonce missing or already seen" };
  }

  return { ok: true };
}
