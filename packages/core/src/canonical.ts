// RFC 8785 — JSON Canonicalization Scheme (JCS). Signatures are computed over
// these exact bytes, so two independent implementations (TS, Python, …) sign
// and verify identically. This is the permanent definition of "what gets
// signed"; it is verified against the official RFC 8785 test vectors.
//
// Why JS primitives are already correct:
//  - Numbers: ECMAScript Number::toString (what `String(n)` yields) IS the
//    serialization RFC 8785 §3.2.2.3 mandates — except non-finite, which must
//    error rather than become null.
//  - Strings: JS string escaping (short forms \b\t\n\f\r\"\\, lowercase \u00xx
//    for other controls, non-ASCII emitted as UTF-8, forward slash unescaped)
//    is exactly RFC 8785 §3.2.2.2.
//  - Keys: sorted by UTF-16 code units, which is JS's default string ordering.

export function canonicalize(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("canonicalize: non-finite numbers are not permitted (RFC 8785)");
      }
      // -0 must serialize as "0"; String() already does this.
      return String(value);
    }

    case "string":
      // JS JSON string escaping == RFC 8785 §3.2.2.2.
      return JSON.stringify(value);

    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map(write).join(",") + "]";
      }
      const obj = value as Record<string, unknown>;
      const members: string[] = [];
      // Sort property names by UTF-16 code units (JS default sort).
      for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v === undefined) continue; // undefined is not representable in JSON
        members.push(JSON.stringify(key) + ":" + write(v));
      }
      return "{" + members.join(",") + "}";
    }

    default:
      // bigint, function, symbol, undefined at top level
      throw new Error("canonicalize: unsupported value of type " + typeof value);
  }
}
