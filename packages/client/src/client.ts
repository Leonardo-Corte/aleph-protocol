// The Agent Client: the agent-facing API. This is THE target of Aleph — the
// surface an agent uses to cross the five verbs. Find a node, fetch its
// manifest, invoke it with a bounded Grant (paying via escrow if priced), and
// verify both the signed receipt and the settlement.

import { randomUUID } from "node:crypto";
import type { Identity } from "@aleph/core";
import type { Grant } from "@aleph/core";
import type { Manifest } from "@aleph/core";
import { createEnvelope, verifyEnvelope, type Envelope } from "@aleph/core";
import { verifySettlement, type SettlementRail, type SettlementRecord } from "@aleph/core";
import { createAttestation, computeTrust, type Attestation } from "@aleph/core";

// The aggregate reputation summary as served on the wire by a node. Declared
// here (not imported from @aleph/store) so the agent SDK stays free of any
// server-side storage dependency — it only consumes this JSON response.
export interface ReputationSummary {
  subject: string;
  count: number;
  distinctIssuers: number;
  totalSettledValue: number;
  oldestTs?: number;
  newestTs?: number;
}

export interface Pointer {
  did: string;
  manifest: string;
  summary: string;
  reputation?: string;
}

// FIND — ask a registry "who does X?"
export async function resolve(registryUrl: string, capability: string, agent: Identity): Promise<Pointer[]> {
  const env = createEnvelope(
    { from: agent.did, to: "did:aleph:registry", type: "RESOLVE", body: { capability } },
    agent.privateKey,
  );
  const res = await fetch(registryUrl + "/aleph", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(env),
  });
  const json = (await res.json()) as { results?: Pointer[] };
  return json.results ?? [];
}

// Fetch the full Manifest — only for a shortlisted candidate (lazy).
export async function fetchManifest(url: string): Promise<Manifest> {
  const res = await fetch(url);
  return (await res.json()) as Manifest;
}

// ACT + PAY + PROVE — invoke a capability, paying via escrow if requested,
// then verify the signed receipt and any settlement.
export async function invoke(opts: {
  nodeDid: string;
  endpoint: string;
  capability: string;
  input: Record<string, unknown>;
  grant?: Grant;
  agent: Identity;
  rail?: SettlementRail;
  payEur?: number;
  prev?: string[];
}): Promise<{ result: unknown; outcome: unknown; receipt: Envelope; settlement?: SettlementRecord }> {
  // PAY — lock funds in escrow before invoking (pay-on-delivery).
  let payment: { rail: string; escrow: string; amount: number } | undefined;
  if (opts.payEur && opts.payEur > 0) {
    if (!opts.rail) throw new Error("payEur set but no rail provided");
    const lock = opts.rail.lock(opts.agent.did, opts.nodeDid, opts.payEur, "pay-" + randomUUID());
    if (!lock.ok) throw new Error("payment lock failed: " + lock.reason);
    payment = { rail: opts.rail.did, escrow: lock.escrow.id, amount: opts.payEur };
  }

  const env = createEnvelope(
    {
      from: opts.agent.did,
      to: opts.nodeDid,
      type: "INVOKE",
      body: {
        capability: opts.capability,
        input: opts.input,
        grant: opts.grant,
        payment,
        prev: opts.prev,
      },
    },
    opts.agent.privateKey,
  );
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(env),
  });
  const receipt = (await res.json()) as Envelope;

  // PROVE — the agent does not trust the result on faith; it verifies.
  const v = verifyEnvelope(receipt);
  if (!v.ok) throw new Error("receipt signature invalid: " + v.reason);
  if (receipt.from !== opts.nodeDid) throw new Error("receipt not from the expected node");

  const settlement = (receipt.body.settlement as SettlementRecord | null) ?? undefined;
  if (settlement) {
    const sv = verifySettlement(settlement);
    if (!sv.ok) throw new Error("settlement invalid: " + sv.reason);
  }

  return { result: receipt.body.result, outcome: receipt.body.outcome, receipt, settlement };
}

// TRUST (write) — after a settled interaction, attest to the counterparty.
// The attestation is backed by the settlement, so it cannot be forged for free.
export async function attest(opts: {
  agent: Identity;
  subjectDid: string;
  reputationUrl: string;
  settlement: SettlementRecord;
  rating: number;
  claim?: string;
}): Promise<Attestation> {
  const att = createAttestation(opts.agent, {
    subject: opts.subjectDid,
    settlement: opts.settlement,
    rating: opts.rating,
    claim: opts.claim,
  });
  // Deliver it to the subject's reputation store (derive base from the pointer).
  const base = opts.reputationUrl.replace(/\/reputation$/, "");
  await fetch(base + "/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(att),
  });
  return att;
}

// TRUST (read) — fetch a node's raw attestations and compute trust locally.
// Follows pagination to the end so trust is computed over the FULL evidence set;
// a node cannot truncate its bad history into invisibility by paginating.
export async function fetchReputation(
  reputationUrl: string,
): Promise<{ attestations: Attestation[]; trust: ReturnType<typeof computeTrust> }> {
  const attestations: Attestation[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(reputationUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url);
    const json = (await res.json()) as { attestations?: Attestation[]; nextCursor?: string };
    attestations.push(...(json.attestations ?? []));
    cursor = json.nextCursor;
  } while (cursor);
  return { attestations, trust: computeTrust(attestations) };
}

// TRUST (read, cheap) — fetch only the aggregate summary, with conditional
// support: pass a prior ETag to get a 304 (and reuse the cached summary) when
// nothing changed. Returns the ETag so the caller can cache it.
export async function fetchReputationSummary(
  reputationUrl: string,
  etag?: string,
): Promise<{ summary?: ReputationSummary; etag?: string; notModified: boolean }> {
  const summaryUrl = reputationUrl.replace(/\/reputation$/, "/reputation/summary");
  const res = await fetch(summaryUrl, etag ? { headers: { "if-none-match": etag } } : undefined);
  const newEtag = res.headers.get("etag") ?? undefined;
  if (res.status === 304) return { notModified: true, etag: etag ?? newEtag };
  return { summary: (await res.json()) as ReputationSummary, etag: newEtag, notModified: false };
}

// FIND + TRUST — resolve candidates and rank them by consumer-computed trust.
// (A node with no reputation pointer scores 0 but is still listed.)
export async function resolveRanked(
  registryUrl: string,
  capability: string,
  agent: Identity,
): Promise<(Pointer & { trust: number; attestations: number })[]> {
  const pointers = await resolve(registryUrl, capability, agent);
  const ranked = await Promise.all(
    pointers.map(async (p) => {
      if (!p.reputation) return { ...p, trust: 0, attestations: 0 };
      try {
        const { trust } = await fetchReputation(p.reputation);
        // Rank by `reputation` (mean rating folded with diversity + decay
        // confidence), not raw `score`: at equal rating, more distinct, recent,
        // settlement-backed custom ranks higher — that is the anti-Sybil signal.
        return { ...p, trust: trust.reputation, attestations: trust.count };
      } catch {
        return { ...p, trust: 0, attestations: 0 };
      }
    }),
  );
  return ranked.sort((a, b) => b.trust - a.trust);
}
