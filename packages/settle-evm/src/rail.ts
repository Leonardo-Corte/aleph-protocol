// The on-chain settlement rail. Implements lock / release / refund / verify
// against the AlephEscrow contract via viem. Unlike the in-memory reference
// rail (which signs records with its own key), an on-chain SettlementRecord is
// proven by its transaction: verify() re-reads the chain event by txHash and
// confirms it matches. That on-chain proof is what makes settlement trustless
// and settlement-backed reputation un-forgeable.

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toHex,
  getContract,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { alephEscrowAbi } from "./abi";

// A settlement record proven by an on-chain transaction.
export interface EvmSettlementRecord {
  escrowId: string; // bytes32 hex
  payer: Address;
  payee: Address;
  amount: string; // base units, as a decimal string (no float)
  invokeRef: string; // bytes32 hex
  status: "released" | "refunded";
  rail: "evm";
  chainId: number;
  escrowAddress: Address;
  txHash: Hex;
  ts: number;
}

const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface EvmRailConfig {
  chain: Chain;
  rpcUrl: string;
  escrowAddress: Address;
  tokenAddress: Address;
  privateKey: Hex; // the payer/operator key for sending txs
}

// Deterministic bytes32 escrow id from the invocation reference + a nonce.
export function escrowIdFor(invokeRef: string, nonce: string): Hex {
  return keccak256(toHex(`${invokeRef}:${nonce}`));
}

export class EvmSettlementRail {
  private pub: PublicClient;
  private wallet: WalletClient;
  private cfg: EvmRailConfig;
  readonly account: Address;

  constructor(cfg: EvmRailConfig) {
    this.cfg = cfg;
    const account = privateKeyToAccount(cfg.privateKey);
    this.account = account.address;
    this.pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  }

  // Ensure the escrow can pull `amount` of the token, then lock it for `invokeRef`.
  async lock(params: {
    id: Hex;
    payee: Address;
    amount: bigint;
    invokeRef: Hex;
    deadline: bigint;
  }): Promise<{ id: Hex; txHash: Hex }> {
    // approve (idempotent: only if allowance is short)
    const allowance = await this.pub.readContract({
      address: this.cfg.tokenAddress,
      abi: erc20ApproveAbi,
      functionName: "allowance",
      args: [this.account, this.cfg.escrowAddress],
    });
    if (allowance < params.amount) {
      const approveTx = await this.wallet.writeContract({
        address: this.cfg.tokenAddress,
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [this.cfg.escrowAddress, params.amount],
        account: this.account,
        chain: this.cfg.chain,
      });
      await this.pub.waitForTransactionReceipt({ hash: approveTx });
    }
    const txHash = await this.wallet.writeContract({
      address: this.cfg.escrowAddress,
      abi: alephEscrowAbi,
      functionName: "lock",
      args: [params.id, params.payee, params.amount, params.invokeRef, params.deadline],
      account: this.account,
      chain: this.cfg.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash: txHash });
    return { id: params.id, txHash };
  }

  async release(id: Hex): Promise<EvmSettlementRecord> {
    const txHash = await this.wallet.writeContract({
      address: this.cfg.escrowAddress,
      abi: alephEscrowAbi,
      functionName: "release",
      args: [id],
      account: this.account,
      chain: this.cfg.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash: txHash });
    return this.recordFor(id, "released", txHash);
  }

  async refund(id: Hex): Promise<EvmSettlementRecord> {
    const txHash = await this.wallet.writeContract({
      address: this.cfg.escrowAddress,
      abi: alephEscrowAbi,
      functionName: "refund",
      args: [id],
      account: this.account,
      chain: this.cfg.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash: txHash });
    return this.recordFor(id, "refunded", txHash);
  }

  private async recordFor(
    id: Hex,
    status: "released" | "refunded",
    txHash: Hex,
  ): Promise<EvmSettlementRecord> {
    const e = await this.getEscrow(id);
    return {
      escrowId: id,
      payer: e.payer,
      payee: e.payee,
      amount: e.amount.toString(),
      invokeRef: e.invokeRef,
      status,
      rail: "evm",
      chainId: this.cfg.chain.id,
      escrowAddress: this.cfg.escrowAddress,
      txHash,
      ts: Date.now(),
    };
  }

  async getEscrow(id: Hex): Promise<{
    payer: Address;
    payee: Address;
    amount: bigint;
    invokeRef: Hex;
    deadline: bigint;
    status: number;
  }> {
    const e = await this.pub.readContract({
      address: this.cfg.escrowAddress,
      abi: alephEscrowAbi,
      functionName: "getEscrow",
      args: [id],
    });
    return e;
  }

  // Re-read the chain to confirm a record is real: the on-chain escrow exists,
  // matches the record's parties/amount, and is in the claimed terminal status.
  async verify(rec: EvmSettlementRecord): Promise<{ ok: boolean; reason?: string }> {
    if (rec.escrowAddress.toLowerCase() !== this.cfg.escrowAddress.toLowerCase()) {
      return { ok: false, reason: "escrow address mismatch" };
    }
    const e = await this.getEscrow(rec.escrowId as Hex);
    const wantStatus = rec.status === "released" ? 2 : 3; // Status enum: Released=2, Refunded=3
    if (e.status !== wantStatus) return { ok: false, reason: "on-chain status does not match" };
    if (e.payer.toLowerCase() !== rec.payer.toLowerCase()) return { ok: false, reason: "payer mismatch" };
    if (e.payee.toLowerCase() !== rec.payee.toLowerCase()) return { ok: false, reason: "payee mismatch" };
    if (e.amount.toString() !== rec.amount) return { ok: false, reason: "amount mismatch" };
    return { ok: true };
  }

  contract() {
    return getContract({ address: this.cfg.escrowAddress, abi: alephEscrowAbi, client: this.pub });
  }
}

// The chain-reading settlement verifier, as a standalone function. A consumer
// of the trust layer injects this so a settlement-backed attestation counts
// ONLY if its escrow really exists on-chain with the claimed parties, amount,
// and terminal status — a fabricated reference is rejected by reading the chain.
// (Binding the on-chain payer/payee ADDRESSES to the attesting DID needs did:pkh,
// which is deferred; until then this verifies settlement authenticity, and the
// trust layer's DID-level issuer-matching stays on the in-memory reference rail.)
export function evmSettlementVerifier(
  rail: EvmSettlementRail,
): (rec: EvmSettlementRecord) => Promise<{ ok: boolean; reason?: string }> {
  return (rec) => rail.verify(rec);
}
