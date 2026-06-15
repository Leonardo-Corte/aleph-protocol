// Section 5 acceptance: reputation must hold against an adversary manufacturing
// trust, and scale. We prove four properties:
//  1. wash-trading (self-dealing among a few identities) fails to outrank an
//     honest node with diverse real custom — even at far higher fake volume;
//  2. time-decay makes recent custom outweigh ancient custom;
//  3. the /reputation HTTP endpoint paginates and supports conditional (ETag) GETs.
// (Negative attestations + revocation are proven in trust.test.ts.)

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SettlementRail,
  generateIdentity,
  createAttestation,
  computeTrust,
  DEFAULT_HALF_LIFE_MS,
  type Attestation,
  type Identity,
} from "@aleph/core";
import { createNode } from "@aleph/node";

// Build `count` attestations for one payee, each from a DISTINCT payer paying
// `amountEach`, all rating 1.0 (the diverse, honest pattern).
function diverseCustom(payee: Identity, count: number, amountEach: number, ts: number): Attestation[] {
  const rail = new SettlementRail();
  const out: Attestation[] = [];
  for (let i = 0; i < count; i++) {
    const payer = generateIdentity();
    rail.deposit(payer.did, amountEach);
    const lock = rail.lock(payer.did, payee.did, amountEach, "ref-" + i);
    if (!lock.ok) throw new Error("lock failed");
    const settlement = rail.release(lock.escrow.id);
    out.push(createAttestation(payer, { subject: payee.did, settlement, rating: 1, ts }));
  }
  return out;
}

// Build `payments` self-dealing attestations spread over `issuers` identities
// (the wash-trade pattern: a few colluding identities pay each other).
function washTrade(
  payee: Identity,
  issuers: number,
  payments: number,
  amountEach: number,
  ts: number,
): Attestation[] {
  const rail = new SettlementRail();
  const payers = Array.from({ length: issuers }, () => generateIdentity());
  const out: Attestation[] = [];
  for (let i = 0; i < payments; i++) {
    const payer = payers[i % issuers]!;
    rail.deposit(payer.did, amountEach);
    const lock = rail.lock(payer.did, payee.did, amountEach, "ref-" + i);
    if (!lock.ok) throw new Error("lock failed");
    const settlement = rail.release(lock.escrow.id);
    out.push(createAttestation(payer, { subject: payee.did, settlement, rating: 1, ts }));
  }
  return out;
}

test("anti-Sybil: diverse honest custom outranks wash-trading", () => {
  const now = Date.now();
  const honest = generateIdentity();
  const washer = generateIdentity();

  // Honest: 10 distinct payers × 10 each = 100 total settled value.
  const honestAtts = diverseCustom(honest, 10, 10, now);
  // Wash A: SAME total value (100) concentrated in 2 self-dealing identities.
  const washSame = washTrade(washer, 2, 2, 50, now);
  // Wash B: 10× the value (1000) but still only 2 identities — buying volume,
  // not diversity. Per-issuer log saturation must keep this below honest.
  const washHeavy = washTrade(washer, 2, 10, 100, now);

  const h = computeTrust(honestAtts, { now });
  const wa = computeTrust(washSame, { now });
  const wb = computeTrust(washHeavy, { now });

  // both reach rating 1.0 — the differentiator is diversity-weighted confidence
  assert.equal(h.score, 1);
  assert.equal(wb.score, 1);
  assert.equal(h.distinctIssuers, 10);
  assert.equal(wb.distinctIssuers, 2);

  assert.ok(h.reputation > wa.reputation, "honest beats equal-value wash");
  assert.ok(h.reputation > wb.reputation, "honest beats 10x-volume wash via diversity");
});

test("time-decay: recent custom outweighs ancient custom", () => {
  const now = Date.now();
  const payee = generateIdentity();
  const rail = new SettlementRail();
  const payer = generateIdentity();
  rail.deposit(payer.did, 100);

  const mk = (amount: number, rating: number, ts: number) => {
    const lock = rail.lock(payer.did, payee.did, amount, "ref-" + Math.random());
    if (!lock.ok) throw new Error("lock failed");
    const s = rail.release(lock.escrow.id);
    return createAttestation(payer, { subject: payee.did, settlement: s, rating, ts });
  };

  // bad two half-lives ago (decay 0.25), good now (decay 1.0), same value 10
  const ancientBad = mk(10, 0.0, now - 2 * DEFAULT_HALF_LIFE_MS);
  const recentGood = mk(10, 1.0, now);

  const t = computeTrust([ancientBad, recentGood], { now });
  // value-weighted by decay: (1*10 + 0*2.5) / (10 + 2.5) = 0.8 — recent good wins
  assert.ok(Math.abs(t.score - 0.8) < 1e-9, `expected ~0.8, got ${t.score}`);

  // without decay (a flat policy) the same inputs would average to 0.5
  const flat = computeTrust([ancientBad, recentGood], { now, decay: () => 1 });
  assert.ok(Math.abs(flat.score - 0.5) < 1e-9);
});

test("/reputation HTTP: pagination + conditional ETag (304)", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4470,
    capabilities: { "noop.ping": { handler: () => ({ output: {} }) } },
  });
  await node.listen();
  const subject = node.manifest.identity;

  // post 5 settlement-backed attestations about the node
  const rail = new SettlementRail();
  for (let i = 0; i < 5; i++) {
    const payer = generateIdentity();
    rail.deposit(payer.did, 10);
    const lock = rail.lock(payer.did, subject, 10, "ref-" + i);
    if (!lock.ok) throw new Error("lock failed");
    const settlement = rail.release(lock.escrow.id);
    const att = createAttestation(payer, { subject, settlement, rating: 1 });
    const r = await fetch(node.url + "/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(att),
    });
    assert.equal(r.status, 200);
  }

  try {
    // page 1 of size 2 → 2 items + a nextCursor
    const p1 = await fetch(node.url + "/reputation?limit=2");
    const j1 = (await p1.json()) as { attestations: Attestation[]; nextCursor?: string };
    assert.equal(j1.attestations.length, 2);
    assert.ok(j1.nextCursor);

    // conditional GET with the page's ETag → 304 Not Modified
    const etag = p1.headers.get("etag");
    assert.ok(etag);
    const p1again = await fetch(node.url + "/reputation?limit=2", {
      headers: { "if-none-match": etag },
    });
    assert.equal(p1again.status, 304);

    // walking the cursor reaches all 5 with no duplicates
    const seen = new Set<string>();
    let cursor: string | undefined = j1.nextCursor;
    for (const a of j1.attestations) seen.add(a.settlement.escrowId);
    while (cursor) {
      const url = new URL(node.url + "/reputation");
      url.searchParams.set("limit", "2");
      url.searchParams.set("cursor", cursor);
      const res = await fetch(url);
      const j = (await res.json()) as { attestations: Attestation[]; nextCursor?: string };
      for (const a of j.attestations) seen.add(a.settlement.escrowId);
      cursor = j.nextCursor;
    }
    assert.equal(seen.size, 5);

    // the summary endpoint reports the aggregate
    const sres = await fetch(node.url + "/reputation/summary");
    const summary = (await sres.json()) as {
      count: number;
      distinctIssuers: number;
      totalSettledValue: number;
    };
    assert.equal(summary.count, 5);
    assert.equal(summary.distinctIssuers, 5);
    assert.equal(summary.totalSettledValue, 50);
  } finally {
    await node.close();
  }
});
