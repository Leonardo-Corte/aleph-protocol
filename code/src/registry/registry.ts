// The Registry: the discovery multiplier. Nodes register their Manifest; an
// agent sends a RESOLVE and gets back *pointers* (did + manifest location +
// summary + reputation pointer), never full manifests — the two-stage,
// pull-not-push design that keeps the agent from loading capabilities it will
// not use. Inbound RESOLVE Envelopes pass through the receive-guard.

import http from "node:http";
import type { Envelope } from "../core/envelope.ts";
import { NonceStore, verifyReceived } from "../core/replay.ts";
import { validateManifest, type Manifest } from "../core/manifest.ts";
import { err } from "../core/errors.ts";
import { readJson, sendJson } from "../transport/http.ts";

type Pointer = { did: string; manifest: string; summary: string; reputation?: string };

export function createRegistry(opts: { port: number }) {
  const byCapability = new Map<string, Pointer[]>();
  const nonces = new NonceStore();

  const server = http.createServer(async (req, res) => {
    try {
      // Out-of-band registration: a node submits its Manifest + where to fetch it.
      if (req.method === "POST" && req.url === "/register") {
        const body = await readJson(req);
        const manifest = body.manifest as Manifest;
        const manifestUrl = body.manifestUrl as string;
        const v = validateManifest(manifest);
        if (!v.ok) return sendJson(res, 400, { error: err("ENVELOPE_INVALID", v.reason ?? "bad manifest") });
        for (const cap of manifest.capabilities) {
          const list = byCapability.get(cap.key) ?? [];
          // Avoid duplicate (did, capability) entries on re-registration.
          if (!list.some((p) => p.did === manifest.identity)) {
            list.push({
              did: manifest.identity,
              manifest: manifestUrl,
              summary: `${cap.key} · risk:${cap.risk ?? "low"}`,
              reputation: manifest.reputation,
            });
          }
          byCapability.set(cap.key, list);
        }
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
