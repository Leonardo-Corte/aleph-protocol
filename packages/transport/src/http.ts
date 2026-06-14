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
