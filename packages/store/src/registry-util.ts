// Shared derivations used by every RegistryStore driver, so price/region are
// extracted from a Manifest identically regardless of backing store.

import type { Capability, Manifest } from "@aleph/core";

// The numeric price of a capability, from its declared cost.value. Non-numeric
// or absent cost → 0 (free). Keeps filtering arithmetic, not string-parsing.
export function capPrice(cap: Capability): number {
  const v = Number(cap.cost?.value);
  return Number.isFinite(v) ? v : 0;
}

// A node's declared region lives in the open extension bag (manifest.ext.region),
// so region-aware discovery needs no change to the near-frozen Manifest core.
export function manifestRegion(manifest: Manifest): string | undefined {
  const r = manifest.ext?.region;
  return typeof r === "string" ? r : undefined;
}
