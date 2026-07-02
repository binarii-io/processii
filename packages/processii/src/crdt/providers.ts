/**
 * Pluggable **provider** interfaces: transport (network sync) and persistence (local storage).
 *
 * Local (vendored) copy of the `crdt-core` contracts (ADR 0006), **structurally identical**:
 * a provider implemented against the crdt-core interfaces (in-app y-websocket, standalone
 * y-webrtc, y-indexeddb…) is assignable here without adaptation — TypeScript's structural
 * typing bridges the gap.
 *
 * A provider is a box that:
 *  - takes a `CrdtDoc` (+ possibly a `CrdtAwareness`),
 *  - keeps it synchronized with a source (server, peer, local storage),
 *  - exposes its connection / loading status,
 *  - cleans up properly (`destroy`).
 */
import type { CrdtAwareness } from './awareness.js';
import type { CrdtDoc } from './doc.js';

/** Link status of a transport provider towards its remote source. */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** Common base of every provider: it attaches to a document and detaches cleanly. */
export interface CrdtProvider {
  /** The document driven by this provider. */
  readonly doc: CrdtDoc;
  /**
   * Detaches the provider: closes the connections / handles, removes the listeners.
   * Idempotent. After `destroy`, the provider must no longer mutate the document.
   */
  destroy(): void | Promise<void>;
}

/**
 * **Transport** provider: keeps a document synchronized with a remote source
 * (sync server, P2P peer…). Optionally also propagates the awareness.
 */
export interface TransportProvider extends CrdtProvider {
  readonly kind: 'transport';
  /** Awareness propagated by this transport, when presence is supported. */
  readonly awareness?: CrdtAwareness;
  /** Current connection status. */
  readonly status: ConnectionStatus;
  /** Opens the connection and starts the sync. Resolves when the initial sync is negotiated. */
  connect(): Promise<void>;
  /** Cuts the connection without destroying the provider (reconnection possible via `connect`). */
  disconnect(): void | Promise<void>;
  /**
   * Subscribes to status changes. Returns an unsubscribe function.
   * Lets the UI reflect online / offline (offline-first).
   */
  onStatusChange(handler: (status: ConnectionStatus) => void): () => void;
}

/**
 * **Persistence** provider: stores/loads a document's state on a local medium
 * (IndexedDB in the browser, server snapshots…). Enables offline-first startup:
 * the local state is loaded before (or without) network.
 */
export interface PersistenceProvider extends CrdtProvider {
  readonly kind: 'persistence';
  /** `true` once the local state is loaded into the document. */
  readonly loaded: boolean;
  /** Loads the persisted state into the document. Resolves when `loaded` becomes `true`. */
  whenLoaded(): Promise<void>;
  /** Forces the current state to be written to the medium (flush). */
  flush(): Promise<void>;
  /** Deletes the persisted state for this document. */
  clear(): Promise<void>;
}

/** Type guard: true when the provider is a transport provider. */
export function isTransportProvider(provider: CrdtProvider): provider is TransportProvider {
  return (provider as Partial<TransportProvider>).kind === 'transport';
}

/** Type guard: true when the provider is a persistence provider. */
export function isPersistenceProvider(provider: CrdtProvider): provider is PersistenceProvider {
  return (provider as Partial<PersistenceProvider>).kind === 'persistence';
}

/**
 * Transport provider factory. Injected to make the transport pluggable without coupling the
 * engine to an implementation (in-app websocket, standalone y-webrtc, fake test transport…).
 */
export type TransportProviderFactory = (
  doc: CrdtDoc,
  options?: { readonly awareness?: CrdtAwareness },
) => TransportProvider;

/** Persistence provider factory (same injection logic). */
export type PersistenceProviderFactory = (doc: CrdtDoc) => PersistenceProvider;
