// Section 8: observability. Structured logs (with secret redaction + trace
// correlation) and Prometheus metrics are first-class, so a deployed registry
// or node is operable and provably healthy.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateIdentity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createLogger, MetricsRegistry } from "@aleph/transport";

test("logger: structured JSON, level filtering, and SECRET redaction", () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    level: "info",
    sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  });

  log.debug("dropped"); // below threshold → not emitted
  log.info("kept", {
    did: "did:key:zABC",
    privateKey: "SECRET-MATERIAL",
    nested: { passphrase: "hunter2", ok: "visible" },
    sig: "public-signature-stays",
  });

  assert.equal(lines.length, 1);
  const line = lines[0]!;
  assert.equal(line.level, "info");
  assert.equal(line.msg, "kept");
  assert.equal(line.did, "did:key:zABC");
  // secrets redacted at any depth; public fields (incl. signatures) preserved
  assert.equal(line.privateKey, "[REDACTED]");
  assert.equal((line.nested as Record<string, unknown>).passphrase, "[REDACTED]");
  assert.equal((line.nested as Record<string, unknown>).ok, "visible");
  assert.equal(line.sig, "public-signature-stays");
});

test("logger: child bindings are merged into every line", () => {
  const lines: Record<string, unknown>[] = [];
  const base = createLogger({
    level: "debug",
    sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  });
  const child = base.child({ trace: "t-123", service: "node" });
  child.info("x");
  assert.equal(lines[0]!.trace, "t-123");
  assert.equal(lines[0]!.service, "node");
});

test("metrics: counters and histograms render in Prometheus format", () => {
  const m = new MetricsRegistry();
  const c = m.counter("aleph_requests_total", "requests");
  c.inc({ service: "node" });
  c.inc({ service: "node" });
  c.inc({ service: "registry" });
  const h = m.histogram("aleph_request_ms", "latency", [10, 100]);
  h.observe({ service: "node" }, 5);
  h.observe({ service: "node" }, 50);

  const text = m.render();
  assert.match(text, /# TYPE aleph_requests_total counter/);
  assert.match(text, /aleph_requests_total\{service="node"\} 2/);
  assert.match(text, /aleph_requests_total\{service="registry"\} 1/);
  assert.match(text, /# TYPE aleph_request_ms histogram/);
  // labels render sorted alphabetically (le before service)
  assert.match(text, /aleph_request_ms_bucket\{le="10",service="node"\} 1/); // 5 ≤ 10
  assert.match(text, /aleph_request_ms_bucket\{le="\+Inf",service="node"\} 2/);
  assert.match(text, /aleph_request_ms_count\{service="node"\} 2/);
});

test("node: /metrics endpoint reflects served requests, with correlated logs", async () => {
  const lines: Record<string, unknown>[] = [];
  const node = createNode({
    identity: generateIdentity(),
    port: 4720,
    capabilities: { "text.echo": { handler: (i) => ({ output: { text: i.text } }) } },
    logger: createLogger({
      level: "debug",
      sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
    }),
  });
  await node.listen();
  try {
    await fetch(node.url + "/manifest");
    await fetch(node.url + "/manifest");

    const res = await fetch(node.url + "/metrics");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /aleph_requests_total\{service="node"\}/);
    assert.match(body, /aleph_request_ms_count/);

    // every request produced a trace-correlated structured log line
    const served = lines.filter((l) => l.service === "node" && typeof l.trace === "string");
    assert.ok(served.length > 0, "expected trace-correlated node logs");
  } finally {
    await node.close();
  }
});
