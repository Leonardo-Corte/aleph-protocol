// S2 acceptance: the network's memory survives a restart. Boot a registry +
// node backed by a SQLite file, build real state (a registered node, settled
// reputation, recorded settlements, a seen nonce), then throw the instances
// away and bring up fresh ones on the SAME database — as a real process restart
// would. Everything must still be there.

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { invoke, attest, fetchReputation, resolve } from "@aleph/client";
import { generateIdentity, SettlementRail } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";
import { SqliteStores } from "@aleph/store";

const addSchema = {
  type: "object" as const,
  properties: { a: { type: "number" as const }, b: { type: "number" as const } },
  required: ["a", "b"],
};
const adder = (i: Record<string, unknown>) => ({ output: { sum: (i.a as number) + (i.b as number) } });

test("registry, reputation, settlements, and nonces survive a restart (SQLite)", async () => {
  const regFile = join(tmpdir(), `aleph-reg-${Date.now()}.db`);
  const nodeFile = join(tmpdir(), `aleph-node-${Date.now()}.db`);
  const rail = new SettlementRail();
  const nodeId = generateIdentity();
  const customer = generateIdentity();
  rail.deposit(customer.did, 100);
  const cleanup = (f: string) => {
    for (const ext of ["", "-wal", "-shm"]) rmSync(f + ext, { force: true });
  };

  try {
    // --- first "process": build durable state ---
    const regStore1 = new SqliteStores(regFile);
    await regStore1.migrate();
    const nodeStore1 = new SqliteStores(nodeFile);
    await nodeStore1.migrate();

    const registry1 = createRegistry({ port: 4810, store: regStore1.registry, nonceStore: regStore1.nonces });
    await registry1.listen();
    const node1 = createNode({
      identity: nodeId,
      port: 4811,
      rail,
      capabilities: { "math.add": { priceEur: 2, schema: addSchema, handler: adder } },
      reputationStore: nodeStore1.reputation,
      nonceStore: nodeStore1.nonces,
      settlementStore: nodeStore1.settlements,
    });
    await node1.listen();
    await fetch(registry1.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: node1.manifest, manifestUrl: node1.url + "/manifest" }),
    });

    // one paid call → reputation + settlement recorded
    const { settlement } = await invoke({
      nodeDid: nodeId.did,
      endpoint: node1.url + "/aleph",
      capability: "math.add",
      input: { a: 2, b: 3 },
      agent: customer,
      rail,
      payEur: 2,
    });
    await attest({
      agent: customer,
      subjectDid: nodeId.did,
      reputationUrl: node1.url + "/reputation",
      settlement: settlement!,
      rating: 1,
    });

    // shut everything down (the "crash"/"deploy")
    await node1.close();
    await registry1.close();
    await regStore1.close();
    await nodeStore1.close();

    // --- second "process": fresh instances on the SAME database files ---
    const regStore2 = new SqliteStores(regFile);
    await regStore2.migrate();
    const nodeStore2 = new SqliteStores(nodeFile);
    await nodeStore2.migrate();

    const registry2 = createRegistry({ port: 4812, store: regStore2.registry, nonceStore: regStore2.nonces });
    await registry2.listen();
    const node2 = createNode({
      identity: nodeId,
      port: 4813,
      rail,
      capabilities: { "math.add": { priceEur: 2, schema: addSchema, handler: adder } },
      reputationStore: nodeStore2.reputation,
      nonceStore: nodeStore2.nonces,
      settlementStore: nodeStore2.settlements,
    });
    await node2.listen();

    try {
      // the node is still discoverable in the registry
      const found = (await resolve(registry2.url, "math.add", generateIdentity())).results;
      assert.equal(found.length, 1, "registered node survived restart");
      assert.equal(found[0]?.did, nodeId.did);

      // its reputation survived
      const rep = await fetchReputation(node2.url + "/reputation");
      assert.equal(rep.trust.count, 1, "reputation survived restart");
      assert.equal(rep.trust.score, 1);

      // the settlement history survived
      const rec = await nodeStore2.settlements.get(settlement!.escrowId);
      assert.ok(rec, "settlement record survived restart");
      assert.equal(rec.status, "released");
    } finally {
      await node2.close();
      await registry2.close();
      await regStore2.close();
      await nodeStore2.close();
    }
  } finally {
    cleanup(regFile);
    cleanup(nodeFile);
  }
});
