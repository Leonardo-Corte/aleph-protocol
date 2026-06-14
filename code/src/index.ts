// Aleph Protocol — public API barrel. Import everything the protocol exposes
// from one place: `import { createNode, generateIdentity } from "aleph"`.

// Core (the thin waist)
export { generateIdentity, publicKeyFromDid, didFromRawPublicKey, type Identity } from "./core/identity.ts";
export {
  createEnvelope,
  verifyEnvelope,
  PROTOCOL_VERSION,
  type Envelope,
  type EnvelopeType,
} from "./core/envelope.ts";
export { createGrant, verifyGrant, type Grant, type GrantScope } from "./core/grant.ts";
export { validateManifest, type Manifest, type Capability } from "./core/manifest.ts";
export { NonceStore, verifyReceived } from "./core/replay.ts";
export { validateSchema, type JsonSchema } from "./core/schema.ts";
export { canonicalize } from "./core/canonical.ts";
export { hashObject } from "./core/hash.ts";
export { err, type AlephError, type AlephErrorCode } from "./core/errors.ts";
export {
  resolveDid,
  registerDidMethod,
  publicKeyFromVerificationMethod,
  type DidResolver,
  type DidDocument,
} from "./core/resolver.ts";
export { Vocabulary, SEED_VOCABULARY, isWellFormedKey, namespaceOf } from "./core/vocabulary.ts";

// Settlement (PAY)
export { SettlementRail, verifySettlement, type SettlementRecord, type Escrow } from "./settle/rail.ts";

// Trust (TRUST + PROVE chains)
export { createAttestation, verifyAttestation, computeTrust, type Attestation } from "./trust/attest.ts";
export { verifyReceiptChain, linkTo, type ChainCheck } from "./trust/chain.ts";

// Roles
export { createNode, type NodeOptions } from "./node/node.ts";
export { createRegistry } from "./registry/registry.ts";

// Agent-facing API (THE target)
export {
  resolve,
  resolveRanked,
  fetchManifest,
  invoke,
  attest,
  fetchReputation,
  type Pointer,
} from "./agent/client.ts";
export { compose, type Step, type Composition } from "./agent/compose.ts";
