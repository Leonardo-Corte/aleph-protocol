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
import type {
  Attestation,
  EscrowRef,
  LockParams,
  LockResult,
  OnChainSettlementRef,
  PayeeRail,
  PayerRail,
} from "@aleph/core";
import { verifyAttestation, verifyAttestationOnChain, isOnChainSettlement } from "@aleph/core";
import { defineChain, keccak256, parseUnits, toHex, type Address, type Chain, type Hex } from "viem";
import * as chains from "viem/chains";
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

// An attestation verifier for a node's /attest endpoint: reference-rail
// attestations verify synchronously; on-chain-backed ones re-read the chain
// (the escrow exists, released, with the bound parties) AND check the did:pkh
// address binding — so a fabricated on-chain reference, or one whose attester/
// subject DIDs don't match the escrow's payer/payee addresses, is rejected.
export function evmAttestationVerifier(
  rail: EvmSettlementRail,
): (att: Attestation) => Promise<{ ok: boolean; reason?: string }> {
  return (att) => {
    if (!isOnChainSettlement(att.settlement)) return Promise.resolve(verifyAttestation(att));
    return verifyAttestationOnChain(att, (s: OnChainSettlementRef) =>
      rail.verify(s as unknown as EvmSettlementRecord),
    );
  };
}

// Build an agent payer rail from environment variables, or return undefined if
// unconfigured (so a host falls back to free-only). A deployed MCP agent sets
// these to pay priced nodes with real value. The fiat/token decimals boundary
// is explicit (ALEPH_EVM_DECIMALS).
export function evmPayerRailFromEnv(
  env: Record<string, string | undefined> = process.env,
): PayerRail<EvmSettlementRecord> | undefined {
  const rpcUrl = env.ALEPH_EVM_RPC;
  const escrowAddress = env.ALEPH_EVM_ESCROW as Address | undefined;
  const tokenAddress = env.ALEPH_EVM_TOKEN as Address | undefined;
  const privateKey = env.ALEPH_EVM_KEY as Hex | undefined;
  if (!rpcUrl || !escrowAddress || !tokenAddress || !privateKey) return undefined;

  const chainId = Number(env.ALEPH_EVM_CHAIN_ID ?? 84532); // default Base Sepolia
  const decimals = Number(env.ALEPH_EVM_DECIMALS ?? 6);
  const known = (Object.values(chains) as Chain[]).find((c) => c.id === chainId);
  const chain =
    known ??
    defineChain({
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });

  const rail = new EvmSettlementRail({ chain, rpcUrl, escrowAddress, tokenAddress, privateKey });
  return evmPayerRail(rail, { decimals, chainId, escrowAddress });
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
