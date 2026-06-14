// Phase B: the PAY verb. Escrow funds, settle atomically with delivery, refund
// on failure, and reject when funds are short.

import assert from "node:assert/strict";
import { test } from "node:test";
import { invoke } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { SettlementRail, verifySettlement } from "@aleph/core";
import { createNode } from "@aleph/node";

const addSchema = {
  type: "object" as const,
  properties: { a: { type: "number" as const }, b: { type: "number" as const } },
  required: ["a", "b"],
};

test("priced capability: pay-on-delivery settles funds and yields a verified settlement", async () => {
  const rail = new SettlementRail();
  const agent = generateIdentity();
  const nodeId = generateIdentity();
  rail.deposit(agent.did, 100);

  const node = createNode({
    identity: nodeId,
    port: 4300,
    rail,
    capabilities: {
      "math.add": {
        priceEur: 5,
        schema: addSchema,
        handler: (input) => ({ output: { sum: (input.a as number) + (input.b as number) } }),
      },
    },
  });
  await node.listen();
  try {
    const { result, outcome, settlement } = await invoke({
      nodeDid: nodeId.did,
      endpoint: node.url + "/aleph",
      capability: "math.add",
      input: { a: 2, b: 3 },
      agent,
      rail,
      payEur: 5,
    });
    assert.equal(outcome, "success");
    assert.deepEqual(result, { sum: 5 });
    assert.ok(settlement, "receipt carries a settlement");
    assert.equal(settlement.status, "released");
    assert.equal(verifySettlement(settlement).ok, true);
    assert.equal(rail.balanceOf(agent.did), 95);
    assert.equal(rail.balanceOf(nodeId.did), 5);
  } finally {
    await node.close();
  }
});

test("insufficient funds: escrow lock fails before invoking", async () => {
  const rail = new SettlementRail();
  const agent = generateIdentity();
  const nodeId = generateIdentity();
  // no deposit
  const node = createNode({
    identity: nodeId,
    port: 4301,
    rail,
    capabilities: {
      "math.add": {
        priceEur: 5,
        schema: addSchema,
        handler: (i) => ({ output: { sum: (i.a as number) + (i.b as number) } }),
      },
    },
  });
  await node.listen();
  try {
    await assert.rejects(
      invoke({
        nodeDid: nodeId.did,
        endpoint: node.url + "/aleph",
        capability: "math.add",
        input: { a: 1, b: 1 },
        agent,
        rail,
        payEur: 5,
      }),
      /payment lock failed/,
    );
  } finally {
    await node.close();
  }
});

test("failure refunds the escrow (no charge on a failed delivery)", async () => {
  const rail = new SettlementRail();
  const agent = generateIdentity();
  const nodeId = generateIdentity();
  rail.deposit(agent.did, 100);

  const node = createNode({
    identity: nodeId,
    port: 4302,
    rail,
    capabilities: {
      explode: {
        priceEur: 5,
        handler: () => {
          throw new Error("boom");
        },
      },
    },
  });
  await node.listen();
  try {
    const { outcome, settlement } = await invoke({
      nodeDid: nodeId.did,
      endpoint: node.url + "/aleph",
      capability: "explode",
      input: {},
      agent,
      rail,
      payEur: 5,
    });
    assert.equal(outcome, "failure");
    assert.equal(settlement!.status, "refunded");
    assert.equal(rail.balanceOf(agent.did), 100); // fully refunded
    assert.equal(rail.balanceOf(nodeId.did), 0);
  } finally {
    await node.close();
  }
});
