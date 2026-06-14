// Identity = a self-owned keypair rendered as a did:key. The DID *is* the
// public key, so anyone can verify a signature by parsing the DID — no
// authority, no blockchain. Two signature suites are supported, distinguished
// by the did:key multicodec prefix: Ed25519 (the default) and secp256k1 (for
// chain-linked identities, ROADMAP §4).

import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58encode, base58decode } from "./base58";

// Multicodec prefixes: Ed25519 = 0xed 0x01, secp256k1 = 0xe7 0x01.
const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);
const SECP256K1_PREFIX = new Uint8Array([0xe7, 0x01]);

export type Suite = "ed25519" | "secp256k1";

export interface Identity {
  did: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

// A secp256k1 identity carries raw key bytes (verified via @noble/curves).
export interface Secp256k1Identity {
  did: string;
  suite: "secp256k1";
  publicKey: Uint8Array; // 33-byte compressed point
  privateKey: Uint8Array; // 32-byte scalar
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

// Resolve an Ed25519 did:key into a usable public key for signature verification.
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

// Which signature suite a did:key encodes (from its multicodec prefix).
export function suiteFromDid(did: string): Suite {
  if (!did.startsWith("did:key:z")) throw new Error("unsupported DID method: " + did);
  const decoded = base58decode(did.slice("did:key:z".length));
  if (decoded[0] === 0xed && decoded[1] === 0x01) return "ed25519";
  if (decoded[0] === 0xe7 && decoded[1] === 0x01) return "secp256k1";
  throw new Error("unknown did:key signature suite");
}

export function generateSecp256k1Identity(): Secp256k1Identity {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true); // compressed
  const prefixed = new Uint8Array(SECP256K1_PREFIX.length + publicKey.length);
  prefixed.set(SECP256K1_PREFIX, 0);
  prefixed.set(publicKey, SECP256K1_PREFIX.length);
  return { did: "did:key:z" + base58encode(prefixed), suite: "secp256k1", publicKey, privateKey };
}

// Resolve a secp256k1 did:key into the raw compressed public key.
export function secp256k1PublicKeyFromDid(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("unsupported DID method: " + did);
  const decoded = base58decode(did.slice("did:key:z".length));
  if (decoded[0] !== 0xe7 || decoded[1] !== 0x01) throw new Error("not a secp256k1 did:key");
  return decoded.slice(2);
}
