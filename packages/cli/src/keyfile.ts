// EncryptedFileKeyStore — the thin fs wrapper around core's pure seal/unseal.
// The private key is encrypted at rest (scrypt + AES-256-GCM); only the
// passphrase unlocks it. This keeps @aleph/core I/O-free while giving operators
// a real on-disk keystore.

import { readFile, writeFile } from "node:fs/promises";
import {
  sealIdentity,
  unsealIdentity,
  generateIdentity,
  type Identity,
  type KeyStore,
  type SealedKey,
} from "@aleph/core";

export class EncryptedFileKeyStore implements KeyStore {
  constructor(private path: string) {}

  // Create a fresh identity, seal it under the passphrase, write it.
  static async init(
    path: string,
    passphrase: string,
  ): Promise<{ store: EncryptedFileKeyStore; did: string }> {
    const id = generateIdentity();
    const sealed = sealIdentity(id, passphrase);
    await writeFile(path, JSON.stringify(sealed, null, 2), { mode: 0o600 });
    return { store: new EncryptedFileKeyStore(path), did: id.did };
  }

  async load(passphrase: string): Promise<Identity> {
    const sealed = JSON.parse(await readFile(this.path, "utf8")) as SealedKey;
    return unsealIdentity(sealed, passphrase);
  }
}
