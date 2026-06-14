import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity, publicKeyFromDid } from "@aleph/core";
import { createEnvelope, verifyEnvelope } from "@aleph/core";
import { createGrant, verifyGrant } from "@aleph/core";

test("did:key round-trips to a usable public key", () => {
  const id = generateIdentity();
  assert.ok(id.did.startsWith("did:key:z"));
  assert.ok(publicKeyFromDid(id.did)); // resolves without throwing
});

test("envelope verifies with the correct signer", () => {
  const id = generateIdentity();
  const env = createEnvelope(
    { from: id.did, to: id.did, type: "INVOKE", body: { hello: "world" } },
    id.privateKey,
  );
  assert.equal(verifyEnvelope(env).ok, true);
});

test("envelope fails if the body is tampered after signing", () => {
  const id = generateIdentity();
  const env = createEnvelope(
    { from: id.did, to: id.did, type: "INVOKE", body: { amount: 10 } },
    id.privateKey,
  );
  env.body.amount = 1_000_000; // tamper
  assert.equal(verifyEnvelope(env).ok, false);
});

test("envelope fails if signed by a key other than `from`", () => {
  const alice = generateIdentity();
  const mallory = generateIdentity();
  // Claims to be from alice, but signed with mallory's key.
  const env = createEnvelope(
    { from: alice.did, to: alice.did, type: "INVOKE", body: {} },
    mallory.privateKey,
  );
  assert.equal(verifyEnvelope(env).ok, false);
});

test("grant authorizes an action within scope and limit", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const grant = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "restaurant.booking", limit: { max_eur: 40 } }],
      not_after: Date.now() + 60_000,
    },
    principal.privateKey,
  );
  assert.equal(
    verifyGrant(grant, { grantee: agent.did, capability: "restaurant.booking", amountEur: 32 }).ok,
    true,
  );
});

test("grant rejects over-limit, wrong grantee, wrong capability, and expiry", () => {
  const principal = generateIdentity();
  const agent = generateIdentity();
  const other = generateIdentity();
  const grant = createGrant(
    {
      issuer: principal.did,
      grantee: agent.did,
      scope: [{ capability: "restaurant.booking", limit: { max_eur: 40 } }],
      not_after: Date.now() + 60_000,
    },
    principal.privateKey,
  );
  assert.equal(
    verifyGrant(grant, { grantee: agent.did, capability: "restaurant.booking", amountEur: 100 }).ok,
    false,
  );
  assert.equal(
    verifyGrant(grant, { grantee: other.did, capability: "restaurant.booking", amountEur: 10 }).ok,
    false,
  );
  assert.equal(
    verifyGrant(grant, { grantee: agent.did, capability: "compute.inference", amountEur: 10 }).ok,
    false,
  );
  const expired = createGrant(
    { issuer: principal.did, grantee: agent.did, scope: [{ capability: "x.y" }], not_after: Date.now() - 1 },
    principal.privateKey,
  );
  assert.equal(verifyGrant(expired, { grantee: agent.did, capability: "x.y" }).ok, false);
});
