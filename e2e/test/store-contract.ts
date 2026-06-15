// The store contract: a single suite every driver (in-memory, SQLite, Postgres)
// MUST pass identically. This is what guarantees the drivers are interchangeable.
// Not a *.test.ts file (so it isn't auto-run); driver test files call it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateIdentity, SettlementRail, createAttestation, type Manifest } from "@aleph/core";
import type { Stores } from "@aleph/store";

function manifestFor(
  did: string,
  caps: string[],
  reputation?: string,
  opts: { price?: number; region?: string } = {},
): Manifest {
  return {
    v: "aleph/0.1",
    identity: did,
    conformance: "L1",
    capabilities: caps.map((key) => ({
      key,
      risk: "low" as const,
      ...(opts.price !== undefined
        ? { cost: { unit: "stable", value: String(opts.price), model: "per-call" } }
        : {}),
    })),
    endpoint: [`http://127.0.0.1/aleph`],
    ...(reputation ? { reputation } : {}),
    ...(opts.region ? { ext: { region: opts.region } } : {}),
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
      const found = (await s.registry.resolveByCapability("math.add", { limit: 10 })).results;
      assert.equal(found.length, 1);
      assert.equal(found[0]?.did, node.did);
      assert.equal(found[0]?.reputation, "http://127.0.0.1/reputation");
      assert.match(found[0]?.summary ?? "", /math\.add/);
      assert.equal((await s.registry.resolveByCapability("nope.none", { limit: 10 })).results.length, 0);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] registry: filtering (price/region/reputation) + keyset pagination`, async () => {
    const s = await make();
    try {
      // three providers of "img.gen": cheap/EU/high-rep, dear/US/low-rep, mid/EU.
      const a = generateIdentity();
      const b = generateIdentity();
      const c = generateIdentity();
      await s.registry.upsertNode(
        manifestFor(a.did, ["img.gen"], undefined, { price: 1, region: "eu" }),
        "http://a",
        {
          count: 20,
          distinctIssuers: 15,
          totalSettledValue: 500,
        },
      );
      await s.registry.upsertNode(
        manifestFor(b.did, ["img.gen"], undefined, { price: 9, region: "us" }),
        "http://b",
        {
          count: 1,
          distinctIssuers: 1,
          totalSettledValue: 3,
        },
      );
      await s.registry.upsertNode(
        manifestFor(c.did, ["img.gen"], undefined, { price: 5, region: "eu" }),
        "http://c",
      );

      // price ceiling
      const cheap = (await s.registry.resolveByCapability("img.gen", { maxPrice: 5 })).results;
      assert.deepEqual(new Set(cheap.map((p) => p.did)), new Set([a.did, c.did]));
      assert.ok(cheap.every((p) => (p.price ?? 0) <= 5));

      // region
      const eu = (await s.registry.resolveByCapability("img.gen", { region: "eu" })).results;
      assert.deepEqual(new Set(eu.map((p) => p.did)), new Set([a.did, c.did]));

      // reputation hint (min distinct issuers) — only A qualifies, and the hint
      // rides along on the pointer for cheap client-side ranking.
      const trusted = (await s.registry.resolveByCapability("img.gen", { minIssuers: 10 })).results;
      assert.equal(trusted.length, 1);
      assert.equal(trusted[0]?.did, a.did);
      assert.equal(trusted[0]?.rep?.distinctIssuers, 15);

      // keyset pagination: page size 2 → 2 then 1, all three seen, no dupes.
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await s.registry.resolveByCapability("img.gen", { limit: 2, cursor });
        pages++;
        for (const p of page.results) seen.add(p.did);
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.size, 3);
      assert.equal(pages, 2);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] registry: anti-entropy feed (changesSince)`, async () => {
    const s = await make();
    try {
      const a = generateIdentity();
      const b = generateIdentity();
      await s.registry.upsertNode(manifestFor(a.did, ["x.do"]), "http://a");
      await s.registry.upsertNode(manifestFor(b.did, ["y.do"]), "http://b");

      // everything since the beginning, oldest-first, monotonic revs
      const all = await s.registry.changesSince(0, 100);
      assert.equal(all.length, 2);
      const [first, second] = all;
      assert.ok(first && second);
      assert.ok(first.rev < second.rev);
      assert.equal(first.manifest.identity, a.did);

      // a peer that already has rev[0] pulls only the delta after it
      const delta = await s.registry.changesSince(first.rev, 100);
      assert.equal(delta.length, 1);
      assert.equal(delta[0]?.manifest.identity, b.did);

      // an update re-emits the node on the feed (updates propagate, not just inserts)
      await s.registry.upsertNode(manifestFor(a.did, ["x.do", "x.do2"]), "http://a");
      const afterUpdate = await s.registry.changesSince(second.rev, 100);
      assert.equal(afterUpdate.length, 1);
      assert.equal(afterUpdate[0]?.manifest.identity, a.did);
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
      const page = await s.reputation.getAttestations(payee.did);
      assert.equal(page.attestations.length, 1);
      assert.equal(page.attestations[0]?.subject, payee.did);
      assert.equal(page.attestations[0]?.settlement.escrowId, att.settlement.escrowId);
      assert.equal(page.nextCursor, undefined);
      assert.equal((await s.reputation.getAttestations(generateIdentity().did)).attestations.length, 0);
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
      assert.equal(
        (await s.registry.resolveByCapability("math.add", { limit: 50 })).results.length,
        1,
        "no duplicate rows",
      );

      // 20 parallel attestations backed by the SAME settlement → exactly one stored.
      const { att, payee } = settledAttestation(3);
      const adds = await Promise.all(Array.from({ length: 20 }, () => s.reputation.addAttestation(att)));
      assert.equal(
        adds.filter((x) => x).length,
        1,
        "exactly one attestation per settlement under concurrency (anti-Sybil holds)",
      );
      assert.equal((await s.reputation.getAttestations(payee.did)).attestations.length, 1);
    } finally {
      await s.close();
    }
  });

  test(`[${name}] reputation: pagination (keyset) + summary aggregate`, async () => {
    const s = await make();
    try {
      // a single payee attested by 5 distinct payers, each a real settlement
      const payee = generateIdentity();
      const rail = new SettlementRail();
      let total = 0;
      for (let i = 0; i < 5; i++) {
        const payer = generateIdentity();
        const amount = i + 1; // 1..5
        total += amount;
        rail.deposit(payer.did, amount);
        const lock = rail.lock(payer.did, payee.did, amount, "ref-" + i);
        if (!lock.ok) throw new Error("lock failed");
        const settlement = rail.release(lock.escrow.id);
        const att = createAttestation(payer, { subject: payee.did, settlement, rating: 1 });
        assert.equal(await s.reputation.addAttestation(att), true);
      }

      // walk pages of size 2 → 2 + 2 + 1, no duplicates, no omissions
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await s.reputation.getAttestations(payee.did, { limit: 2, cursor });
        pages++;
        assert.ok(page.attestations.length <= 2);
        for (const a of page.attestations) seen.add(a.settlement.escrowId);
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.size, 5);
      assert.equal(pages, 3);

      // the aggregate summary matches, computed at the DB
      const summary = await s.reputation.summary(payee.did);
      assert.equal(summary.subject, payee.did);
      assert.equal(summary.count, 5);
      assert.equal(summary.distinctIssuers, 5);
      assert.equal(summary.totalSettledValue, total);
      assert.ok(summary.oldestTs && summary.newestTs && summary.oldestTs <= summary.newestTs);

      // empty subject → zeroed summary
      const empty = await s.reputation.summary(generateIdentity().did);
      assert.equal(empty.count, 0);
      assert.equal(empty.distinctIssuers, 0);
      assert.equal(empty.totalSettledValue, 0);
    } finally {
      await s.close();
    }
  });
}
