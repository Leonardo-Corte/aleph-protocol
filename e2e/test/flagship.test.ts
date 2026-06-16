// Section 11.3: the flagship composition. An agent resolves real-capability
// nodes, ranks by trust, composes two of them, pays each, and ends with a
// verifiable receipt chain — the five verbs end to end.

import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyReceiptChain } from "@aleph/core";
import { SettlementRail, generateIdentity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";
import { referenceCapabilities } from "../../examples/src/capabilities.ts";
import { flagshipCompose } from "../../examples/src/flagship.ts";

test("flagship: resolve → rank → compose → pay → verifiable receipt chain", async () => {
  const rail = new SettlementRail();
  const registry = createRegistry({ port: 4820 });
  await registry.listen();

  const geoId = generateIdentity();
  const sumId = generateIdentity();
  const geo = referenceCapabilities["data.geocode"];
  const sum = referenceCapabilities["text.summarize"];
  assert.ok(geo && sum);
  const geocoder = createNode({
    identity: geoId,
    port: 4821,
    rail,
    capabilities: { "data.geocode": { priceEur: 1, schema: geo.schema, handler: geo.handler } },
  });
  const summarizer = createNode({
    identity: sumId,
    port: 4822,
    rail,
    capabilities: { "text.summarize": { priceEur: 1, schema: sum.schema, handler: sum.handler } },
  });
  await geocoder.listen();
  await summarizer.listen();

  try {
    for (const n of [geocoder, summarizer]) {
      await fetch(registry.url + "/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: n.manifest, manifestUrl: n.url + "/manifest" }),
      });
    }

    const agent = generateIdentity();
    rail.deposit(agent.did, 100);

    const out = await flagshipCompose({ registryUrl: registry.url, agent, rail, place: "Tokyo" });

    // composed value: a non-empty summary derived from the geocoded place
    // (extractive, so it picks the highest-signal sentences — not necessarily
    // the place name; the point is the geocode→summarize→pay flow produced it)
    assert.equal(typeof out.value, "string");
    assert.ok((out.value as string).length > 0);

    // two priced steps, each paid (the rail debited the agent)
    assert.equal(out.receipts.length, 2);
    assert.equal(out.geocoder, geoId.did);
    assert.equal(out.summarizer, sumId.did);
    assert.ok(rail.balanceOf(agent.did) <= 98); // paid 1 + 1

    // the receipt chain is independently auditable + verifies
    assert.equal(out.chain.ok, true);
    assert.equal(out.chain.steps, 2);
    assert.equal(verifyReceiptChain(out.receipts).ok, true);
  } finally {
    await geocoder.close();
    await summarizer.close();
    await registry.close();
  }
});
