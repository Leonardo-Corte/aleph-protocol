#!/usr/bin/env node
// Aleph as an MCP server. This is how an agent actually *uses* Aleph: any
// MCP-capable agent (Claude Desktop, Claude Code, …) gains two tools —
// aleph_resolve (FIND) and aleph_invoke (ACT + PROVE) — and can cross the
// verbs natively. Aleph wraps MCP: MCP is the agent's entry point into it.
//
// IMPORTANT: never write to stdout here — stdout is the JSON-RPC channel.
// Diagnostics go to stderr.

import { resolve, fetchManifest, invoke } from "@aleph/client";
import { generateIdentity } from "@aleph/core";
import { createGrant } from "@aleph/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// The agent's identity for this session. In v0 it also acts as its own
// principal (self-delegation); in a fuller build the Grant would be issued by
// the human's key and handed to the agent.
const agent = generateIdentity();
const DEFAULT_REGISTRY = process.env.ALEPH_REGISTRY ?? "http://127.0.0.1:4000";

const server = new McpServer({ name: "aleph", version: "0.1.0" });

server.registerTool(
  "aleph_resolve",
  {
    title: "Aleph · find nodes (FIND)",
    description:
      "Ask the Aleph registry which nodes provide a capability. Returns pointers: did, manifest URL, and a one-line summary. Pull-not-push: fetch a full manifest only for a candidate you choose.",
    inputSchema: {
      capability: z.string().describe("semantic capability key, e.g. 'math.add'"),
      registryUrl: z
        .string()
        .optional()
        .describe("registry base URL (defaults to $ALEPH_REGISTRY or localhost:4000)"),
    },
  },
  async ({ capability, registryUrl }) => {
    const { results } = await resolve(registryUrl ?? DEFAULT_REGISTRY, capability, agent);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  },
);

server.registerTool(
  "aleph_invoke",
  {
    title: "Aleph · act on a node (ACT + PROVE)",
    description:
      "Resolve a capability, invoke the first matching node with a bounded grant, verify the signed receipt, and return the result plus proof. The agent never trusts the result on faith — the receipt is cryptographically verified.",
    inputSchema: {
      capability: z.string().describe("semantic capability key, e.g. 'math.add'"),
      input: z.record(z.string(), z.any()).describe("arguments for the capability, e.g. { a: 2, b: 3 }"),
      maxEur: z.number().optional().describe("spending limit encoded into the bounded grant"),
      registryUrl: z.string().optional(),
    },
  },
  async ({ capability, input, maxEur, registryUrl }) => {
    const { results } = await resolve(registryUrl ?? DEFAULT_REGISTRY, capability, agent);
    const chosen = results[0];
    if (!chosen) {
      return { content: [{ type: "text", text: `No Aleph node found for "${capability}".` }], isError: true };
    }
    const manifest = await fetchManifest(chosen.manifest, chosen.did);
    const endpoint = manifest.endpoint[0];
    if (!endpoint) {
      return {
        content: [{ type: "text", text: `Node for "${capability}" has no endpoint.` }],
        isError: true,
      };
    }
    const grant = createGrant(
      {
        issuer: agent.did,
        grantee: agent.did,
        scope: [{ capability, limit: maxEur !== undefined ? { max_eur: maxEur } : {} }],
        not_after: Date.now() + 300_000,
      },
      agent.privateKey,
    );
    const { result, outcome, receipt } = await invoke({
      nodeDid: manifest.identity,
      endpoint,
      capability,
      input: input as Record<string, unknown>,
      grant,
      agent,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { outcome, result, receipt_signed_by: receipt.from, invoke_ref: receipt.body.invoke_ref },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
