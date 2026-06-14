// PROVE, in depth: receipts chain into a tamper-evident provenance DAG.
// Each receipt references the hash of the prior receipts via body.prev[].
// The agent hands its principal the *head* of the chain; the whole task is
// then independently auditable — every step verified, every link present.

import { verifyEnvelope, type Envelope } from "../envelope";
import { hashObject } from "../hash";

export type ChainCheck = { ok: boolean; steps: number; reason?: string };

// Verify a linear chain of receipts (oldest first). Each receipt must:
//  - carry a valid signature,
//  - be of type RECEIPT,
//  - reference the previous receipt's hash in its prev[] (except the root).
export function verifyReceiptChain(chain: Envelope[]): ChainCheck {
  if (chain.length === 0) return { ok: false, steps: 0, reason: "empty chain" };

  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (!r) return { ok: false, steps: i, reason: `step ${i}: missing receipt` };
    if (r.type !== "RECEIPT") return { ok: false, steps: i, reason: `step ${i}: not a RECEIPT` };
    const v = verifyEnvelope(r);
    if (!v.ok) return { ok: false, steps: i, reason: `step ${i}: ${v.reason}` };

    if (i > 0) {
      const prevReceipt = chain[i - 1];
      if (!prevReceipt) return { ok: false, steps: i, reason: `step ${i}: missing previous receipt` };
      const prevHash = hashObject(prevReceipt);
      const prev = (r.body.prev as string[] | undefined) ?? [];
      if (!prev.includes(prevHash)) {
        return { ok: false, steps: i, reason: `step ${i}: broken link to previous receipt` };
      }
    }
  }
  return { ok: true, steps: chain.length };
}

// Convenience: the hash an agent should put in the next INVOKE's prev[] to
// chain it to a receipt it just received.
export function linkTo(receipt: Envelope): string {
  return hashObject(receipt);
}
