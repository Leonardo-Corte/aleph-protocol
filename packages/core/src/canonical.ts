// Deterministic JSON canonicalization: recursively sort object keys, then
// JSON.stringify. Signatures are computed over this canonical form so that
// two implementations sign and verify the same bytes regardless of key order.
// (A pragmatic JCS for v0; not full RFC 8785 number handling.)

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) out[key] = sortValue(input[key]);
    return out;
  }
  return value;
}
