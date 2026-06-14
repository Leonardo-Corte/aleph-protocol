// Tiny HTTP helpers shared by the node and the registry. Transport lives
// *below* the thin waist (§7 of the paper): it can be anything. Here it is
// plain Node http — zero dependencies — with a body-size cap as a basic DoS
// guard (an oversized payload is rejected before it can exhaust memory).

import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 1_000_000; // 1 MB cap on inbound JSON

export function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return; // stop accumulating once over the cap (bounded memory)
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("payload too large"));
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
