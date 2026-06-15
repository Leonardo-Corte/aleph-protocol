// SQLite driver, built on Node's built-in `node:sqlite` — zero native
// dependencies, no compilation. Ideal for node operators running on a laptop
// and for embedded/edge deployments. Synchronous under the hood; wrapped to
// satisfy the async store interfaces.

import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Manifest, Attestation, SettlementRecord } from "@aleph/core";
import type {
  RegistryStore,
  NonceStore,
  ReputationStore,
  SettlementStore,
  Stores,
  Pointer,
  AttestationPage,
  ReputationSummary,
} from "./interfaces";
import { REPUTATION_PAGE_SIZE } from "./interfaces";

// node:sqlite is a builtin that exists ONLY under the `node:` prefix (unlike
// `crypto`/`http`), so a bundler that strips the prefix breaks it. Load it at
// runtime via require — the string is a call argument, not an import specifier,
// so it survives bundling intact.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  did           TEXT PRIMARY KEY,
  manifest_url  TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  reputation_url TEXT,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS node_capabilities (
  did        TEXT NOT NULL,
  capability TEXT NOT NULL,
  risk       TEXT,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (did, capability)
);
CREATE INDEX IF NOT EXISTS idx_caps ON node_capabilities (capability, seq DESC);

CREATE TABLE IF NOT EXISTS attestations (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_did   TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  issuer_did    TEXT NOT NULL,
  amount        REAL NOT NULL,
  att_ts        INTEGER NOT NULL,
  attestation   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (subject_did, settlement_id)
);
CREATE INDEX IF NOT EXISTS idx_att_subject ON attestations (subject_did, seq);

CREATE TABLE IF NOT EXISTS seen_nonces (
  from_did TEXT NOT NULL,
  nonce    TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (from_did, nonce)
);
CREATE INDEX IF NOT EXISTS idx_nonce_ts ON seen_nonces (ts);

CREATE TABLE IF NOT EXISTS settlements (
  escrow_id   TEXT PRIMARY KEY,
  record_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

export class SqliteStores implements Stores {
  private db: DatabaseSyncType;
  registry: RegistryStore;
  nonces: NonceStore;
  reputation: ReputationStore;
  settlements: SettlementStore;

  // `path` defaults to in-process memory; pass a file path to persist.
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.registry = new SqliteRegistryStore(this.db);
    this.nonces = new SqliteNonceStore(this.db);
    this.reputation = new SqliteReputationStore(this.db);
    this.settlements = new SqliteSettlementStore(this.db);
  }

  migrate(): Promise<void> {
    this.db.exec(SCHEMA);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

class SqliteRegistryStore implements RegistryStore {
  constructor(private db: DatabaseSyncType) {}

  upsertNode(manifest: Manifest, manifestUrl: string): Promise<boolean> {
    const now = Date.now();
    const existing = this.db.prepare("SELECT did FROM nodes WHERE did = ?").get(manifest.identity);
    const firstSeen = !existing;
    this.db
      .prepare(
        `INSERT INTO nodes (did, manifest_url, manifest_json, reputation_url, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET manifest_url=excluded.manifest_url,
           manifest_json=excluded.manifest_json, reputation_url=excluded.reputation_url, last_seen=excluded.last_seen`,
      )
      .run(manifest.identity, manifestUrl, JSON.stringify(manifest), manifest.reputation ?? null, now, now);
    const ins = this.db.prepare(
      `INSERT INTO node_capabilities (did, capability, risk, seq) VALUES (?, ?, ?, ?)
       ON CONFLICT(did, capability) DO UPDATE SET risk=excluded.risk, seq=excluded.seq`,
    );
    for (const cap of manifest.capabilities) {
      ins.run(manifest.identity, cap.key, cap.risk ?? "low", now);
    }
    return Promise.resolve(firstSeen);
  }

  resolveByCapability(capability: string, limit: number): Promise<Pointer[]> {
    const rows = this.db
      .prepare(
        `SELECT n.did AS did, n.manifest_url AS manifest, n.reputation_url AS reputation, c.risk AS risk, c.capability AS capability
         FROM node_capabilities c JOIN nodes n ON n.did = c.did
         WHERE c.capability = ? ORDER BY c.seq DESC LIMIT ?`,
      )
      .all(capability, limit) as {
      did: string;
      manifest: string;
      reputation: string | null;
      risk: string | null;
      capability: string;
    }[];
    return Promise.resolve(
      rows.map((r) => ({
        did: r.did,
        manifest: r.manifest,
        summary: `${r.capability} · risk:${r.risk ?? "low"}`,
        ...(r.reputation ? { reputation: r.reputation } : {}),
      })),
    );
  }
}

class SqliteNonceStore implements NonceStore {
  constructor(private db: DatabaseSyncType) {}

  checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean> {
    try {
      this.db.prepare("INSERT INTO seen_nonces (from_did, nonce, ts) VALUES (?, ?, ?)").run(from, nonce, ts);
      return Promise.resolve(true);
    } catch {
      // PRIMARY KEY violation → already seen (a replay).
      return Promise.resolve(false);
    }
  }

  gc(beforeTs: number): Promise<number> {
    const res = this.db.prepare("DELETE FROM seen_nonces WHERE ts < ?").run(beforeTs);
    return Promise.resolve(Number(res.changes));
  }
}

class SqliteReputationStore implements ReputationStore {
  constructor(private db: DatabaseSyncType) {}

  addAttestation(att: Attestation): Promise<boolean> {
    try {
      this.db
        .prepare(
          "INSERT INTO attestations (subject_did, settlement_id, issuer_did, amount, att_ts, attestation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          att.subject,
          att.settlement.escrowId,
          att.issued_by,
          att.settlement.amount,
          att.ts,
          JSON.stringify(att),
          Date.now(),
        );
      return Promise.resolve(true);
    } catch {
      // UNIQUE(subject, settlement) violation → one settlement, one attestation.
      return Promise.resolve(false);
    }
  }

  getAttestations(
    subjectDid: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<AttestationPage> {
    const limit = opts.limit ?? REPUTATION_PAGE_SIZE;
    const after = opts.cursor ? Number(opts.cursor) : 0; // cursor = last returned seq
    // keyset pagination on the monotonic seq: stable under concurrent inserts.
    const rows = this.db
      .prepare(
        "SELECT seq, attestation FROM attestations WHERE subject_did = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
      )
      .all(subjectDid, after, limit) as { seq: number; attestation: string }[];
    const attestations = rows.map((r) => JSON.parse(r.attestation) as Attestation);
    const last = rows[rows.length - 1];
    return Promise.resolve({
      attestations,
      nextCursor: rows.length === limit && last ? String(last.seq) : undefined,
    });
  }

  summary(subjectDid: string): Promise<ReputationSummary> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COUNT(DISTINCT issuer_did) AS issuers,
                COALESCE(SUM(amount), 0) AS total, MIN(att_ts) AS oldest, MAX(att_ts) AS newest
         FROM attestations WHERE subject_did = ?`,
      )
      .get(subjectDid) as {
      count: number;
      issuers: number;
      total: number;
      oldest: number | null;
      newest: number | null;
    };
    return Promise.resolve({
      subject: subjectDid,
      count: row.count,
      distinctIssuers: row.issuers,
      totalSettledValue: row.total,
      oldestTs: row.oldest ?? undefined,
      newestTs: row.newest ?? undefined,
    });
  }
}

class SqliteSettlementStore implements SettlementStore {
  constructor(private db: DatabaseSyncType) {}

  record(rec: SettlementRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO settlements (escrow_id, record_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(escrow_id) DO UPDATE SET record_json=excluded.record_json, updated_at=excluded.updated_at`,
      )
      .run(rec.escrowId, JSON.stringify(rec), Date.now());
    return Promise.resolve();
  }

  get(escrowId: string): Promise<SettlementRecord | undefined> {
    const row = this.db.prepare("SELECT record_json FROM settlements WHERE escrow_id = ?").get(escrowId) as
      | { record_json: string }
      | undefined;
    return Promise.resolve(row ? (JSON.parse(row.record_json) as SettlementRecord) : undefined);
  }
}
