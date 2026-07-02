/**
 * processii-standalone — public interface (the only surface importable by other packages,
 * e.g. the memorii VS Code extension (vscode-ext) whose webview reuses this standalone engine).
 *
 * **Public P2P site** (`docs/01`, `docs/04`): the `@binarii/processii` whiteboard engine in
 * **local (IndexedDB) + P2P (y-webrtc)** mode, no account, no backend. Exposed here are the
 * reusable, **network-free-testable** building blocks: the bundle model (import/export +
 * merge/remap), document mounting (injected adapters), CRDT providers (y-webrtc / y-indexeddb),
 * and the validated signaling boundary.
 *
 * The React app (`app.tsx`/`main.tsx`) is NOT exported: it is the assembly, not an API.
 */

// --- Save bundle (import/export, new space or merge + ID remapping) ---
export {
  BUNDLE_VERSION,
  parseBundle,
  toBundle,
  toBundleString,
  bundleToNewSpace,
  mergeBundleIntoSpace,
  BundleParseError,
  type SpaceBundle,
  type BundleDocument,
  type IdFactory,
} from './bundle.js';

// --- Document mounting (offline-first, injected adapters) ---
export {
  mountDocument,
  snapshotDocument,
  type MountedDocument,
  type MountDocumentOptions,
} from './lib/space.js';

// --- CRDT providers (P2P transport / local persistence) ---
export { createWebrtcProvider, type WebrtcProviderConfig } from './crdt/webrtc-provider.js';
export { createIndexeddbProvider } from './crdt/indexeddb-provider.js';

// --- Signaling boundary (validation/limitation — SECURITY.md) ---
export {
  SIGNALING_LIMITS,
  roomNameSchema,
  roomSecretSchema,
  validateRoomName,
  validateRoomSecret,
  sanitizePeerName,
  generateRoomName,
  generateRoomSecret,
  SignalingValidationError,
} from './lib/signaling.js';

// --- Config (signaling env, no secret) ---
export { readEnv, type StandaloneEnv } from './lib/env.js';

// --- Runtime wiring ---
export { createWiring, type StandaloneWiring } from './bootstrap.js';
