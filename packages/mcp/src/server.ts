#!/usr/bin/env node
// The runnable Aleph MCP server (bin `aleph-mcp`): build the server and serve it
// over stdio. Configuration is by env (ALEPH_REGISTRY); a settlement rail for
// paying priced nodes is wired here once on-chain settlement is threaded through
// the agent path. IMPORTANT: never write to stdout — it is the JSON-RPC channel.

import { evmPayerRailFromEnv } from "@aleph/settle-evm";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAlephServer } from "./build";

// A deployed agent pays priced nodes with REAL value when an EVM rail is
// configured (ALEPH_EVM_RPC/ESCROW/TOKEN/KEY/...); otherwise it serves free
// nodes only. Diagnostics to stderr — stdout is the JSON-RPC channel.
const rail = evmPayerRailFromEnv();
if (rail) process.stderr.write(`aleph-mcp: on-chain rail enabled (${rail.id})\n`);

const server = buildAlephServer({ rail });
const transport = new StdioServerTransport();
await server.connect(transport);
