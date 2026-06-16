// create-aleph-node — scaffold a working Aleph node skeleton. The generated node
// signs its Manifest, serves a capability, and (optionally) registers itself, so
// a developer goes from zero to discoverable in one command.
//
//   npm create aleph-node@latest my-node
//   cd my-node && npm install && npm start

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PKG_VERSION = "^0.2.0";

const indexMjs = `import { createNode } from "@aleph/node";
import { generateIdentity } from "@aleph/core";

// A node IS its keypair. In production, persist this (see @aleph/cli keygen +
// the encrypted keystore) so the node keeps its identity — and its reputation —
// across restarts.
const identity = generateIdentity();

const node = createNode({
  identity,
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? "127.0.0.1",
  publicUrl: process.env.PUBLIC_URL,
  capabilities: {
    // Your capability. Replace with something useful; declare a JSON Schema so
    // agents can validate input/output and you can be discovered by it.
    "math.add": {
      schema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      handler: (input) => ({ output: { sum: input.a + input.b } }),
    },
  },
});

await node.listen();

// Optionally register at a public registry so agents can find you.
const registry = process.env.ALEPH_REGISTRY;
if (registry) {
  await fetch(registry + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest: node.manifest, manifestUrl: node.url + "/manifest" }),
  });
}

console.log("aleph node", node.manifest.identity);
console.log("listening on", node.url, registry ? "(registered at " + registry + ")" : "");
`;

function pkgJson(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { start: "node index.mjs" },
        dependencies: { "@aleph/node": PKG_VERSION, "@aleph/core": PKG_VERSION },
      },
      null,
      2,
    ) + "\n"
  );
}

function readme(name: string): string {
  return `# ${name}

An Aleph node. It signs its Manifest, serves a capability (\`math.add\` to start),
and can register at a public registry so agents discover it.

\`\`\`bash
npm install
npm start                                   # serves on http://127.0.0.1:4100
ALEPH_REGISTRY=https://registry.example.org npm start   # + register
\`\`\`

Edit \`index.mjs\`: replace \`math.add\` with a capability that does real work, give
it a JSON Schema, and (if priced) wire a settlement rail. See
https://github.com/Leonardo-Corte/aleph-protocol.
`;
}

// Write the scaffold into `dir`. Returns the relative paths written. Exported so
// it can be driven from a test without spawning a process.
export function scaffold(dir: string, opts: { name?: string } = {}): string[] {
  const name = opts.name ?? dir.split(/[/\\]/).pop() ?? "aleph-node";
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "package.json": pkgJson(name),
    "index.mjs": indexMjs,
    "README.md": readme(name),
    ".gitignore": "node_modules\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return Object.keys(files);
}

// CLI entry (only when run as a binary, not when imported by a test).
function main(): void {
  const target = process.argv[2] ?? "aleph-node";
  const written = scaffold(target);
  console.log(`Scaffolded an Aleph node in ./${target}`);
  for (const f of written) console.log("  " + f);
  console.log(`\nNext:\n  cd ${target} && npm install && npm start`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
