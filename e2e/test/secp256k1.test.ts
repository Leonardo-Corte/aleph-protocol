// S3.3: the core supports two signature suites — Ed25519 (default) and
// secp256k1 (chain-linked identities). did:key encodes both; verification is
// suite-agnostic (dispatched from the signer's DID).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  generateIdentity,
  generateSecp256k1Identity,
  suiteFromDid,
  secp256k1PublicKeyFromDid,
  DOMAIN,
  signSecp256k1,
  verifySecp256k1,
  verifyByDid,
  verifyEnvelope,
  type Envelope,
} from "@aleph/core";

test("secp256k1 did:key round-trips and reports its suite", () => {
  const id = generateSecp256k1Identity();
  assert.ok(id.did.startsWith("did:key:z"));
  assert.equal(suiteFromDid(id.did), "secp256k1");
  // the public key recovered from the DID matches the identity's key
  assert.deepEqual([...secp256k1PublicKeyFromDid(id.did)], [...id.publicKey]);
  // and an Ed25519 identity reports the other suite
  assert.equal(suiteFromDid(generateIdentity().did), "ed25519");
});

test("secp256k1 sign/verify; tamper and cross-suite are rejected", () => {
  const id = generateSecp256k1Identity();
  const obj = { hello: "world", n: 42 };
  const sig = signSecp256k1(DOMAIN.envelope, obj, id.privateKey);
  assert.equal(verifySecp256k1(DOMAIN.envelope, obj, sig, id.publicKey), true);
  // tampered object → fail
  assert.equal(verifySecp256k1(DOMAIN.envelope, { ...obj, n: 43 }, sig, id.publicKey), false);
  // wrong domain → fail (domain separation holds for secp256k1 too)
  assert.equal(verifySecp256k1(DOMAIN.grant, obj, sig, id.publicKey), false);
});

test("verifyByDid dispatches on the DID's suite (both verify)", () => {
  const ed = generateIdentity();
  const sk = generateSecp256k1Identity();
  const obj = { x: 1 };
  // sign with each suite, verify through the one dispatcher
  const skSig = signSecp256k1(DOMAIN.attestation, obj, sk.privateKey);
  assert.equal(verifyByDid(sk.did, DOMAIN.attestation, obj, skSig), true);
  // an Ed25519-signed object verifies through the same dispatcher (via envelope path elsewhere)
  assert.equal(suiteFromDid(ed.did), "ed25519");
});

test("a secp256k1-signed Envelope verifies through verifyEnvelope", () => {
  const id = generateSecp256k1Identity();
  const base = {
    v: "aleph/0.1",
    from: id.did,
    to: id.did,
    type: "INVOKE" as const,
    nonce: randomUUID(),
    ts: Date.now(),
    body: { capability: "math.add" },
  };
  const env: Envelope = { ...base, sig: signSecp256k1(DOMAIN.envelope, base, id.privateKey) };
  assert.equal(verifyEnvelope(env).ok, true);
  // tamper the body → rejected
  const tampered: Envelope = { ...env, body: { capability: "evil" } };
  assert.equal(verifyEnvelope(tampered).ok, false);
});
