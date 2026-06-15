// The Manifest: a node's machine-readable self-declaration — the atomic unit
// that makes a node a node. Carries identity, capabilities, terms, a
// reputation pointer, and endpoints. A node signs its own Manifest, so it is
// verifiable independent of where it is hosted (a registry or agent can confirm
// it is authentic and unaltered, and authored by the claimed DID).

import { type Identity } from "./identity";
import { DOMAIN, signEd25519, verifyByDid } from "./signing";

// Complexity cap: a Manifest is a self-declaration, not a catalogue dump.
export const MAX_CAPABILITIES_PER_MANIFEST = 256;

export interface Capability {
  key: string;
  schema?: { input?: unknown; output?: unknown };
  cost?: { unit: string; value: string; model: string };
  risk?: "low" | "medium" | "high";
  reversibility?: string;
}

export interface Manifest {
  v: string;
  identity: string;
  conformance: "L0" | "L1" | "L2" | "L3";
  capabilities: Capability[];
  terms?: { pricing?: string; required_grants?: string[]; sla?: Record<string, unknown> };
  reputation?: string;
  endpoint: string[];
  ext?: Record<string, unknown>;
  sig?: string;
}

// Sign a Manifest with the node's own key. The `identity` DID must match the
// signing key (a node can only author its own Manifest).
export function signManifest(manifest: Omit<Manifest, "sig">, identity: Identity): Manifest {
  if (manifest.identity !== identity.did) {
    throw new Error("manifest.identity does not match the signing key");
  }
  return { ...manifest, sig: signEd25519(DOMAIN.manifest, manifest, identity.privateKey) };
}

// Verify a Manifest's self-signature against its declared identity DID.
export function verifyManifest(manifest: Manifest): { ok: boolean; reason?: string } {
  if (!manifest.sig) return { ok: false, reason: "manifest is unsigned" };
  const structural = validateManifest(manifest);
  if (!structural.ok) return structural;
  const { sig, ...unsigned } = manifest;
  try {
    const ok = verifyByDid(manifest.identity, DOMAIN.manifest, unsigned, sig);
    return ok ? { ok: true } : { ok: false, reason: "bad manifest signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function validateManifest(m: unknown): { ok: boolean; reason?: string } {
  if (!m || typeof m !== "object") return { ok: false, reason: "manifest is not an object" };
  const man = m as Partial<Manifest>;
  if (typeof man.identity !== "string" || !man.identity.startsWith("did:")) {
    return { ok: false, reason: "missing or invalid identity DID" };
  }
  if (!Array.isArray(man.capabilities) || man.capabilities.length === 0) {
    return { ok: false, reason: "need at least one capability" };
  }
  // Complexity cap: a Manifest advertising thousands of capabilities is either
  // abuse or a bug; bound it so indexing/serialization stays cheap.
  if (man.capabilities.length > MAX_CAPABILITIES_PER_MANIFEST) {
    return { ok: false, reason: "too many capabilities" };
  }
  for (const c of man.capabilities) {
    if (!c || typeof c.key !== "string") return { ok: false, reason: "capability missing key" };
  }
  if (!Array.isArray(man.endpoint) || man.endpoint.length === 0) {
    return { ok: false, reason: "need at least one endpoint" };
  }
  return { ok: true };
}
