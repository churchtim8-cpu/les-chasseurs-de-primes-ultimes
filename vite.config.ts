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
  },
});
