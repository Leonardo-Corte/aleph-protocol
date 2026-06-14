// An Aleph node: a capability provider. It publishes a Manifest and answers an
// INVOKE with a signed RECEIPT — running the inbound Envelope through the
// receive-guard (signature + replay + skew + version), verifying the Grant,
// and validating input against the capability schema, before acting.

import http from "node:http";
import type { ServerResponse } from "node:http";
import type { Identity } from "../core/identity.ts";
import { createEnvelope, type Envelope } from "../core/envelope.ts";
import { NonceStore, verifyReceived } from "../core/replay.ts";
import { verifyGrant, type Grant } from "../core/grant.ts";
import { hashObject } from "../core/hash.ts";
import { validateSchema, type JsonSchema } from "../core/schema.ts";
import { err, type AlephError } from "../core/errors.ts";
import type { Manifest } from "../core/manifest.ts";
import { readJson, sendJson } from "../transport/http.ts";

type CapabilitySpec = {
  handler: (input: Record<string, unknown>) => { output: Record<string, unknown> };
  requiredGrant?: boolean;
  risk?: "low" | "medium" | "high";
  schema?: JsonSchema;
};

export type NodeOptions = {
  identity: Identity;
  port: number;
  capabilities: Record<string, CapabilitySpec>;
};

export function createNode(opts: NodeOptions) {
  const { identity, port } = opts;
  const baseUrl = `http://127.0.0.1:${port}`;
  const nonces = new NonceStore();

  const manifest: Manifest = {
    v: "aleph/0.1",
    identity: identity.did,
    conformance: "L1",
    capabilities: Object.keys(opts.capabilities).map((key) => ({
      key,
      risk: opts.capabilities[key].risk ?? "low",
      cost: { unit: "stable", value: "0", model: "per-call" },
      schema: opts.capabilities[key].schema
        ? { input: opts.capabilities[key].schema }
        : undefined,
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

  const reject = (res: ServerResponse, invoke: Envelope, e: AlephError) =>
    sendReceipt(res, invoke, "rejected", { error: e });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/manifest") {
        return sendJson(res, 200, manifest);
      }
      if (req.method === "POST" && req.url === "/aleph") {
        const env = (await readJson(req)) as unknown as Envelope;

        // 1. waist: signature + version + skew + replay
        const v = verifyReceived(env, { nonceStore: nonces });
        if (!v.ok) return sendJson(res, 400, { error: err(v.code!, v.reason!) });
        if (env.type !== "INVOKE") {
          return sendJson(res, 400, { error: err("WRONG_TYPE", "node only accepts INVOKE") });
        }

        // 2. capability exists
        const capName = env.body.capability as string;
        const cap = opts.capabilities[capName];
        if (!cap) return reject(res, env, err("UNKNOWN_CAPABILITY", capName));

        // 3. bounded-authority gate
        if (cap.requiredGrant) {
          const grant = env.body.grant as Grant | undefined;
          if (!grant) return reject(res, env, err("GRANT_REQUIRED", "this capability requires a grant"));
          const g = verifyGrant(grant, { grantee: env.from, capability: capName });
          if (!g.ok) return reject(res, env, err("GRANT_INVALID", g.reason ?? "grant invalid"));
        }

        // 4. typed input
        const input = (env.body.input ?? {}) as Record<string, unknown>;
        const sv = validateSchema(cap.schema, input);
        if (!sv.ok) return reject(res, env, err("SCHEMA_INVALID", sv.reason ?? "input invalid"));

        // 5. act
        const { output } = cap.handler(input);
        return sendReceipt(res, env, "success", output);
      }
      sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
    } catch (e) {
      sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
    }
  });

  return {
    manifest,
    url: baseUrl,
    listen: () => new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r())),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
