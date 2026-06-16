// The MCP server is a production agent surface, not a thin demo: it ranks by
// trust, PAYS priced nodes via a settlement rail, VERIFIES the output against
// its declared schema, gates high-risk capabilities, and writes reputation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SettlementRail, generateIdentity } from "@aleph/core";
import { buildAlephServer } from "@aleph/mcp";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function connect(
  rail: SettlementRail,
  agent: ReturnType<typeof generateIdentity>,
  registryUrl: string,
) {
  const server = buildAlephServer({ registryUrl, agent, rail });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function parse(res: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const text = (res.content as { text: string }[])[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

const geocodeOutSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    lat: { type: "number" as const },
    lon: { type: "number" as const },
  },
  required: ["name", "lat", "lon"],
};

test("MCP: pays a priced node, verifies output, ranks by trust, attests", async () => {
  const rail = new SettlementRail();
  const registry = createRegistry({ port: 4900 });
  await registry.listen();
  const nodeId = generateIdentity();
  const node = createNode({
    identity: nodeId,
    port: 4901,
    rail,
    capabilities: {
      "data.geocode": {
        priceEur: 2,
        outputSchema: geocodeOutSchema,
        handler: () => ({ output: { name: "Tokyo", lat: 35.6762, lon: 139.6503 } }),
      },
    },
  });
  await node.listen();
  await fetch(registry.url + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
  });

  const agent = generateIdentity();
  rail.deposit(agent.did, 50);
  const client = await connect(rail, agent, registry.url);
  try {
    // ACT + PAY + PROVE: pays 2, output validates, signed receipt, then attests
    const out = parse(
      await client.callTool({
        name: "aleph_invoke",
        arguments: { capability: "data.geocode", input: { place: "Tokyo" }, maxEur: 5, rate: 1 },
      }),
    );
    assert.equal(out.outcome, "success");
    assert.equal((out.result as { name: string }).name, "Tokyo");
    assert.equal(out.output_verified, true);
    assert.equal(out.paid, 2);
    assert.equal(out.attested, true);
    assert.match(out.receipt_signed_by as string, /^did:key:z/);
    assert.ok(rail.balanceOf(agent.did) <= 48); // actually paid

    // FIND now ranks the node by the trust it just accrued
    const ranked = parse(
      await client.callTool({ name: "aleph_resolve", arguments: { capability: "data.geocode" } }),
    ) as unknown as { did: string; trust: number }[];
    const best = ranked[0];
    assert.ok(best);
    assert.equal(best.did, nodeId.did);
    assert.ok(best.trust > 0);
  } finally {
    await client.close();
    await node.close();
    await registry.close();
  }
});

test("MCP: a priced node with no rail, a bad output, and a high-risk gate", async () => {
  const registry = createRegistry({ port: 4902 });
  await registry.listen();

  // node A: priced (no rail on the server → must refuse to pay)
  const pricedId = generateIdentity();
  const priced = createNode({
    identity: pricedId,
    port: 4903,
    rail: new SettlementRail(),
    capabilities: {
      "data.geocode": { priceEur: 1, handler: () => ({ output: { name: "X", lat: 0, lon: 0 } }) },
    },
  });
  // node B: free, but returns output that VIOLATES its declared schema
  const badId = generateIdentity();
  const bad = createNode({
    identity: badId,
    port: 4904,
    capabilities: {
      "data.badcode": {
        outputSchema: geocodeOutSchema,
        handler: () => ({ output: { wrong: true } }), // missing name/lat/lon
      },
    },
  });
  // node C: a high-risk capability
  const riskId = generateIdentity();
  const risky = createNode({
    identity: riskId,
    port: 4905,
    capabilities: { "funds.transfer": { risk: "high", handler: () => ({ output: { ok: true } }) } },
  });
  for (const n of [priced, bad, risky]) await n.listen();
  for (const n of [priced, bad, risky]) {
    await fetch(registry.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: n.manifest, manifestUrl: n.url + "/manifest" }),
    });
  }

  // server WITHOUT a rail
  const client = await connect(undefined as unknown as SettlementRail, generateIdentity(), registry.url);
  try {
    // priced node, no rail → clear refusal (not a silent failure)
    const noPay = parse(
      await client.callTool({
        name: "aleph_invoke",
        arguments: { capability: "data.geocode", input: { place: "Tokyo" } },
      }),
    );
    assert.match(String(noPay.error), /priced/);

    // bad output → flagged unverified (the agent must not trust it)
    const badOut = parse(
      await client.callTool({ name: "aleph_invoke", arguments: { capability: "data.badcode", input: {} } }),
    );
    assert.equal(badOut.outcome, "success");
    assert.equal(badOut.output_verified, false);

    // high-risk capability → gated behind confirmation
    const gated = parse(
      await client.callTool({ name: "aleph_invoke", arguments: { capability: "funds.transfer", input: {} } }),
    );
    assert.equal(gated.needs_confirmation, true);
    assert.equal(gated.risk, "high");
  } finally {
    await client.close();
    await priced.close();
    await bad.close();
    await risky.close();
    await registry.close();
  }
});
