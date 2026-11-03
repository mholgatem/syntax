import { defineConfig } from 'vitest/config';
import { pwa } from './vite-pwa';

export default defineConfig({
  // GitHub Pages serves the project at https://<user>.github.io/syntax/
  base: process.env.VITE_BASE ?? '/syntax/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  plugins: [pwa()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
