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

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
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
    const port = Number(arg("port", "4000"));
    const peers = arg("peers")?.split(",").filter(Boolean);
    const reg = createRegistry({ port, peers });
    await reg.listen();
    console.log(`registry listening on ${reg.url}` + (peers ? ` (peers: ${peers.join(", ")})` : ""));
    break;
  }

  case "node": {
    const port = Number(arg("port", "4100"));
    const registry = arg("registry");
    const node = createNode({
      identity: generateIdentity(),
      port,
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
        "  registry --port 4000 [--peers a,b]     run a registry",
        "  node --port 4100 [--registry URL]      run a node (math.add)",
        "  resolve <cap> [--registry URL]         find + rank nodes by trust",
        "  invoke <cap> [--registry URL] [--input JSON]   call the best node",
      ].join("\n"),
    );
}
