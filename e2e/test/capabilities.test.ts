// Section 11.2: the reference capability nodes are useful, deterministic, and
// verifiable, and a priced one settles + accrues reputation end to end.

import assert from "node:assert/strict";
import { test } from "node:test";
import { attest, fetchReputation, invoke } from "@aleph/client";
import { SettlementRail, generateIdentity, validateSchema } from "@aleph/core";
import { createNode } from "@aleph/node";
import { geocode, summarize, referenceCapabilities } from "../../examples/src/capabilities.ts";

test("data.geocode resolves a place and validates against its schema", () => {
  const out = geocode.handler({ place: "Paris" }).output;
  assert.equal(out.name, "Paris");
  assert.ok(Math.abs((out.lat as number) - 48.8566) < 1e-6);
  assert.equal(validateSchema(geocode.schema, { place: "Paris" }).ok, true);
  assert.equal(validateSchema(geocode.schema, {}).ok, false); // place required
  assert.throws(() => geocode.handler({ place: "Atlantis" }), /unknown place/);
});

test("text.summarize extracts the top sentences, deterministically", () => {
  const text =
    "Aleph gives agents five verbs. The verbs are FIND, TRUST, ACT, PAY, PROVE. " +
    "A registry helps agents find nodes. Reputation lets agents trust nodes. " +
    "Payment is settled in escrow. Receipts prove what happened.";
  const out = summarize.handler({ text, maxSentences: 2 }).output;
  assert.equal(out.sentences, 2);
  assert.ok(typeof out.summary === "string" && out.summary.length > 0);
  // deterministic: same input → same output
  const again = summarize.handler({ text, maxSentences: 2 }).output;
  assert.deepEqual(out, again);
});

test("a priced reference node settles and accrues reputation end to end", async () => {
  const rail = new SettlementRail();
  const customer = generateIdentity();
  rail.deposit(customer.did, 50);

  const nodeId = generateIdentity();
  const geo = referenceCapabilities["data.geocode"];
  assert.ok(geo);
  const node = createNode({
    identity: nodeId,
    port: 4760,
    rail,
    capabilities: {
      "data.geocode": { priceEur: 2, schema: geo.schema, handler: geo.handler },
    },
  });
  await node.listen();
  try {
    const { outcome, result, settlement } = await invoke({
      nodeDid: nodeId.did,
      endpoint: node.url + "/aleph",
      capability: "data.geocode",
      input: { place: "Tokyo" },
      agent: customer,
      rail,
      payEur: 2,
    });
    assert.equal(outcome, "success");
    assert.equal((result as { name: string }).name, "Tokyo");
    assert.ok(settlement);
    assert.equal(settlement.status, "released");

    // pay-backed attestation → the node accrues real reputation
    await attest({
      agent: customer,
      subjectDid: nodeId.did,
      reputationUrl: node.url + "/reputation",
      settlement,
      rating: 1,
    });
    const rep = await fetchReputation(node.url + "/reputation");
    assert.equal(rep.trust.count, 1);
    assert.equal(rep.trust.score, 1);
  } finally {
    await node.close();
  }
});
