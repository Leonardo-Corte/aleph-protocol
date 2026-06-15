// Async repository interfaces — the seam between protocol logic and storage.
// Every method is async so one interface serves in-memory (dev/tests), SQLite
// (node operators, embedded), and Postgres (the deployed registry) alike.
//
// Protocol code depends ONLY on these interfaces, never on a concrete database.

import type { Manifest, Attestation, SettlementRecord } from "@aleph/core";

// A reputation snapshot the registry keeps as a COARSE discovery hint. It is
// not authoritative (the agent still computes trust from the raw attestations);
// it just lets the registry pre-filter and the agent rank without N round-trips.
export interface RepHint {
  count: number;
  distinctIssuers: number;
  totalSettledValue: number;
}

// A discovery pointer returned by RESOLVE — never a full manifest (two-stage).
export interface Pointer {
  did: string;
  manifest: string;
  summary: string;
  reputation?: string;
  price?: number; // price of the MATCHED capability (numeric, from cost.value)
  region?: string; // node region (manifest.ext.region), if declared
  rep?: RepHint; // reputation hint snapshot, if known
}

// Selectivity pushed to the registry so the agent pulls fewer candidates.
export interface ResolveFilter {
  limit?: number;
  cursor?: string; // opaque keyset cursor (newest-first)
  maxPrice?: number; // exclude capabilities priced above this
  region?: string; // require this node region
  minIssuers?: number; // require ≥ this many distinct reputation issuers (hint)
  minSettled?: number; // require ≥ this much total settled value (hint)
}

export interface ResolvePage {
  results: Pointer[];
  nextCursor?: string;
}

// A registration as replayed over the anti-entropy feed (see changesSince).
export interface RegistrationDelta {
  rev: number; // monotonic revision assigned on each upsert
  manifest: Manifest;
  manifestUrl: string;
}

// --- Discovery (the registry) ---
export interface RegistryStore {
  // Index a node's manifest. Returns true if this is a first-seen node (so the
  // registry knows whether to gossip it onward). An optional reputation snapshot
  // is stored as a coarse discovery hint.
  upsertNode(manifest: Manifest, manifestUrl: string, rep?: RepHint): Promise<boolean>;
  // Find providers of a capability with optional filtering + keyset pagination.
  resolveByCapability(capability: string, filter?: ResolveFilter): Promise<ResolvePage>;
  // Anti-entropy: registrations with rev greater than `afterRev`, oldest-first,
  // so an offline peer can catch up by pulling deltas.
  changesSince(afterRev: number, limit: number): Promise<RegistrationDelta[]>;
}

// Default discovery page size (cap so one RESOLVE can't return an unbounded set).
export const RESOLVE_PAGE_SIZE = 50;

// --- Replay protection (nonces) ---
// Named NonceChecker to match the core interface that verifyReceived consumes.
export interface NonceStore {
  // Record (from, nonce); return false if it was already seen (a replay).
  checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean>;
  // Drop nonces older than `beforeTs` (windowed GC; keeps the table bounded).
  gc(beforeTs: number): Promise<number>;
}

// Default reputation page size (capped per request so a node can't be made to
// serialize an unbounded set in one response).
export const REPUTATION_PAGE_SIZE = 100;

// --- Reputation (attestations) ---

// One page of a subject's raw attestations. `nextCursor` is an opaque token;
// pass it back as `cursor` to fetch the following page. Absent => last page.
export interface AttestationPage {
  attestations: Attestation[];
  nextCursor?: string;
}

// An aggregate view of a subject's reputation, computed at the DB, so an agent
// can rank candidates without downloading every raw attestation. The raw set
// stays available (getAttestations) for full, independent verification.
export interface ReputationSummary {
  subject: string;
  count: number; // total attestations
  distinctIssuers: number; // distinct attesting DIDs (the diversity signal)
  totalSettledValue: number; // Σ settled value backing them
  oldestTs?: number; // earliest attestation ts (undefined if none)
  newestTs?: number; // latest attestation ts
}

export interface ReputationStore {
  // Store an attestation about a subject. Idempotent on (subject, settlement):
  // returns false if that settlement already backs a stored attestation
  // (the anti-Sybil "one settlement, one attestation" rule, enforced at the DB).
  addAttestation(att: Attestation): Promise<boolean>;
  // A page of the raw attestation set for a subject, oldest-first, stably
  // ordered (keyset pagination). Default limit is the driver's page size.
  getAttestations(subjectDid: string, opts?: { limit?: number; cursor?: string }): Promise<AttestationPage>;
  // The aggregate summary (cheap to fetch, derived from indexed columns).
  summary(subjectDid: string): Promise<ReputationSummary>;
}

// --- Settlement history (durable record, forward-compatible with the on-chain rail) ---
export interface SettlementStore {
  record(rec: SettlementRecord): Promise<void>;
  get(escrowId: string): Promise<SettlementRecord | undefined>;
}

// The full set of stores a deployment uses, plus lifecycle.
export interface Stores {
  registry: RegistryStore;
  nonces: NonceStore;
  reputation: ReputationStore;
  settlements: SettlementStore;
  // Run migrations / ensure schema (no-op for in-memory).
  migrate(): Promise<void>;
  // Release resources (close DB connections).
  close(): Promise<void>;
}
