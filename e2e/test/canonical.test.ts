// Verify Aleph's canonicalize against the official RFC 8785 (JCS) test vectors.
// Byte-for-byte equality with the reference output is the proof of correctness
// — and the cross-language contract every SDK must meet.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize } from "@aleph/core";

const vectorsDir = fileURLToPath(new URL("../../spec/test-vectors/jcs/", import.meta.url));
const cases = ["arrays", "structures", "values", "weird", "unicode", "french"];

for (const name of cases) {
  test(`RFC 8785 vector: ${name}`, () => {
    const input = JSON.parse(readFileSync(`${vectorsDir}input/${name}.json`, "utf8")) as unknown;
    const expected = readFileSync(`${vectorsDir}output/${name}.json`, "utf8").replace(/\n$/, "");
    assert.equal(canonicalize(input), expected);
  });
}

test("canonicalize rejects non-finite numbers", () => {
  assert.throws(() => canonicalize({ x: Infinity }), /non-finite/);
  assert.throws(() => canonicalize({ x: NaN }), /non-finite/);
});

test("canonicalize: -0 serializes as 0; nested keys sorted recursively", () => {
  assert.equal(canonicalize(-0), "0");
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});
