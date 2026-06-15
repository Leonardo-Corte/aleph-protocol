# The registry (discovery, federation) & how to run your own

> Status: implemented and tested (ROADMAP §6, decision D9). Indexed filtered
> discovery, keyset pagination, anti-entropy federation, lazy manifest
> re-verification, and caching are in `@aleph/registry` + `@aleph/store`.

## What a registry is — and is not

A registry is the **discovery multiplier**: nodes register their Manifest, and an
agent sends a `RESOLVE` to learn *who* provides a capability. It returns
**pointers** (DID + manifest location + summary + price + a reputation hint),
never full Manifests — the two-stage, pull-not-push design.

A registry is **a replicating index, not an authority** (the end-to-end
principle):

- It indexes only **authentic, self-signed Manifests** — it re-verifies every
  Manifest's signature before indexing, and trusts no peer's claims.
- It **does not mint trust**. The reputation hint it stores is a coarse
  pre-filter; the agent always re-computes trust from the raw attestations and
  **re-verifies the Manifest** itself before acting (see `fetchManifest`).
- **Anyone can run one.** Agents may query several and merge. The network is the
  set of nodes, not any registry.

## Indexed, filtered discovery

`RESOLVE` is an indexed query on `node_capabilities`. The agent pushes
selectivity to the registry so it pulls fewer candidates (a `ResolveFilter`):

| filter        | meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `maxPrice`    | exclude capabilities priced above this (from `cost.value`)    |
| `region`      | require this node region (`manifest.ext.region`)              |
| `minIssuers`  | require ≥ this many distinct reputation issuers (coarse hint) |
| `minSettled`  | require ≥ this much total settled value (coarse hint)         |
| `limit`/`cursor` | keyset pagination, newest-first, stable under writes       |

Results carry `price` and the reputation `rep` hint so an agent can rank cheaply
before fetching any full Manifest.

## Federation: gossip + anti-entropy

Two mechanisms keep peers eventually consistent:

1. **Gossip on write.** A first-seen registration is pushed to configured peers
   (best-effort; a `gossiped` flag prevents propagation loops).
2. **Anti-entropy (the backstop).** Each registry exposes a `GET /since?rev=`
   delta feed (registrations after a monotonic revision, oldest-first). A peer
   periodically `reconcile()`s: it pulls each peer's deltas from a per-peer
   cursor, **re-verifies every Manifest**, and upserts idempotently. This
   recovers state a peer missed while offline — gossip alone cannot.

Properties: **eventually consistent**, **loop-free** (cursored + idempotent),
**no global authority**. A registry that was down catches up on its next
reconcile.

## Caching & performance

- The node `/manifest` endpoint sends an **ETag** (from the Manifest signature)
  and `Cache-Control`; a conditional re-fetch is a **304**.
- The registry keeps a **short-TTL read cache** for hot capability resolves,
  **fully invalidated on every write**, so correctness never lags a registration.
- Target: **p99 RESOLVE latency < 50 ms** on a warm in-memory registry
  (measured locally p50 ≈ 0.35 ms, p99 ≈ 1.2 ms over N=300). See
  `e2e/test/perf.test.ts`.

## Run your own registry

```ts
import { createRegistry } from "@aleph/registry";
import { PostgresStores } from "@aleph/store";

// production: Postgres-backed, federated, periodically reconciling
const stores = await PostgresStores.connect(process.env.DATABASE_URL!);
await stores.migrate();
const registry = createRegistry({
  port: 4000,
  store: stores.registry,
  nonceStore: stores.nonces,
  peers: ["https://registry.example.org", "https://registry.other.org"],
  reconcileIntervalMs: 30_000, // anti-entropy every 30s
  resolveCacheTtlMs: 1_000, // hot-resolve cache (0 to disable)
});
await registry.listen();
```

For a laptop/edge deployment, swap `PostgresStores` for `SqliteStores` (or omit
`store` entirely for in-memory). To **federate**, run a second registry, list
each other in `peers`, and they will gossip new registrations and reconcile the
rest. Nodes register out-of-band by POSTing `{ manifest, manifestUrl }` to
`/register`; the registry re-verifies the Manifest signature before indexing.

### Endpoints

| method + path            | purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `POST /register`         | index a node (re-verifies the signed Manifest)     |
| `POST /aleph` (RESOLVE)  | find providers of a capability (filtered, paged)   |
| `GET  /since?rev=&limit=`| anti-entropy delta feed for peers                  |
