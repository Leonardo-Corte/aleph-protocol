# Quickstart

Two paths: **integrate an agent** (consume the network) or **run a node**
(provide a capability). Both take minutes.

## Integrate an agent (10 lines)

```bash
npm i @aleph/client @aleph/core
```

```ts
import { resolve, fetchManifest, invoke } from "@aleph/client";
import { generateIdentity, createGrant } from "@aleph/core";

const agent = generateIdentity();
const { results } = await resolve("https://registry.example.org", "math.add", agent);
const top = results[0]; // ranked by trust
const manifest = await fetchManifest(top.manifest, top.did); // re-verifies signature + pins DID
const grant = createGrant(
  { issuer: agent.did, grantee: agent.did, scope: [{ capability: "math.add" }], not_after: Date.now() + 60_000 },
  agent.privateKey,
);
const { outcome, result } = await invoke({
  nodeDid: manifest.identity,
  endpoint: manifest.endpoint[0],
  capability: "math.add",
  input: { a: 2, b: 3 },
  agent,
  grant,
});
console.log(outcome, result); // "success" { sum: 5 } — with a verified receipt
```

The five verbs: **FIND** (`resolve`) · **TRUST** (`resolveRanked` /
`fetchReputation`) · **ACT + PAY** (`invoke`) · **PROVE** (the signed receipt,
verified for you). Capability output is **untrusted** — validate it
(`verifyOutput`) and gate dangerous calls (`requiresConfirmation`).

## Run a node (one command)

```bash
npm create aleph-node@latest my-node
cd my-node && npm install && npm start
# ALEPH_REGISTRY=https://registry.example.org npm start   # + register & be discoverable
```

Edit `index.mjs`: replace `math.add` with a capability that does real work, give
it a JSON Schema, and (if priced) wire a settlement rail. To **deploy** it, see
[`docs/operators/`](./operators/README.md) (`docker compose up` for a full local
stack: registry + node + Postgres).

## Use it from an LLM (MCP)

`@aleph/mcp` exposes Aleph as an MCP server (`aleph_resolve`, `aleph_invoke`), so
an agent in Claude (or any MCP client) can find, invoke, and pay nodes directly.

## Other languages

A minimal **Python** SDK (`pip install aleph-protocol`) reproduces the wire
format byte-for-byte and interoperates with TS nodes — see `sdk/python/`.

More: the spec (`aleph-manifest-spec.md`), the paper
(`aleph-protocol-paper.md`), runnable demos in `examples/`, and the API
reference (`pnpm docs:api`).
