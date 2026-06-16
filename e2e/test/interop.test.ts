// Section 10.2: cross-language INTEROP. A Python agent (the aleph_protocol SDK)
// builds and signs an INVOKE; a TypeScript node verifies and answers it — no
// shared code. This proves the protocol is language-independent at the wire
// level, not just in canonicalization. Skipped if python3 / cryptography absent.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyEnvelope, type Envelope } from "@aleph/core";
import { createNode } from "@aleph/node";

const SCRIPT = fileURLToPath(new URL("../../conformance/python/interop_client.py", import.meta.url));

function hasPythonCrypto(): boolean {
  const r = spawnSync("python3", ["-c", "import cryptography"], { stdio: "ignore" });
  return r.status === 0;
}

const skip = !hasPythonCrypto();

// Async spawn (NOT spawnSync): the TS node serves the Python request on this same
// event loop, so blocking it synchronously would deadlock.
function runPython(args: string[]): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [SCRIPT, ...args]);
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    let out = "";
    let errOut = "";
    p.stdout.on("data", (d: string) => (out += d));
    p.stderr.on("data", (d: string) => (errOut += d));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("python interop client failed: " + (errOut || out)));
      try {
        resolve(JSON.parse(out.trim()) as { status: number; body: unknown });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

test("a Python-signed INVOKE is verified and answered by a TS node", { skip }, async () => {
  const node = createNode({
    identity: (await import("@aleph/core")).generateIdentity(),
    port: 4750,
    capabilities: {
      "math.add": { handler: (i) => ({ output: { sum: (i.a as number) + (i.b as number) } }) },
    },
  });
  await node.listen();
  try {
    // valid: the TS node accepts the Python signature and returns a signed RECEIPT
    const ok = await runPython([node.url + "/aleph", node.manifest.identity]);
    assert.equal(ok.status, 200);
    const receipt = ok.body as Envelope;
    assert.equal(receipt.type, "RECEIPT");
    assert.equal(verifyEnvelope(receipt).ok, true); // TS verifies its own node's receipt
    assert.equal(receipt.from, node.manifest.identity);
    const body = receipt.body as { outcome: string; result: { sum: number } };
    assert.equal(body.outcome, "success");
    assert.equal(body.result.sum, 5);

    // tampered: a body mutated after signing is rejected by the node's sig check
    const bad = await runPython([node.url + "/aleph", node.manifest.identity, "--tamper"]);
    assert.equal(bad.status, 400);
    assert.equal((bad.body as { error?: { code?: string } }).error?.code, "ENVELOPE_INVALID");
  } finally {
    await node.close();
  }
});
