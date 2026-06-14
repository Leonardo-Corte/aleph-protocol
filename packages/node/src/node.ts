// An Aleph node: a capability provider. It publishes a Manifest and answers an
// INVOKE with a signed RECEIPT — running the inbound Envelope through the
// receive-guard (signature + replay + skew + version), verifying the Grant,
// validating input against the capability schema, and (for priced capabilities)
// settling payment atomically with delivery, before/as it acts.

import http from "node:http";
import type { ServerResponse } from "node:http";
import type { Identity } from "@aleph/core";
import type { Manifest } from "@aleph/core";
import type { SettlementRail, SettlementRecord } from "@aleph/core";
import { createEnvelope, type Envelope } from "@aleph/core";
import { NonceStore, verifyReceived } from "@aleph/core";
import { verifyGrant, type Grant } from "@aleph/core";
import { hashObject } from "@aleph/core";
import { validateSchema, type JsonSchema } from "@aleph/core";
import { err, type AlephError } from "@aleph/core";
import { verifyAttestation, type Attestation } from "@aleph/core";
import { readJson, sendJson, asyncHandler } from "@aleph/transport";

interface CapabilitySpec {
  handler: (input: Record<string, unknown>) => { output: Record<string, unknown> };
  requiredGrant?: boolean;
  risk?: "low" | "medium" | "high";
  schema?: JsonSchema;
  priceEur?: number;
}

export interface NodeOptions {
  identity: Identity;
  port: number;
  capabilities: Record<string, CapabilitySpec>;
  rail?: SettlementRail;
}

export function createNode(opts: NodeOptions) {
  const { identity, port } = opts;
  const baseUrl = `http://127.0.0.1:${port}`;
  const nonces = new NonceStore();

  // The node holds the verified attestations written about it. Trust is
  // computed by the consumer from these raw facts — the node only stores and
  // serves them; it cannot mint its own score.
  const reputation: Attestation[] = [];

  const manifest: Manifest = {
    v: "aleph/0.1",
    identity: identity.did,
    conformance: opts.rail ? "L3" : "L1",
    reputation: `${baseUrl}/reputation`,
    capabilities: Object.entries(opts.capabilities).map(([key, cap]) => ({
      key,
      risk: cap.risk ?? "low",
      cost: { unit: "stable", value: String(cap.priceEur ?? 0), model: "per-call" },
      schema: cap.schema ? { input: cap.schema } : undefined,
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
    settlement?: SettlementRecord,
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
          settle_ref: settlement ? hashObject(settlement) : null,
          settlement: settlement ?? null,
          prev: invoke.body.prev ?? [],
          issued_by: identity.did,
        },
      },
      identity.privateKey,
    );
    sendJson(res, 200, receipt);
  }

  const reject = (res: ServerResponse, invoke: Envelope, e: AlephError) => {
    sendReceipt(res, invoke, "rejected", { error: e });
  };

  const server = http.createServer(
    asyncHandler(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/manifest") {
          sendJson(res, 200, manifest);
          return;
        }
        // Serve the raw attestation set (the consumer computes its own trust).
        if (req.method === "GET" && req.url === "/reputation") {
          sendJson(res, 200, { subject: identity.did, attestations: reputation });
          return;
        }
        // Receive an attestation written about this node; store only if it is
        // backed by a valid, released settlement to this node (anti-Sybil).
        if (req.method === "POST" && req.url === "/attest") {
          const att = (await readJson(req)) as unknown as Attestation;
          const av = verifyAttestation(att);
          if (!av.ok) {
            sendJson(res, 400, { error: err("ATTEST_INVALID", av.reason ?? "invalid") });
            return;
          }
          if (att.subject !== identity.did) {
            sendJson(res, 400, { error: err("ATTEST_INVALID", "not about this node") });
            return;
          }
          // One settlement can back at most one stored attestation.
          if (!reputation.some((a) => a.settlement.escrowId === att.settlement.escrowId)) {
            reputation.push(att);
          }
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === "POST" && req.url === "/aleph") {
          const env = (await readJson(req)) as unknown as Envelope;

          // 1. waist: signature + version + skew + replay
          const v = verifyReceived(env, { nonceStore: nonces });
          if (!v.ok) {
            sendJson(res, 400, { error: err(v.code!, v.reason!) });
            return;
          }
          if (env.type !== "INVOKE") {
            sendJson(res, 400, { error: err("WRONG_TYPE", "node only accepts INVOKE") });
            return;
          }

          // 2. capability exists
          const capName = env.body.capability as string;
          const cap = opts.capabilities[capName];
          if (!cap) {
            reject(res, env, err("UNKNOWN_CAPABILITY", capName));
            return;
          }

          // 3. bounded-authority gate
          if (cap.requiredGrant) {
            const grant = env.body.grant as Grant | undefined;
            if (!grant) {
              reject(res, env, err("GRANT_REQUIRED", "this capability requires a grant"));
              return;
            }
            const g = verifyGrant(grant, { grantee: env.from, capability: capName });
            if (!g.ok) {
              reject(res, env, err("GRANT_INVALID", g.reason ?? "grant invalid"));
              return;
            }
          }

          // 4. typed input
          const input = (env.body.input ?? {}) as Record<string, unknown>;
          const sv = validateSchema(cap.schema, input);
          if (!sv.ok) {
            reject(res, env, err("SCHEMA_INVALID", sv.reason ?? "input invalid"));
            return;
          }

          // 5. payment escrow (for priced capabilities)
          const price = cap.priceEur ?? 0;
          let escrowId: string | undefined;
          if (price > 0) {
            if (!opts.rail) {
              reject(res, env, err("INTERNAL", "node priced but has no rail"));
              return;
            }
            const payment = env.body.payment as { escrow?: string } | undefined;
            if (!payment?.escrow) {
              reject(res, env, err("PAYMENT_REQUIRED", "payment escrow required"));
              return;
            }
            const e = opts.rail.get(payment.escrow);
            if (e?.status !== "locked") {
              reject(res, env, err("SETTLE_INVALID", "escrow missing or not locked"));
              return;
            }
            if (e.payer !== env.from || e.payee !== identity.did) {
              reject(res, env, err("SETTLE_INVALID", "escrow parties mismatch"));
              return;
            }
            if (e.amount < price) {
              reject(res, env, err("INSUFFICIENT_FUNDS", "escrow below price"));
              return;
            }
            escrowId = payment.escrow;
          }

          // 6. act — settle atomically with delivery; refund on failure
          try {
            const { output } = cap.handler(input);
            const settlement = escrowId && opts.rail ? opts.rail.release(escrowId) : undefined;
            sendReceipt(res, env, "success", output, settlement);
            return;
          } catch (e) {
            const refund = escrowId && opts.rail ? opts.rail.refund(escrowId) : undefined;
            sendReceipt(res, env, "failure", { error: err("INTERNAL", (e as Error).message) }, refund);
            return;
          }
        }
        sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
      } catch (e) {
        sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
      }
    }),
  );

  return {
    manifest,
    url: baseUrl,
    listen: () =>
      new Promise<void>((r) =>
        server.listen(port, "127.0.0.1", () => {
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
