// Phase E: networking maturity — capability vocabulary, did:web resolution,
// and registry federation (gossip).

import assert from "node:assert/strict";
import { sign, verify } from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import { resolve, fetchManifest } from "@aleph/client";
import { generateIdentity, signManifest, type Manifest } from "@aleph/core";
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

test("manifest re-verification: the client rejects forged or substituted manifests", async () => {
  const id = generateIdentity();
  const real = signManifest(
    {
      v: "aleph/0.1",
      identity: id.did,
      conformance: "L1",
      capabilities: [{ key: "math.add", risk: "low" }],
      endpoint: ["http://127.0.0.1/aleph"],
    },
    id,
  );

  // a malicious host that can serve any manifest body we set
  let body: unknown = real;
  const host = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => host.listen(4630, "127.0.0.1", () => r()));
  const url = "http://127.0.0.1:4630/manifest";

  try {
    // authentic manifest, identity pinned to the resolved DID → trusted
    const got = await fetchManifest(url, id.did);
    assert.equal(got.identity, id.did);

    // tampered after signing (extra capability) → signature no longer verifies
    body = { ...real, capabilities: [...real.capabilities, { key: "evil.exec", risk: "high" }] };
    await assert.rejects(() => fetchManifest(url, id.did), /verification failed/);

    // a different node's validly-signed manifest, served at this host → identity
    // pin catches the substitution even though the signature is valid
    const other = generateIdentity();
    body = signManifest({ ...real, identity: other.did, sig: undefined } as Manifest, other);
    await assert.rejects(() => fetchManifest(url, id.did), /identity mismatch/);

    // an unsigned manifest → rejected
    body = { ...real, sig: undefined };
    await assert.rejects(() => fetchManifest(url, id.did), /verification failed/);
  } finally {
    await new Promise<void>((r) => host.close(() => r()));
  }
});
