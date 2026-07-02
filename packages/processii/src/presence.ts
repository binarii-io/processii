/**
 * Collaborative presence — peer cursors via the local **awareness** (`./crdt/awareness.ts`,
 * ephemeral state, not persisted, broadcast on the same transport as the doc). The local
 * cursor's **world** position + the identity (name/color) are published, and the remote cursors
 * are read to display them.
 *
 * Pure helpers around the awareness API (testable without network): the actual sync happens via
 * the P2P transport (y-webrtc), which is given the same awareness.
 */
import { getStates, onAwarenessChange, setLocalState, type CrdtAwareness } from './crdt/index.js';
import type { Participant } from './adapters.js';

/** A peer's cursor, ready to draw (color = ui-kit token or free value). */
export interface RemoteCursor {
  readonly clientId: number;
  readonly name: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
}

/** A peer's selection: the element ids they selected + their color (collab highlight). */
export interface RemoteSelection {
  readonly clientId: number;
  readonly color: string;
  readonly ids: readonly string[];
}

/** Present participant (self included): for the avatar chips (name + color + initials). */
export interface PresenceParticipant {
  readonly clientId: number;
  readonly name: string;
  readonly color: string;
  readonly self: boolean;
}

/**
 * A peer's CSS color, **agnostic of the host app's convention**:
 * - a ui-kit **token** (letters/dashes, e.g. `accent`, `success`) → `var(--color-<token>)`;
 * - a **CSS value** (hex/rgb/hsl, e.g. `#1e90ff`) → as-is.
 *
 * The standalone publishes tokens, the web app a deterministic per-user color: both go through
 * this helper for correct rendering (cursors/chips), with no hard-coded value in the code.
 */
export function presenceCssColor(color: string): string {
  return /^[a-z-]+$/i.test(color) ? `var(--color-${color})` : color;
}

/** Initials of a name (1–2 letters) for an avatar chip. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Publishes the local identity (name/color) — do this once on mount. Only needs `name` and
 * `color`: accepts a full `Participant` (standalone) as well as a plain `{name,color}`
 * collaborator (web app).
 */
export function publishIdentity(
  awareness: CrdtAwareness,
  participant: Pick<Participant, 'name' | 'color'>,
): void {
  setLocalState(awareness, { name: participant.name, color: participant.color });
}

/** Publishes (or clears) the local cursor's **world** position. */
export function publishCursor(
  awareness: CrdtAwareness,
  cursor: { x: number; y: number } | null,
): void {
  setLocalState(awareness, { cursor });
}

/** Publishes the **local selection** (element ids) — peers see it highlighted. */
export function publishSelection(awareness: CrdtAwareness, ids: readonly string[]): void {
  setLocalState(awareness, { selection: [...ids] });
}

/**
 * **Remote** cursors (excludes the local client), filtered to those exposing a valid position.
 * `getStates` returns a defensive copy (the internal awareness does not leak).
 */
export function readRemoteCursors(awareness: CrdtAwareness): RemoteCursor[] {
  const self = awareness.clientID;
  const cursors: RemoteCursor[] = [];
  for (const [clientId, state] of getStates(awareness)) {
    if (clientId === self) continue;
    const cursor = state.cursor as { x?: unknown; y?: unknown } | null | undefined;
    if (!cursor || typeof cursor.x !== 'number' || typeof cursor.y !== 'number') continue;
    cursors.push({
      clientId,
      name: typeof state.name === 'string' ? state.name : 'Invité',
      color: typeof state.color === 'string' ? state.color : 'accent',
      x: cursor.x,
      y: cursor.y,
    });
  }
  return cursors;
}

/**
 * **Remote** selections (excludes the local client), filtered to those exposing at least one id.
 * Used to draw the collaborative highlight in each peer's color.
 */
export function readRemoteSelections(awareness: CrdtAwareness): RemoteSelection[] {
  const self = awareness.clientID;
  const selections: RemoteSelection[] = [];
  for (const [clientId, state] of getStates(awareness)) {
    if (clientId === self) continue;
    const raw = state.selection;
    if (!Array.isArray(raw)) continue;
    const ids = raw.filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) continue;
    selections.push({
      clientId,
      color: typeof state.color === 'string' ? state.color : 'accent',
      ids,
    });
  }
  return selections;
}

/**
 * All present participants (**self included**) having published an identity, for the avatar
 * chips. Flags the local client (`self`).
 */
export function readParticipants(awareness: CrdtAwareness): PresenceParticipant[] {
  const self = awareness.clientID;
  const participants: PresenceParticipant[] = [];
  for (const [clientId, state] of getStates(awareness)) {
    if (typeof state.name !== 'string') continue; // identity not published → skipped
    participants.push({
      clientId,
      name: state.name,
      color: typeof state.color === 'string' ? state.color : 'accent',
      self: clientId === self,
    });
  }
  return participants;
}

/** Subscribes to awareness changes (peer add/update/remove). Returns the unsubscriber. */
export function observePresence(awareness: CrdtAwareness, handler: () => void): () => void {
  return onAwarenessChange(awareness, handler);
}
