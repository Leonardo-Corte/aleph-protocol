// Async repository interfaces — the seam between protocol logic and storage.
// Every method is async so one interface serves in-memory (dev/tests), SQLite
// (node operators, embedded), and Postgres (the deployed registry) alike.
//
// Protocol code depends ONLY on these interfaces, never on a concrete database.

import type { Manifest, Attestation, SettlementRecord } from "@aleph/core";

// A discovery pointer returned by RESOLVE — never a full manifest (two-stage).
export interface Pointer {
  did: string;
  manifest: string;
  summary: string;
  reputation?: string;
}

// --- Discovery (the registry) ---
export interface RegistryStore {
  // Index a node's manifest. Returns true if this is a first-seen node
  // (so the registry knows whether to gossip it onward).
  upsertNode(manifest: Manifest, manifestUrl: string): Promise<boolean>;
  // Find providers of a capability, newest-first, capped at `limit`.
  resolveByCapability(capability: string, limit: number): Promise<Pointer[]>;
}

// --- Replay protection (nonces) ---
// Named NonceChecker to match the core interface that verifyReceived consumes.
export interface NonceStore {
  // Record (from, nonce); return false if it was already seen (a replay).
  checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean>;
  // Drop nonces older than `beforeTs` (windowed GC; keeps the table bounded).
  gc(beforeTs: number): Promise<number>;
}

// --- Reputation (attestations) ---
export interface ReputationStore {
  // Store an attestation about a subject. Idempotent on (subject, settlement):
  // returns false if that settlement already backs a stored attestation
  // (the anti-Sybil "one settlement, one attestation" rule, enforced at the DB).
  addAttestation(att: Attestation): Promise<boolean>;
  // The raw attestation set for a subject (the consumer computes its own trust).
  getAttestations(subjectDid: string): Promise<Attestation[]>;
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
