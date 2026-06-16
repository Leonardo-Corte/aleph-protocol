// Domain-separated signing. Every signed object kind (envelope, grant,
// attestation, settlement, manifest) is signed over a message prefixed with a
// distinct domain tag, so a signature produced for one kind can never verify as
// another — even if their canonical forms happen to overlap. The signed message
// is the UTF-8 bytes of:  `<domain>\n<RFC8785-canonical-json>`.

import { sign, verify, timingSafeEqual, type KeyObject } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalize } from "./canonical";
import { publicKeyFromDid, secp256k1PublicKeyFromDid, suiteFromDid } from "./identity";
import { isDidPkh, verifyPkh } from "./pkh";

export const DOMAIN = {
  envelope: "aleph/0.1:envelope",
  grant: "aleph/0.1:grant",
  attestation: "aleph/0.1:attestation",
  revocation: "aleph/0.1:revocation",
  settlement: "aleph/0.1:settlement",
  manifest: "aleph/0.1:manifest",
} as const;

export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

// The exact bytes a signature is computed over. Cross-language SDKs reproduce
// this string and sign/verify the same bytes.
export function signedMessage(domain: Domain, obj: unknown): Buffer {
  return Buffer.from(domain + "\n" + canonicalize(obj), "utf8");
}

// Ed25519 over the domain-separated message. (secp256k1 is added behind the
// suite abstraction in S3.3; this is the Ed25519 path.)
export function signEd25519(domain: Domain, obj: unknown, privateKey: KeyObject): string {
  return sign(null, signedMessage(domain, obj), privateKey).toString("base64url");
}

export function verifyEd25519(domain: Domain, obj: unknown, sigB64: string, publicKey: KeyObject): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    return false;
  }
  return verify(null, signedMessage(domain, obj), publicKey, sig);
}

// secp256k1 over sha256 of the domain-separated message (ECDSA needs a digest).
export function signSecp256k1(domain: Domain, obj: unknown, privateKey: Uint8Array): string {
  const digest = sha256(signedMessage(domain, obj));
  const sig = secp256k1.sign(digest, privateKey); // 64-byte compact signature
  return Buffer.from(sig).toString("base64url");
}

export function verifySecp256k1(
  domain: Domain,
  obj: unknown,
  sigB64: string,
  publicKey: Uint8Array,
): boolean {
  try {
    const sig = new Uint8Array(Buffer.from(sigB64, "base64url"));
    return secp256k1.verify(sig, sha256(signedMessage(domain, obj)), publicKey);
  } catch {
    return false;
  }
}

// A signer is anything that can produce a signature over a domain-separated
// message. This abstracts the signature suite behind the identity, so the signed-
// object constructors accept an Ed25519 key, a secp256k1 did:key, or a did:pkh
// account uniformly (ROADMAP D6: "abstract the suite behind the verification
// method type").
export interface Signer {
  did: string;
  sign(domain: Domain, obj: unknown): string;
}

export function isSigner(x: unknown): x is Signer {
  return !!x && typeof (x as Signer).sign === "function";
}

// Normalize a KeyObject (Ed25519 — the common case) or a Signer into a sign fn.
export function signWith(key: KeyObject | Signer, domain: Domain, obj: unknown): string {
  return isSigner(key) ? key.sign(domain, obj) : signEd25519(domain, obj, key);
}

// Suite-agnostic verification: detect the signature suite from the signer's DID
// and dispatch to the right verifier. An object signed by an Ed25519, secp256k1
// did:key, or did:pkh identity verifies through this one function.
export function verifyByDid(did: string, domain: Domain, obj: unknown, sigB64: string): boolean {
  try {
    if (isDidPkh(did)) return verifyPkh(did, domain, obj, sigB64);
    const suite = suiteFromDid(did);
    return suite === "ed25519"
      ? verifyEd25519(domain, obj, sigB64, publicKeyFromDid(did))
      : verifySecp256k1(domain, obj, sigB64, secp256k1PublicKeyFromDid(did));
  } catch {
    return false;
  }
}

// Constant-time comparison for any secret/MAC comparisons (length-safe).
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
