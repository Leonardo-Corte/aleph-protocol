// Regenerate src/abi.ts from the forge build artifact.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const artifact = join(here, "../../../contracts/out/AlephEscrow.sol/AlephEscrow.json");
const art = JSON.parse(readFileSync(artifact, "utf8"));
const out =
  `// Generated from contracts/out/AlephEscrow.sol/AlephEscrow.json (forge build).\n` +
  `// Regenerate with: pnpm --filter @aleph/settle-evm gen:abi\n\n` +
  `export const alephEscrowAbi = ${JSON.stringify(art.abi, null, 2)} as const;\n\n` +
  `export const alephEscrowBytecode = "${art.bytecode.object}" as const;\n`;
writeFileSync(join(here, "../src/abi.ts"), out);
console.log("regenerated abi.ts");
