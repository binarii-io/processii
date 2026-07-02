/**
 * Yjs "doc" abstractions — local (vendored) copy of the `crdt-core` helpers, so the package is
 * **self-sufficient** (open-source processii, ADR 0006): no private workspace dependency. The
 * types are **structural Yjs aliases** (`CrdtDoc = Y.Doc`): providers written against
 * `crdt-core` remain assignable here without adaptation (TS structural typing).
 *
 * Document creation, update encoding/application, state-vector-based diffs. No hard network
 * dependency — everything is in-memory, binary, transport-agnostic (providers then plug in the
 * network / the persistence).
 */
import * as Y from 'yjs';

/** A CRDT document. Re-export of the Yjs type so consumers depend only on the package. */
export type CrdtDoc = Y.Doc;

/** Encoded Yjs update (binary delta), ready to travel over any transport. */
export type CrdtUpdate = Uint8Array;

/** Encoded state vector: "what I already know" of a document (to compute a diff). */
export type CrdtStateVector = Uint8Array;

/** Document creation options. `gc` (garbage collection) enabled by default like Yjs. */
export interface CreateDocOptions {
  /**
   * Identity of the local client (Yjs clientID). Useful for deterministic tests / debugging.
   * In production, let Yjs assign a random one (avoids collisions between peers).
   */
  readonly clientId?: number;
  /** Enables garbage collection of deleted structures (Yjs default: `true`). */
  readonly gc?: boolean;
}

/**
 * Creates a new blank CRDT document.
 *
 * `clientId` is optional and mostly serves tests: two docs with concurrent updates converge
 * regardless of the application order, the clientID only breaks conflicts deterministically.
 */
export function createDoc(options: CreateDocOptions = {}): CrdtDoc {
  const doc = new Y.Doc(options.gc === undefined ? undefined : { gc: options.gc });
  if (options.clientId !== undefined) {
    doc.clientID = options.clientId;
  }
  return doc;
}

/**
 * Encodes the full state of a document as an update applicable to any other document
 * ("full state" snapshot). Preferred to bootstrap a peer that knows nothing of the doc.
 */
export function encodeStateAsUpdate(doc: CrdtDoc): CrdtUpdate {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Encodes the document's **state vector**: the vector version of what it knows.
 * A peer sends it to the other to receive back ONLY the missing updates (diff).
 */
export function encodeStateVector(doc: CrdtDoc): CrdtStateVector {
  return Y.encodeStateVector(doc);
}

/**
 * Computes the **diff**: the minimal update containing everything `doc` knows that is missing
 * from the peer described by `remoteStateVector`. The core of the sync protocol (offline → resync).
 */
export function diffUpdate(doc: CrdtDoc, remoteStateVector: CrdtStateVector): CrdtUpdate {
  return Y.encodeStateAsUpdate(doc, remoteStateVector);
}

/**
 * Applies an update to a document. Idempotent: applying the same update twice has no effect
 * (Yjs ignores what it already knows), which makes the sync robust to network duplicates.
 *
 * @param origin tags the update's origin (e.g. a provider). Lets observers distinguish their
 *   own writes from incoming updates and avoid echo loops.
 */
export function applyUpdate(doc: CrdtDoc, update: CrdtUpdate, origin?: unknown): void {
  Y.applyUpdate(doc, update, origin);
}

/**
 * Merges several updates into a single equivalent update (transport/log-side compaction).
 * Order does not matter for convergence; the result is more compact to transmit/store.
 */
export function mergeUpdates(updates: readonly CrdtUpdate[]): CrdtUpdate {
  return Y.mergeUpdates(updates as Uint8Array[]);
}

/**
 * Subscribes to the updates produced locally by the document (app writes + applications of
 * incoming updates). The callback receives the binary update and its `origin`. Returns an
 * unsubscribe function.
 *
 * A transport provider uses this to broadcast; it usually filters on `origin` to avoid
 * re-emitting what it just applied itself.
 */
export function onUpdate(
  doc: CrdtDoc,
  handler: (update: CrdtUpdate, origin: unknown) => void,
): () => void {
  const listener = (update: Uint8Array, origin: unknown): void => handler(update, origin);
  doc.on('update', listener);
  return () => doc.off('update', listener);
}

/**
 * Synchronizes `target` from `source` with a bidirectional diff exchange based on the state
 * vectors (the mechanics of an in-memory Yjs sync round). After the call, both documents know
 * the union of their updates → they **converge**.
 *
 * Test / bootstrap helper: a real transport performs the same exchange across the network.
 */
export function syncDocs(source: CrdtDoc, target: CrdtDoc): void {
  const sourceToTarget = diffUpdate(source, encodeStateVector(target));
  const targetToSource = diffUpdate(target, encodeStateVector(source));
  applyUpdate(target, sourceToTarget);
  applyUpdate(source, targetToSource);
}
