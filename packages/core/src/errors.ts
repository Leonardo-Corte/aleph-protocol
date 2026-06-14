// Canonical error model. Failure must be reported cleanly and typed, never as
// garbled success. These codes are stable identifiers an agent can branch on.

export type AlephErrorCode =
  | "ENVELOPE_INVALID" // signature/format bad
  | "VERSION_UNSUPPORTED" // unknown major protocol version
  | "CLOCK_SKEW" // timestamp outside the acceptable window
  | "REPLAY" // nonce already seen
  | "WRONG_TYPE" // wrong Envelope type for this endpoint
  | "UNKNOWN_CAPABILITY" // node does not offer this capability
  | "SCHEMA_INVALID" // input/output failed schema validation
  | "GRANT_REQUIRED" // capability needs a Grant, none provided
  | "GRANT_INVALID" // Grant failed verification (sig/scope/limit/expiry)
  | "PAYMENT_REQUIRED" // priced capability invoked without payment
  | "INSUFFICIENT_FUNDS" // escrow could not be locked
  | "SETTLE_INVALID" // settlement reference invalid
  | "ATTEST_INVALID" // attestation not backed by a settlement
  | "INTERNAL"; // unexpected server error

export interface AlephError {
  code: AlephErrorCode;
  message: string;
}

export function err(code: AlephErrorCode, message: string): AlephError {
  return { code, message };
}
