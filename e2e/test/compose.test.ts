// Phase D: receipt chaining + agentic composition.
// An agent composes a task across two competing nodes, paying each for its own
// function, and ends with a verifiable, tamper-evident receipt chain.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compose } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { SettlementRail } from "@aleph/core";
import { verifyReceiptChain } from "@aleph/core";
import { createNode } from "@aleph/node";

test("compose chains two nodes into one verified result + receipt chain", async () => {
  const rail = new SettlementRail();
  const agent = generateIdentity();
  rail.deposit(agent.did, 100);

  const adderId = generateIdentity();
  const doublerId = generateIdentity();

  const adder = createNode({
    identity: adderId,
    port: 4500,
    rail,
    capabilities: {
      "math.add": {
        priceEur: 1,
        schema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
        handler: (i) => ({ output: { value: (i.a as number) + (i.b as number) } }),
      },
    },
  });
  const doubler = createNode({
    identity: doublerId,
    port: 4501,
    rail,
    capabilities: {
      "math.double": {
        priceEur: 1,
        schema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        handler: (i) => ({ output: { value: (i.x as number) * 2 } }),
      },
    },
  });
  await adder.listen();
  await doubler.listen();

  try {
    // task: double(add(2,3)) = 10, pulling each function from a different node
    const out = await compose({
      agent,
      rail,
      initial: { a: 2, b: 3 },
      steps: [
        {
          nodeDid: adderId.did,
          endpoint: adder.url + "/aleph",
          capability: "math.add",
          input: (c) => c as Record<string, unknown>,
          pick: (r) => (r as { value: number }).value,
          payEur: 1,
        },
        {
          nodeDid: doublerId.did,
          endpoint: doubler.url + "/aleph",
          capability: "math.double",
          input: (c) => ({ x: c }),
          pick: (r) => (r as { value: number }).value,
          payEur: 1,
        },
      ],
    });

    assert.equal(out.value, 10);
    assert.equal(out.receipts.length, 2);
    assert.equal(out.chain.ok, true);
    assert.equal(out.chain.steps, 2);

    // granular per-function merit: each node was paid for its own function
    assert.equal(rail.balanceOf(adderId.did), 1);
    assert.equal(rail.balanceOf(doublerId.did), 1);
    assert.equal(rail.balanceOf(agent.did), 98);
  } finally {
    await adder.close();
    await doubler.close();
  }
});

test("a tampered receipt breaks chain verification", async () => {
  const rail = new SettlementRail();
  const agent = generateIdentity();
  rail.deposit(agent.did, 10);
  const nodeId = generateIdentity();
  const node = createNode({
    identity: nodeId,
    port: 4502,
    rail,
    capabilities: {
      "math.add": {
        priceEur: 1,
        schema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
        handler: (i) => ({ output: { value: (i.a as number) + (i.b as number) } }),
      },
    },
  });
  await node.listen();
  try {
    const out = await compose({
      agent,
      rail,
      initial: { a: 1, b: 1 },
      steps: [
        {
          nodeDid: nodeId.did,
          endpoint: node.url + "/aleph",
          capability: "math.add",
          input: (c) => c as Record<string, unknown>,
          pick: (r) => (r as { value: number }).value,
          payEur: 1,
        },
      ],
    });
    assert.equal(out.chain.ok, true);
    // tamper with the receipt after the fact
    const first = out.receipts[0];
    assert.ok(first);
    first.body.result = { value: 999 };
    assert.equal(verifyReceiptChain(out.receipts).ok, false);
  } finally {
    await node.close();
  }
});
