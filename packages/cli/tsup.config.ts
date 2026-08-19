import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/bin.ts'],
    format: ['esm'],
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
