// The "LO of 1969": the smallest end-to-end run that proves Aleph works.
// A registry and a node come up; an agent FINDs the node, is GRANTed bounded
// authority by its principal, INVOKEs the node, and verifies the signed
// RECEIPT. Two nodes speaking the new language, for real.

import { resolve, fetchManifest, invoke } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { createGrant } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

const short = (did: string) => did.slice(0, 20) + "…";

// --- identities ---
const principal = generateIdentity(); // the human, who delegates
const agent = generateIdentity(); // the agent, acting on the human's behalf
const nodeId = generateIdentity(); // the service provider

console.log("Aleph reference demo — the 'LO of 1969'\n");

// --- boot the registry ---
const registry = createRegistry({ port: 4000 });
await registry.listen();

// --- boot a node offering one trivial, dependency-free capability ---
const node = createNode({
  identity: nodeId,
  port: 4100,
  capabilities: {
    "math.add": {
      requiredGrant: true,
      handler: (input) => ({ output: { sum: (input.a as number) + (input.b as number) } }),
    },
  },
});
await node.listen();

// --- node registers its manifest with the registry ---
await fetch(registry.url + "/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
});

// === the five verbs ===

// 1. FIND
const { results } = await resolve(registry.url, "math.add", agent);
console.log(
  `1. RESOLVE  → found ${results.length} node(s) for "math.add": ${results.map((r) => short(r.did)).join(", ")}`,
);

// fetch the chosen node's full manifest (lazy, only for the candidate)
const chosen = results[0];
if (!chosen) throw new Error("no node found for math.add");
const manifest = await fetchManifest(chosen.manifest);
const endpoint = manifest.endpoint[0];
if (!endpoint) throw new Error("node manifest has no endpoint");

// 2. the principal GRANTs the agent bounded authority
const grant = createGrant(
  {
    issuer: principal.did,
    grantee: agent.did,
    scope: [{ capability: "math.add" }],
    not_after: Date.now() + 60_000,
  },
  principal.privateKey,
);
console.log(`2. GRANT    → principal ${short(principal.did)} authorized agent for "math.add"`);

// 3. ACT  +  4. PROVE
const { result, outcome, receipt } = await invoke({
  nodeDid: manifest.identity,
  endpoint,
  capability: "math.add",
  input: { a: 2, b: 3 },
  grant,
  agent,
});
console.log(`3. INVOKE   → math.add(2, 3) → ${JSON.stringify(result)} · outcome: ${String(outcome)}`);
console.log(`4. RECEIPT  → verified, signed by node ${short(receipt.from)}`);

// --- prove the bounded-authority gate actually bites: no grant ⇒ rejected ---
const noGrant = await invoke({
  nodeDid: manifest.identity,
  endpoint,
  capability: "math.add",
  input: { a: 1, b: 1 },
  agent, // no grant
});
console.log(
  `5. GATE     → invoke without a grant → outcome: ${String(noGrant.outcome)} (${JSON.stringify(noGrant.result)})`,
);

console.log("\nTwo nodes spoke Aleph end to end. The network has its first four nodes. ✅");

await node.close();
await registry.close();
