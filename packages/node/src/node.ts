// An Aleph node: a capability provider. It publishes a Manifest and answers an
// INVOKE with a signed RECEIPT — running the inbound Envelope through the
// receive-guard (signature + replay + skew + version), verifying the Grant,
// validating input against the capability schema, and (for priced capabilities)
// settling payment atomically with delivery, before/as it acts.

import http from "node:http";
import type { ServerResponse } from "node:http";
import type { Identity, NonceChecker } from "@aleph/core";
import type { Manifest } from "@aleph/core";
import type { SettlementRail, SettlementRecord } from "@aleph/core";
import { createEnvelope, type Envelope } from "@aleph/core";
import { NonceStore, verifyReceived } from "@aleph/core";
import { verifyGrant, type Grant } from "@aleph/core";
import { hashObject } from "@aleph/core";
import { validateSchema, type JsonSchema } from "@aleph/core";
import { checkComplexity } from "@aleph/core";
import { signManifest } from "@aleph/core";
import { err, type AlephError } from "@aleph/core";
import { verifyAttestation, type Attestation } from "@aleph/core";
import {
  InMemoryReputationStore,
  REPUTATION_PAGE_SIZE,
  type ReputationStore,
  type SettlementStore,
} from "@aleph/store";
import {
  readJson,
  sendJson,
  asyncHandler,
  RateLimiter,
  clientIp,
  hardenServer,
  createLogger,
  traceIdFrom,
  MetricsRegistry,
  type RateLimitOptions,
  type Logger,
} from "@aleph/transport";

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
  // Storage is pluggable: pass these (SQLite/Postgres) to persist a node's
  // reputation, nonces, and settlement history; all default to in-memory.
  reputationStore?: ReputationStore;
  nonceStore?: NonceChecker;
  settlementStore?: SettlementStore;
  // Token-bucket rate limit per IP and per caller DID. Generous default; tune
  // down (or up) per deployment. The basic flood/DoS defense.
  rateLimit?: RateLimitOptions;
  // Observability: a structured logger (default silent unless ALEPH_LOG_LEVEL)
  // and a metrics registry (its counters/histograms are served at /metrics).
  logger?: Logger;
  metrics?: MetricsRegistry;
  // Deployment: bind address (default loopback; set 0.0.0.0 in a container) and
  // the EXTERNAL base URL advertised in the Manifest (endpoint + reputation
  // pointer) when behind a proxy/domain. Defaults to http://<host>:<port>.
  host?: string;
  publicUrl?: string;
}

export function createNode(opts: NodeOptions) {
  const { identity, port } = opts;
  const host = opts.host ?? "127.0.0.1";
  const baseUrl = opts.publicUrl ?? `http://${host}:${port}`;
  const nonces: NonceChecker = opts.nonceStore ?? new NonceStore();
  const limiter = new RateLimiter(opts.rateLimit ?? { capacity: 2000, refillPerSec: 200 });
  const log = (opts.logger ?? createLogger()).child({ service: "node", node: identity.did });
  const metrics = opts.metrics ?? new MetricsRegistry();
  const reqs = metrics.counter("aleph_requests_total", "requests by service and outcome");
  const invokes = metrics.counter("aleph_invoke_total", "INVOKEs by outcome");
  const errors = metrics.counter("aleph_errors_total", "errors by AlephErrorCode");
  const latency = metrics.histogram("aleph_request_ms", "request latency in ms");

  // The node's reputation store holds the verified attestations written about
  // it. Trust is computed by the consumer from these raw facts — the node only
  // stores and serves them; it cannot mint its own score. Defaults to in-memory.
  const reputation: ReputationStore = opts.reputationStore ?? new InMemoryReputationStore();
  const settlements: SettlementStore | undefined = opts.settlementStore;

  const unsignedManifest: Omit<Manifest, "sig"> = {
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
  // A node signs its own Manifest so it is verifiable wherever it is hosted.
  const manifest: Manifest = signManifest(unsignedManifest, identity);

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
    invokes.inc({ outcome: "rejected" });
    errors.inc({ code: e.code });
    sendReceipt(res, invoke, "rejected", { error: e });
  };

  const server = http.createServer(
    asyncHandler(async (req, res) => {
      // Per-request structured logging, correlated by a trace id propagated from
      // the caller (agent → node), so one operation is followable end to end.
      const trace = traceIdFrom(req);
      const reqLog = log.child({ trace, method: req.method, url: req.url });
      const startedAt = performance.now();
      reqLog.debug("request");
      try {
        // Abuse defense: per-IP token bucket in front of every endpoint.
        if (!limiter.allow("ip:" + clientIp(req))) {
          errors.inc({ code: "RATE_LIMITED" });
          reqLog.warn("rate_limited");
          sendJson(res, 429, { error: err("RATE_LIMITED", "rate limit exceeded") });
          return;
        }
        // Liveness/readiness probe (Docker/K8s healthcheck target).
        if (req.method === "GET" && req.url === "/healthz") {
          sendJson(res, 200, { ok: true, did: identity.did, uptime: process.uptime() });
          return;
        }
        // Metrics scrape endpoint (Prometheus text format).
        if (req.method === "GET" && req.url === "/metrics") {
          res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
          res.end(metrics.render());
          return;
        }
        if (req.method === "GET" && req.url === "/manifest") {
          // The Manifest is signed once at startup; its signature uniquely
          // identifies its content, so it makes a stable ETag. A re-fetch with a
          // matching If-None-Match is a cheap 304 (agents re-resolve often).
          const etag = `"man-${manifest.sig?.slice(0, 24) ?? "0"}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { etag });
            res.end();
            return;
          }
          res.writeHead(200, {
            "content-type": "application/json",
            etag,
            "cache-control": "public, max-age=60",
          });
          res.end(JSON.stringify(manifest));
          return;
        }
        const url = new URL(req.url ?? "/", baseUrl);

        // Aggregate summary (count, distinct issuers, settled value, time span)
        // so an agent can rank candidates without downloading every raw att.
        if (req.method === "GET" && url.pathname === "/reputation/summary") {
          const s = await reputation.summary(identity.did);
          const etag = `"sum-${s.count}-${s.newestTs ?? 0}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { etag });
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json", etag });
          res.end(JSON.stringify(s));
          return;
        }

        // Serve the raw attestation set, paginated, with an ETag so a re-fetch
        // with no new attestations is a cheap 304 (the consumer computes trust).
        if (req.method === "GET" && url.pathname === "/reputation") {
          const cursor = url.searchParams.get("cursor") ?? undefined;
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam
            ? Math.max(1, Math.min(Number(limitParam) || REPUTATION_PAGE_SIZE, REPUTATION_PAGE_SIZE))
            : undefined;
          // ETag binds the subject's evidence (count + latest ts) to this exact
          // page request, so new attestations or a different page invalidate it.
          const s = await reputation.summary(identity.did);
          const etag = `"rep-${s.count}-${s.newestTs ?? 0}-${cursor ?? ""}-${limit ?? ""}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { etag });
            res.end();
            return;
          }
          const page = await reputation.getAttestations(identity.did, { cursor, limit });
          res.writeHead(200, { "content-type": "application/json", etag });
          res.end(
            JSON.stringify({
              subject: identity.did,
              attestations: page.attestations,
              nextCursor: page.nextCursor,
            }),
          );
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
          // The store enforces "one settlement, one attestation" (anti-Sybil)
          // at the database level.
          await reputation.addAttestation(att);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === "POST" && req.url === "/aleph") {
          const env = (await readJson(req)) as unknown as Envelope;

          // 1. waist: signature + version + skew + replay
          const v = await verifyReceived(env, { nonceStore: nonces });
          if (!v.ok) {
            sendJson(res, 400, { error: err(v.code!, v.reason!) });
            return;
          }
          if (env.type !== "INVOKE") {
            sendJson(res, 400, { error: err("WRONG_TYPE", "node only accepts INVOKE") });
            return;
          }
          // per-DID rate limit (an authenticated flood from one caller)
          if (!limiter.allow("did:" + env.from)) {
            reject(res, env, err("RATE_LIMITED", "rate limit exceeded"));
            return;
          }
          // structural complexity cap (deep/wide payloads rejected before work)
          const cx = checkComplexity(env.body);
          if (!cx.ok) {
            reject(res, env, err("TOO_COMPLEX", cx.reason ?? "payload too complex"));
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
            // Enforce the capability-scoped payment limit JOINTLY with the
            // escrow: the amount checked here is the price the node will settle.
            const g = verifyGrant(grant, {
              grantee: env.from,
              capability: capName,
              amountEur: cap.priceEur,
            });
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

          // 6. act — settle atomically with delivery; refund on failure.
          // Each produced settlement is recorded to the durable settlement
          // history (forward-compatible with the on-chain rail).
          try {
            const { output } = cap.handler(input);
            const settlement = escrowId && opts.rail ? opts.rail.release(escrowId) : undefined;
            if (settlement) await settlements?.record(settlement);
            invokes.inc({ outcome: "success" });
            if (settlement)
              metrics.counter("aleph_settlements_total", "settlements by status").inc({ status: "released" });
            reqLog.info("invoke", { capability: capName, from: env.from, outcome: "success" });
            sendReceipt(res, env, "success", output, settlement);
            return;
          } catch (e) {
            const refund = escrowId && opts.rail ? opts.rail.refund(escrowId) : undefined;
            if (refund) await settlements?.record(refund);
            invokes.inc({ outcome: "failure" });
            if (refund)
              metrics.counter("aleph_settlements_total", "settlements by status").inc({ status: "refunded" });
            reqLog.warn("invoke", { capability: capName, from: env.from, outcome: "failure" });
            sendReceipt(res, env, "failure", { error: err("INTERNAL", (e as Error).message) }, refund);
            return;
          }
        }
        sendJson(res, 404, { error: err("WRONG_TYPE", "not found") });
      } catch (e) {
        errors.inc({ code: "INTERNAL" });
        reqLog.error("handler_error", { err: (e as Error).message });
        sendJson(res, 500, { error: err("INTERNAL", (e as Error).message) });
      } finally {
        const ms = performance.now() - startedAt;
        reqs.inc({ service: "node" });
        latency.observe({ service: "node" }, ms);
        reqLog.debug("response", { ms: Math.round(ms) });
      }
    }),
  );

  hardenServer(server);

  return {
    manifest,
    url: baseUrl,
    listen: () =>
      new Promise<void>((r) =>
        server.listen(port, host, () => {
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
