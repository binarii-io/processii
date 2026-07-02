import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Build of the **public standalone** whiteboard site (`docs/01`, `docs/04`).
 *
 * No backend: everything runs in the browser. Collaboration is **P2P** (y-webrtc, public
 * signaling + STUN) and persistence is **local** (y-indexeddb). The app is an installable PWA,
 * like `@app/web` — offline-first is guaranteed by Yjs/IndexedDB, not by the service worker.
 *
 * - `@vitejs/plugin-react`: JSX + Fast Refresh in dev.
 * - `vite-plugin-pwa` (Workbox): manifest + service worker precaching the shell (offline shell).
 *   The spaces' content stays served offline by y-indexeddb (see `src/crdt`), not by the SW;
 *   the P2P signaling is never cached.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Memorii Whiteboard',
        short_name: 'Whiteboard',
        description: 'Whiteboard collaboratif P2P, offline-first, sans compte.',
        // Color aligned with the ui-kit `accent` token (binarii brand blue #0166ff).
        theme_color: '#0166ff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // **Fixed** port: `strictPort` makes Vite fail when 5174 is taken (instead of drifting to
    // 5175… → unstable URL). Kill the residual process and relaunch rather than changing the URL.
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
});
