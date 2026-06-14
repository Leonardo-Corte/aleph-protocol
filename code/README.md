# Aleph — reference implementation

A runnable reference implementation of the [Aleph Protocol](../README.md). **All five verbs work end to end**, with tests:

| Verb | What works |
|---|---|
| **FIND** | `RESOLVE` to a (federated) registry → pointers; lazy manifest fetch |
| **TRUST** | settlement-backed `ATTEST`; consumer-computed trust; reputation-ranked discovery (anti-Sybil) |
| **ACT** | `INVOKE` gated by a bounded `Grant`; typed JSON-Schema input |
| **PAY** | escrow lock → atomic settle on delivery → refund on failure; stable usage-credit unit |
| **PROVE** | signed `RECEIPT`s chained into a tamper-evident provenance trail; chain verifier |

Plus: hardened waist (replay / clock-skew / version), typed errors, `did:key` + `did:web` resolution, registry federation (gossip), a capability vocabulary, agentic composition across nodes, a CLI, and **native agent use over MCP**.

**Zero heavy dependencies** for the protocol core (only Node's built-in crypto). The MCP server uses the official `@modelcontextprotocol/sdk`.

## Requirements

- Node **≥ 23.6** (native TypeScript execution — no build step).

## Quickstart

```bash
cd code

# 1. run the end-to-end demo (no install needed)
node src/demo/run.ts

# 2. run the full test suite (install only needed for the MCP integration test)
npm install
npm test            # 27 tests
```

## Use the CLI

```bash
node src/cli.ts keygen                                   # a did:key identity
node src/cli.ts registry --port 4000                     # run a registry
node src/cli.ts node --port 4100 --registry http://127.0.0.1:4000   # run a node
node src/cli.ts resolve math.add --registry http://127.0.0.1:4000   # find + rank by trust
node src/cli.ts invoke  math.add --registry http://127.0.0.1:4000 --input '{"a":2,"b":3}'
```

## Use it from an agent (MCP)

Aleph is exposed to any MCP-capable agent (Claude Desktop, Claude Code, …) as two tools: `aleph_resolve` (FIND) and `aleph_invoke` (ACT + PROVE).

1. Start a demo network: `node src/demo/network.ts`
2. Point your agent's MCP config at the server:
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

## Structure

```
src/
  core/        the thin waist + crypto
    identity.ts    did:key (Ed25519)
    resolver.ts    pluggable DID resolution (did:key, did:web)
    envelope.ts    the signed, addressed message (5 types)
    replay.ts      receive-guard: replay + clock-skew + version
    grant.ts       bounded delegation (the safety gate)
    schema.ts      zero-dep JSON-Schema-subset validator
    manifest.ts    a node's self-declaration + validator
    vocabulary.ts  shared capability keys + seed vocabulary
    errors.ts      typed error model
    canonical.ts / hash.ts / base58.ts
  settle/        rail.ts — escrow ledger, stable usage credit, signed settlements
  trust/         attest.ts (anti-Sybil attestations + computeTrust) · chain.ts (receipt chains)
  node/          a capability provider (Grant + schema + escrow gates; serves /reputation)
  registry/      the discovery multiplier (RESOLVE → pointers; peer gossip)
  agent/
    client.ts      THE target: resolve · resolveRanked · invoke · attest · fetchReputation
    compose.ts     agentic composition across nodes
    mcp-server.ts  Aleph as MCP tools
  transport/     tiny HTTP (with a body-size DoS guard)
  demo/          run.ts (the "LO of 1969") · network.ts (persistent net for MCP)
  cli.ts         terminal driver
  index.ts       public API barrel
test/            27 tests across all phases
```

## What this implements vs. what is modeled

**Real and enforced:** identity, signed stateless envelopes, replay/skew/version guards, bounded grants, typed schema validation, escrow settlement with atomic release/refund, settlement-backed attestations (anti-Sybil), consumer-computed trust, reputation-ranked discovery, receipt chaining, agentic composition, registry federation, did:web parsing, the capability vocabulary, MCP exposure, a CLI.

**Modeled in-memory (interface ready for a real backend):** the settlement rail is an in-memory escrow ledger with the correct semantics, behind an interface a real chain/payment rail can replace; registries and reputation are in-memory; the fiat on-ramp (`deposit`) is the honestly-open reserve boundary (the chain proves what happens inside it, not that off-chain value exists). These are the documented next increments — see the paper, §8.
