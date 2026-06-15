// A structural complexity guard. The transport already caps body BYTES; this
// caps SHAPE — nesting depth and array width — so a small-but-pathological
// payload (deeply nested or a huge array) cannot exhaust CPU/stack in parsing,
// validation, or canonicalization. Applied to inbound message bodies.

export interface ComplexityLimits {
  maxDepth: number; // maximum object/array nesting depth
  maxArrayLength: number; // maximum length of any single array
  maxKeys: number; // maximum keys on any single object
}

export const DEFAULT_COMPLEXITY: ComplexityLimits = {
  maxDepth: 32,
  maxArrayLength: 4096,
  maxKeys: 1024,
};

// Returns ok=false on the first violation (no full traversal of a hostile
// payload beyond the offending node). Depth starts at 1 for the root value.
export function checkComplexity(
  value: unknown,
  limits: ComplexityLimits = DEFAULT_COMPLEXITY,
): { ok: boolean; reason?: string } {
  function walk(v: unknown, depth: number): { ok: boolean; reason?: string } {
    if (depth > limits.maxDepth) return { ok: false, reason: "nesting too deep" };
    if (Array.isArray(v)) {
      if (v.length > limits.maxArrayLength) return { ok: false, reason: "array too large" };
      for (const item of v) {
        const r = walk(item, depth + 1);
        if (!r.ok) return r;
      }
    } else if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length > limits.maxKeys) return { ok: false, reason: "object has too many keys" };
      for (const k of keys) {
        const r = walk((v as Record<string, unknown>)[k], depth + 1);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }
  return walk(value, 1);
}
