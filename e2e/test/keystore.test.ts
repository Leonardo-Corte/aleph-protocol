// S3.5: key management — encrypted keystore (no plaintext at rest) and key
// rotation with validity windows.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateIdentity,
  sealIdentity,
  unsealIdentity,
  KeyRing,
  verifyAtTime,
  DOMAIN,
  signEd25519,
  createEnvelope,
  verifyEnvelope,
} from "@aleph/core";

test("seal/unseal round-trips a key under a passphrase; wrong passphrase fails", () => {
  const id = generateIdentity();
  const sealed = sealIdentity(id, "correct horse battery staple");

  // nothing in the sealed blob is the plaintext key
  const blob = JSON.stringify(sealed);
  assert.doesNotMatch(blob, /BEGIN PRIVATE KEY/);

  // correct passphrase recovers a working key (it can sign a verifiable envelope)
  const back = unsealIdentity(sealed, "correct horse battery staple");
  assert.equal(back.did, id.did);
  const env = createEnvelope({ from: back.did, to: back.did, type: "INVOKE", body: {} }, back.privateKey);
  assert.equal(verifyEnvelope(env).ok, true);

  // wrong passphrase throws (never returns a wrong key)
  assert.throws(() => unsealIdentity(sealed, "wrong"), /wrong passphrase or corrupted/);

  // tampered ciphertext fails the GCM auth tag
  const tampered = {
    ...sealed,
    cipher: { ...sealed.cipher, data: sealed.cipher.data.slice(0, -4) + "AAAA" },
  };
  assert.throws(() => unsealIdentity(tampered, "correct horse battery staple"));
});

test("key rotation: a signature verifies against the key valid at its timestamp", () => {
  const k1 = generateIdentity();
  const k2 = generateIdentity();
  const ring = new KeyRing();
  const t0 = 1000;
  const tRotate = 5000;
  ring.rotate(k1.did, t0); // k1 valid from t0
  ring.rotate(k2.did, tRotate); // k2 valid from tRotate; k1 closed at tRotate

  const obj = { x: 1 };
  // a message signed by k1 at t=2000 (k1's epoch)
  const sigOld = signEd25519(DOMAIN.envelope, obj, k1.privateKey);
  assert.equal(verifyAtTime(ring, 2000, DOMAIN.envelope, obj, sigOld).ok, true);
  // the same old signature is NOT valid in the new epoch (t=6000 → k2 expected)
  assert.equal(verifyAtTime(ring, 6000, DOMAIN.envelope, obj, sigOld).ok, false);

  // a message signed by k2 verifies in the new epoch
  const sigNew = signEd25519(DOMAIN.envelope, obj, k2.privateKey);
  assert.equal(verifyAtTime(ring, 6000, DOMAIN.envelope, obj, sigNew).ok, true);
  // before any key was valid → no key
  assert.equal(verifyAtTime(ring, 500, DOMAIN.envelope, obj, sigNew).ok, false);

  assert.equal(ring.keyAt(2000), k1.did);
  assert.equal(ring.keyAt(6000), k2.did);
});
