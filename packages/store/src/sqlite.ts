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
  RepHint,
  ResolveFilter,
  ResolvePage,
  RegistrationDelta,
} from "./interfaces";
import { REPUTATION_PAGE_SIZE, RESOLVE_PAGE_SIZE } from "./interfaces";
import { capPrice, manifestRegion } from "./registry-util";

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
  region        TEXT,
  rep_count     INTEGER NOT NULL DEFAULT 0,
  rep_issuers   INTEGER NOT NULL DEFAULT 0,
  rep_settled   REAL NOT NULL DEFAULT 0,
  rev           INTEGER NOT NULL,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_rev ON nodes (rev);
CREATE TABLE IF NOT EXISTS node_capabilities (
  did        TEXT NOT NULL,
  capability TEXT NOT NULL,
  risk       TEXT,
  price      REAL NOT NULL DEFAULT 0,
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

  upsertNode(manifest: Manifest, manifestUrl: string, rep?: RepHint): Promise<boolean> {
    const now = Date.now();
    const existing = this.db.prepare("SELECT did FROM nodes WHERE did = ?").get(manifest.identity);
    const firstSeen = !existing;
    // Monotonic feed revision: every upsert (insert OR update) gets a fresh,
    // higher rev so peers pulling /since also receive updates, not just inserts.
    const rev = (this.db.prepare("SELECT COALESCE(MAX(rev),0) AS m FROM nodes").get() as { m: number }).m + 1;
    // A fresh hint overrides; otherwise keep the previously-stored snapshot.
    const hasRep = rep ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO nodes (did, manifest_url, manifest_json, reputation_url, region, rep_count, rep_issuers, rep_settled, rev, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET manifest_url=excluded.manifest_url,
           manifest_json=excluded.manifest_json, reputation_url=excluded.reputation_url,
           region=excluded.region,
           rep_count=CASE WHEN ?=1 THEN excluded.rep_count ELSE nodes.rep_count END,
           rep_issuers=CASE WHEN ?=1 THEN excluded.rep_issuers ELSE nodes.rep_issuers END,
           rep_settled=CASE WHEN ?=1 THEN excluded.rep_settled ELSE nodes.rep_settled END,
           rev=excluded.rev, last_seen=excluded.last_seen`,
      )
      .run(
        manifest.identity,
        manifestUrl,
        JSON.stringify(manifest),
        manifest.reputation ?? null,
        manifestRegion(manifest) ?? null,
        rep ? rep.count : 0,
        rep ? rep.distinctIssuers : 0,
        rep ? rep.totalSettledValue : 0,
        rev,
        now,
        now,
        hasRep,
        hasRep,
        hasRep,
      );
    const ins = this.db.prepare(
      `INSERT INTO node_capabilities (did, capability, risk, price, seq) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(did, capability) DO UPDATE SET risk=excluded.risk, price=excluded.price, seq=excluded.seq`,
    );
    for (const cap of manifest.capabilities) {
      ins.run(manifest.identity, cap.key, cap.risk ?? "low", capPrice(cap), rev);
    }
    return Promise.resolve(firstSeen);
  }

  resolveByCapability(capability: string, filter: ResolveFilter = {}): Promise<ResolvePage> {
    const limit = filter.limit ?? RESOLVE_PAGE_SIZE;
    const before = filter.cursor ? Number(filter.cursor) : Number.MAX_SAFE_INTEGER;
    const clauses = ["c.capability = ?", "n.rev < ?"];
    const args: (string | number)[] = [capability, before];
    if (filter.maxPrice !== undefined) {
      clauses.push("c.price <= ?");
      args.push(filter.maxPrice);
    }
    if (filter.region !== undefined) {
      clauses.push("n.region = ?");
      args.push(filter.region);
    }
    if (filter.minIssuers !== undefined) {
      clauses.push("n.rep_issuers >= ?");
      args.push(filter.minIssuers);
    }
    if (filter.minSettled !== undefined) {
      clauses.push("n.rep_settled >= ?");
      args.push(filter.minSettled);
    }
    args.push(limit + 1); // fetch one extra to know whether another page exists
    const rows = this.db
      .prepare(
        `SELECT n.did AS did, n.manifest_url AS manifest, n.reputation_url AS reputation, n.region AS region,
                n.rep_count AS rep_count, n.rep_issuers AS rep_issuers, n.rep_settled AS rep_settled, n.rev AS rev,
                c.risk AS risk, c.price AS price, c.capability AS capability
         FROM node_capabilities c JOIN nodes n ON n.did = c.did
         WHERE ${clauses.join(" AND ")} ORDER BY n.rev DESC LIMIT ?`,
      )
      .all(...args) as unknown as RegistryRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return Promise.resolve({
      results: page.map(toPointer),
      nextCursor: hasMore && last ? String(last.rev) : undefined,
    });
  }

  changesSince(afterRev: number, limit: number): Promise<RegistrationDelta[]> {
    const rows = this.db
      .prepare("SELECT manifest_json, manifest_url, rev FROM nodes WHERE rev > ? ORDER BY rev ASC LIMIT ?")
      .all(afterRev, limit) as { manifest_json: string; manifest_url: string; rev: number }[];
    return Promise.resolve(
      rows.map((r) => ({
        rev: r.rev,
        manifest: JSON.parse(r.manifest_json) as Manifest,
        manifestUrl: r.manifest_url,
      })),
    );
  }
}

interface RegistryRow {
  did: string;
  manifest: string;
  reputation: string | null;
  region: string | null;
  rep_count: number;
  rep_issuers: number;
  rep_settled: number;
  rev: number;
  risk: string | null;
  price: number;
  capability: string;
}

function toPointer(r: RegistryRow): Pointer {
  return {
    did: r.did,
    manifest: r.manifest,
    summary: `${r.capability} · risk:${r.risk ?? "low"}`,
    price: r.price,
    ...(r.reputation ? { reputation: r.reputation } : {}),
    ...(r.region ? { region: r.region } : {}),
    ...(r.rep_count > 0
      ? {
          rep: {
            count: r.rep_count,
            distinctIssuers: r.rep_issuers,
            totalSettledValue: r.rep_settled,
          },
        }
      : {}),
  };
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
