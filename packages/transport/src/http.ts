// Tiny HTTP helpers shared by the node and the registry. Transport lives
// *below* the thin waist (§7 of the paper): it can be anything. Here it is
// plain Node http — zero dependencies — with a body-size cap as a basic DoS
// guard (an oversized payload is rejected before it can exhaust memory).

import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";

const MAX_BODY_BYTES = 1_000_000; // 1 MB cap on inbound JSON

export function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return; // stop accumulating once over the cap (bounded memory)
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("payload too large"));
        return;
      }
      try {
        resolve((data ? JSON.parse(data) : {}) as Record<string, unknown>);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Wrap an async request handler so it can be passed to http.createServer
// without violating no-misused-promises (errors are caught, not floated).
export function asyncHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): RequestListener {
  return (req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INTERNAL", message: "handler error" } }));
      }
    });
  };
}

export interface RateLimitOptions {
  capacity: number; // max burst (tokens available at rest)
  refillPerSec: number; // sustained rate (tokens added per second)
}

// A lazy token-bucket rate limiter: O(1) per check, no background timer. Each
// key (per-IP or per-DID) gets `capacity` burst and refills at `refillPerSec`.
// The basic abuse defense in front of public endpoints — a flood from one
// caller is throttled without affecting others.
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  constructor(private opts: RateLimitOptions) {}

  // Consume one token for `key`; false if the bucket is empty (→ 429).
  allow(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.opts.capacity, last: now };
    b.tokens = Math.min(this.opts.capacity, b.tokens + ((now - b.last) / 1000) * this.opts.refillPerSec);
    b.last = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

// Best-effort client IP for per-IP limiting (loopback/proxy aware enough for
// the basic defense; a production deployment terminates TLS/proxy upstream).
export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

// HTTP server hardening: bound how long a client may take to send headers and
// the whole request (slow-loris defense), and cap concurrent connections. Tunable
// but with safe defaults so every server is protected by construction.
export function hardenServer(
  server: { headersTimeout: number; requestTimeout: number; maxConnections: number },
  opts: { headersTimeoutMs?: number; requestTimeoutMs?: number; maxConnections?: number } = {},
): void {
  server.headersTimeout = opts.headersTimeoutMs ?? 10_000;
  server.requestTimeout = opts.requestTimeoutMs ?? 30_000;
  server.maxConnections = opts.maxConnections ?? 1024;
}
