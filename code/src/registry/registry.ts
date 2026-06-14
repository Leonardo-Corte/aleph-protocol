// The Registry: the discovery multiplier. Nodes register their Manifest; an
// agent sends a RESOLVE and gets back *pointers* (did + manifest location +
// summary), never full manifests — the two-stage, pull-not-push design that
// keeps the agent from loading capabilities it will not use.

import http from "node:http";
import { verifyEnvelope, type Envelope } from "../core/envelope.ts";
import { validateManifest, type Manifest } from "../core/manifest.ts";
import { readJson, sendJson } from "../transport/http.ts";

type Pointer = { did: string; manifest: string; summary: string };

export function createRegistry(opts: { port: number }) {
  const byCapability = new Map<string, Pointer[]>();

  const server = http.createServer(async (req, res) => {
    try {
      // Out-of-band registration: a node submits its Manifest + where to fetch it.
      if (req.method === "POST" && req.url === "/register") {
        const body = await readJson(req);
        const manifest = body.manifest as Manifest;
        const manifestUrl = body.manifestUrl as string;
        const v = validateManifest(manifest);
        if (!v.ok) return sendJson(res, 400, { error: v.reason });
        for (const cap of manifest.capabilities) {
          const list = byCapability.get(cap.key) ?? [];
          list.push({
            did: manifest.identity,
            manifest: manifestUrl,
            summary: `${cap.key} · risk:${cap.risk ?? "low"}`,
          });
          byCapability.set(cap.key, list);
        }
        return sendJson(res, 200, { ok: true });
      }

      // RESOLVE: find providers of a capability.
      if (req.method === "POST" && req.url === "/aleph") {
        const env = (await readJson(req)) as unknown as Envelope;
        const v = verifyEnvelope(env);
        if (!v.ok) return sendJson(res, 400, { error: "envelope: " + v.reason });
        if (env.type !== "RESOLVE") return sendJson(res, 400, { error: "registry only accepts RESOLVE" });
        const capability = env.body.capability as string;
        const results = byCapability.get(capability) ?? [];
        return sendJson(res, 200, { results });
      }

      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
  });

  return {
    url: `http://127.0.0.1:${opts.port}`,
    listen: () => new Promise<void>((r) => server.listen(opts.port, "127.0.0.1", () => r())),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
