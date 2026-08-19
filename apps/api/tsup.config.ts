import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  clean: true,
  noExternal: ["@token2022-preflight/core", "@token2022-preflight/solana"],
});
