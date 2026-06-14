# Aleph — reference implementation (v0)

A small, runnable reference implementation of the [Aleph Protocol](../README.md). It proves the thin waist works end to end: an agent **finds** a node, is **granted** bounded authority, **acts** on it, and verifies a **signed receipt** — the "LO of 1969".

**Zero heavy dependencies** for the core (only Node's built-in crypto). The optional MCP server uses the official `@modelcontextprotocol/sdk`.

## Requirements

- Node **≥ 23.6** (uses native TypeScript execution — no build step).

## Run the demo (no install needed)

```bash
cd code
node src/demo/run.ts
```

Expected output: the five verbs running, and the bounded-authority gate rejecting an ungranted call.

## Run the tests

```bash
cd code
npm install        # only needed for the MCP integration test
npm test           # node --test
```

Seven tests: the cryptographic core (identity, signed envelopes, tamper/wrong-signer detection, bounded grants) and a full **MCP client → Aleph → node** integration.

## Use it from an agent (MCP)

Aleph is exposed to any MCP-capable agent (Claude Desktop, Claude Code, …) as two tools: `aleph_resolve` (FIND) and `aleph_invoke` (ACT + PROVE).

1. Start a demo network in one terminal:
   ```bash
   node src/demo/network.ts
   ```
2. Point your agent's MCP config at the server (absolute path):
   ```json
   {
     "mcpServers": {
       "aleph": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/aleph-protocol/code/src/agent/mcp-server.ts"],
         "env": { "ALEPH_REGISTRY": "http://127.0.0.1:4000" }
       }
     }
   }
   ```
3. Ask the agent to call `math.add` — it will resolve, invoke, and return a verified receipt.

## Structure

```
src/
  core/        the thin waist in code
    identity.ts    did:key (Ed25519) — identify, sign, verify
    envelope.ts    the signed, addressed message (5 types)
    grant.ts       bounded delegation (the safety gate)
    manifest.ts    a node's self-declaration + validator
    canonical.ts   deterministic JSON for signing
    hash.ts        content hashing for receipt references
    base58.ts      did:key encoding (zero-dep)
  node/        a capability provider (publishes a Manifest, returns signed RECEIPTs)
  registry/    the discovery multiplier (RESOLVE → pointers)
  agent/
    client.ts      the agent-facing API (THE target): resolve · fetchManifest · invoke
    mcp-server.ts  Aleph exposed as MCP tools, so an agent uses it natively
  transport/   tiny HTTP helpers (transport lives below the waist)
  demo/
    run.ts         the end-to-end "LO of 1969"
    network.ts     a persistent registry + node for MCP use
test/          core unit tests + MCP integration test
```

## What this v0 does and does not do

**Does:** identity (did:key), signed stateless envelopes, the five message types, a registry with two-stage discovery, bounded grants enforced before action, signed and verified receipts, and native agent use via MCP.

**Does not yet:** settlement/payment (`SETTLE`) and settlement-backed reputation (`ATTEST`) — the next increment; a persistent/federated registry; the shared capability vocabulary governance. These are layers *above* the waist (see the paper, §7–§8). The waist is here and it runs.
