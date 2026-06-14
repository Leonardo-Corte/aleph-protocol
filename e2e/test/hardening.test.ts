// Phase A: the waist is hardened. Negative tests for every gate the protocol
// must enforce — replay, clock skew, unsupported version, and schema validation.

import assert from "node:assert/strict";
import { sign, randomUUID } from "node:crypto";
import { test } from "node:test";
import { generateIdentity, type Identity } from "@aleph/core";
import { canonicalize } from "@aleph/core";
import { NonceStore, verifyReceived } from "@aleph/core";
import { validateSchema, type JsonSchema } from "@aleph/core";
import { createEnvelope, type Envelope } from "@aleph/core";
import { createNode } from "@aleph/node";

// Sign an Envelope with arbitrary fields (so we can backdate ts, bump version, etc).
function signEnvelope(id: Identity, partial: Partial<Envelope>): Envelope {
  const base = {
    v: "aleph/0.1",
    from: id.did,
    to: id.did,
    type: "INVOKE" as const,
    nonce: randomUUID(),
    ts: Date.now(),
    body: {},
    ...partial,
  };
  const sig = sign(null, Buffer.from(canonicalize(base)), id.privateKey).toString("base64url");
  return { ...base, sig };
}

test("verifyReceived accepts a fresh, valid envelope", async () => {
  const id = generateIdentity();
  const ns = new NonceStore();
  assert.equal((await verifyReceived(signEnvelope(id, {}), { nonceStore: ns })).ok, true);
});

test("verifyReceived rejects a replayed nonce", async () => {
  const id = generateIdentity();
  const ns = new NonceStore();
  const env = signEnvelope(id, {});
  assert.equal((await verifyReceived(env, { nonceStore: ns })).ok, true);
  const second = await verifyReceived(env, { nonceStore: ns });
  assert.equal(second.ok, false);
  assert.equal(second.code, "REPLAY");
});

test("verifyReceived rejects a stale timestamp (clock skew)", async () => {
  const id = generateIdentity();
  const ns = new NonceStore();
  const env = signEnvelope(id, { ts: Date.now() - 10 * 60 * 1000 });
  const r = await verifyReceived(env, { nonceStore: ns });
  assert.equal(r.ok, false);
  assert.equal(r.code, "CLOCK_SKEW");
});

test("verifyReceived rejects an unsupported major version", async () => {
  const id = generateIdentity();
  const ns = new NonceStore();
  const env = signEnvelope(id, { v: "aleph/9.0" });
  const r = await verifyReceived(env, { nonceStore: ns });
  assert.equal(r.ok, false);
  assert.equal(r.code, "VERSION_UNSUPPORTED");
});

test("schema validation accepts valid and rejects invalid input", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  };
  assert.equal(validateSchema(schema, { a: 1, b: 2 }).ok, true);
  assert.equal(validateSchema(schema, { a: 1 }).ok, false); // missing b
  assert.equal(validateSchema(schema, { a: 1, b: "x" }).ok, false); // wrong type
});

test("node rejects schema-invalid input with a typed SCHEMA_INVALID receipt", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4200,
    capabilities: {
      "math.add": {
        schema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
        handler: (input) => ({ output: { sum: (input.a as number) + (input.b as number) } }),
      },
    },
  });
  await node.listen();
  try {
    const agent = generateIdentity();
    const env = createEnvelope(
      {
        from: agent.did,
        to: node.manifest.identity,
        type: "INVOKE",
        body: { capability: "math.add", input: { a: 1 } },
      },
      agent.privateKey,
    );
    const res = await fetch(node.url + "/aleph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env),
    });
    const receipt = (await res.json()) as Envelope;
    assert.equal(receipt.body.outcome, "rejected");
    const error = (receipt.body.result as { error: { code: string } }).error;
    assert.equal(error.code, "SCHEMA_INVALID");
  } finally {
    await node.close();
  }
});
