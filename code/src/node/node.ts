// An Aleph node: a capability provider. It publishes a Manifest and answers an
// INVOKE with a signed RECEIPT — verifying the Grant before acting. This is the
// L0/L1 floor: "receive INVOKE, return RECEIPT".

import http from "node:http";
import type { ServerResponse } from "node:http";
import type { Identity } from "../core/identity.ts";
import { createEnvelope, verifyEnvelope, type Envelope } from "../core/envelope.ts";
import { verifyGrant, type Grant } from "../core/grant.ts";
import { hashObject } from "../core/hash.ts";
import type { Manifest } from "../core/manifest.ts";
import { readJson, sendJson } from "../transport/http.ts";

type CapabilitySpec = {
  handler: (input: Record<string, unknown>) => { output: Record<string, unknown> };
  requiredGrant?: boolean;
  risk?: "low" | "medium" | "high";
};

export type NodeOptions = {
  identity: Identity;
  port: number;
  capabilities: Record<string, CapabilitySpec>;
};

export function createNode(opts: NodeOptions) {
  const { identity, port } = opts;
  const baseUrl = `http://127.0.0.1:${port}`;

  const manifest: Manifest = {
    v: "aleph/0.1",
    identity: identity.did,
    conformance: "L1",
    capabilities: Object.keys(opts.capabilities).map((key) => ({
      key,
      risk: opts.capabilities[key].risk ?? "low",
      cost: { unit: "stable", value: "0", model: "per-call" },
    })),
    terms: {
      required_grants: Object.entries(opts.capabilities)
        .filter(([, c]) => c.requiredGrant)
        .map(([k]) => k),
    },
    endpoint: [`${baseUrl}/aleph`],
  };

  function sendReceipt(
    res: ServerResponse,
    invoke: Envelope,
    outcome: "success" | "rejected" | "failure",
    result: Record<string, unknown>,
  ): void {
    const receipt = createEnvelope(
      {
        from: identity.did,
        to: invoke.from,
        type: "RECEIPT",
        body: {
          invoke_ref: hashObject(invoke),
          capability: invoke.body.capability,
          outcome,
          result,
          settle_ref: null,
          prev: [],
          issued_by: identity.did,
        },
      },
      identity.privateKey,
    );
    sendJson(res, 200, receipt);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/manifest") {
        return sendJson(res, 200, manifest);
      }
      if (req.method === "POST" && req.url === "/aleph") {
        const env = (await readJson(req)) as unknown as Envelope;
        const v = verifyEnvelope(env);
        if (!v.ok) return sendJson(res, 400, { error: "envelope: " + v.reason });
        if (env.type !== "INVOKE") return sendJson(res, 400, { error: "node only accepts INVOKE" });

        const capName = env.body.capability as string;
        const cap = opts.capabilities[capName];
        if (!cap) return sendReceipt(res, env, "rejected", { error: "unknown capability" });

        // Bounded-authority gate: verify the Grant before acting.
        if (cap.requiredGrant) {
          const grant = env.body.grant as Grant | undefined;
          if (!grant) return sendReceipt(res, env, "rejected", { error: "grant required" });
          const g = verifyGrant(grant, { grantee: env.from, capability: capName });
          if (!g.ok) return sendReceipt(res, env, "rejected", { error: "grant: " + g.reason });
        }

        const { output } = cap.handler((env.body.input ?? {}) as Record<string, unknown>);
        return sendReceipt(res, env, "success", output);
      }
      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
  });

  return {
    manifest,
    url: baseUrl,
    listen: () => new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r())),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
