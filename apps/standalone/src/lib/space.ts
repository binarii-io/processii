/**
 * **Standalone local space** — orchestration model (framework-agnostic, testable in Node/jsdom).
 *
 * A space contains several **documents**, each mounted on its own `WhiteboardEngine`
 * (`@binarii/processii`) on top of a Y.Doc. The engine works **offline-first**: it edits locally
 * without any adapter. A local persistence (y-indexeddb) and/or a P2P transport (y-webrtc) can
 * then be **plugged in** via `connectAdapters` — exactly the `@binarii/processii` adapters,
 * never reimplemented here.
 *
 * This module touches neither the DOM nor the network directly: it consumes **injected
 * factories** (transport/persistence), which makes it testable with a fake contract-conforming transport.
 */
import {
  connectAdapters,
  createAwareness,
  createEngine,
  createMemoryIdentity,
  destroyAwareness,
  parseScene,
  publishIdentity,
  WhiteboardSchemaVersionError,
  type CrdtAwareness,
  type Participant,
  type PersistenceProviderFactory,
  type TransportProviderFactory,
  type WhiteboardEngine,
  type WhiteboardSession,
} from '@binarii/processii';
import type { BundleDocument } from '../bundle.js';

/** A mounted document: its identity, its engine, and (when wired) its collab session. */
export interface MountedDocument {
  readonly id: string;
  readonly name: string;
  readonly engine: WhiteboardEngine;
  readonly session: WhiteboardSession;
  /** The document's **current** awareness (presence): peer cursors, to pass to the P2P transport. */
  readonly awareness: CrdtAwareness;
  /**
   * Recreates a **fresh** awareness (and republishes the identity). Call before each
   * (re)connection: y-webrtc removes our local presence state on disconnect and a reused
   * awareness drags stale states → starting from a clean awareness guarantees a full cursor
   * re-exchange (exactly what a page refresh did). Returns the new awareness.
   */
  renewAwareness(participant: Participant): CrdtAwareness;
  /** Detaches transport/persistence (the local engine survives) and releases the resources. */
  dispose(): void;
}

/** Document mount options (optional adapters → offline-first by default). */
export interface MountDocumentOptions {
  readonly id: string;
  readonly name: string;
  readonly participant: Participant;
  /** Initial scene to load (e.g. a document imported from a bundle). Revalidated by `parseScene`. */
  readonly initialScene?: unknown;
  readonly persistenceFactory?: PersistenceProviderFactory;
  readonly transportFactory?: TransportProviderFactory;
  /**
   * Called when the persisted document declares a schema version this build cannot read (a newer,
   * breaking format). Lets the app surface an "update required" message instead of mis-rendering.
   */
  readonly onSchemaError?: (error: WhiteboardSchemaVersionError) => void;
}

/**
 * Mounts a document: creates a fresh (offline) engine, loads the initial scene when there is
 * one, then connects the provided adapters. **Without adapters, the document is purely local**
 * (offline-first guaranteed by construction — `@binarii/processii`'s `connectAdapters` guarantees it).
 */
export function mountDocument(options: MountDocumentOptions): MountedDocument {
  const engine = createEngine();
  if (options.initialScene !== undefined) {
    // Boundary: the initial scene (coming from an import) is revalidated before mounting.
    engine.loadScene(parseScene(options.initialScene));
  }

  const session = connectAdapters(engine, {
    identity: createMemoryIdentity(options.participant),
    ...(options.transportFactory ? { transport: options.transportFactory } : {}),
    ...(options.persistenceFactory ? { persistence: options.persistenceFactory } : {}),
  });

  // Compatibility gate: this engine is created fresh (not via `engineFromDoc`), so the package's
  // eager check does not run. Once the persisted state (IndexedDB) is applied, refuse a document
  // written by a newer schema version rather than mis-rendering it.
  const persistence = session.persistence;
  if (persistence) {
    void persistence.whenLoaded().then(() => {
      try {
        engine.assertReadable();
      } catch (error) {
        if (error instanceof WhiteboardSchemaVersionError) {
          if (options.onSchemaError) options.onSchemaError(error);
          else console.error(error.message);
        }
      }
    });
  }

  // Presence: awareness on the board's doc, local identity published right away. Mutable: it is
  // **renewed** on every (re)connection (see `renewAwareness`).
  let awareness = createAwareness(engine.board.doc);
  publishIdentity(awareness, options.participant);

  return {
    id: options.id,
    name: options.name,
    engine,
    session,
    get awareness() {
      return awareness;
    },
    renewAwareness(participant: Participant): CrdtAwareness {
      destroyAwareness(awareness);
      awareness = createAwareness(engine.board.doc);
      publishIdentity(awareness, participant);
      return awareness;
    },
    dispose() {
      session.disconnect();
      destroyAwareness(awareness);
    },
  };
}

/** Snapshot of a mounted document as a `BundleDocument` (for bundle export). */
export function snapshotDocument(doc: MountedDocument): BundleDocument {
  return { id: doc.id, name: doc.name, scene: doc.engine.toScene() };
}
