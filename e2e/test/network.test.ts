// Phase E: networking maturity — capability vocabulary, did:web resolution,
// and registry federation (gossip).

import assert from "node:assert/strict";
import { sign, verify } from "node:crypto";
import { test } from "node:test";
import { resolve } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { Vocabulary, isWellFormedKey, namespaceOf } from "@aleph/core";
import { publicKeyFromVerificationMethod } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

test("vocabulary: well-formedness, namespacing, validation, proposal", () => {
  assert.equal(isWellFormedKey("restaurant.booking"), true);
  assert.equal(isWellFormedKey("compute.inference.stream"), true);
  assert.equal(isWellFormedKey("Bad.Key"), false); // uppercase
  assert.equal(isWellFormedKey("single"), false); // needs a namespace
  assert.equal(namespaceOf("restaurant.booking"), "restaurant");

  const vocab = new Vocabulary();
  assert.equal(vocab.validate("math.add").ok, true);
  assert.equal(vocab.validate("unknown.thing").ok, false);
  assert.equal(vocab.propose("logistics.shipment", "ship a parcel").ok, true);
  assert.equal(vocab.validate("logistics.shipment").ok, true);
  assert.equal(vocab.propose("logistics.shipment", "dup").ok, false); // already exists
});

test("did:web verificationMethod parses into a key that verifies a real signature", () => {
  // A did:web identity publishes a did.json with its public key. We test the
  // part that matters and is method-independent: that the verificationMethod
  // (publicKeyJwk) parses into a KeyObject which actually verifies a signature
  // made by the matching private key. (The https fetch is the transport.)
  const id = generateIdentity();
  const didDoc = {
    id: "did:web:example.com",
    verificationMethod: [
      {
        type: "JsonWebKey2020",
        publicKeyJwk: id.publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string },
      },
    ],
  };
  const pub = publicKeyFromVerificationMethod(didDoc);
  const msg = Buffer.from("aleph did:web roundtrip");
  const signature = sign(null, msg, id.privateKey);
  assert.equal(verify(null, msg, pub, signature), true);

  // A tampered message must fail under the resolved key.
  assert.equal(verify(null, Buffer.from("tampered"), pub, signature), false);
});

test("registry federation: register at one, discover at the peer", async () => {
  const regA = createRegistry({ port: 4610, peers: ["http://127.0.0.1:4611"] });
  const regB = createRegistry({ port: 4611, peers: ["http://127.0.0.1:4610"] });
  await regA.listen();
  await regB.listen();

  const node = createNode({
    identity: generateIdentity(),
    port: 4612,
    capabilities: {
      "math.add": { handler: (i) => ({ output: { sum: (i.a as number) + (i.b as number) } }) },
    },
  });
  await node.listen();

  try {
    // register only at A
    await fetch(regA.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
    });

    // discover at B (it learned via gossip)
    const fromB = (await resolve(regB.url, "math.add", generateIdentity())).results;
    assert.equal(fromB.length, 1);
    assert.equal(fromB[0]?.did, node.manifest.identity);
  } finally {
    await node.close();
    await regA.close();
    await regB.close();
  }
});

test("registry anti-entropy: an offline peer catches up on reconcile", async () => {
  // B starts WITHOUT A as a peer and stays down during A's registration, so
  // gossip-on-write never reaches it — only anti-entropy can recover the state.
  const regA = createRegistry({ port: 4620 });
  await regA.listen();

  const node = createNode({
    identity: generateIdentity(),
    port: 4622,
    capabilities: {
      "math.add": { handler: (i) => ({ output: { sum: (i.a as number) + (i.b as number) } }) },
    },
  });
  await node.listen();

  try {
    // register only at A (B does not exist yet → gossip cannot reach it)
    await fetch(regA.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
    });

    // B comes online afterwards, peered to A
    const regB = createRegistry({ port: 4621, peers: [regA.url] });
    await regB.listen();
    try {
      // before reconciling, B knows nothing
      assert.equal((await resolve(regB.url, "math.add", generateIdentity())).results.length, 0);

      // anti-entropy: B pulls A's feed, re-verifies, indexes
      const pulled = await regB.reconcile();
      assert.equal(pulled, 1);
      const fromB = (await resolve(regB.url, "math.add", generateIdentity())).results;
      assert.equal(fromB.length, 1);
      assert.equal(fromB[0]?.did, node.manifest.identity);

      // reconcile is idempotent: a second pass advances the cursor, pulls nothing
      assert.equal(await regB.reconcile(), 0);
    } finally {
      await regB.close();
    }
  } finally {
    await node.close();
    await regA.close();
  }
});
