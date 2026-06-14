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
} from "./interfaces";

export class InMemoryRegistryStore implements RegistryStore {
  private byCapability = new Map<string, Pointer[]>();

  upsertNode(manifest: Manifest, manifestUrl: string): Promise<boolean> {
    let firstSeen = false;
    for (const cap of manifest.capabilities) {
      const list = this.byCapability.get(cap.key) ?? [];
      if (!list.some((p) => p.did === manifest.identity)) {
        list.unshift({
          did: manifest.identity,
          manifest: manifestUrl,
          summary: `${cap.key} · risk:${cap.risk ?? "low"}`,
          reputation: manifest.reputation,
        });
        firstSeen = true;
      }
      this.byCapability.set(cap.key, list);
    }
    return Promise.resolve(firstSeen);
  }

  resolveByCapability(capability: string, limit: number): Promise<Pointer[]> {
    return Promise.resolve((this.byCapability.get(capability) ?? []).slice(0, limit));
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
    list.push(att);
    this.bySubject.set(att.subject, list);
    return Promise.resolve(true);
  }

  getAttestations(subjectDid: string): Promise<Attestation[]> {
    return Promise.resolve(this.bySubject.get(subjectDid) ?? []);
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
