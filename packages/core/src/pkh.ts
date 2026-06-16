// did:pkh — an identity that IS a blockchain account. For EVM:
//   did:pkh:eip155:<chainId>:<0x-address>
// The DID is the Ethereum address, so a node's protocol identity and its on-chain
// payout address are the SAME thing — "who I am" == "where I get paid", with no
// trusted self-assertion. Signatures are verified by ECDSA *recovery*: recover
// the secp256k1 public key from a recoverable signature over the Aleph
// domain-separated message, derive the Ethereum address, and compare to the DID.
//
// No new heavy dependency: the core already carries @noble/curves (secp256k1)
// and @noble/hashes (keccak). did:pkh is verifiable here without viem.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { type Domain, type Signer, signedMessage } from "./signing";

const PKH_PREFIX = "did:pkh:eip155:";

export interface PkhAccount {
  chainId: number;
  address: string; // lowercase 0x-hex
}

// The Ethereum address (lowercase) for a secp256k1 public key (compressed or
// uncompressed): keccak256 of the uncompressed point (sans 0x04 prefix), last 20.
export function addressFromSecp256k1PublicKey(pub: Uint8Array): string {
  const point = secp256k1.Point.fromBytes(pub);
  const uncompressed = point.toBytes(false); // 65 bytes: 0x04 || X || Y
  const hash = keccak_256(uncompressed.slice(1));
  return "0x" + Buffer.from(hash.slice(12)).toString("hex");
}

export function didPkh(chainId: number, address: string): string {
  return `${PKH_PREFIX}${chainId}:${address.toLowerCase()}`;
}

export function isDidPkh(did: string): boolean {
  return did.startsWith(PKH_PREFIX);
}

export function parseDidPkh(did: string): PkhAccount {
  if (!isDidPkh(did)) throw new Error("not a did:pkh:eip155 DID: " + did);
  const rest = did.slice(PKH_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new Error("malformed did:pkh: " + did);
  const chainId = Number(rest.slice(0, sep));
  const address = rest.slice(sep + 1).toLowerCase();
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("bad chainId in did:pkh: " + did);
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("bad address in did:pkh: " + did);
  return { chainId, address };
}

// A signing identity backed by a secp256k1 key, addressed as did:pkh.
export interface PkhIdentity {
  did: string;
  suite: "pkh";
  chainId: number;
  address: string;
  privateKey: Uint8Array; // 32-byte scalar
}

export function pkhIdentityFromPrivateKey(privateKey: Uint8Array, chainId: number): PkhIdentity {
  const pub = secp256k1.getPublicKey(privateKey, false);
  const address = addressFromSecp256k1PublicKey(pub);
  return { did: didPkh(chainId, address), suite: "pkh", chainId, address, privateKey };
}

export function generatePkhIdentity(chainId: number): PkhIdentity {
  return pkhIdentityFromPrivateKey(secp256k1.utils.randomSecretKey(), chainId);
}

// Sign the domain-separated message with a recoverable secp256k1 signature
// (65 bytes: r || s || recovery), base64url — so a verifier can recover the
// signer's public key (and thus its address) from the signature alone.
export function signPkh(domain: Domain, obj: unknown, privateKey: Uint8Array): string {
  const digest = sha256(signedMessage(domain, obj));
  const sig = secp256k1.sign(digest, privateKey, { format: "recovered" }); // 65 bytes
  return Buffer.from(sig).toString("base64url");
}

// A Signer for a did:pkh identity, usable by any signed-object constructor.
export function pkhSigner(identity: PkhIdentity): Signer {
  return {
    did: identity.did,
    sign: (domain, obj) => signPkh(domain, obj, identity.privateKey),
  };
}

// Verify by recovering the address from the signature and comparing to the DID.
export function verifyPkh(did: string, domain: Domain, obj: unknown, sigB64: string): boolean {
  try {
    const { address } = parseDidPkh(did);
    const sig = new Uint8Array(Buffer.from(sigB64, "base64url"));
    if (sig.length !== 65) return false;
    const digest = sha256(signedMessage(domain, obj));
    const recovered = secp256k1.recoverPublicKey(sig, digest); // compressed pubkey
    return addressFromSecp256k1PublicKey(recovered) === address;
  } catch {
    return false;
  }
}
