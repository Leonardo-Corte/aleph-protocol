// Section 11.1: the curated capability catalog is the governed, schema-bearing
// vocabulary nodes and agents build against. It must be well-formed, so two
// nodes offering the same key really match.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isWellFormedKey, validateSchema, type JsonSchema, type Risk } from "@aleph/core";

const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../spec/vocabulary/catalog.json", import.meta.url)), "utf8"),
) as {
  version: string;
  capabilities: {
    key: string;
    description: string;
    status: string;
    risk: Risk;
    reversibility: string;
    input: JsonSchema;
    output: JsonSchema;
  }[];
};

test("every catalog entry is well-formed (key, risk, schemas)", () => {
  const seen = new Set<string>();
  for (const e of catalog.capabilities) {
    assert.ok(isWellFormedKey(e.key), `malformed key: ${e.key}`);
    assert.ok(!seen.has(e.key), `duplicate key: ${e.key}`);
    seen.add(e.key);
    assert.ok(e.description.length > 0, `${e.key}: empty description`);
    assert.ok(["low", "medium", "high"].includes(e.risk), `${e.key}: bad risk`);
    assert.ok(["proposed", "stable", "seed"].includes(e.status), `${e.key}: bad status`);
    // input/output are object JSON Schemas
    for (const which of ["input", "output"] as const) {
      const s = e[which];
      assert.equal(s.type, "object", `${e.key}.${which}: not an object schema`);
      assert.ok(s.properties && Object.keys(s.properties).length > 0, `${e.key}.${which}: no properties`);
    }
  }
});

test("the reference-node capabilities are in the catalog and self-consistent", () => {
  const byKey = new Map(catalog.capabilities.map((e) => [e.key, e]));
  for (const key of ["math.add", "data.geocode", "text.summarize"]) {
    assert.ok(byKey.has(key), `missing reference capability: ${key}`);
  }
  // a valid example validates against the declared schema; a bad one fails
  const geocode = byKey.get("data.geocode")!;
  assert.equal(validateSchema(geocode.input, { place: "Paris" }).ok, true);
  assert.equal(validateSchema(geocode.input, {}).ok, false); // place required
  assert.equal(validateSchema(geocode.output, { name: "Paris", lat: 48.85, lon: 2.35 }).ok, true);
});
