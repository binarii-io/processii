import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The Playwright E2E tests live in `e2e/` and are not run by Vitest.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
