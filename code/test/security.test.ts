// Phase F: security hardening. The transport rejects oversized payloads, the
// public API barrel re-exports the surface, and negative gates hold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "../src/core/identity.ts";
import { createNode } from "../src/node/node.ts";
import * as aleph from "../src/index.ts";

test("the public API barrel exposes the full surface", () => {
  for (const name of [
    "generateIdentity",
    "createEnvelope",
    "verifyEnvelope",
    "createGrant",
    "verifyGrant",
    "createNode",
    "createRegistry",
    "resolve",
    "invoke",
    "compose",
    "SettlementRail",
    "createAttestation",
    "computeTrust",
    "verifyReceiptChain",
    "Vocabulary",
  ]) {
    assert.equal(typeof (aleph as Record<string, unknown>)[name], "function", `missing export: ${name}`);
  }
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
