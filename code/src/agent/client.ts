// The Agent Client: the agent-facing API. This is THE target of Aleph — the
// surface an agent uses to cross the five verbs. Find a node, fetch its
// manifest, invoke it with a bounded Grant, and verify the signed receipt.

import { createEnvelope, verifyEnvelope, type Envelope } from "../core/envelope.ts";
import type { Identity } from "../core/identity.ts";
import type { Grant } from "../core/grant.ts";
import type { Manifest } from "../core/manifest.ts";

export type Pointer = { did: string; manifest: string; summary: string };

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

// ACT + PROVE — invoke a capability with a Grant, get back a verified receipt.
export async function invoke(opts: {
  nodeDid: string;
  endpoint: string;
  capability: string;
  input: Record<string, unknown>;
  grant?: Grant;
  agent: Identity;
}): Promise<{ result: unknown; outcome: unknown; receipt: Envelope }> {
  const env = createEnvelope(
    {
      from: opts.agent.did,
      to: opts.nodeDid,
      type: "INVOKE",
      body: { capability: opts.capability, input: opts.input, grant: opts.grant },
    },
    opts.agent.privateKey,
  );
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(env),
  });
  const receipt = (await res.json()) as Envelope;

  // The agent does not trust the result on faith — it verifies the receipt.
  const v = verifyEnvelope(receipt);
  if (!v.ok) throw new Error("receipt signature invalid: " + v.reason);
  if (receipt.from !== opts.nodeDid) throw new Error("receipt not from the expected node");

  return { result: receipt.body.result, outcome: receipt.body.outcome, receipt };
}
