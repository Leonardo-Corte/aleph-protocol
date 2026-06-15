// The Registry: the discovery multiplier. Nodes register their Manifest; an
// agent sends a RESOLVE and gets back *pointers* (did + manifest location +
// summary + reputation pointer), never full manifests — the two-stage,
// pull-not-push design that keeps the agent from loading capabilities it will
// not use. Inbound RESOLVE Envelopes pass through the receive-guard.

import http from "node:http";
import type { Envelope, NonceChecker } from "@aleph/core";
import { NonceStore, verifyReceived } from "@aleph/core";
import { verifyManifest, type Manifest } from "@aleph/core";
import { err } from "@aleph/core";
import {
  InMemoryRegistryStore,
  type RegistryStore,
  type RepHint,
  type ResolveFilter,
  type ResolvePage,
  type RegistrationDelta,
} from "@aleph/store";
import {
  readJson,
  sendJson,
  asyncHandler,
  RateLimiter,
  clientIp,
  hardenServer,
  type RateLimitOptions,
} from "@aleph/transport";

// Best-effort fetch of a node's reputation summary, kept as a COARSE discovery
// hint (the agent still computes real trust). Any failure → no hint; discovery
// must never block on a slow or absent reputation endpoint.
async function defaultFetchSummary(reputationUrl: string): Promise<RepHint | undefined> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(reputationUrl + "/summary", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return undefined;
    const s = (await res.json()) as Partial<RepHint>;
    return {
      count: s.count ?? 0,
      distinctIssuers: s.distinctIssuers ?? 0,
      totalSettledValue: s.totalSettledValue ?? 0,
    };
  } catch {
    return undefined;
  }
}

// Federated registries gossip registrations to peers, so a RESOLVE to any
// registry yields a comparable view. No registry is authoritative — discovery
// is a service to the network, not the network.
//
// Storage is pluggable: pass `store` (SQLite/Postgres) and `nonceStore` to
// persist; both default to in-memory (behavior unchanged).
export function createRegistry(opts: {
  port: number;
  peers?: string[];
  store?: RegistryStore;
  nonceStore?: NonceChecker;
  // Injectable for tests; defaults to a real best-effort HTTP fetch.
  fetchSummary?: (reputationUrl: string) => Promise<RepHint | undefined>;
  // If set, periodically pull deltas from peers (anti-entropy). Tests call
  // reconcile() directly for determinism; production sets an interval.
  reconcileIntervalMs?: number;
  // Short-TTL read cache for hot capability resolves (ms). 0 disables it.
  resolveCacheTtlMs?: number;
  // Token-bucket rate limit per IP and per caller DID. Generous default.
  rateLimit?: RateLimitOptions;
}) {
  const store: RegistryStore = opts.store ?? new InMemoryRegistryStore();
  const nonces: NonceChecker = opts.nonceStore ?? new NonceStore();
  const peers = opts.peers ?? [];
  const fetchSummary = opts.fetchSummary ?? defaultFetchSummary;
  const cacheTtl = opts.resolveCacheTtlMs ?? 1000;
  const limiter = new RateLimiter(opts.rateLimit ?? { capacity: 5000, refillPerSec: 500 });

  // A tiny read cache for hot capabilities: discovery is read-heavy and writes
  // are comparatively rare, so cache resolves briefly and drop the whole cache
  // on any write (register/reconcile). Bounded staleness = TTL; correctness on
  // write = full invalidation.
  const resolveCache = new Map<string, { at: number; page: ResolvePage }>();
  const invalidateCache = () => resolveCache.clear();
  async function cachedResolve(capability: string, filter: ResolveFilter): Promise<ResolvePage> {
    if (cacheTtl <= 0) return store.resolveByCapability(capability, filter);
    const key = capability + "|" + JSON.stringify(filter);
    const hit = resolveCache.get(key);
    if (hit && Date.now() - hit.at < cacheTtl) return hit.page;
    const page = await store.resolveByCapability(capability, filter);
    resolveCache.set(key, { at: Date.now(), page });
    return page;
  }

  // Anti-entropy state: how far we have caught up on each peer's feed. Gossip-on-
  // write is best-effort (a peer may be offline); periodic reconcile is the
  // backstop that guarantees eventual consistency. Cursors are per-peer because
  // each registry numbers its own feed independently.
  const peerCursor = new Map<string, number>();
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;

  async function gossip(manifest: Manifest, manifestUrl: string): Promise<void> {
    await Promise.allSettled(
      peers.map((peer) =>
        fetch(peer + "/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // `gossiped` flag prevents infinite propagation loops.
          body: JSON.stringify({ manifest, manifestUrl, gossiped: true }),
        }),
      ),
    );
  }

  // Pull each peer's deltas since our last cursor, RE-VERIFY every Manifest
  // (a registry trusts no peer's claims — it replicates only authentic, self-
  // signed Manifests), and upsert idempotently. Returns how many it indexed.
  async function reconcile(): Promise<number> {
    let pulled = 0;
    for (const peer of peers) {
      const after = peerCursor.get(peer) ?? 0;
      try {
        const res = await fetch(`${peer}/since?rev=${after}&limit=500`);
        if (!res.ok) continue;
        const { changes } = (await res.json()) as { changes?: RegistrationDelta[] };
        for (const d of changes ?? []) {
          if (verifyManifest(d.manifest).ok) {
            await store.upsertNode(d.manifest, d.manifestUrl);
            invalidateCache();
            pulled++;
          }
          peerCursor.set(peer, Math.max(peerCursor.get(peer) ?? 0, d.rev));
        }
      } catch {
        // a peer being unreachable is normal; the next reconcile retries
      }
    }
    return pulled;
  }

  const server = http.createServer(
    asyncHandler(async (req, res) => {
      try {
        // Abuse defense: per-IP token bucket in front of every endpoint.
        if (!limiter.allow("ip:" + clientIp(req))) {
          sendJson(res, 429, { error: err("RATE_LIMITED", "rate limit exceeded") });
          return;
        }
        // Anti-entropy feed: registrations since `rev`, oldest-first, so a peer
        // (even one that was offline) can catch up by pulling deltas.
        if (req.method === "GET" && req.url?.startsWith("/since")) {
          const url = new URL(req.url, "http://internal");
          const after = Number(url.searchParams.get("rev") ?? 0) || 0;
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 1000);
          const changes = await store.changesSince(after, limit);
          sendJson(res, 200, { changes });
          return;
        }

        // Out-of-band registration: a node submits its Manifest + where to fetch it.
        if (req.method === "POST" && req.url === "/register") {
          const body = await readJson(req);
          const manifest = body.manifest as Manifest;
          const manifestUrl = body.manifestUrl as string;
          // Re-verify the node's self-signature: a registry is a replicator, not
          // an authority — it indexes only Manifests that are authentic and
          // authored by the claimed DID, regardless of who submitted them.
          const v = verifyManifest(manifest);
          if (!v.ok) {
            sendJson(res, 400, { error: err("ENVELOPE_INVALID", v.reason ?? "bad manifest") });
            return;
          }
          // Best-effort reputation hint for discovery pre-filtering (never fatal).
          const rep = manifest.reputation ? await fetchSummary(manifest.reputation) : undefined;
          const added = await store.upsertNode(manifest, manifestUrl, rep);
          invalidateCache(); // a write may change any cached resolve
          // Propagate first-seen registrations to peers (not re-propagating gossip).
          if (added && !body.gossiped) await gossip(manifest, manifestUrl);
          sendJson(res, 200, { ok: true });
          return;
        }

        // RESOLVE: find providers of a capability.
        if (req.method === "POST" && req.url === "/aleph") {
          const env = (await readJson(req)) as unknown as Envelope;
          const v = await verifyReceived(env, { nonceStore: nonces });
          if (!v.ok) {
            sendJson(res, 400, { error: err(v.code!, v.reason!) });
            return;
          }
          if (env.type !== "RESOLVE") {
            sendJson(res, 400, { error: err("WRONG_TYPE", "registry only accepts RESOLVE") });
            return;
          }
          // per-DID rate limit (an authenticated flood from one caller)
          if (!limiter.allow("did:" + env.from)) {
            sendJson(res, 429, { error: err("RATE_LIMITED", "rate limit exceeded") });
            return;
          }
          const capability = env.body.capability as string;
          // Optional selectivity pushed to the registry (pull-not-push): the
          // agent pulls fewer candidates by filtering + paginating server-side.
          const filter = (env.body.filter as ResolveFilter | undefined) ?? {};
          const page = await cachedResolve(capability, filter);
          sendJson(res, 200, { results: page.results, nextCursor: page.nextCursor });
          return;
        }

        sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
      } catch (e) {
        sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
      }
    }),
  );

  hardenServer(server);

  return {
    url: `http://127.0.0.1:${opts.port}`,
    // Pull deltas from all peers now (the anti-entropy backstop). Exposed so
    // tests can drive it deterministically; production uses reconcileIntervalMs.
    reconcile,
    listen: () =>
      new Promise<void>((r) =>
        server.listen(opts.port, "127.0.0.1", () => {
          if (opts.reconcileIntervalMs) {
            reconcileTimer = setInterval(() => void reconcile(), opts.reconcileIntervalMs);
            reconcileTimer.unref?.(); // never keep the process alive for it
          }
          r();
        }),
      ),
    close: () =>
      new Promise<void>((r) => {
        if (reconcileTimer) clearInterval(reconcileTimer);
        server.close(() => {
          r();
        });
      }),
  };
}
