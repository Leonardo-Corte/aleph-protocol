// The Agent Client: the agent-facing API. This is THE target of Aleph — the
// surface an agent uses to cross the five verbs. Find a node, fetch its
// manifest, invoke it with a bounded Grant (paying via escrow if priced), and
// verify both the signed receipt and the settlement.

import { randomUUID } from "node:crypto";
import { createEnvelope, verifyEnvelope, type Envelope } from "../core/envelope.ts";
import type { Identity } from "../core/identity.ts";
import type { Grant } from "../core/grant.ts";
import type { Manifest } from "../core/manifest.ts";
import { verifySettlement, type SettlementRail, type SettlementRecord } from "../settle/rail.ts";

export type Pointer = { did: string; manifest: string; summary: string; reputation?: string };

// FIND — ask a registry "who does X?"
export async function resolve(
  registryUrl: string,
  capability: string,
  agent: Identity,
): Promise<Pointer[]> {
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
