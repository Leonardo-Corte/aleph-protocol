// Phase F: security hardening. The transport rejects oversized payloads, the
// public API barrel re-exports the surface, and negative gates hold.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as client from "@aleph/client";
import * as core from "@aleph/core";
import { generateIdentity } from "@aleph/core";
import * as node from "@aleph/node";
import { createNode } from "@aleph/node";
import * as registry from "@aleph/registry";
import { hardenServer } from "@aleph/transport";

test("each package exposes its public surface", () => {
  const expect = (mod: Record<string, unknown>, names: string[]) => {
    for (const name of names) {
      assert.equal(typeof mod[name], "function", `missing export: ${name}`);
    }
  };
  expect(core, [
    "generateIdentity",
    "createEnvelope",
    "verifyEnvelope",
    "createGrant",
    "verifyGrant",
    "SettlementRail",
    "createAttestation",
    "computeTrust",
    "verifyReceiptChain",
    "Vocabulary",
  ]);
  expect(node, ["createNode"]);
  expect(registry, ["createRegistry"]);
  expect(client, ["resolve", "invoke", "compose"]);
});

test("node rejects an oversized payload (DoS guard)", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4700,
    capabilities: { "text.echo": { handler: (i) => ({ output: { text: i.text } }) } },
  });
  await node.listen();
  try {
    const huge = "x".repeat(2_000_000); // 2 MB > 1 MB cap
    const res = await fetch(node.url + "/aleph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blob: huge }),
    });
    assert.equal(res.status, 500); // rejected before processing
    const json = (await res.json()) as { error?: { message?: string } };
    assert.match(json.error?.message ?? "", /payload too large/);
  } finally {
    await node.close();
  }
});

test("node ignores a malformed-JSON body without crashing", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4701,
    capabilities: { "text.echo": { handler: (i) => ({ output: { text: i.text } }) } },
  });
  await node.listen();
  try {
    const res = await fetch(node.url + "/aleph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 500);
    // server still alive: a follow-up request to /manifest succeeds
    const ok = await fetch(node.url + "/manifest");
    assert.equal(ok.status, 200);
  } finally {
    await node.close();
  }
});

test("rate limiting: a per-IP flood is throttled with 429", async () => {
  const n = createNode({
    identity: generateIdentity(),
    port: 4702,
    capabilities: { "text.echo": { handler: (i) => ({ output: { text: i.text } }) } },
    rateLimit: { capacity: 2, refillPerSec: 0 }, // 2 then deny (no refill)
  });
  await n.listen();
  try {
    assert.equal((await fetch(n.url + "/manifest")).status, 200);
    assert.equal((await fetch(n.url + "/manifest")).status, 200);
    const third = await fetch(n.url + "/manifest");
    assert.equal(third.status, 429);
    const json = (await third.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "RATE_LIMITED");
  } finally {
    await n.close();
  }
});

test("complexity cap: a deeply-nested INVOKE body is rejected before work", async () => {
  const n = createNode({
    identity: generateIdentity(),
    port: 4703,
    capabilities: { "text.echo": { handler: (i) => ({ output: { text: i.text } }) } },
  });
  await n.listen();
  try {
    // build a body nested deeper than the default maxDepth (32)
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 40; i++) {
      const next: Record<string, unknown> = {};
      cur.x = next;
      cur = next;
    }
    const agent = generateIdentity();
    const env = core.createEnvelope(
      {
        from: agent.did,
        to: n.manifest.identity,
        type: "INVOKE",
        body: { capability: "text.echo", input: deep },
      },
      agent.privateKey,
    );
    const res = await fetch(n.url + "/aleph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env),
    });
    const json = (await res.json()) as { body?: { result?: { error?: { code?: string } } } };
    // the node answers an INVOKE with a signed RECEIPT carrying the rejection
    assert.equal(json.body?.result?.error?.code, "TOO_COMPLEX");
  } finally {
    await n.close();
  }
});

test("complexity cap: a Manifest with too many capabilities is rejected", () => {
  const id = generateIdentity();
  const caps = Array.from({ length: 300 }, (_, i) => ({ key: `x.cap${i}`, risk: "low" as const }));
  const v = core.validateManifest({
    v: "aleph/0.1",
    identity: id.did,
    conformance: "L1",
    capabilities: caps,
    endpoint: ["http://127.0.0.1/aleph"],
  });
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /too many capabilities/);
});

test("server hardening sets slow-loris timeouts and a connection cap", () => {
  const fake = { headersTimeout: 0, requestTimeout: 0, maxConnections: 0 };
  hardenServer(fake);
  assert.ok(fake.headersTimeout > 0 && fake.headersTimeout <= 60_000);
  assert.ok(fake.requestTimeout > 0);
  assert.ok(fake.maxConnections > 0);
});
