// Key rotation with validity windows. A logical identity (e.g. a did:web node)
// can rotate the key under it without losing its identity: each key is recorded
// with the time window it was valid, and a signature is verified against the key
// that was valid at the message's timestamp. Old receipts stay verifiable; new
// ones use the new key. (Pure: no I/O.)

import { publicKeyFromDid } from "./identity";
import type { Domain } from "./signing";
import { verifyEd25519 } from "./signing";

export interface KeyEpoch {
  did: string; // the did:key of the key used in this epoch
  validFrom: number; // inclusive (ms epoch)
  validUntil?: number; // exclusive; undefined = still current
}

// An append-only ring of key epochs for one logical identity, newest last.
export class KeyRing {
  private epochs: KeyEpoch[] = [];

  // Rotate to a new key, closing the previous epoch at `at`.
  rotate(newKeyDid: string, at: number): void {
    const prev = this.epochs[this.epochs.length - 1];
    if (prev && prev.validUntil === undefined) prev.validUntil = at;
    this.epochs.push({ did: newKeyDid, validFrom: at });
  }

  // The key DID that was valid at time `ts`, or undefined if none.
  keyAt(ts: number): string | undefined {
    for (const e of this.epochs) {
      if (ts >= e.validFrom && (e.validUntil === undefined || ts < e.validUntil)) return e.did;
    }
    return undefined;
  }

  list(): readonly KeyEpoch[] {
    return this.epochs;
  }
}

// Verify a signature against the key that was valid at `ts` in the ring.
export function verifyAtTime(
  ring: KeyRing,
  ts: number,
  domain: Domain,
  obj: unknown,
  sigB64: string,
): { ok: boolean; reason?: string } {
  const keyDid = ring.keyAt(ts);
  if (!keyDid) return { ok: false, reason: "no key valid at the given time" };
  try {
    const ok = verifyEd25519(domain, obj, sigB64, publicKeyFromDid(keyDid));
    return ok ? { ok: true } : { ok: false, reason: "bad signature for the epoch key" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
