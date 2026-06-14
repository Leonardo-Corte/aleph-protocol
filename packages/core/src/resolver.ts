// DID resolution behind a pluggable interface. did:key is resolved locally
// (the DID *is* the key); did:web is resolved by fetching the domain's
// /.well-known/did.json. New methods can be registered without touching
// callers. Envelope verification stays on the synchronous did:key fast path;
// this resolver is for identities that live behind a domain.

import { createPublicKey, type KeyObject } from "node:crypto";
import { publicKeyFromDid } from "./identity";

export type DidResolver = (did: string) => Promise<KeyObject>;

const methods = new Map<string, DidResolver>();

export function registerDidMethod(method: string, resolver: DidResolver): void {
  methods.set(method, resolver);
}

export async function resolveDid(did: string): Promise<KeyObject> {
  const method = did.split(":")[1];
  if (!method) throw new Error("malformed DID: " + did);
  const resolver = methods.get(method);
  if (!resolver) throw new Error("no resolver for DID method: " + method);
  return resolver(did);
}

// did:key — local, synchronous under the hood (wrapped to satisfy the async interface).
registerDidMethod("key", (did) => Promise.resolve(publicKeyFromDid(did)));

// did:web — did:web:example.com[:path] -> https://example.com[/path]/did.json
// (root form uses /.well-known/did.json), per the did:web method.
registerDidMethod("web", async (did) => {
  const rest = did.slice("did:web:".length);
  const parts = rest.split(":").map(decodeURIComponent);
  const host = parts[0];
  const path = parts.slice(1);
  const url =
    path.length === 0 ? `https://${host}/.well-known/did.json` : `https://${host}/${path.join("/")}/did.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`did:web fetch failed (${res.status}) for ${url}`);
  const doc = (await res.json()) as DidDocument;
  return publicKeyFromVerificationMethod(doc);
});

export interface DidDocument {
  verificationMethod?: {
    type?: string;
    publicKeyJwk?: { kty: string; crv: string; x: string };
    publicKeyMultibase?: string;
  }[];
}

export function publicKeyFromVerificationMethod(doc: DidDocument): KeyObject {
  const vm = doc.verificationMethod?.[0];
  if (!vm) throw new Error("did document has no verificationMethod");
  if (vm.publicKeyJwk) {
    return createPublicKey({ key: vm.publicKeyJwk, format: "jwk" });
  }
  if (vm.publicKeyMultibase) {
    // Reuse the did:key decoder by reconstructing a did:key from the multibase.
    return publicKeyFromDid("did:key:" + vm.publicKeyMultibase);
  }
  throw new Error("unsupported verificationMethod encoding");
}
