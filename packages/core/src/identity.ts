// Identity = a self-owned Ed25519 keypair rendered as a did:key.
// did:key needs no authority and no blockchain: the DID *is* the public key,
// so anyone can verify a signature by parsing the DID. This is the whole
// identity layer for v0 (the "wallet custodies, the DID identifies" split).

import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { base58encode, base58decode } from "./base58";

// Multicodec prefix for an Ed25519 public key (0xed 0x01).
const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);

export interface Identity {
  did: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

function rawPublicKey(pub: KeyObject): Uint8Array {
  const jwk = pub.export({ format: "jwk" }) as { x: string };
  return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}

export function didFromRawPublicKey(raw: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_PREFIX.length + raw.length);
  prefixed.set(ED25519_PREFIX, 0);
  prefixed.set(raw, ED25519_PREFIX.length);
  return "did:key:z" + base58encode(prefixed);
}

export function generateIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { did: didFromRawPublicKey(rawPublicKey(publicKey)), publicKey, privateKey };
}

// Resolve a did:key back into a usable public key for signature verification.
export function publicKeyFromDid(did: string): KeyObject {
  if (!did.startsWith("did:key:z")) throw new Error("unsupported DID method: " + did);
  const decoded = base58decode(did.slice("did:key:z".length));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("not an Ed25519 did:key");
  }
  const raw = decoded.slice(2);
  const x = Buffer.from(raw).toString("base64url");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}
