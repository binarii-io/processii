/**
 * Local CRDT module of the package (vendored from `crdt-core`, ADR 0006).
 *
 * Makes `@binarii/processii` **self-sufficient**: no private workspace dependency left. The types
 * (`CrdtDoc`, `CrdtAwareness`, providers) are **structural aliases/contracts** identical to
 * crdt-core's — the memorii providers remain assignable without adaptation. The part of this
 * module acting as the adapters contract is re-exported by `src/index.ts` (public surface).
 */

// --- Documents ---
export {
  createDoc,
  encodeStateAsUpdate,
  encodeStateVector,
  diffUpdate,
  applyUpdate,
  mergeUpdates,
  onUpdate,
  syncDocs,
  type CrdtDoc,
  type CrdtUpdate,
  type CrdtStateVector,
  type CreateDocOptions,
} from './doc.js';

// --- Awareness (presence) ---
export {
  createAwareness,
  setLocalState,
  getLocalState,
  clearLocalState,
  getStates,
  encodeUpdate as encodeAwarenessUpdate,
  applyUpdate as applyAwarenessUpdate,
  onAwarenessChange,
  destroyAwareness,
  type CrdtAwareness,
  type AwarenessUpdate,
  type AwarenessChange,
} from './awareness.js';

// --- Providers (pluggable transport / persistence) ---
export {
  isTransportProvider,
  isPersistenceProvider,
  type CrdtProvider,
  type TransportProvider,
  type PersistenceProvider,
  type ConnectionStatus,
  type TransportProviderFactory,
  type PersistenceProviderFactory,
} from './providers.js';
