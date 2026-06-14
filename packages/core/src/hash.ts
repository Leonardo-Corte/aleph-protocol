// Content hashing over the canonical form of an object. Used to reference an
// INVOKE from its RECEIPT, and to chain receipts into a provenance trail.

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical";

export function hashObject(obj: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalize(obj)).digest("hex");
}
