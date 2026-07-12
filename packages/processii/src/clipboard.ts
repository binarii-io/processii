/**
 * Whiteboard **clipboard** — copy/paste of scene elements, portable across boards.
 *
 * A clipboard payload is a **self-contained, versioned, JSON-serializable** snapshot of a set of
 * copied elements (verbatim: ids + world coordinates). The re-id / re-offset / binding-remap logic
 * of pasting lives in the engine (`WhiteboardEngine.copySelection` / `.paste`) — this module owns
 * the **format** and the **storage contract**, both DOM-free / React-free so a pure Node runtime
 * (and the `@binarii/processii/core` subpath) can read/write payloads.
 *
 * Because a payload is just tagged JSON, a host can back the clipboard with the **system clipboard**
 * (`navigator.clipboard`, cross-tab) or an **in-memory** store (same page). The engine never talks
 * to a storage medium: the host reads/writes payloads and hands them to `paste`.
 */
import { z } from 'zod';
import { elementSchema, type WhiteboardElement } from './scene.js';

/**
 * Marker tagging a processii clipboard payload — distinguishes our JSON from arbitrary text a host
 * might read out of the system clipboard. A blob without this exact `type` is **not** a payload.
 */
export const CLIPBOARD_MARKER = 'processii/clipboard' as const;

/** Current payload format version. Bumped only on a breaking payload-shape change. */
export const CLIPBOARD_VERSION = 1 as const;

/**
 * A clipboard payload: the copied elements, verbatim. Ids and coordinates are kept as-is — the
 * **paste** re-ids every element, remaps intra-payload connector bindings and offsets the block
 * (see `WhiteboardEngine.paste`). At least one element (an empty copy yields `null`, never a
 * payload).
 */
export const clipboardPayloadSchema = z.object({
  type: z.literal(CLIPBOARD_MARKER),
  version: z.literal(CLIPBOARD_VERSION),
  elements: z.array(elementSchema).min(1),
});
export type ClipboardPayload = z.infer<typeof clipboardPayloadSchema>;

/**
 * Parses an unknown value (typically read from the system clipboard) as a payload. Returns `null`
 * when it is not a valid processii payload (foreign text, wrong version, malformed) — never throws,
 * so a paste over unrelated clipboard content is simply a no-op.
 */
export function parseClipboardPayload(input: unknown): ClipboardPayload | null {
  const result = clipboardPayloadSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Storage medium for whiteboard copy/paste, **injected by the host** into `BoardCanvas`. The host
 * decides the backing store — the system clipboard (`navigator.clipboard`, works across tabs and
 * apps) or an in-memory store (same page only). All methods may be async (the browser clipboard
 * API is promise-based).
 */
export interface WhiteboardClipboard {
  /** Persists a copied payload (overwrites any previous one). */
  write(payload: ClipboardPayload): void | Promise<void>;
  /** Reads the last payload, or `null` when the clipboard holds no processii payload. */
  read(): ClipboardPayload | null | Promise<ClipboardPayload | null>;
}

/**
 * In-memory clipboard (holds the last payload in a closure). The default when a host injects none:
 * copy/paste then works **within the same page** (across boards navigated in one SPA) but not
 * across browser tabs — for that a host wires a `navigator.clipboard`-backed adapter.
 */
export function createMemoryClipboard(): WhiteboardClipboard {
  let held: ClipboardPayload | null = null;
  return {
    write(payload: ClipboardPayload) {
      held = payload;
    },
    read() {
      return held;
    },
  };
}

/** Re-exported for convenience so a host can type its payloads without importing `scene.ts`. */
export type { WhiteboardElement };
