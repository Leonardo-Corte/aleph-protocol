// Section 7.2: the authorization model. A Grant is bounded delegation; a
// sub-grant can only ever NARROW its parent. These tests pin every narrowing
// rule (scope ⊆, limit ≤, expiry ≤, parent delegable, depth ≤ MAX, chain
// integrity) and the joint capability-scoped payment limit.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateIdentity,
  createGrant,
  createSubGrant,
  verifyGrant,
  MAX_DELEGATION_DEPTH,
  type Grant,
} from "@aleph/core";

const HOUR = 3_600_000;

test("a valid sub-grant verifies as a narrowing of its parent", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const subAgent = generateIdentity();
  const now = Date.now();

  const root = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 100 } }],
      not_after: now + 2 * HOUR,
      delegable: true,
    },
    principal.privateKey,
  );

  // agent hires subAgent for a narrower slice: same capability, lower limit, sooner expiry
  const sub = createSubGrant(
    root,
    {
      grantee: subAgent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 20 } }],
      not_after: now + HOUR,
    },
    agent.privateKey,
  );

  // subAgent may spend up to 20 on pay.send
  assert.equal(verifyGrant(sub, { grantee: subAgent.did, capability: "pay.send", amountEur: 20 }).ok, true);
  // but not 21 (its own limit), and the chain still ties back to the principal
  assert.equal(
    verifyGrant(sub, { grantee: subAgent.did, capability: "pay.send", amountEur: 21 }).reason,
    "amount exceeds grant limit",
  );
});

test("a sub-grant cannot widen its parent", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const subAgent = generateIdentity();
  const now = Date.now();

  const root = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 50 } }],
      not_after: now + HOUR,
      delegable: true,
    },
    principal.privateKey,
  );

  // higher limit than parent → rejected at creation
  assert.throws(
    () =>
      createSubGrant(
        root,
        {
          grantee: subAgent.did,
          scope: [{ capability: "pay.send", limit: { max_eur: 80 } }],
          not_after: now + HOUR,
        },
        agent.privateKey,
      ),
    /exceeds parent/,
  );

  // a capability the parent never had → rejected
  assert.throws(
    () =>
      createSubGrant(
        root,
        { grantee: subAgent.did, scope: [{ capability: "admin.delete" }], not_after: now + HOUR },
        agent.privateKey,
      ),
    /exceeds parent/,
  );

  // outliving the parent → rejected (scope itself is valid: equal limit)
  assert.throws(
    () =>
      createSubGrant(
        root,
        {
          grantee: subAgent.did,
          scope: [{ capability: "pay.send", limit: { max_eur: 50 } }],
          not_after: now + 10 * HOUR,
        },
        agent.privateKey,
      ),
    /outlives parent/,
  );
});

test("a non-delegable grant cannot be sub-delegated", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const now = Date.now();
  const root = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 10 } }],
      not_after: now + HOUR,
      delegable: false,
    },
    principal.privateKey,
  );
  assert.throws(
    () =>
      createSubGrant(
        root,
        { grantee: generateIdentity().did, scope: [{ capability: "pay.send" }], not_after: now + HOUR },
        agent.privateKey,
      ),
    /not delegable/,
  );
});

test("a forged widening (tampered after signing) is rejected by chain verification", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const subAgent = generateIdentity();
  const now = Date.now();
  const root = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 10 } }],
      not_after: now + HOUR,
      delegable: true,
    },
    principal.privateKey,
  );
  const sub = createSubGrant(
    root,
    {
      grantee: subAgent.did,
      scope: [{ capability: "pay.send", limit: { max_eur: 10 } }],
      not_after: now + HOUR,
    },
    agent.privateKey,
  );

  // tamper the leaf scope upward AFTER signing → its signature no longer verifies
  const tampered: Grant = { ...sub, scope: [{ capability: "pay.send", limit: { max_eur: 1000 } }] };
  assert.equal(verifyGrant(tampered, { grantee: subAgent.did, capability: "pay.send" }).ok, false);

  // forge a parent swap: claim the root is delegable-wider — sig over parent binds it
  const fakeRoot: Grant = { ...root, scope: [{ capability: "pay.send", limit: { max_eur: 9999 } }] };
  const swapped: Grant = { ...sub, parent: fakeRoot };
  const r = verifyGrant(swapped, { grantee: subAgent.did, capability: "pay.send" });
  assert.equal(r.ok, false); // leaf sig was over the real parent, not the fake one
});

test("delegation depth is bounded", () => {
  const principal = generateIdentity();
  const now = Date.now();
  let current = createGrant(
    {
      issuer: principal.did,
      grantee: principal.did,
      scope: [{ capability: "x.do" }],
      not_after: now + HOUR,
      delegable: true,
    },
    principal.privateKey,
  );
  let holder = principal;

  // build a chain longer than MAX_DELEGATION_DEPTH
  for (let i = 0; i < MAX_DELEGATION_DEPTH + 2; i++) {
    const next = generateIdentity();
    current = createSubGrant(
      current,
      { grantee: next.did, scope: [{ capability: "x.do" }], not_after: now + HOUR, delegable: true },
      holder.privateKey,
    );
    holder = next;
  }

  const r = verifyGrant(current, { grantee: holder.did, capability: "x.do" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "delegation chain too deep");
});
