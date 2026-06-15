// Section 7.4: agent-side safety. A signed RECEIPT proves authorship, not
// safety — the agent must treat capability output as untrusted and gate
// dangerous (high-risk / irreversible) capabilities behind confirmation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyOutput, requiresConfirmation } from "@aleph/client";
import type { Capability } from "@aleph/core";

test("verifyOutput rejects output that violates the declared schema", () => {
  const cap: Capability = {
    key: "math.add",
    schema: {
      input: { type: "object", properties: { a: { type: "number" } }, required: ["a"] },
      output: { type: "object", properties: { sum: { type: "number" } }, required: ["sum"] },
    },
  };

  // a well-formed output passes
  assert.equal(verifyOutput(cap, { sum: 5 }).ok, true);
  // a node returning a wrong-typed / missing field is caught — untrusted input
  assert.equal(verifyOutput(cap, { sum: "five" }).ok, false);
  assert.equal(verifyOutput(cap, {}).ok, false);

  // a capability that declares no output schema can't be auto-validated (ok=true,
  // but the agent still must not execute content blindly — documented contract)
  assert.equal(verifyOutput({ key: "x.do" }, { anything: true }).ok, true);
});

test("requiresConfirmation gates high-risk and irreversible capabilities", () => {
  assert.equal(requiresConfirmation({ key: "math.add", risk: "low" }), false);
  assert.equal(requiresConfirmation({ key: "fs.read", risk: "medium" }), false);
  assert.equal(requiresConfirmation({ key: "funds.transfer", risk: "high" }), true);
  assert.equal(requiresConfirmation({ key: "email.send", reversibility: "irreversible" }), true);
  assert.equal(requiresConfirmation({ key: "db.write", reversibility: "reversible" }), false);
});
