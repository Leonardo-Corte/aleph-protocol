// On-chain-backed reputation: an agent pays a node on-chain, then attests with
// the EVM settlement record. The node verifies the attestation by RE-READING THE
// CHAIN (the escrow exists, released, to this node) AND the did:pkh binding (the
// attester's DID address is the on-chain payer), then stores it — reputation
// accrues from real on-chain value. A fabricated on-chain reference is rejected.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { invoke, attest, fetchReputation } from "@aleph/client";
import {
  pkhIdentityFromPrivateKey,
  pkhSigner,
  computeTrustAsync,
  type Attestation,
  type OnChainSettlementRef,
} from "@aleph/core";
import { createNode } from "@aleph/node";
import {
  EvmSettlementRail,
  deployEscrow,
  evmPayerRail,
  evmPayeeRail,
  evmAttestationVerifier,
} from "@aleph/settle-evm";
import { createWalletClient, createPublicClient, http, parseUnits, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { mockUsdcAbi, mockUsdcBytecode } from "../fixtures/mock-usdc.ts";

const ANVIL = join(homedir(), ".foundry/bin/anvil");
const RPC = "http://127.0.0.1:8547";
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const PAYEE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const hasAnvil = existsSync(ANVIL);
let anvil: ChildProcess | undefined;

before(async () => {
  if (!hasAnvil) return;
  anvil = spawn(ANVIL, ["--silent", "--port", "8547"], { stdio: "ignore" });
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

test(
  "on-chain-backed attestation: pay → attest with EVM record → reputation accrues",
  { skip: !hasAnvil },
  async () => {
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

    // Both parties are did:pkh — their DIDs ARE their on-chain accounts.
    const agentPkh = pkhIdentityFromPrivateKey(hexToBytes(PAYER_KEY), foundry.id);
    const nodePkh = pkhIdentityFromPrivateKey(hexToBytes(PAYEE_KEY), foundry.id);

    const payeeEvm = new EvmSettlementRail({
      chain: foundry,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      privateKey: PAYEE_KEY,
    });
    const node = createNode({
      identity: nodePkh,
      port: 4814,
      rail: evmPayeeRail(payeeEvm, { decimals: 6, payeeAddress: payeeAcct.address }),
      // the node verifies on-chain-backed attestations by reading the chain
      attestationVerifier: evmAttestationVerifier(payeeEvm),
      capabilities: {
        "data.geocode": { priceEur: 4, handler: () => ({ output: { name: "Rome", lat: 41.9, lon: 12.5 } }) },
      },
    });
    await node.listen();
    try {
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

      // pay on-chain (agent identifies as its pkh account)
      const { outcome, settlement } = await invoke<OnChainSettlementRef>({
        nodeDid: nodePkh.did,
        endpoint: node.url + "/aleph",
        capability: "data.geocode",
        input: { place: "Rome" },
        agent: pkhSigner(agentPkh),
        rail: payerRail,
        payEur: 4,
      });
      assert.equal(outcome, "success");
      assert.ok(settlement?.status === "released");

      // attest with the on-chain record, signed by the agent's pkh identity
      await attest({
        agent: pkhSigner(agentPkh),
        subjectDid: nodePkh.did,
        reputationUrl: node.url + "/reputation",
        settlement,
        rating: 1,
      });

      // reputation accrues — verified via the chain-reading async trust path
      const { attestations } = await fetchReputation(node.url + "/reputation");
      assert.equal(attestations.length, 1);
      const trust = await computeTrustAsync(attestations, { verifier: evmAttestationVerifier(payeeEvm) });
      assert.equal(trust.count, 1);
      assert.equal(trust.score, 1);

      // a FABRICATED on-chain reference (never-locked escrow) is rejected by /attest
      const fake = { ...settlement, escrowId: "0x" + "ab".repeat(32) } as OnChainSettlementRef;
      const fakeAtt = await postAttest(node.url, agentPkh, nodePkh.did, fake);
      assert.equal(fakeAtt.status, 400);
    } finally {
      await node.close();
    }
  },
);

// Build + POST an attestation directly (to assert the node rejects a fake).
async function postAttest(
  nodeUrl: string,
  agent: ReturnType<typeof pkhIdentityFromPrivateKey>,
  subject: string,
  settlement: OnChainSettlementRef,
) {
  const { createAttestation } = await import("@aleph/core");
  const att: Attestation = createAttestation(pkhSigner(agent), { subject, settlement, rating: 1 });
  const res = await fetch(nodeUrl + "/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(att),
  });
  return { status: res.status };
}
