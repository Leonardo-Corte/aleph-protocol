// Section 9.3: the typed config loader validates and FAILS FAST — a
// misconfigured server must never start and silently misbehave.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadServerConfig } from "../../packages/cli/src/config.ts";

test("config: valid env parses into a typed config", () => {
  const cfg = loadServerConfig(
    {
      PORT: "8080",
      HOST: "0.0.0.0",
      PUBLIC_URL: "https://registry.example.org",
      DATABASE_URL: "postgres://u:p@db/aleph",
      ALEPH_LOG_LEVEL: "info",
      PEERS: "https://a.example.org, https://b.example.org",
    },
    { port: 4000 },
  );
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.host, "0.0.0.0");
  assert.equal(cfg.publicUrl, "https://registry.example.org");
  assert.equal(cfg.databaseUrl, "postgres://u:p@db/aleph");
  assert.equal(cfg.logLevel, "info");
  assert.deepEqual(cfg.peers, ["https://a.example.org", "https://b.example.org"]);
});

test("config: defaults apply when env is empty", () => {
  const cfg = loadServerConfig({}, { port: 4100 });
  assert.equal(cfg.port, 4100);
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.publicUrl, undefined);
  assert.equal(cfg.databaseUrl, undefined);
  assert.equal(cfg.logLevel, "info");
  assert.deepEqual(cfg.peers, []);
});

test("config: fails fast on invalid input", () => {
  assert.throws(() => loadServerConfig({ PORT: "0" }, { port: 4000 }), /invalid PORT/);
  assert.throws(() => loadServerConfig({ PORT: "notnum" }, { port: 4000 }), /invalid PORT/);
  assert.throws(() => loadServerConfig({ PORT: "70000" }, { port: 4000 }), /invalid PORT/);
  assert.throws(
    () => loadServerConfig({ ALEPH_LOG_LEVEL: "loud" }, { port: 4000 }),
    /invalid ALEPH_LOG_LEVEL/,
  );
  assert.throws(() => loadServerConfig({ PUBLIC_URL: "ftp://x" }, { port: 4000 }), /invalid PUBLIC_URL/);
  assert.throws(() => loadServerConfig({ PUBLIC_URL: "not a url" }, { port: 4000 }), /invalid PUBLIC_URL/);
});
