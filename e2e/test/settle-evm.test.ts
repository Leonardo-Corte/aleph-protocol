// S4.4: the on-chain settlement rail, end to end against a REAL EVM (local
// anvil). Deploys a stablecoin + AlephEscrow, then drives EvmSettlementRail:
// lock funds for an invocation, release on delivery, verify the record against
// the chain — and the refund path. Proves the rail is real without a public
// testnet. Skipped automatically if anvil is not installed.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { EvmSettlementRail, deployEscrow, escrowIdFor, evmSettlementVerifier } from "@aleph/settle-evm";
import { createWalletClient, createPublicClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { mockUsdcAbi, mockUsdcBytecode } from "../fixtures/mock-usdc.ts";

const ANVIL = join(homedir(), ".foundry/bin/anvil");
const RPC = "http://127.0.0.1:8545";
// anvil deterministic accounts (well-known dev keys; testnet/dev only).
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const PAYEE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const hasAnvil = existsSync(ANVIL);
let anvil: ChildProcess | undefined;

before(async () => {
  if (!hasAnvil) return;
  anvil = spawn(ANVIL, ["--silent", "--port", "8545"], { stdio: "ignore" });
  // wait for the RPC to come up
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil did not start");
});

after(() => {
  anvil?.kill();
});

test("on-chain settlement: deploy, lock, release, verify (real EVM)", { skip: !hasAnvil }, async () => {
  const payer = privateKeyToAccount(PAYER_KEY);
  const payee = privateKeyToAccount(PAYEE_KEY);
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const wallet = createWalletClient({ account: payer, chain: foundry, transport: http(RPC) });

  // deploy MockUSDC (6 decimals) and AlephEscrow
  const tokenTx = await wallet.deployContract({
    abi: mockUsdcAbi,
    bytecode: mockUsdcBytecode,
    account: payer,
    chain: foundry,
  });
  const tokenReceipt = await pub.waitForTransactionReceipt({ hash: tokenTx });
  const token = tokenReceipt.contractAddress!;

  const escrow = await deployEscrow({ chain: foundry, rpcUrl: RPC, privateKey: PAYER_KEY, token });

  // mint 1000 USDC to the payer
  const amount = parseUnits("100", 6);
  await wallet.writeContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [payer.address, parseUnits("1000", 6)],
    account: payer,
    chain: foundry,
  });

  const rail = new EvmSettlementRail({
    chain: foundry,
    rpcUrl: RPC,
    escrowAddress: escrow,
    tokenAddress: token,
    privateKey: PAYER_KEY,
  });

  // --- lock → release → verify ---
  const id = escrowIdFor("invoke-1", "nonce-1");
  await rail.lock({
    id,
    payee: payee.address,
    amount,
    invokeRef: escrowIdFor("invoke-1", ""),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });

  const balBefore = await pub.readContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [payee.address],
  });

  const record = await rail.release(id);
  assert.equal(record.status, "released");
  assert.equal(record.amount, amount.toString());
  assert.match(record.txHash, /^0x[0-9a-f]+$/i);

  // the payee actually received the funds on-chain
  const balAfter = await pub.readContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [payee.address],
  });
  assert.equal(balAfter - balBefore, amount);

  // verify() re-reads the chain and confirms the record
  assert.equal((await rail.verify(record)).ok, true);
  // a record claiming the wrong amount fails verification
  assert.equal((await rail.verify({ ...record, amount: "1" })).ok, false);

  // the injectable trust-layer verifier reads the chain: real record passes,
  // a fabricated reference (never-locked escrow id) is rejected.
  const verifier = evmSettlementVerifier(rail);
  assert.equal((await verifier(record)).ok, true);
  const fabricated = { ...record, escrowId: escrowIdFor("never", "happened") };
  assert.equal((await verifier(fabricated)).ok, false);
});

test("on-chain settlement: refund after deadline returns to payer", { skip: !hasAnvil }, async () => {
  const payer = privateKeyToAccount(PAYER_KEY);
  const payee = privateKeyToAccount(PAYEE_KEY);
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const wallet = createWalletClient({ account: payer, chain: foundry, transport: http(RPC) });

  const tokenTx = await wallet.deployContract({
    abi: mockUsdcAbi,
    bytecode: mockUsdcBytecode,
    account: payer,
    chain: foundry,
  });
  const token = (await pub.waitForTransactionReceipt({ hash: tokenTx })).contractAddress!;
  const escrow = await deployEscrow({ chain: foundry, rpcUrl: RPC, privateKey: PAYER_KEY, token });
  await wallet.writeContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [payer.address, parseUnits("1000", 6)],
    account: payer,
    chain: foundry,
  });

  // payee returns funds early (declines) — exercises the refund path
  const payeeRail = new EvmSettlementRail({
    chain: foundry,
    rpcUrl: RPC,
    escrowAddress: escrow,
    tokenAddress: token,
    privateKey: PAYEE_KEY,
  });
  const payerRail = new EvmSettlementRail({
    chain: foundry,
    rpcUrl: RPC,
    escrowAddress: escrow,
    tokenAddress: token,
    privateKey: PAYER_KEY,
  });

  const amount = parseUnits("50", 6);
  const id = escrowIdFor("invoke-2", "nonce-2");
  await payerRail.lock({
    id,
    payee: payee.address,
    amount,
    invokeRef: escrowIdFor("invoke-2", ""),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });

  const before = await pub.readContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [payer.address],
  });

  const record = await payeeRail.refund(id);
  assert.equal(record.status, "refunded");
  assert.equal((await payerRail.verify(record)).ok, true);

  const after2 = await pub.readContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [payer.address],
  });
  assert.equal(after2 - before, amount);
});
