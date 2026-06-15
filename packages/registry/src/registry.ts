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
import { InMemoryRegistryStore, type RegistryStore, type RepHint, type ResolveFilter } from "@aleph/store";
import { readJson, sendJson, asyncHandler } from "@aleph/transport";

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
}) {
  const store: RegistryStore = opts.store ?? new InMemoryRegistryStore();
  const nonces: NonceChecker = opts.nonceStore ?? new NonceStore();
  const peers = opts.peers ?? [];
  const fetchSummary = opts.fetchSummary ?? defaultFetchSummary;

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

  const server = http.createServer(
    asyncHandler(async (req, res) => {
      try {
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
          const capability = env.body.capability as string;
          // Optional selectivity pushed to the registry (pull-not-push): the
          // agent pulls fewer candidates by filtering + paginating server-side.
          const filter = (env.body.filter as ResolveFilter | undefined) ?? {};
          const page = await store.resolveByCapability(capability, filter);
          sendJson(res, 200, { results: page.results, nextCursor: page.nextCursor });
          return;
        }

        sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
      } catch (e) {
        sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
      }
    }),
  );

  return {
    url: `http://127.0.0.1:${opts.port}`,
    listen: () =>
      new Promise<void>((r) =>
        server.listen(opts.port, "127.0.0.1", () => {
          r();
        }),
      ),
    close: () =>
      new Promise<void>((r) =>
        server.close(() => {
          r();
        }),
      ),
  };
}
