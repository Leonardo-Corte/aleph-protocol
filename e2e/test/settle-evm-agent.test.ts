// The product proof for PAY: an agent pays a TypeScript node with REAL value
// ON-CHAIN, through the ordinary client.invoke / compose path — the EVM rail
// plugged into the same settlement seam the in-memory rail uses. Payer-release:
// the agent locks, the node verifies the lock + delivers, the agent releases on
// the verified receipt, and ERC-20 tokens actually move. Skipped without anvil.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { invoke, compose } from "@aleph/client";
import { generateIdentity, pkhIdentityFromPrivateKey } from "@aleph/core";
import { createNode } from "@aleph/node";
import {
  EvmSettlementRail,
  deployEscrow,
  evmPayerRail,
  evmPayeeRail,
  type EvmRailUnit,
} from "@aleph/settle-evm";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  hexToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { mockUsdcAbi, mockUsdcBytecode } from "../fixtures/mock-usdc.ts";

const ANVIL = join(homedir(), ".foundry/bin/anvil");
const RPC = "http://127.0.0.1:8546";
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const PAYEE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const hasAnvil = existsSync(ANVIL);
let anvil: ChildProcess | undefined;

before(async () => {
  if (!hasAnvil) return;
  anvil = spawn(ANVIL, ["--silent", "--port", "8546"], { stdio: "ignore" });
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

after(() => anvil?.kill());

test("agent pays a TS node ON-CHAIN through invoke (+compose)", { skip: !hasAnvil }, async () => {
  const payerAcct = privateKeyToAccount(PAYER_KEY);
  const payeeAcct = privateKeyToAccount(PAYEE_KEY);
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const wallet = createWalletClient({ account: payerAcct, chain: foundry, transport: http(RPC) });

  // deploy MockUSDC (6 decimals) + AlephEscrow; fund the agent (payer)
  const tokenTx = await wallet.deployContract({
    abi: mockUsdcAbi,
    bytecode: mockUsdcBytecode,
    account: payerAcct,
    chain: foundry,
  });
  const token = (await pub.waitForTransactionReceipt({ hash: tokenTx })).contractAddress!;
  const escrow = await deployEscrow({ chain: foundry, rpcUrl: RPC, privateKey: PAYER_KEY, token });
  await wallet.writeContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [payerAcct.address, parseUnits("1000", 6)],
    account: payerAcct,
    chain: foundry,
  });

  const unit: EvmRailUnit = { decimals: 6, chainId: foundry.id, escrowAddress: escrow };
  // agent's payer rail (locks/releases with the payer key)
  const payerRail = evmPayerRail(
    new EvmSettlementRail({
      chain: foundry,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      privateKey: PAYER_KEY,
    }),
    unit,
  );
  // the node's payee rail (reads the chain to verify the lock; the payee address
  // is what the node advertises as its on-chain payout address)
  const payeeRail = evmPayeeRail(
    new EvmSettlementRail({
      chain: foundry,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      privateKey: PAYEE_KEY,
    }),
    { decimals: 6, payeeAddress: payeeAcct.address },
  );

  const nodeId = generateIdentity();
  const node = createNode({
    identity: nodeId,
    port: 4811,
    rail: payeeRail,
    capabilities: {
      "data.geocode": {
        priceEur: 5,
        handler: () => ({ output: { name: "Tokyo", lat: 35.6762, lon: 139.6503 } }),
      },
    },
  });
  await node.listen();
  try {
    const agent = generateIdentity();
    const before = await balance(pub, token, payeeAcct.address);

    const { outcome, result, settlement } = await invoke({
      nodeDid: nodeId.did,
      endpoint: node.url + "/aleph",
      capability: "data.geocode",
      input: { place: "Tokyo" },
      agent,
      rail: payerRail,
      payEur: 5,
      payeeAddress: payeeAcct.address, // from the node's Manifest in production
    });

    assert.equal(outcome, "success");
    assert.equal((result as { name: string }).name, "Tokyo");
    // a real on-chain settlement, released to the payee
    assert.ok(settlement);
    assert.equal(settlement.status, "released");
    assert.equal(settlement.rail, "evm");
    assert.match(settlement.txHash, /^0x[0-9a-f]+$/i);

    // REAL tokens moved: the payee received exactly 5 USDC
    const after = await balance(pub, token, payeeAcct.address);
    assert.equal(after - before, parseUnits("5", 6));

    // compose pays on-chain too: two paid steps, two real settlements, a chain
    const composed = await compose({
      agent,
      rail: payerRail,
      initial: { place: "Tokyo" },
      steps: [
        {
          nodeDid: nodeId.did,
          endpoint: node.url + "/aleph",
          capability: "data.geocode",
          payEur: 5,
          payeeAddress: payeeAcct.address,
          input: () => ({ place: "Tokyo" }),
          pick: (r) => r,
        },
        {
          nodeDid: nodeId.did,
          endpoint: node.url + "/aleph",
          capability: "data.geocode",
          payEur: 5,
          payeeAddress: payeeAcct.address,
          input: () => ({ place: "Tokyo" }),
          pick: (r) => r,
        },
      ],
    });
    assert.equal(composed.chain.ok, true);
    assert.equal(composed.receipts.length, 2);
    const afterCompose = await balance(pub, token, payeeAcct.address);
    assert.equal(afterCompose - after, parseUnits("10", 6)); // two more paid steps
  } finally {
    await node.close();
  }
});

test("a did:pkh node is paid at its DID address — no trusted ext.payTo", { skip: !hasAnvil }, async () => {
  const payerAcct = privateKeyToAccount(PAYER_KEY);
  const payeeAcct = privateKeyToAccount(PAYEE_KEY);
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const wallet = createWalletClient({ account: payerAcct, chain: foundry, transport: http(RPC) });

  const tokenTx = await wallet.deployContract({
    abi: mockUsdcAbi,
    bytecode: mockUsdcBytecode,
    account: payerAcct,
    chain: foundry,
  });
  const token = (await pub.waitForTransactionReceipt({ hash: tokenTx })).contractAddress!;
  const escrow = await deployEscrow({ chain: foundry, rpcUrl: RPC, privateKey: PAYER_KEY, token });
  await wallet.writeContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [payerAcct.address, parseUnits("1000", 6)],
    account: payerAcct,
    chain: foundry,
  });

  // The node's IDENTITY is its payout account: did:pkh:eip155:<chain>:<payeeAddr>.
  // It signs its Manifest with the EVM key — and the agent derives the payout
  // address from the DID, so there is NO trusted ext.payTo assertion.
  const nodePkh = pkhIdentityFromPrivateKey(hexToBytes(PAYEE_KEY), foundry.id);
  assert.equal(nodePkh.address, payeeAcct.address.toLowerCase());

  const payerRail = evmPayerRail(
    new EvmSettlementRail({
      chain: foundry,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      privateKey: PAYER_KEY,
    }),
    { decimals: 6, chainId: foundry.id, escrowAddress: escrow },
  );
  const payeeRail = evmPayeeRail(
    new EvmSettlementRail({
      chain: foundry,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      privateKey: PAYEE_KEY,
    }),
    { decimals: 6, payeeAddress: payeeAcct.address },
  );

  const node = createNode({
    identity: nodePkh, // did:pkh — the node signs as its EVM account
    port: 4813,
    rail: payeeRail,
    capabilities: {
      "data.geocode": { priceEur: 3, handler: () => ({ output: { name: "Rome", lat: 41.9, lon: 12.5 } }) },
    },
  });
  await node.listen();
  try {
    const agent = generateIdentity();
    const before = await balance(pub, token, payeeAcct.address);

    // NOTE: no payeeAddress passed — the agent derives it from the node's did:pkh.
    const { outcome, settlement } = await invoke({
      nodeDid: nodePkh.did,
      endpoint: node.url + "/aleph",
      capability: "data.geocode",
      input: { place: "Rome" },
      agent,
      rail: payerRail,
      payEur: 3,
    });
    assert.equal(outcome, "success");
    assert.ok(settlement);
    assert.equal(settlement.status, "released");

    const after = await balance(pub, token, payeeAcct.address);
    assert.equal(after - before, parseUnits("3", 6)); // paid to the DID's address
  } finally {
    await node.close();
  }
});

async function balance(
  pub: ReturnType<typeof createPublicClient>,
  token: Address,
  who: Address,
): Promise<bigint> {
  return pub.readContract({ address: token, abi: mockUsdcAbi, functionName: "balanceOf", args: [who] });
}
