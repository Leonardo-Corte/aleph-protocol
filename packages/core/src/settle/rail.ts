// The settlement rail: an in-memory escrow ledger with a stable usage-credit
// unit. It models lock / release / refund with the correct semantics, behind
// an interface a real chain rail can later replace. Settlement records are
// signed by the rail's identity so a receipt's settle_ref is verifiable.
//
// The stable unit is a NON-REFUNDABLE usage credit once released (the legal
// guardrail that keeps it from being unauthorized e-money); while still locked
// in escrow it can be refunded on failure.

import { sign, verify } from "node:crypto";
import { generateIdentity, publicKeyFromDid, type Identity } from "../identity";
import { canonicalize } from "../canonical";

export type EscrowStatus = "locked" | "released" | "refunded";

export type Escrow = {
  id: string;
  payer: string;
  payee: string;
  amount: number;
  invokeRef: string;
  status: EscrowStatus;
};

export type SettlementRecord = {
  escrowId: string;
  payer: string;
  payee: string;
  amount: number;
  unit: "stable";
  invokeRef: string;
  status: "released" | "refunded";
  rail: string;
  ts: number;
  sig: string;
};

export class SettlementRail {
  identity: Identity;
  private balances: Map<string, number>;
  private escrows: Map<string, Escrow>;
  private seq: number;

  constructor(identity?: Identity) {
    this.identity = identity ?? generateIdentity();
    this.balances = new Map();
    this.escrows = new Map();
    this.seq = 0;
  }

  get did(): string {
    return this.identity.did;
  }

  balanceOf(did: string): number {
    return this.balances.get(did) ?? 0;
  }

  // Fiat on-ramp. Crediting real value is the honestly-open reserve boundary
  // (the chain proves what happens inside; it cannot prove the off-chain money).
  deposit(did: string, amount: number): void {
    this.balances.set(did, this.balanceOf(did) + amount);
  }

  lock(
    payer: string,
    payee: string,
    amount: number,
    invokeRef: string,
  ): { ok: true; escrow: Escrow } | { ok: false; reason: string } {
    if (amount < 0) return { ok: false, reason: "negative amount" };
    if (this.balanceOf(payer) < amount) return { ok: false, reason: "insufficient funds" };
    this.balances.set(payer, this.balanceOf(payer) - amount);
    const escrow: Escrow = {
      id: "esc-" + ++this.seq,
      payer,
      payee,
      amount,
      invokeRef,
      status: "locked",
    };
    this.escrows.set(escrow.id, escrow);
    return { ok: true, escrow };
  }

  get(escrowId: string): Escrow | undefined {
    return this.escrows.get(escrowId);
  }

  release(escrowId: string): SettlementRecord {
    const e = this.mustLocked(escrowId);
    this.balances.set(e.payee, this.balanceOf(e.payee) + e.amount);
    e.status = "released";
    return this.record(e, "released");
  }

  refund(escrowId: string): SettlementRecord {
    const e = this.mustLocked(escrowId);
    this.balances.set(e.payer, this.balanceOf(e.payer) + e.amount);
    e.status = "refunded";
    return this.record(e, "refunded");
  }

  private mustLocked(escrowId: string): Escrow {
    const e = this.escrows.get(escrowId);
    if (!e) throw new Error("unknown escrow: " + escrowId);
    if (e.status !== "locked") throw new Error("escrow not locked: " + escrowId);
    return e;
  }

  private record(e: Escrow, status: "released" | "refunded"): SettlementRecord {
    const base = {
      escrowId: e.id,
      payer: e.payer,
      payee: e.payee,
      amount: e.amount,
      unit: "stable" as const,
      invokeRef: e.invokeRef,
      status,
      rail: this.did,
      ts: Date.now(),
    };
    const sig = sign(null, Buffer.from(canonicalize(base)), this.identity.privateKey).toString("base64url");
    return { ...base, sig };
  }
}

// Anyone can verify a settlement record against the rail's DID.
export function verifySettlement(rec: SettlementRecord): { ok: boolean; reason?: string } {
  const { sig, ...base } = rec;
  try {
    const pub = publicKeyFromDid(rec.rail);
    const ok = verify(null, Buffer.from(canonicalize(base)), pub, Buffer.from(sig, "base64url"));
    return ok ? { ok: true } : { ok: false, reason: "bad settlement signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
