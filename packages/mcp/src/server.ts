#!/usr/bin/env node
// The runnable Aleph MCP server (bin `aleph-mcp`): build the server and serve it
// over stdio. Configuration is by env (ALEPH_REGISTRY); a settlement rail for
// paying priced nodes is wired here once on-chain settlement is threaded through
// the agent path. IMPORTANT: never write to stdout — it is the JSON-RPC channel.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAlephServer } from "./build";

const server = buildAlephServer();
const transport = new StdioServerTransport();
await server.connect(transport);
