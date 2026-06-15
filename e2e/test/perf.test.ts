// Section 6.4: caching & performance.
//  - the node /manifest endpoint is conditionally cacheable (ETag → 304);
//  - the registry serves RESOLVE under load within a stated p99 latency target.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

test("node /manifest: ETag enables a conditional 304", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4640,
    capabilities: { "math.add": { handler: () => ({ output: {} }) } },
  });
  await node.listen();
  try {
    const first = await fetch(node.url + "/manifest");
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.match(first.headers.get("cache-control") ?? "", /max-age/);

    // a conditional re-fetch with the ETag is a cheap 304 (no body)
    const second = await fetch(node.url + "/manifest", { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304);
    assert.equal((await second.text()).length, 0);
  } finally {
    await node.close();
  }
});

// Stated target: p99 RESOLVE latency < 50ms against a warm in-memory registry
// (single host, loopback). The percentile tolerates rare GC/scheduler outliers;
// the median is the honest steady-state number we log.
test("registry RESOLVE: p99 latency under load meets target", async () => {
  const registry = createRegistry({ port: 4641 });
  await registry.listen();
  const node = createNode({
    identity: generateIdentity(),
    port: 4642,
    capabilities: { "math.add": { handler: () => ({ output: {} }) } },
  });
  await node.listen();
  try {
    await fetch(registry.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
    });

    const agent = generateIdentity();
    // warm up (JIT, connection setup, cache fill)
    for (let i = 0; i < 50; i++) await resolve(registry.url, "math.add", agent);

    const N = 300;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const { results } = await resolve(registry.url, "math.add", agent);
      samples.push(performance.now() - t0);
      assert.equal(results.length, 1); // correctness holds under load
    }
    samples.sort((a, b) => a - b);
    const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
    const p50 = p(0.5);
    const p99 = p(0.99);
    console.log(`    RESOLVE latency: p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms (N=${N})`);
    assert.ok(p99 < 50, `p99 ${p99.toFixed(2)}ms exceeded 50ms target`);
  } finally {
    await node.close();
    await registry.close();
  }
});
