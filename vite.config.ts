import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Relative asset paths so the build works under the GitHub Pages sub-path.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Many tests play whole simulated chases; CI runners share cores across test files.
    testTimeout: 240_000, // chases are planned so every call is heard in time (2026-10-03): generating one takes longer; CI runners are about 3x slower
  },
});
