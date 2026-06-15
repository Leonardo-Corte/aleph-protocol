import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateIdentity, type Manifest } from "@aleph/core";
import { SqliteStores } from "@aleph/store";
import { runStoreContract } from "./store-contract.ts";

// Run the full contract on an in-memory SQLite db.
runStoreContract("sqlite", async () => {
  const s = new SqliteStores(":memory:");
  await s.migrate();
  return s;
});

// Persistence: data written by one connection is visible to the next on the
// same file — i.e. it survives a "restart".
test("[sqlite] data persists across reopen (restart)", async () => {
  const file = join(tmpdir(), `aleph-test-${Date.now()}.db`);
  try {
    const node = generateIdentity();
    const m: Manifest = {
      v: "aleph/0.1",
      identity: node.did,
      conformance: "L1",
      capabilities: [{ key: "math.add", risk: "low" }],
      endpoint: ["http://127.0.0.1/aleph"],
    };
    const s1 = new SqliteStores(file);
    await s1.migrate();
    await s1.registry.upsertNode(m, "http://n/manifest");
    await s1.nonces.checkAndRecord(node.did, "persist-nonce", 1234);
    await s1.close();

    // reopen the same file — a fresh process would do exactly this
    const s2 = new SqliteStores(file);
    await s2.migrate();
    const found = (await s2.registry.resolveByCapability("math.add", { limit: 10 })).results;
    assert.equal(found.length, 1, "node survived restart");
    assert.equal(found[0]?.did, node.did);
    // the nonce is still remembered → replay still blocked across restart
    assert.equal(await s2.nonces.checkAndRecord(node.did, "persist-nonce", 9999), false);
    await s2.close();
  } finally {
    rmSync(file, { force: true });
    rmSync(file + "-wal", { force: true });
    rmSync(file + "-shm", { force: true });
  }
});
