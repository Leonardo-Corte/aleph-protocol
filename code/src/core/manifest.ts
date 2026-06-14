// The Manifest: a node's machine-readable self-declaration — the atomic unit
// that makes a node a node. Carries identity, capabilities, terms, a
// reputation pointer, and endpoints. Here we define the type and a structural
// validator (the minimal "is this a node?" check).

export type Capability = {
  key: string;
  schema?: { input?: unknown; output?: unknown };
  cost?: { unit: string; value: string; model: string };
  risk?: "low" | "medium" | "high";
  reversibility?: string;
};

export type Manifest = {
  v: string;
  identity: string;
  conformance: "L0" | "L1" | "L2" | "L3";
  capabilities: Capability[];
  terms?: { pricing?: string; required_grants?: string[]; sla?: Record<string, unknown> };
  reputation?: string;
  endpoint: string[];
  ext?: Record<string, unknown>;
};

export function validateManifest(m: unknown): { ok: boolean; reason?: string } {
  if (!m || typeof m !== "object") return { ok: false, reason: "manifest is not an object" };
  const man = m as Partial<Manifest>;
  if (typeof man.identity !== "string" || !man.identity.startsWith("did:")) {
    return { ok: false, reason: "missing or invalid identity DID" };
  }
  if (!Array.isArray(man.capabilities) || man.capabilities.length === 0) {
    return { ok: false, reason: "need at least one capability" };
  }
  for (const c of man.capabilities) {
    if (!c || typeof c.key !== "string") return { ok: false, reason: "capability missing key" };
  }
  if (!Array.isArray(man.endpoint) || man.endpoint.length === 0) {
    return { ok: false, reason: "need at least one endpoint" };
  }
  return { ok: true };
}
