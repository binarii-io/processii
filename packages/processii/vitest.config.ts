import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is DOM-free, but the React UI (`board-canvas`, `style-panel`,
    // `presence-avatars`) and its Testing Library tests need a simulated DOM → jsdom. The
    // engine (Yjs) tests also run under jsdom with no impact.
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
