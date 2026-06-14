// The real proof: an MCP client (standing in for any MCP-capable agent) uses
// Aleph through the MCP server, against a live registry + node. This is "an
// agent uses Aleph natively" end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateIdentity } from "@aleph/core";
import { createRegistry } from "@aleph/registry";
import { createNode } from "@aleph/node";

test("an MCP agent resolves and invokes an Aleph node, getting a verified receipt", async () => {
  // live registry + node
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

  // spawn the built MCP server as a subprocess and connect a client to it
  const serverPath = fileURLToPath(new URL("../../packages/mcp/dist/server.js", import.meta.url));
  const transport = new StdioClientTransport({ command: "node", args: [serverPath] });
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(transport);

  try {
    // the agent sees Aleph's verbs as MCP tools
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["aleph_invoke", "aleph_resolve"]);

    // FIND
    const found = await client.callTool({ name: "aleph_resolve", arguments: { capability: "math.add" } });
    const foundText = (found.content as Array<{ text: string }>)[0]?.text ?? "";
    assert.match(foundText, /did:key:z/);

    // ACT + PROVE
    const acted = await client.callTool({
      name: "aleph_invoke",
      arguments: { capability: "math.add", input: { a: 2, b: 3 }, maxEur: 10 },
    });
    const actedText = (acted.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const out = JSON.parse(actedText);
    assert.equal(out.outcome, "success");
    assert.deepEqual(out.result, { sum: 5 });
    assert.match(out.receipt_signed_by, /did:key:z/);
  } finally {
    await client.close();
    await node.close();
    await registry.close();
  }
});
