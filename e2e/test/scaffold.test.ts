// Section 10.4: the create-aleph-node scaffolder produces a runnable node
// skeleton — a developer goes from zero to a registering, capability-serving
// node in one command.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scaffold } from "../../packages/create-aleph-node/src/index.ts";

test("scaffold writes a coherent, runnable node skeleton", () => {
  const dir = mkdtempSync(join(tmpdir(), "aleph-scaffold-"));
  try {
    const files = scaffold(dir, { name: "my-node" });
    assert.deepEqual(new Set(files), new Set(["package.json", "index.mjs", "README.md", ".gitignore"]));

    // package.json is valid and depends on the SDK
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      type: string;
      scripts: { start: string };
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.name, "my-node");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.scripts.start, "node index.mjs");
    assert.ok(pkg.dependencies["@aleph/node"]);
    assert.ok(pkg.dependencies["@aleph/core"]);

    // the entry actually creates + serves a node and can register
    const entry = readFileSync(join(dir, "index.mjs"), "utf8");
    assert.match(entry, /createNode/);
    assert.match(entry, /node\.listen\(\)/);
    assert.match(entry, /\/register/);
    assert.match(entry, /math\.add/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
