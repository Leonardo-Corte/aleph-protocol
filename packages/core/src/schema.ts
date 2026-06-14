// A minimal JSON-Schema-subset validator (zero dependencies). Capabilities
// declare a schema for their input (and optionally output); the node validates
// against it so I/O is *typed*, not guessed. Supports the subset Aleph needs:
// type, properties, required, items. (ajv could replace this for full JSON
// Schema; this keeps the core dependency-free.)

export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

export function validateSchema(
  schema: JsonSchema | undefined,
  value: unknown,
): { ok: boolean; reason?: string } {
  if (!schema) return { ok: true };
  return check(schema, value, "$");
}

function check(schema: JsonSchema, value: unknown, path: string): { ok: boolean; reason?: string } {
  if (schema.type) {
    const t = schema.type;
    const typeOk =
      t === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : t === "array"
          ? Array.isArray(value)
          : t === "integer"
            ? typeof value === "number" && Number.isInteger(value)
            : t === "number"
              ? typeof value === "number"
              : t === "string"
                ? typeof value === "string"
                : t === "boolean"
                  ? typeof value === "boolean"
                  : false;
    if (!typeOk) return { ok: false, reason: `${path}: expected ${t}` };
  }

  if (schema.type === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) return { ok: false, reason: `${path}.${req}: required` };
    }
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in obj) {
        const r = check(sub, obj[k], `${path}.${k}`);
        if (!r.ok) return r;
      }
    }
  }

  if (schema.type === "array" && schema.items) {
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      const r = check(schema.items, arr[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
  }

  return { ok: true };
}
