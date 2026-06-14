// The capability vocabulary: the shared keys that let `restaurant.booking` on
// node A mean *identically* the same on node B (match by identity, not prose).
// This is the perpetual-governance layer given a concrete home: well-formedness
// rules, namespacing, validation, and a seed set. New keys are proposed and
// adopted by consensus (an RFC-like process); this module is where they live.

export type VocabularyEntry = {
  key: string;
  description: string;
  status: "seed" | "proposed" | "stable";
};

// A key is a dotted, lowercase, hierarchical identifier: segment(.segment)+
// where each segment is [a-z][a-z0-9-]*. At least two segments (namespace.name).
const KEY_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export function isWellFormedKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function namespaceOf(key: string): string {
  return key.split(".")[0];
}

// The seed vocabulary. Deliberately small — the point is the mechanism, not
// completeness. The network grows this by proposal.
export const SEED_VOCABULARY: VocabularyEntry[] = [
  { key: "math.add", description: "add two numbers", status: "seed" },
  { key: "math.double", description: "double a number", status: "seed" },
  { key: "text.echo", description: "return the input text", status: "seed" },
  { key: "compute.inference", description: "run model inference on a prompt", status: "seed" },
  { key: "data.geocode", description: "resolve a place name to coordinates", status: "seed" },
  { key: "restaurant.booking", description: "reserve a table", status: "seed" },
];

export class Vocabulary {
  private entries: Map<string, VocabularyEntry>;

  constructor(seed: VocabularyEntry[] = SEED_VOCABULARY) {
    this.entries = new Map(seed.map((e) => [e.key, e]));
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): VocabularyEntry | undefined {
    return this.entries.get(key);
  }

  list(): VocabularyEntry[] {
    return [...this.entries.values()];
  }

  // Propose a new key. Rejected if malformed or already present.
  propose(key: string, description: string): { ok: boolean; reason?: string } {
    if (!isWellFormedKey(key)) return { ok: false, reason: "malformed key" };
    if (this.entries.has(key)) return { ok: false, reason: "key already exists" };
    this.entries.set(key, { key, description, status: "proposed" });
    return { ok: true };
  }

  // Validate that a capability key is well-formed and known (a node should not
  // advertise a capability outside the shared vocabulary).
  validate(key: string): { ok: boolean; reason?: string } {
    if (!isWellFormedKey(key)) return { ok: false, reason: "malformed key" };
    if (!this.entries.has(key)) return { ok: false, reason: "unknown capability key" };
    return { ok: true };
  }
}
