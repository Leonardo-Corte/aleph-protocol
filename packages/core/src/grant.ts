// The Grant: bounded delegation. A principal signs a Grant that says
// "this agent may do {capability, limits} until {expiry}". A serving node
// verifies it before acting. This is what makes an agent *safe to permit*:
// not "the agent has my keys" but "the agent may do exactly this much".
//
// Sub-delegation: a `delegable` grant can be NARROWED into a sub-grant (an agent
// hiring a sub-agent). A sub-grant can only ever be ⊆ its parent — never wider,
// never longer-lived, never deeper than MAX_DELEGATION_DEPTH. The whole chain is
// carried inline and re-verified back to the root principal, so authority can
// be traced to a single signature no one can forge.

import { PROTOCOL_VERSION } from "./envelope";
import { type Identity } from "./identity";
import { DOMAIN, signEd25519, verifyByDid } from "./signing";

// A root principal grant is depth 0; each sub-grant adds one. Bounds the chain
// an attacker (or a bug) could otherwise grow without limit.
export const MAX_DELEGATION_DEPTH = 4;

export interface GrantScope {
  capability: string;
  limit?: Record<string, unknown>;
}

export interface Grant {
  v: string;
  issuer: string;
  grantee: string;
  scope: GrantScope[];
  not_after: number;
  delegable?: boolean;
  parent?: Grant; // the grant this was delegated from; absent on a root grant
  sig?: string;
}

export function createGrant(
  params: { issuer: string; grantee: string; scope: GrantScope[]; not_after: number; delegable?: boolean },
  issuerPrivateKey: Identity["privateKey"],
): Grant {
  const grant: Grant = {
    v: PROTOCOL_VERSION,
    issuer: params.issuer,
    grantee: params.grantee,
    scope: params.scope,
    not_after: params.not_after,
    delegable: params.delegable ?? false,
  };
  grant.sig = signEd25519(DOMAIN.grant, grant, issuerPrivateKey);
  return grant;
}

// Narrow a delegable grant into a sub-grant. The signer MUST be the parent's
// grantee (the agent re-delegating). Eagerly rejects any widening so a malformed
// sub-grant can never be created, not merely caught at verify time.
export function createSubGrant(
  parent: Grant,
  params: { grantee: string; scope: GrantScope[]; not_after: number; delegable?: boolean },
  signerPrivateKey: Identity["privateKey"],
): Grant {
  if (!parent.delegable) throw new Error("parent grant is not delegable");
  const within = scopeWithin(params.scope, parent.scope);
  if (!within.ok) throw new Error("sub-grant exceeds parent scope: " + within.reason);
  if (params.not_after > parent.not_after) throw new Error("sub-grant outlives parent");
  const grant: Grant = {
    v: PROTOCOL_VERSION,
    issuer: parent.grantee, // the delegator is the party the parent was granted to
    grantee: params.grantee,
    scope: params.scope,
    not_after: params.not_after,
    delegable: params.delegable ?? false,
    parent,
  };
  grant.sig = signEd25519(DOMAIN.grant, grant, signerPrivateKey);
  return grant;
}

// Every scope entry in `child` must be authorized by a matching entry in
// `parent`, with a limit no greater than the parent's. A parent limit the child
// omits is treated as unbounded → rejected (a sub-grant cannot widen a cap).
function scopeWithin(child: GrantScope[], parent: GrantScope[]): { ok: boolean; reason?: string } {
  for (const cs of child) {
    const ps = parent.find((p) => p.capability === cs.capability);
    if (!ps) return { ok: false, reason: `capability ${cs.capability} not in parent scope` };
    const parentMax = ps.limit?.max_eur as number | undefined;
    if (parentMax !== undefined) {
      const childMax = cs.limit?.max_eur as number | undefined;
      if (childMax === undefined || childMax > parentMax) {
        return { ok: false, reason: `max_eur for ${cs.capability} exceeds parent` };
      }
    }
  }
  return { ok: true };
}

// Verify one grant's own integrity (signature + not-expired) and, if it is a
// sub-grant, that it is a valid narrowing of its parent — recursively to the
// root. Bounded by MAX_DELEGATION_DEPTH.
function verifyChain(grant: Grant, depth: number): { ok: boolean; reason?: string } {
  if (depth > MAX_DELEGATION_DEPTH) return { ok: false, reason: "delegation chain too deep" };
  if (!grant.sig) return { ok: false, reason: "missing grant signature" };
  const { sig, ...unsigned } = grant;
  try {
    if (!verifyByDid(grant.issuer, DOMAIN.grant, unsigned, sig)) {
      return { ok: false, reason: "bad grant signature" };
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (Date.now() >= grant.not_after) return { ok: false, reason: "grant expired" };

  const parent = grant.parent;
  if (!parent) return { ok: true }; // reached the root principal grant
  if (!parent.delegable) return { ok: false, reason: "parent grant is not delegable" };
  if (grant.issuer !== parent.grantee) {
    return { ok: false, reason: "broken delegation chain: issuer is not the parent's grantee" };
  }
  const within = scopeWithin(grant.scope, parent.scope);
  if (!within.ok) return { ok: false, reason: "sub-grant exceeds parent scope: " + within.reason };
  if (grant.not_after > parent.not_after) return { ok: false, reason: "sub-grant outlives parent" };
  return verifyChain(parent, depth + 1);
}

// Hard gate (not a hint): verify the full delegation chain, then the LEAF's
// authorization for this exact call — grantee match, capability in scope, amount
// within the limit. amountEur is the real payment the node will settle, so the
// capability-scoped payment limit is enforced jointly with the escrow.
export function verifyGrant(
  grant: Grant,
  check: { grantee: string; capability: string; amountEur?: number },
): { ok: boolean; reason?: string } {
  const chain = verifyChain(grant, 0);
  if (!chain.ok) return chain;
  if (grant.grantee !== check.grantee) return { ok: false, reason: "grantee mismatch" };
  const scope = grant.scope.find((s) => s.capability === check.capability);
  if (!scope) return { ok: false, reason: "capability not in grant scope" };
  if (check.amountEur !== undefined) {
    const max = scope.limit?.max_eur as number | undefined;
    if (max !== undefined && check.amountEur > max) {
      return { ok: false, reason: "amount exceeds grant limit" };
    }
  }
  return { ok: true };
}
