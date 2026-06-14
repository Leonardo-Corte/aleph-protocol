// A persistent demo network: boots a registry and one node and stays up, so an
// MCP client (e.g. Claude Desktop pointed at src/agent/mcp-server.ts) can talk
// to it. Run this in one terminal; point your agent's MCP config at the server.

import { generateIdentity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";

const registry = createRegistry({ port: 4000 });
await registry.listen();

const node = createNode({
  identity: generateIdentity(),
  port: 4100,
  capabilities: {
    "math.add": {
      requiredGrant: true,
      handler: (input) => ({ output: { sum: (input.a as number) + (input.b as number) } }),
    },
  },
});
await node.listen();

await fetch(registry.url + "/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
});

console.log("Aleph demo network is up:");
console.log("  registry → " + registry.url);
console.log("  node     → " + node.url + "  (capability: math.add)");
console.log("\nPoint an MCP client at src/agent/mcp-server.ts, or run `node src/demo/run.ts`.");
console.log("Press Ctrl+C to stop.");
