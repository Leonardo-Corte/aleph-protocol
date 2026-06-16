// The settlement seam between the agent and the node — an injectable, async
// interface so the SAME invoke/compose flow works over the in-memory reference
// rail (dev/tests) and the on-chain EVM rail (real value), with no change to the
// agent or node code.
//
// The trust model follows AlephEscrow exactly: the PAYER (agent) locks, the node
// only VERIFIES the lock (it cannot move funds — that is the trustless property),
// and the PAYER RELEASES after it has verified the delivered receipt (or refunds
// on failure / via the deadline). This is "pay on verified delivery".

import type { SettlementRecord } from "./rail";

// A reference to a locked escrow, carried in the INVOKE body and used by the
// node to verify and by the agent to settle. `escrowId` + `rail` identify it;
// extra fields (txHash, chainId, escrowAddress, deadline) ride along as proof.
export interface EscrowRef {
  rail: string;
  escrowId: string;
  amount: number; // protocol-unit amount (the price); rails map this to their unit
  [field: string]: unknown;
}

export interface LockParams {
  payer: string; // the agent's DID (the in-memory rail debits it; EVM uses its key)
  payee: string; // the node's DID
  amount: number;
  invokeRef: string; // binds the escrow to this invocation
}

export type LockResult = { ok: true; ref: EscrowRef } | { ok: false; reason: string };

// Agent side: lock funds, then settle once the receipt is verified.
export interface PayerRail {
  readonly id: string;
  lockEscrow(p: LockParams): Promise<LockResult>;
  releaseEscrow(ref: EscrowRef): Promise<SettlementRecord>;
  refundEscrow(ref: EscrowRef): Promise<SettlementRecord>;
}

// Node side: verify a lock matches the expected terms. The node cannot release
// or refund — only the payer can — so a node can never take funds it wasn't paid.
export interface PayeeRail {
  verifyLock(
    ref: EscrowRef,
    expect: { payee: string; minAmount: number; payer?: string },
  ): Promise<{ ok: boolean; reason?: string }>;
}

// The in-memory reference rail is a single shared object that is both (payer and
// payee share it); the EVM rails are separate per-party clients to the chain.
export type AgentRail = PayerRail & PayeeRail;
