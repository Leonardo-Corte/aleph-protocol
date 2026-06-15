// Phase C: the TRUST verb and the self-sustaining loop.
// - an attestation backed by a real settlement counts;
// - an attestation NOT backed by a settlement is zero-weight (anti-Sybil);
// - the consumer computes trust itself and ranks discovery by it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { invoke, attest, fetchReputation, resolveRanked } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { SettlementRail } from "@aleph/core";
import { createAttestation, verifyAttestation, computeTrust, type Attestation } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

const addSchema = {
  type: "object" as const,
  properties: { a: { type: "number" as const }, b: { type: "number" as const } },
  required: ["a", "b"],
};
const adder = (input: Record<string, unknown>) => ({
  output: { sum: (input.a as number) + (input.b as number) },
});

test("a settlement-backed attestation verifies; an unbacked one is rejected", () => {
  const rail = new SettlementRail();
  const payer = generateIdentity();
  const payee = generateIdentity();
  rail.deposit(payer.did, 50);
  const lock = rail.lock(payer.did, payee.did, 5, "ref-1");
  assert.equal(lock.ok, true);
  const settlement = rail.release((lock as { escrow: { id: string } }).escrow.id);

  const good = createAttestation(payer, { subject: payee.did, settlement, rating: 1 });
  assert.equal(verifyAttestation(good).ok, true);

  // Forge: claim an attestation about a node you never paid (no settlement).
  const forged = { ...good, settlement: undefined as never };
  assert.equal(verifyAttestation(forged).ok, false);
});

test("computeTrust ignores unbacked attestations and weights by settled value", () => {
  const rail = new SettlementRail();
  const payer = generateIdentity();
  const payee = generateIdentity();
  rail.deposit(payer.did, 100);

  const mk = (amount: number, rating: number) => {
    const lock = rail.lock(payer.did, payee.did, amount, "r" + Math.random());
    const s = rail.release((lock as { escrow: { id: string } }).escrow.id);
    return createAttestation(payer, { subject: payee.did, settlement: s, rating });
  };

  const real = [mk(10, 1.0), mk(30, 0.5)];
  const base = real[0];
  assert.ok(base);
  // a forged attestation with no settlement backing → must count as zero weight
  const fake = { ...base, settlement: undefined } as unknown as Attestation;
  // pin `now` so time-decay is deterministic (the attestations are same-aged here)
  const t = computeTrust([...real, fake], { now: Date.now() });
  assert.equal(t.count, 2);
  assert.equal(t.totalValue, 40);
  // both from one issuer → value-weighted mean rating: (1.0*10 + 0.5*30)/40 = 0.625
  assert.ok(Math.abs(t.score - 0.625) < 1e-9);
  assert.equal(t.distinctIssuers, 1);
  // confidence < 1 with a single issuer; reputation = score * confidence < score
  assert.ok(t.confidence > 0 && t.confidence < 1);
  assert.ok(t.reputation < t.score);
});

test("end-to-end loop: pay -> receipt -> attest -> reputation -> ranked discovery", async () => {
  const rail = new SettlementRail();
  const registry = createRegistry({ port: 4400 });
  await registry.listen();

  // two competing nodes for the same capability
  const goodId = generateIdentity();
  const newId = generateIdentity();
  const goodNode = createNode({
    identity: goodId,
    port: 4401,
    rail,
    capabilities: { "math.add": { priceEur: 2, schema: addSchema, handler: adder } },
  });
  const newNode = createNode({
    identity: newId,
    port: 4402,
    rail,
    capabilities: { "math.add": { priceEur: 2, schema: addSchema, handler: adder } },
  });
  await goodNode.listen();
  await newNode.listen();
  for (const n of [goodNode, newNode]) {
    await fetch(registry.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: n.manifest, manifestUrl: n.url + "/manifest" }),
    });
  }

  // a paying agent builds the good node's reputation across several settled calls
  const customer = generateIdentity();
  rail.deposit(customer.did, 100);
  for (let i = 0; i < 3; i++) {
    const { outcome, settlement } = await invoke({
      nodeDid: goodId.did,
      endpoint: goodNode.url + "/aleph",
      capability: "math.add",
      input: { a: i, b: 1 },
      agent: customer,
      rail,
      payEur: 2,
    });
    assert.equal(outcome, "success");
    await attest({
      agent: customer,
      subjectDid: goodId.did,
      reputationUrl: goodNode.url + "/reputation",
      settlement: settlement!,
      rating: 1,
    });
  }

  // the good node now has verifiable reputation; the new one has none
  const goodRep = await fetchReputation(goodNode.url + "/reputation");
  assert.equal(goodRep.trust.count, 3);
  assert.equal(goodRep.trust.score, 1);

  // a fresh agent resolves and ranks by computed trust — good node comes first
  const ranked = await resolveRanked(registry.url, "math.add", generateIdentity());
  assert.equal(ranked.length, 2);
  const [top, second] = ranked;
  assert.ok(top && second);
  assert.equal(top.did, goodId.did);
  assert.ok(top.trust > second.trust);

  await goodNode.close();
  await newNode.close();
  await registry.close();
});
