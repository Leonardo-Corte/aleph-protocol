// Postgres driver (postgres.js) — for the deployed registry and any node that
// wants a real, concurrent, networked database. `postgres` is an optional
// dependency, loaded lazily, so memory/SQLite work without it installed.
//
// Construct via `await PostgresStores.connect(url)`.

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

// Minimal structural type for the postgres.js tagged-template client we use.
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  unsafe(query: string): Promise<Row[]>;
  json(value: unknown): unknown; // wraps a JS value for a JSONB column
  end(): Promise<void>;
};
type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  did            TEXT PRIMARY KEY,
  manifest_url   TEXT NOT NULL,
  manifest_json  JSONB NOT NULL,
  reputation_url TEXT,
  region         TEXT,
  rep_count      INTEGER NOT NULL DEFAULT 0,
  rep_issuers    INTEGER NOT NULL DEFAULT 0,
  rep_settled    DOUBLE PRECISION NOT NULL DEFAULT 0,
  rev            BIGINT NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nodes_rev ON nodes (rev);
CREATE SEQUENCE IF NOT EXISTS registry_rev_seq;
CREATE TABLE IF NOT EXISTS node_capabilities (
  did        TEXT NOT NULL REFERENCES nodes(did) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  risk       TEXT,
  price      DOUBLE PRECISION NOT NULL DEFAULT 0,
  seq        BIGINT NOT NULL,
  PRIMARY KEY (did, capability)
);
CREATE INDEX IF NOT EXISTS idx_caps ON node_capabilities (capability, seq DESC);

CREATE TABLE IF NOT EXISTS attestations (
  seq           BIGSERIAL,
  subject_did   TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  issuer_did    TEXT NOT NULL,
  amount        DOUBLE PRECISION NOT NULL,
  att_ts        BIGINT NOT NULL,
  attestation   JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_did, settlement_id)
);
CREATE INDEX IF NOT EXISTS idx_att_subject ON attestations (subject_did, seq);

CREATE TABLE IF NOT EXISTS seen_nonces (
  from_did TEXT NOT NULL,
  nonce    TEXT NOT NULL,
  ts       BIGINT NOT NULL,
  PRIMARY KEY (from_did, nonce)
);
CREATE INDEX IF NOT EXISTS idx_nonce_ts ON seen_nonces (ts);

CREATE TABLE IF NOT EXISTS settlements (
  escrow_id   TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export class PostgresStores implements Stores {
  registry: RegistryStore;
  nonces: NonceStore;
  reputation: ReputationStore;
  settlements: SettlementStore;

  private constructor(private sql: Sql) {
    this.registry = new PgRegistryStore(sql);
    this.nonces = new PgNonceStore(sql);
    this.reputation = new PgReputationStore(sql);
    this.settlements = new PgSettlementStore(sql);
  }

  static async connect(url: string): Promise<PostgresStores> {
    const mod = (await import("postgres")) as unknown as { default: (url: string) => Sql };
    return new PostgresStores(mod.default(url));
  }

  async migrate(): Promise<void> {
    await this.sql.unsafe(SCHEMA);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

class PgRegistryStore implements RegistryStore {
  constructor(private sql: Sql) {}

  async upsertNode(manifest: Manifest, manifestUrl: string, rep?: RepHint): Promise<boolean> {
    // Monotonic, concurrency-safe feed revision from a sequence — used both as
    // capability seq and as the anti-entropy /since cursor. Every upsert (insert
    // OR update) advances it, so peers receive updates too, not just inserts.
    const [revRow] = await this.sql`SELECT nextval('registry_rev_seq')::bigint AS rev`;
    const rev = Number(revRow?.rev ?? 0);
    // Determine first-seen ATOMICALLY from the insert itself — never via a prior
    // SELECT, which races under real concurrency (parallel callers all read
    // "not exists" before any commits). `xmax = 0` is true only for a freshly
    // inserted row, false for the ON CONFLICT update path — so exactly one of N
    // concurrent upserts reports first-seen.
    const rows = await this.sql`
      INSERT INTO nodes (did, manifest_url, manifest_json, reputation_url, region, rep_count, rep_issuers, rep_settled, rev)
      VALUES (${manifest.identity}, ${manifestUrl}, ${this.sql.json(manifest)}, ${manifest.reputation ?? null},
              ${manifestRegion(manifest) ?? null}, ${rep?.count ?? 0}, ${rep?.distinctIssuers ?? 0}, ${rep?.totalSettledValue ?? 0}, ${rev})
      ON CONFLICT (did) DO UPDATE SET manifest_url = EXCLUDED.manifest_url,
        manifest_json = EXCLUDED.manifest_json, reputation_url = EXCLUDED.reputation_url,
        region = EXCLUDED.region,
        rep_count = CASE WHEN ${rep ? true : false} THEN EXCLUDED.rep_count ELSE nodes.rep_count END,
        rep_issuers = CASE WHEN ${rep ? true : false} THEN EXCLUDED.rep_issuers ELSE nodes.rep_issuers END,
        rep_settled = CASE WHEN ${rep ? true : false} THEN EXCLUDED.rep_settled ELSE nodes.rep_settled END,
        rev = EXCLUDED.rev, last_seen = now()
      RETURNING (xmax = 0) AS inserted`;
    const firstSeen = rows[0]?.inserted === true;
    for (const cap of manifest.capabilities) {
      await this.sql`
        INSERT INTO node_capabilities (did, capability, risk, price, seq)
        VALUES (${manifest.identity}, ${cap.key}, ${cap.risk ?? "low"}, ${capPrice(cap)}, ${rev})
        ON CONFLICT (did, capability) DO UPDATE SET risk = EXCLUDED.risk, price = EXCLUDED.price, seq = EXCLUDED.seq`;
    }
    return firstSeen;
  }
  // (the SELECT-then-insert race above was caught by the Postgres concurrency
  // test in CI — exactly the kind of bug serialized in-memory/SQLite hide.)

  async resolveByCapability(capability: string, filter: ResolveFilter = {}): Promise<ResolvePage> {
    const limit = filter.limit ?? RESOLVE_PAGE_SIZE;
    const before = filter.cursor ? Number(filter.cursor) : Number.MAX_SAFE_INTEGER;
    const maxPrice = filter.maxPrice ?? null;
    const region = filter.region ?? null;
    const minIssuers = filter.minIssuers ?? null;
    const minSettled = filter.minSettled ?? null;
    // Optional filters expressed as "param IS NULL OR <predicate>" so the query
    // stays a single prepared statement (no string concatenation).
    const rows = await this.sql`
      SELECT n.did AS did, n.manifest_url AS manifest, n.reputation_url AS reputation, n.region AS region,
             n.rep_count AS rep_count, n.rep_issuers AS rep_issuers, n.rep_settled AS rep_settled, n.rev AS rev,
             c.risk AS risk, c.price AS price, c.capability AS capability
      FROM node_capabilities c JOIN nodes n ON n.did = c.did
      WHERE c.capability = ${capability} AND n.rev < ${before}
        AND (${maxPrice}::float8 IS NULL OR c.price <= ${maxPrice})
        AND (${region}::text IS NULL OR n.region = ${region})
        AND (${minIssuers}::int IS NULL OR n.rep_issuers >= ${minIssuers})
        AND (${minSettled}::float8 IS NULL OR n.rep_settled >= ${minSettled})
      ORDER BY n.rev DESC LIMIT ${limit + 1}`;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      results: page.map((r) => toPointer(r)),
      nextCursor: hasMore && last ? String(last.rev) : undefined,
    };
  }

  async changesSince(afterRev: number, limit: number): Promise<RegistrationDelta[]> {
    const rows = await this.sql`
      SELECT manifest_json, manifest_url, rev FROM nodes
      WHERE rev > ${afterRev} ORDER BY rev ASC LIMIT ${limit}`;
    return rows.map((r) => ({
      rev: Number(r.rev),
      manifest: r.manifest_json as Manifest,
      manifestUrl: r.manifest_url as string,
    }));
  }
}

function toPointer(r: Row): Pointer {
  const repCount = Number(r.rep_count ?? 0);
  return {
    did: r.did as string,
    manifest: r.manifest as string,
    summary: `${r.capability as string} · risk:${(r.risk as string | null) ?? "low"}`,
    price: Number(r.price ?? 0),
    ...(r.reputation ? { reputation: r.reputation as string } : {}),
    ...(r.region ? { region: r.region as string } : {}),
    ...(repCount > 0
      ? {
          rep: {
            count: repCount,
            distinctIssuers: Number(r.rep_issuers ?? 0),
            totalSettledValue: Number(r.rep_settled ?? 0),
          },
        }
      : {}),
  };
}

class PgNonceStore implements NonceStore {
  constructor(private sql: Sql) {}

  async checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean> {
    const res = await this.sql`
      INSERT INTO seen_nonces (from_did, nonce, ts) VALUES (${from}, ${nonce}, ${ts})
      ON CONFLICT (from_did, nonce) DO NOTHING RETURNING 1`;
    return res.length > 0;
  }

  async gc(beforeTs: number): Promise<number> {
    const res = await this.sql`DELETE FROM seen_nonces WHERE ts < ${beforeTs} RETURNING 1`;
    return res.length;
  }
}

class PgReputationStore implements ReputationStore {
  constructor(private sql: Sql) {}

  async addAttestation(att: Attestation): Promise<boolean> {
    const res = await this.sql`
      INSERT INTO attestations (subject_did, settlement_id, issuer_did, amount, att_ts, attestation)
      VALUES (${att.subject}, ${att.settlement.escrowId}, ${att.issued_by}, ${att.settlement.amount}, ${att.ts}, ${this.sql.json(att)})
      ON CONFLICT (subject_did, settlement_id) DO NOTHING RETURNING 1`;
    return res.length > 0;
  }

  async getAttestations(
    subjectDid: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<AttestationPage> {
    const limit = opts.limit ?? REPUTATION_PAGE_SIZE;
    const after = opts.cursor ? Number(opts.cursor) : 0; // cursor = last returned seq
    // keyset pagination on the monotonic seq — race-free under concurrent inserts.
    const rows = await this.sql`
      SELECT seq, attestation FROM attestations
      WHERE subject_did = ${subjectDid} AND seq > ${after}
      ORDER BY seq ASC LIMIT ${limit}`;
    const attestations = rows.map((r) => r.attestation as Attestation);
    const last = rows[rows.length - 1];
    return {
      attestations,
      nextCursor: rows.length === limit && last ? String(last.seq) : undefined,
    };
  }

  async summary(subjectDid: string): Promise<ReputationSummary> {
    const [row] = await this.sql`
      SELECT COUNT(*)::int AS count, COUNT(DISTINCT issuer_did)::int AS issuers,
             COALESCE(SUM(amount), 0)::float8 AS total,
             MIN(att_ts) AS oldest, MAX(att_ts) AS newest
      FROM attestations WHERE subject_did = ${subjectDid}`;
    return {
      subject: subjectDid,
      count: Number(row?.count ?? 0),
      distinctIssuers: Number(row?.issuers ?? 0),
      totalSettledValue: Number(row?.total ?? 0),
      oldestTs: row?.oldest != null ? Number(row.oldest) : undefined,
      newestTs: row?.newest != null ? Number(row.newest) : undefined,
    };
  }
}

class PgSettlementStore implements SettlementStore {
  constructor(private sql: Sql) {}

  async record(rec: SettlementRecord): Promise<void> {
    await this.sql`
      INSERT INTO settlements (escrow_id, record_json)
      VALUES (${rec.escrowId}, ${this.sql.json(rec)})
      ON CONFLICT (escrow_id) DO UPDATE SET record_json = EXCLUDED.record_json, updated_at = now()`;
  }

  async get(escrowId: string): Promise<SettlementRecord | undefined> {
    const rows = await this.sql`SELECT record_json FROM settlements WHERE escrow_id = ${escrowId}`;
    return rows[0] ? (rows[0].record_json as SettlementRecord) : undefined;
  }
}
