import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone site E2E: load the page → create a document → draw a shape. The **built** app is
 * launched, served by `vite preview` (active SW → offline actually testable). `VITE_E2E=1`
 * (injected at **build** time) puts the app in **demo mode**: no network (no real
 * signaling/STUN), conforming to "no network WebRTC in tests" (`docs/06`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_E2E: '1' },
  },
});
