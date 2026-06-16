// @aleph/mcp — programmatic entry point. The runnable server is `./server` (bin);
// `buildAlephServer` builds it in-process (injectable registry/agent/rail).
export const MCP_SERVER_NAME = "aleph";
export { buildAlephServer, type AlephServerOptions } from "./build";
