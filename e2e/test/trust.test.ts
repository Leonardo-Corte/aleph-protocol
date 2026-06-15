// Phase C: the TRUST verb and the self-sustaining loop.
// - an attestation backed by a real settlement counts;
// - an attestation NOT backed by a settlement is zero-weight (anti-Sybil);
// - the consumer computes trust itself and ranks discovery by it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { invoke, attest, fetchReputation, resolveRanked } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { SettlementRail } from "@aleph/core";
import {
  createAttestation,
  verifyAttestation,
  computeTrust,
  computeTrustAsync,
  createRevocation,
  type Attestation,
} from "@aleph/core";
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

test("negative attestations lower the score; a signed revocation removes weight", () => {
  const rail = new SettlementRail();
  const payer = generateIdentity();
  const payee = generateIdentity();
  rail.deposit(payer.did, 100);
  const now = Date.now();

  const mk = (amount: number, rating: number) => {
    const lock = rail.lock(payer.did, payee.did, amount, "r" + Math.random());
    const s = rail.release((lock as { escrow: { id: string } }).escrow.id);
    return createAttestation(payer, { subject: payee.did, settlement: s, rating });
  };

  const good = mk(10, 1.0);
  const bad = mk(10, 0.0); // a fully negative attestation, same settled value

  // both count → value-weighted mean rating drops to 0.5
  const both = computeTrust([good, bad], { now });
  assert.equal(both.count, 2);
  assert.ok(Math.abs(both.score - 0.5) < 1e-9);

  // the issuer revokes the negative one → only the positive remains
  const rev = createRevocation(payer, bad.sig);
  const after = computeTrust([good, bad], { now }, [rev]);
  assert.equal(after.count, 1);
  assert.ok(Math.abs(after.score - 1.0) < 1e-9);

  // a revocation NOT signed by the original issuer must not bite
  const stranger = generateIdentity();
  const forgedRev = createRevocation(stranger, good.sig);
  const tampered = computeTrust([good, bad], { now }, [forgedRev]);
  assert.equal(tampered.count, 2); // good survives the bogus revocation

  // ratings are constrained to [0,1]
  assert.throws(() =>
    createAttestation(payer, { subject: payee.did, settlement: good.settlement, rating: -1 }),
  );
});

test("computeTrustAsync: an injected verifier can reject a fabricated settlement", async () => {
  const rail = new SettlementRail();
  const payer = generateIdentity();
  const payee = generateIdentity();
  rail.deposit(payer.did, 100);
  const now = Date.now();

  const mk = (amount: number, rating: number) => {
    const lock = rail.lock(payer.did, payee.did, amount, "r" + Math.random());
    const s = rail.release((lock as { escrow: { id: string } }).escrow.id);
    return createAttestation(payer, { subject: payee.did, settlement: s, rating });
  };
  const real = mk(10, 1.0);
  const alsoReal = mk(10, 1.0);

  // default verifier = sync verifyAttestation: both count
  const base = await computeTrustAsync([real, alsoReal], { policy: { now } });
  assert.equal(base.count, 2);

  // a stricter verifier that re-reads an external source (here: a stub standing
  // in for an on-chain read) rejects one settlement → it earns zero weight.
  const fabricatedId = alsoReal.settlement.escrowId;
  const withChainCheck = await computeTrustAsync([real, alsoReal], {
    policy: { now },
    verifier: (att) =>
      Promise.resolve(
        att.settlement.escrowId === fabricatedId
          ? { ok: false, reason: "not found on chain" }
          : verifyAttestation(att),
      ),
  });
  assert.equal(withChainCheck.count, 1);
  assert.equal(withChainCheck.totalValue, 10);
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
