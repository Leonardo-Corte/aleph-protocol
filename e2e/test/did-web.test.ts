// did:web URL derivation (the deterministic part; the HTTPS fetch is transport).
import assert from "node:assert/strict";
import { test } from "node:test";
import { didWebUrl } from "@aleph/core";

test("did:web maps to the correct https did.json URL", () => {
  assert.equal(didWebUrl("did:web:example.com"), "https://example.com/.well-known/did.json");
  assert.equal(didWebUrl("did:web:example.com:nodes:42"), "https://example.com/nodes/42/did.json");
  // percent-encoded port form
  assert.equal(didWebUrl("did:web:127.0.0.1%3A8080"), "https://127.0.0.1:8080/.well-known/did.json");
});
