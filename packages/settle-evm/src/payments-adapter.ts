// Adapters that present the on-chain EvmSettlementRail through @aleph/core's
// injectable settlement seam (PayerRail / PayeeRail), so the SAME client.invoke
// and compose flow moves REAL value on-chain with no change to agent/node code.
//
// The agent's payer rail LOCKS (approve + lock) and later RELEASES on verified
// delivery; the node's payee rail only VERIFIES the lock by reading the chain.
// Protocol-unit prices are mapped to token base units via the token's decimals
// (the fiat/token boundary). Binding the on-chain payee address to the node's
// DID is did:pkh territory (deferred): until then the node's signed Manifest
// asserts its payout address, which the agent passes as `payeeAddress`.

import { randomUUID } from "node:crypto";
import type { EscrowRef, LockParams, LockResult, PayeeRail, PayerRail } from "@aleph/core";
import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { EvmSettlementRail, escrowIdFor, type EvmSettlementRecord } from "./rail";

// On-chain escrow status enum (AlephEscrow): None=0, Locked=1, Released=2, Refunded=3.
const LOCKED = 1;

export interface EvmRailUnit {
  decimals: number; // settlement-token decimals (e.g. 6 for USDC)
  chainId: number;
  escrowAddress: Address;
  deadlineSeconds?: number; // refund window; default 1h
}

// Agent side: lock to the node's payout address, release/refund with the agent key.
export function evmPayerRail(rail: EvmSettlementRail, cfg: EvmRailUnit): PayerRail<EvmSettlementRecord> {
  const id = `evm:${cfg.chainId}:${cfg.escrowAddress}`;
  return {
    get id() {
      return id;
    },
    async lockEscrow(p: LockParams): Promise<LockResult> {
      if (!p.payeeAddress) {
        return { ok: false, reason: "EVM rail requires a payee address (from the node's Manifest)" };
      }
      try {
        const escrowId = escrowIdFor(p.invokeRef, randomUUID());
        const amount = parseUnits(String(p.amount), cfg.decimals);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + (cfg.deadlineSeconds ?? 3600));
        const { txHash } = await rail.lock({
          id: escrowId,
          payee: p.payeeAddress as Address,
          amount,
          invokeRef: keccak256(toHex(p.invokeRef)),
          deadline,
        });
        const ref: EscrowRef = {
          rail: id,
          escrowId,
          amount: p.amount,
          chainId: cfg.chainId,
          escrowAddress: cfg.escrowAddress,
          payeeAddress: p.payeeAddress,
          txHash,
        };
        return { ok: true, ref };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
    releaseEscrow(ref: EscrowRef): Promise<EvmSettlementRecord> {
      return rail.release(ref.escrowId as Hex);
    },
    refundEscrow(ref: EscrowRef): Promise<EvmSettlementRecord> {
      return rail.refund(ref.escrowId as Hex);
    },
  };
}

// Node side: verify the agent locked the right amount to THIS node's address for
// this invocation. The node cannot move the funds — only the payer can.
export function evmPayeeRail(
  rail: EvmSettlementRail,
  cfg: { decimals: number; payeeAddress: Address },
): PayeeRail {
  return {
    async verifyLock(ref: EscrowRef, expect: { payee: string; minAmount: number; payer?: string }) {
      try {
        const e = await rail.getEscrow(ref.escrowId as Hex);
        if (e.status !== LOCKED) return { ok: false, reason: "escrow not locked on chain" };
        if (e.payee.toLowerCase() !== cfg.payeeAddress.toLowerCase()) {
          return { ok: false, reason: "on-chain payee is not this node" };
        }
        if (e.amount < parseUnits(String(expect.minAmount), cfg.decimals)) {
          return { ok: false, reason: "on-chain escrow below price" };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    },
  };
}
