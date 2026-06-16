import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/build.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  platform: "node",
});
