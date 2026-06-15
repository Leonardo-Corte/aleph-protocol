#!/usr/bin/env node
// Aleph CLI — drive the protocol from a terminal.
//
//   node src/cli.ts keygen
//   node src/cli.ts registry --port 4000
//   node src/cli.ts node --port 4100 --registry http://127.0.0.1:4000
//   node src/cli.ts resolve <capability> --registry http://127.0.0.1:4000
//   node src/cli.ts invoke  <capability> --registry http://127.0.0.1:4000 --input '{"a":2,"b":3}'

import { resolveRanked, fetchManifest, invoke } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { createGrant } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";
import { PostgresStores, type Stores } from "@aleph/store";
import { createLogger } from "@aleph/transport";
import { loadServerConfig } from "./config";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// CLI flags take precedence over env; both feed the validating config loader.
function serverEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PORT: arg("port") ?? process.env.PORT,
    HOST: arg("host") ?? process.env.HOST,
    PUBLIC_URL: arg("public-url") ?? process.env.PUBLIC_URL,
    PEERS: arg("peers") ?? process.env.PEERS,
  };
}

// Persistent stores when DATABASE_URL is set (production); else in-memory (dev).
async function openStores(databaseUrl?: string): Promise<Stores | undefined> {
  if (!databaseUrl) return undefined;
  const stores = await PostgresStores.connect(databaseUrl);
  await stores.migrate();
  return stores;
}

const cmd = process.argv[2];
const positional = process.argv[3];

switch (cmd) {
  case "keygen": {
    const id = generateIdentity();
    console.log(JSON.stringify({ did: id.did }, null, 2));
    break;
  }

  case "registry": {
    const cfg = loadServerConfig(serverEnv(), { port: 4000 });
    const stores = await openStores(cfg.databaseUrl);
    const reg = createRegistry({
      port: cfg.port,
      host: cfg.host,
      publicUrl: cfg.publicUrl,
      peers: cfg.peers,
      store: stores?.registry,
      nonceStore: stores?.nonces,
      logger: createLogger({ level: cfg.logLevel }),
      // federate: reconcile peers periodically once any are configured
      reconcileIntervalMs: cfg.peers.length > 0 ? 30_000 : undefined,
    });
    await reg.listen();
    console.log(
      `registry listening on ${reg.url} · store:${cfg.databaseUrl ? "postgres" : "memory"}` +
        (cfg.peers.length ? ` · peers: ${cfg.peers.join(", ")}` : ""),
    );
    break;
  }

  case "node": {
    const cfg = loadServerConfig(serverEnv(), { port: 4100 });
    const registry = arg("registry") ?? process.env.REGISTRY_URL;
    const stores = await openStores(cfg.databaseUrl);
    const node = createNode({
      identity: generateIdentity(),
      port: cfg.port,
      host: cfg.host,
      publicUrl: cfg.publicUrl,
      logger: createLogger({ level: cfg.logLevel }),
      reputationStore: stores?.reputation,
      nonceStore: stores?.nonces,
      settlementStore: stores?.settlements,
      capabilities: {
        "math.add": {
          schema: {
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
            required: ["a", "b"],
          },
          handler: (i) => ({ output: { sum: (i.a as number) + (i.b as number) } }),
        },
      },
    });
    await node.listen();
    if (registry) {
      await fetch(registry + "/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
      });
    }
    console.log(`node ${node.manifest.identity}`);
    console.log(
      `listening on ${node.url} · capability: math.add` + (registry ? ` · registered at ${registry}` : ""),
    );
    break;
  }

  case "healthcheck": {
    // Used by the container HEALTHCHECK: ping a /healthz and exit 0/1.
    const port = arg("port") ?? process.env.PORT ?? "4000";
    const url = arg("url") ?? process.env.HEALTHCHECK_URL ?? `http://127.0.0.1:${port}/healthz`;
    try {
      const r = await fetch(url);
      process.exit(r.ok ? 0 : 1);
    } catch {
      process.exit(1);
    }
    break;
  }

  case "resolve": {
    if (!positional) {
      console.error("usage: resolve <capability>");
      process.exit(1);
    }
    const registry = arg("registry", "http://127.0.0.1:4000")!;
    const ranked = await resolveRanked(registry, positional, generateIdentity());
    console.log(JSON.stringify(ranked, null, 2));
    break;
  }

  case "invoke": {
    if (!positional) {
      console.error("usage: invoke <capability> [--input JSON]");
      process.exit(1);
    }
    const capability = positional;
    const registry = arg("registry", "http://127.0.0.1:4000")!;
    const input = JSON.parse(arg("input", "{}")!) as Record<string, unknown>;
    const agent = generateIdentity();
    const ranked = await resolveRanked(registry, capability, agent);
    const top = ranked[0];
    if (!top) {
      console.error(`no node found for "${capability}"`);
      process.exit(1);
    }
    const manifest = await fetchManifest(top.manifest);
    const endpoint = manifest.endpoint[0];
    if (!endpoint) {
      console.error("node manifest has no endpoint");
      process.exit(1);
    }
    const grant = createGrant(
      { issuer: agent.did, grantee: agent.did, scope: [{ capability }], not_after: Date.now() + 60_000 },
      agent.privateKey,
    );
    const out = await invoke({
      nodeDid: manifest.identity,
      endpoint,
      capability,
      input,
      grant,
      agent,
    });
    console.log(JSON.stringify({ outcome: out.outcome, result: out.result }, null, 2));
    break;
  }

  default:
    console.log(
      [
        "Aleph CLI",
        "  keygen                                 generate a did:key identity",
        "  registry [--port] [--host] [--peers a,b] [--public-url]   run a registry",
        "  node [--port] [--host] [--registry URL] [--public-url]    run a node (math.add)",
        "  healthcheck [--url|--port]             probe /healthz (exit 0/1)",
        "  resolve <cap> [--registry URL]         find + rank nodes by trust",
        "  invoke <cap> [--registry URL] [--input JSON]   call the best node",
        "  env: PORT HOST PUBLIC_URL PEERS DATABASE_URL ALEPH_LOG_LEVEL (see docs/operators)",
      ].join("\n"),
    );
}
