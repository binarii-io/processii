/**
 * "Awareness" (presence) abstraction on top of `y-protocols/awareness` — local (vendored) copy
 * of the `crdt-core` helpers (ADR 0006). `CrdtAwareness` is a **structural alias** of the
 * `y-protocols` type: an awareness created on the memorii side (crdt-core) remains assignable here.
 *
 * The awareness carries the peers' ephemeral, non-persistent state: cursors, selections, who is
 * online… Unlike the document, it is NOT a persisted CRDT: it is a key→state registry with
 * expiry, propagated best-effort. No network dependency here either — the transport is plugged
 * in by a provider.
 */
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';

import type { CrdtDoc } from './doc.js';

/** Presence registry for a document. Re-export of the `y-protocols` type. */
export type CrdtAwareness = Awareness;

/** Encoded awareness update (binary), to broadcast on the transport. */
export type AwarenessUpdate = Uint8Array;

/** Creates an awareness registry bound to a document. */
export function createAwareness(doc: CrdtDoc): CrdtAwareness {
  return new Awareness(doc);
}

/**
 * Updates the local presence state (shallow field-by-field merge via Yjs).
 * Passing `null` for a field does not remove it — use `clearLocalState` to start over.
 */
export function setLocalState(
  awareness: CrdtAwareness,
  state: Readonly<Record<string, unknown>>,
): void {
  for (const [field, value] of Object.entries(state)) {
    awareness.setLocalStateField(field, value);
  }
}

/**
 * Returns the current local presence state (`null` when unset).
 *
 * ⚠️ Trust boundary: the Yjs state is typed `unknown` on the `y-protocols` side. The cast to
 * `Record<string, unknown>` is purely structural — the shape of the fields (cursor, selection…)
 * is NOT validated at runtime here. A consumer deriving behavior from a field must validate it
 * itself (e.g. zod) before use.
 */
export function getLocalState(awareness: CrdtAwareness): Record<string, unknown> | null {
  return awareness.getLocalState();
}

/** Clears the local presence state (the peer appears "gone" to the others). */
export function clearLocalState(awareness: CrdtAwareness): void {
  awareness.setLocalState(null);
}

/**
 * Snapshot of all known presence states, indexed by clientID.
 *
 * Returns a **defensive copy**: the awareness's internal `Map` does not leak, the caller can
 * iterate/mutate the result without corrupting the Yjs state.
 *
 * ⚠️ Trust boundary: like `getLocalState`, the cast to `Record<string, unknown>` is structural;
 * the shape of the fields is not validated at runtime. Validate on the consumer side.
 */
export function getStates(awareness: CrdtAwareness): Map<number, Record<string, unknown>> {
  return new Map(awareness.getStates() as Map<number, Record<string, unknown>>);
}

/**
 * Encodes the awareness update for the given clients (default: the local client).
 * To broadcast via the transport to announce/withdraw a presence.
 */
export function encodeUpdate(
  awareness: CrdtAwareness,
  clients: readonly number[] = [awareness.clientID],
): AwarenessUpdate {
  return encodeAwarenessUpdate(awareness, clients as number[]);
}

/**
 * Applies an incoming awareness update. `origin` lets observers distinguish the source
 * (same anti-echo logic as for document updates).
 */
export function applyUpdate(
  awareness: CrdtAwareness,
  update: AwarenessUpdate,
  origin?: unknown,
): void {
  applyAwarenessUpdate(awareness, update, origin);
}

/**
 * Subscribes to awareness changes. The callback receives the added / updated / removed clients
 * as well as the change's origin. Returns an unsubscribe function.
 */
export interface AwarenessChange {
  readonly added: readonly number[];
  readonly updated: readonly number[];
  readonly removed: readonly number[];
}

export function onAwarenessChange(
  awareness: CrdtAwareness,
  handler: (change: AwarenessChange, origin: unknown) => void,
): () => void {
  const listener = (change: AwarenessChange, origin: unknown): void => handler(change, origin);
  awareness.on('change', listener);
  return () => awareness.off('change', listener);
}

/** Releases the awareness resources (internal timers included). Call on disconnect. */
export function destroyAwareness(awareness: CrdtAwareness): void {
  awareness.destroy();
}
