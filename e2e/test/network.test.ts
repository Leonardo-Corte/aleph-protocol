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
    const fromB = await resolve(regB.url, "math.add", generateIdentity());
    assert.equal(fromB.length, 1);
    assert.equal(fromB[0]?.did, node.manifest.identity);
  } finally {
    await node.close();
    await regA.close();
    await regB.close();
  }
});
