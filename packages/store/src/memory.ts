// In-memory implementations — the default for development and the fast path for
// tests. Same async interface as the persistent drivers, so it is a faithful
// stand-in (it just forgets everything on exit).

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

interface NodeRec {
  did: string;
  manifestUrl: string;
  manifest: Manifest;
  reputation?: string;
  region?: string;
  rep?: RepHint;
  rev: number;
  caps: Map<string, { risk: string; price: number }>;
}

export class InMemoryRegistryStore implements RegistryStore {
  private nodes = new Map<string, NodeRec>();
  private revCounter = 0;

  upsertNode(manifest: Manifest, manifestUrl: string, rep?: RepHint): Promise<boolean> {
    const firstSeen = !this.nodes.has(manifest.identity);
    const caps = new Map<string, { risk: string; price: number }>();
    for (const cap of manifest.capabilities) {
      caps.set(cap.key, { risk: cap.risk ?? "low", price: capPrice(cap) });
    }
    this.nodes.set(manifest.identity, {
      did: manifest.identity,
      manifestUrl,
      manifest,
      reputation: manifest.reputation,
      region: manifestRegion(manifest),
      // keep a prior hint if this upsert didn't carry a fresh one
      rep: rep ?? this.nodes.get(manifest.identity)?.rep,
      rev: ++this.revCounter, // every upsert advances the feed (updates propagate too)
      caps,
    });
    return Promise.resolve(firstSeen);
  }

  resolveByCapability(capability: string, filter: ResolveFilter = {}): Promise<ResolvePage> {
    const limit = filter.limit ?? RESOLVE_PAGE_SIZE;
    const before = filter.cursor ? Number(filter.cursor) : Infinity; // keyset on rev DESC
    const matches = [...this.nodes.values()]
      .filter((n) => n.caps.has(capability) && n.rev < before)
      .filter((n) => {
        const cap = n.caps.get(capability)!;
        if (filter.maxPrice !== undefined && cap.price > filter.maxPrice) return false;
        if (filter.region !== undefined && n.region !== filter.region) return false;
        if (filter.minIssuers !== undefined && (n.rep?.distinctIssuers ?? 0) < filter.minIssuers)
          return false;
        if (filter.minSettled !== undefined && (n.rep?.totalSettledValue ?? 0) < filter.minSettled)
          return false;
        return true;
      })
      .sort((a, b) => b.rev - a.rev); // newest-first
    const page = matches.slice(0, limit);
    const last = page[page.length - 1];
    return Promise.resolve({
      results: page.map((n) => this.toPointer(n, capability)),
      nextCursor: matches.length > limit && last ? String(last.rev) : undefined,
    });
  }

  changesSince(afterRev: number, limit: number): Promise<RegistrationDelta[]> {
    const deltas = [...this.nodes.values()]
      .filter((n) => n.rev > afterRev)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit)
      .map((n) => ({ rev: n.rev, manifest: n.manifest, manifestUrl: n.manifestUrl }));
    return Promise.resolve(deltas);
  }

  private toPointer(n: NodeRec, capability: string): Pointer {
    const cap = n.caps.get(capability)!;
    return {
      did: n.did,
      manifest: n.manifestUrl,
      summary: `${capability} · risk:${cap.risk}`,
      price: cap.price,
      ...(n.reputation ? { reputation: n.reputation } : {}),
      ...(n.region ? { region: n.region } : {}),
      ...(n.rep ? { rep: n.rep } : {}),
    };
  }
}

export class InMemoryNonceStore implements NonceStore {
  private seen = new Map<string, number>();

  checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean> {
    const key = from + "|" + nonce;
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.set(key, ts);
    return Promise.resolve(true);
  }

  gc(beforeTs: number): Promise<number> {
    let dropped = 0;
    for (const [k, ts] of this.seen) {
      if (ts < beforeTs) {
        this.seen.delete(k);
        dropped++;
      }
    }
    return Promise.resolve(dropped);
  }
}

export class InMemoryReputationStore implements ReputationStore {
  private bySubject = new Map<string, Attestation[]>();
  private seenSettlements = new Set<string>();

  addAttestation(att: Attestation): Promise<boolean> {
    const key = att.subject + "|" + att.settlement.escrowId;
    if (this.seenSettlements.has(key)) return Promise.resolve(false);
    this.seenSettlements.add(key);
    const list = this.bySubject.get(att.subject) ?? [];
    list.push(att); // insertion order is the stable, oldest-first ordering
    this.bySubject.set(att.subject, list);
    return Promise.resolve(true);
  }

  getAttestations(
    subjectDid: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<AttestationPage> {
    const list = this.bySubject.get(subjectDid) ?? [];
    const start = opts.cursor ? Number(opts.cursor) : 0; // cursor = index into the list
    const limit = opts.limit ?? REPUTATION_PAGE_SIZE;
    const slice = list.slice(start, start + limit);
    const end = start + slice.length;
    return Promise.resolve({
      attestations: slice,
      nextCursor: end < list.length ? String(end) : undefined,
    });
  }

  summary(subjectDid: string): Promise<ReputationSummary> {
    const list = this.bySubject.get(subjectDid) ?? [];
    const issuers = new Set<string>();
    let totalSettledValue = 0;
    let oldestTs: number | undefined;
    let newestTs: number | undefined;
    for (const att of list) {
      issuers.add(att.issued_by);
      totalSettledValue += att.settlement.amount;
      oldestTs = oldestTs === undefined ? att.ts : Math.min(oldestTs, att.ts);
      newestTs = newestTs === undefined ? att.ts : Math.max(newestTs, att.ts);
    }
    return Promise.resolve({
      subject: subjectDid,
      count: list.length,
      distinctIssuers: issuers.size,
      totalSettledValue,
      oldestTs,
      newestTs,
    });
  }
}

export class InMemorySettlementStore implements SettlementStore {
  private byEscrow = new Map<string, SettlementRecord>();

  record(rec: SettlementRecord): Promise<void> {
    this.byEscrow.set(rec.escrowId, rec);
    return Promise.resolve();
  }

  get(escrowId: string): Promise<SettlementRecord | undefined> {
    return Promise.resolve(this.byEscrow.get(escrowId));
  }
}

export class InMemoryStores implements Stores {
  registry = new InMemoryRegistryStore();
  nonces = new InMemoryNonceStore();
  reputation = new InMemoryReputationStore();
  settlements = new InMemorySettlementStore();

  migrate(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
