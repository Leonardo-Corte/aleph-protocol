// S3.2: domain separation + signed Manifest. A signature for one object kind
// must never verify as another, and a node's Manifest is self-verifying.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateIdentity,
  publicKeyFromDid,
  DOMAIN,
  signEd25519,
  verifyEd25519,
  signManifest,
  verifyManifest,
  type Manifest,
} from "@aleph/core";

test("a signature is bound to its domain — cross-kind reuse is rejected", () => {
  const id = generateIdentity();
  const pub = publicKeyFromDid(id.did);
  const obj = { a: 1, b: "x" };

  // sign as an ENVELOPE
  const sig = signEd25519(DOMAIN.envelope, obj, id.privateKey);
  // verifies as an envelope...
  assert.equal(verifyEd25519(DOMAIN.envelope, obj, sig, pub), true);
  // ...but NOT as a grant/attestation/settlement/manifest (same bytes, diff domain)
  assert.equal(verifyEd25519(DOMAIN.grant, obj, sig, pub), false);
  assert.equal(verifyEd25519(DOMAIN.attestation, obj, sig, pub), false);
  assert.equal(verifyEd25519(DOMAIN.settlement, obj, sig, pub), false);
  assert.equal(verifyEd25519(DOMAIN.manifest, obj, sig, pub), false);
});

test("a node's Manifest is self-signed and verifies; tampering is rejected", () => {
  const node = generateIdentity();
  const base: Omit<Manifest, "sig"> = {
    v: "aleph/0.1",
    identity: node.did,
    conformance: "L1",
    capabilities: [{ key: "math.add", risk: "low" }],
    endpoint: ["http://127.0.0.1/aleph"],
  };
  const m = signManifest(base, node);
  assert.equal(verifyManifest(m).ok, true);

  // tamper with a capability after signing → rejected
  const tampered: Manifest = { ...m, capabilities: [{ key: "evil.exfiltrate", risk: "low" }] };
  assert.equal(verifyManifest(tampered).ok, false);

  // an unsigned manifest is rejected
  const unsigned = { ...m };
  delete unsigned.sig;
  assert.equal(verifyManifest(unsigned).ok, false);
});

test("you cannot sign a Manifest for an identity that isn't yours", () => {
  const me = generateIdentity();
  const other = generateIdentity();
  const base: Omit<Manifest, "sig"> = {
    v: "aleph/0.1",
    identity: other.did, // claim someone else's DID
    conformance: "L1",
    capabilities: [{ key: "math.add", risk: "low" }],
    endpoint: ["http://127.0.0.1/aleph"],
  };
  assert.throws(() => signManifest(base, me), /does not match/);
});
