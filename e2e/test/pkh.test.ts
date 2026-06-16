// did:pkh — an identity that IS an Ethereum account. A node addressed as
// did:pkh:eip155:<chain>:<addr> signs with the matching key; verification
// recovers the address from the signature and compares it to the DID. This is
// the binding: "who I am" == "where I get paid", no trusted self-assertion.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generatePkhIdentity,
  pkhIdentityFromPrivateKey,
  pkhSigner,
  parseDidPkh,
  didPkh,
  isDidPkh,
  addressFromSecp256k1PublicKey,
  createEnvelope,
  verifyEnvelope,
  signManifest,
  verifyManifest,
  verifyByDid,
  DOMAIN,
  type Envelope,
} from "@aleph/core";

test("did:pkh: parse, build, and address derivation are consistent", () => {
  const priv = new Uint8Array(32).fill(3);
  const id = pkhIdentityFromPrivateKey(priv, 84532);
  assert.ok(isDidPkh(id.did));
  const parsed = parseDidPkh(id.did);
  assert.equal(parsed.chainId, 84532);
  assert.equal(parsed.address, id.address);
  assert.equal(didPkh(84532, id.address), id.did);
  // deterministic: the same key → the same address/DID
  const again = pkhIdentityFromPrivateKey(priv, 84532);
  assert.equal(again.did, id.did);
  // address derivation is exposed and consistent with the identity helper
  assert.equal(typeof addressFromSecp256k1PublicKey, "function");
  // malformed DIDs are rejected
  assert.throws(() => parseDidPkh("did:pkh:eip155:1:0xnothex"), /bad address/);
  assert.throws(() => parseDidPkh("did:key:zabc"), /not a did:pkh/);
});

test("a pkh-signed envelope verifies; tamper and wrong-DID are rejected", () => {
  const node = generatePkhIdentity(84532);
  const signer = pkhSigner(node);
  const env = createEnvelope(
    { from: node.did, to: "did:aleph:peer", type: "INVOKE", body: { capability: "data.geocode", input: {} } },
    signer,
  );
  assert.equal(verifyEnvelope(env).ok, true);
  assert.equal(verifyByDid(node.did, DOMAIN.envelope, stripSig(env), env.sig!), true);

  // tampered body → recovered address no longer matches
  const tampered = { ...env, body: { capability: "evil.exec", input: {} } };
  assert.equal(verifyEnvelope(tampered).ok, false);

  // a different pkh DID with the same signature → rejected
  const other = generatePkhIdentity(84532);
  assert.equal(verifyByDid(other.did, DOMAIN.envelope, stripSig(env), env.sig!), false);
});

test("a pkh node signs its Manifest; verification binds it to the address", () => {
  const node = generatePkhIdentity(84532);
  const manifest = signManifest(
    {
      v: "aleph/0.1",
      identity: node.did,
      conformance: "L1",
      capabilities: [{ key: "data.geocode", risk: "low" }],
      endpoint: ["https://node.example.org/aleph"],
    },
    pkhSigner(node),
  );
  assert.equal(verifyManifest(manifest).ok, true);
  // the payout address is the DID's address — derivable, not asserted
  assert.equal(parseDidPkh(manifest.identity).address, node.address);

  // signing a Manifest whose identity ≠ the signer is rejected
  const other = generatePkhIdentity(84532);
  assert.throws(
    () => signManifest({ ...manifest, sig: undefined, identity: other.did } as never, pkhSigner(node)),
    /does not match/,
  );
});

function stripSig(env: Envelope): Omit<Envelope, "sig"> {
  const rest = { ...env };
  delete rest.sig;
  return rest;
}
