import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@token2022-preflight/core": `${root}packages/core/src/index.ts`,
      "@token2022-preflight/solana": `${root}packages/solana/src/index.ts`,
    },
  },
});
