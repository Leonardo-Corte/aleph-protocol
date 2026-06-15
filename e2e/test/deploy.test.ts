// Section 9: deployment-readiness. The runtimes expose a healthcheck and can
// advertise an external (proxy/domain) URL distinct from their bind address.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateIdentity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

test("node + registry expose /healthz", async () => {
  const registry = createRegistry({ port: 4730 });
  await registry.listen();
  const node = createNode({
    identity: generateIdentity(),
    port: 4731,
    capabilities: { "math.add": { handler: () => ({ output: {} }) } },
  });
  await node.listen();
  try {
    const rh = await fetch("http://127.0.0.1:4730/healthz");
    assert.equal(rh.status, 200);
    assert.equal(((await rh.json()) as { ok: boolean }).ok, true);

    const nh = await fetch("http://127.0.0.1:4731/healthz");
    assert.equal(nh.status, 200);
    const body = (await nh.json()) as { ok: boolean; did: string };
    assert.equal(body.ok, true);
    assert.match(body.did, /^did:/);
  } finally {
    await node.close();
    await registry.close();
  }
});

test("publicUrl is advertised in the Manifest (proxy/domain deployment)", async () => {
  const node = createNode({
    identity: generateIdentity(),
    port: 4732,
    host: "127.0.0.1",
    publicUrl: "https://node.example.org",
    capabilities: { "math.add": { handler: () => ({ output: {} }) } },
  });
  await node.listen();
  try {
    // the Manifest advertises the EXTERNAL url, not the bind address
    assert.equal(node.manifest.endpoint[0], "https://node.example.org/aleph");
    assert.equal(node.manifest.reputation, "https://node.example.org/reputation");
    // but it still binds locally and serves the (signed) manifest there
    const res = await fetch("http://127.0.0.1:4732/manifest");
    assert.equal(res.status, 200);
    const served = (await res.json()) as { identity: string };
    assert.equal(served.identity, node.manifest.identity);
  } finally {
    await node.close();
  }
});
