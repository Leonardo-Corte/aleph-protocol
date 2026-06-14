// Key management — the part the prototype ignored. Private keys never sit in
// plaintext: a key is sealed with a passphrase (scrypt KDF → AES-256-GCM), and
// only unsealed in memory when needed. These functions are pure (no I/O): they
// turn a key into an encrypted, JSON-serializable blob and back, so the file or
// KMS that stores the blob is a thin, swappable wrapper around them.

import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import type { Identity } from "./identity";

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

export interface SealedKey {
  v: 1;
  did: string;
  suite: "ed25519";
  kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string; data: string };
}

// Seal an identity's private key under a passphrase. Output is safe to write to
// disk: without the passphrase the key cannot be recovered.
export function sealIdentity(identity: Identity, passphrase: string): SealedKey {
  const salt = randomBytes(16);
  const dek = scryptSync(passphrase, salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  const iv = randomBytes(12);
  const pkcs8 = identity.privateKey.export({ type: "pkcs8", format: "der" });
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const data = Buffer.concat([cipher.update(pkcs8), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    did: identity.did,
    suite: "ed25519",
    kdf: { name: "scrypt", salt: salt.toString("base64"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: data.toString("base64"),
    },
  };
}

// Unseal an identity. A wrong passphrase (or any tampering) fails the GCM auth
// tag and throws — it never returns a wrong key.
export function unsealIdentity(sealed: SealedKey, passphrase: string): Identity {
  const salt = Buffer.from(sealed.kdf.salt, "base64");
  const dek = scryptSync(passphrase, salt, SCRYPT.keyLen, {
    N: sealed.kdf.N,
    r: sealed.kdf.r,
    p: sealed.kdf.p,
  });
  const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(sealed.cipher.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.cipher.tag, "base64"));
  let pkcs8: Buffer;
  try {
    pkcs8 = Buffer.concat([decipher.update(Buffer.from(sealed.cipher.data, "base64")), decipher.final()]);
  } catch {
    throw new Error("unseal failed: wrong passphrase or corrupted keystore");
  }
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { did: sealed.did, publicKey, privateKey };
}

// A place a key lives. EncryptedFileKeyStore (fs) and a KMS-backed store are
// thin wrappers; both produce an Identity without exposing plaintext at rest.
export interface KeyStore {
  load(passphrase: string): Promise<Identity>;
}
