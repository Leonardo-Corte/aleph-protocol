// The store contract: a single suite every driver (in-memory, SQLite, Postgres)
// MUST pass identically. This is what guarantees the drivers are interchangeable.
// Not a *.test.ts file (so it isn't auto-run); driver test files call it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateIdentity, SettlementRail, createAttestation, type Manifest } from "@aleph/core";
import type { Stores } from "@aleph/store";

function manifestFor(did: string, caps: string[], reputation?: string): Manifest {
  return {
    v: "aleph/0.1",
    identity: did,
    conformance: "L1",
    capabilities: caps.map((key) => ({ key, risk: "low" as const })),
    endpoint: [`http://127.0.0.1/aleph`],
    ...(reputation ? { reputation } : {}),
  };
}

// A settled attestation from payer about payee, via a fresh rail.
function settledAttestation(amount = 5) {
  const rail = new SettlementRail();
  const payer = generateIdentity();
  const payee = generateIdentity();
  rail.deposit(payer.did, amount * 10);
  const lock = rail.lock(payer.did, payee.did, amount, "ref-" + Math.random());
  if (!lock.ok) throw new Error("lock failed");
  const settlement = rail.release(lock.escrow.id);
  const att = createAttestation(payer, { subject: payee.did, settlement, rating: 1 });
  return { att, payee, settlement };
}

// `make` returns a fresh, migrated Stores for each describe-run.
export function runStoreContract(name: string, make: () => Promise<Stores>): void {
  test(`[${name}] registry: upsert is first-seen once, resolve returns the pointer`, async () => {
    const s = await make();
    try {
      const node = generateIdentity();
      const m = manifestFor(node.did, ["math.add"], "http://127.0.0.1/reputation");
      assert.equal(await s.registry.upsertNode(m, "http://n/manifest"), true); // first-seen
      assert.equal(await s.registry.upsertNode(m, "http://n/manifest"), false); // again → not new
      const found = await s.registry.resolveByCapability("math.add", 10);
      assert.equal(found.length, 1);
      assert.equal(found[0]?.did, node.did);
      assert.equal(found[0]?.reputation, "http://127.0.0.1/reputation");
      assert.match(found[0]?.summary ?? "", /math\.add/);
      assert.equal((await s.registry.resolveByCapability("nope.none", 10)).length, 0);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] nonces: first record wins, replay rejected, gc drops old`, async () => {
    const s = await make();
    try {
      const did = generateIdentity().did;
      assert.equal(await s.nonces.checkAndRecord(did, "n1", 1000), true);
      assert.equal(await s.nonces.checkAndRecord(did, "n1", 1000), false); // replay
      assert.equal(await s.nonces.checkAndRecord(did, "n2", 5000), true);
      const dropped = await s.nonces.gc(2000); // drop ts < 2000 → n1
      assert.equal(dropped, 1);
      // n1 can be recorded again after GC; n2 still blocks
      assert.equal(await s.nonces.checkAndRecord(did, "n1", 6000), true);
      assert.equal(await s.nonces.checkAndRecord(did, "n2", 6000), false);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] reputation: store, dedup by settlement, retrieve raw set`, async () => {
    const s = await make();
    try {
      const { att, payee } = settledAttestation(7);
      assert.equal(await s.reputation.addAttestation(att), true);
      // same settlement again → rejected (one settlement, one attestation)
      assert.equal(await s.reputation.addAttestation(att), false);
      const list = await s.reputation.getAttestations(payee.did);
      assert.equal(list.length, 1);
      assert.equal(list[0]?.subject, payee.did);
      assert.equal(list[0]?.settlement.escrowId, att.settlement.escrowId);
      assert.equal((await s.reputation.getAttestations(generateIdentity().did)).length, 0);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] settlements: record and fetch by escrow id`, async () => {
    const s = await make();
    try {
      const { settlement } = settledAttestation(9);
      await s.settlements.record(settlement);
      const got = await s.settlements.get(settlement.escrowId);
      assert.ok(got);
      assert.equal(got.escrowId, settlement.escrowId);
      assert.equal(got.amount, settlement.amount);
      assert.equal(got.status, "released");
      assert.equal(await s.settlements.get("missing"), undefined);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] concurrency: parallel writes don't double-insert`, async () => {
    const s = await make();
    try {
      // 20 parallel upserts of the SAME node → exactly one reports first-seen.
      const node = generateIdentity();
      const m = manifestFor(node.did, ["math.add"]);
      const upserts = await Promise.all(
        Array.from({ length: 20 }, () => s.registry.upsertNode(m, "http://n/manifest")),
      );
      assert.equal(upserts.filter((x) => x).length, 1, "exactly one upsert is first-seen under concurrency");
      assert.equal((await s.registry.resolveByCapability("math.add", 50)).length, 1, "no duplicate rows");

      // 20 parallel attestations backed by the SAME settlement → exactly one stored.
      const { att, payee } = settledAttestation(3);
      const adds = await Promise.all(Array.from({ length: 20 }, () => s.reputation.addAttestation(att)));
      assert.equal(
        adds.filter((x) => x).length,
        1,
        "exactly one attestation per settlement under concurrency (anti-Sybil holds)",
      );
      assert.equal((await s.reputation.getAttestations(payee.did)).length, 1);
    } finally {
      await s.close();
    }
  });
}
