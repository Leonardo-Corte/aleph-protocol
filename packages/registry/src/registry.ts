// The Registry: the discovery multiplier. Nodes register their Manifest; an
// agent sends a RESOLVE and gets back *pointers* (did + manifest location +
// summary + reputation pointer), never full manifests — the two-stage,
// pull-not-push design that keeps the agent from loading capabilities it will
// not use. Inbound RESOLVE Envelopes pass through the receive-guard.

import http from "node:http";
import type { Envelope } from "@aleph/core";
import { NonceStore, verifyReceived } from "@aleph/core";
import { validateManifest, type Manifest } from "@aleph/core";
import { err } from "@aleph/core";
import { readJson, sendJson } from "@aleph/transport";

type Pointer = { did: string; manifest: string; summary: string; reputation?: string };

// Federated registries gossip registrations to peers, so a RESOLVE to any
// registry yields a comparable view. No registry is authoritative — discovery
// is a service to the network, not the network.
export function createRegistry(opts: { port: number; peers?: string[] }) {
  const byCapability = new Map<string, Pointer[]>();
  const nonces = new NonceStore();
  const peers = opts.peers ?? [];

  function index(manifest: Manifest, manifestUrl: string): boolean {
    let added = false;
    for (const cap of manifest.capabilities) {
      const list = byCapability.get(cap.key) ?? [];
      if (!list.some((p) => p.did === manifest.identity)) {
        list.push({
          did: manifest.identity,
          manifest: manifestUrl,
          summary: `${cap.key} · risk:${cap.risk ?? "low"}`,
          reputation: manifest.reputation,
        });
        added = true;
      }
      byCapability.set(cap.key, list);
    }
    return added;
  }

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

  const server = http.createServer(async (req, res) => {
    try {
      // Out-of-band registration: a node submits its Manifest + where to fetch it.
      if (req.method === "POST" && req.url === "/register") {
        const body = await readJson(req);
        const manifest = body.manifest as Manifest;
        const manifestUrl = body.manifestUrl as string;
        const v = validateManifest(manifest);
        if (!v.ok) return sendJson(res, 400, { error: err("ENVELOPE_INVALID", v.reason ?? "bad manifest") });
        const added = index(manifest, manifestUrl);
        // Propagate first-seen registrations to peers (not re-propagating gossip).
        if (added && !body.gossiped) await gossip(manifest, manifestUrl);
        return sendJson(res, 200, { ok: true });
      }

      // RESOLVE: find providers of a capability.
      if (req.method === "POST" && req.url === "/aleph") {
        const env = (await readJson(req)) as unknown as Envelope;
        const v = verifyReceived(env, { nonceStore: nonces });
        if (!v.ok) return sendJson(res, 400, { error: err(v.code!, v.reason!) });
        if (env.type !== "RESOLVE") {
          return sendJson(res, 400, { error: err("WRONG_TYPE", "registry only accepts RESOLVE") });
        }
        const capability = env.body.capability as string;
        const results = byCapability.get(capability) ?? [];
        return sendJson(res, 200, { results });
      }

      sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
    } catch (e) {
      sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
    }
  });

  return {
    url: `http://127.0.0.1:${opts.port}`,
    listen: () => new Promise<void>((r) => server.listen(opts.port, "127.0.0.1", () => r())),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
