// The Grant: bounded delegation. A principal signs a Grant that says
// "this agent may do {capability, limits} until {expiry}". A serving node
// verifies it before acting. This is what makes an agent *safe to permit*:
// not "the agent has my keys" but "the agent may do exactly this much".

import { sign, verify } from "node:crypto";
import { canonicalize } from "./canonical";
import { publicKeyFromDid, type Identity } from "./identity";
import { PROTOCOL_VERSION } from "./envelope";

export type GrantScope = {
  capability: string;
  limit?: Record<string, unknown>;
};

export type Grant = {
  v: string;
  issuer: string;
  grantee: string;
  scope: GrantScope[];
  not_after: number;
  delegable?: boolean;
  sig?: string;
};

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
  grant.sig = sign(null, Buffer.from(canonicalize(grant)), issuerPrivateKey).toString("base64url");
  return grant;
}

// Hard gate (not a hint): verify issuer signature, grantee match, capability
// in scope, amount within limit, and not expired.
export function verifyGrant(
  grant: Grant,
  check: { grantee: string; capability: string; amountEur?: number },
): { ok: boolean; reason?: string } {
  if (!grant.sig) return { ok: false, reason: "missing grant signature" };
  const { sig, ...unsigned } = grant;
  try {
    const pub = publicKeyFromDid(grant.issuer);
    const sigOk = verify(null, Buffer.from(canonicalize(unsigned)), pub, Buffer.from(sig, "base64url"));
    if (!sigOk) return { ok: false, reason: "bad grant signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (grant.grantee !== check.grantee) return { ok: false, reason: "grantee mismatch" };
  if (Date.now() >= grant.not_after) return { ok: false, reason: "grant expired" };
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
