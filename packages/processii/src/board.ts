/**
 * CRDT board — the collaborative, offline-first state of the whiteboard, carried by **Yjs** via
 * the local CRDT helpers (`./crdt/`, vendored from `crdt-core` — ADR 0006).
 *
 * Each element is a `Y.Map` indexed by its `id` inside a root `elements` `Y.Map`. Consequence
 * for collab: two **concurrent** modifications of different attributes (e.g. A moves,
 * B recolors the same element) merge without loss; two concurrent writes of the **same** field
 * are resolved deterministically by Yjs (last-writer by clientID). This is the granularity that
 * makes "create + move" converge, as required by the issue's acceptance criteria.
 *
 * The board works **entirely locally** (no network required): that's offline-first. Network
 * wiring (in-app websocket, standalone webrtc) happens externally via the provider interfaces
 * (`./crdt/providers.ts`) and the adapters (`adapters.ts`).
 */
import { createDoc, type CrdtDoc, type CreateDocOptions } from './crdt/index.js';
import * as Y from 'yjs';
import {
  agentGroupSchema,
  DEFAULT_SWIMLANES_WIDTH,
  elementSchema,
  parseElement,
  swimlaneSchema,
  WhiteboardSchemaVersionError,
  type AgentGroup,
  type Marker,
  type Scene,
  type StepEmotion,
  type Swimlane,
  type WhiteboardElement,
} from './scene.js';
import { wrapUndoManager, type WhiteboardHistory } from './history.js';

/** Keys of the process board collections inside the Y.Doc. */
const ELEMENTS_KEY = 'whiteboard:elements';
const SWIMLANES_KEY = 'whiteboard:swimlanes';
const AGENT_GROUPS_KEY = 'whiteboard:agentGroups';
const META_KEY = 'whiteboard:meta';
/** Key of the shared swimlane width inside the meta map. */
const SWIMLANES_WIDTH_KEY = 'swimlanesWidth';
/** Key of the shared document name inside the meta map (synced in collab, e.g. for a guest). */
const DOC_NAME_KEY = 'docName';
/** Key of the shared board background color (ui-kit token or CSS literal). */
const BACKGROUND_KEY = 'background';
/** Key of the persisted Y.Doc schema version inside the meta map (see `DOC_SCHEMA_VERSION`). */
const SCHEMA_VERSION_KEY = 'schemaVersion';

/**
 * Current **Y.Doc schema version** — the shape of the persisted CRDT layout this build writes and
 * can read. Bumped ONLY on a breaking structural change (a new/renamed top-level Y.Map key, a new
 * element `kind`, a changed literal); additive field changes are already tolerated on read and do
 * NOT bump it. Distinct from `sceneSchema.version` (the exported `Scene`/bundle JSON version).
 * See the README "Document format & compatibility" section and `WhiteboardBoard.assertReadable`.
 */
export const DOC_SCHEMA_VERSION = 1;

/** Numeric or textual geometry/style fields stored flat in an element's Y.Map. */
type ElementRecord = Record<string, unknown>;

/**
 * Partial patch applicable to an element (transforms: move/resize/restyle, points, links…).
 * Gathers the fields of **all** kinds (an `Omit` on the union would only keep the common
 * fields); a patch inconsistent with the actual kind (e.g. `points` on a rectangle) is rejected
 * at **revalidation** by `updateElement` (zod boundary), without mutating the state.
 */
export type ElementPatch = Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  stroke: string;
  fill: string;
  strokeWidth: number;
  strokeDash: 'solid' | 'dashed';
  opacity: number;
  z: number;
  markers: Marker[];
  points: [number, number][];
  text: string;
  fontSize: number;
  // Per-element text format (#82): alignment + style, on text/step/rectangle/ellipse.
  textAlign: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** "Card" drop shadow (rectangle/ellipse/sticky). `false` disables it; absent = enabled. */
  shadow: boolean;
  start: string;
  end: string;
  startArrow: boolean;
  endArrow: boolean;
  /** Manual elbow position of a connector; `null` = clear (back to the centered/auto elbow). */
  midpoint: number | null;
  // Fields of the `step` node (process board).
  name: string;
  description: string;
  /** Shows the description on the step card. */
  showDescription: boolean;
  skills: string[];
  deliverables: string[];
  /** Step emotion; `null` = clear (no emotion). */
  emotion: StepEmotion | null;
  swimlaneId: string;
  /** Sub-process link (child document id); `null` = unlink (clear the field). */
  subprocessRef: string | null;
}>;

/**
 * Board view over a `Y.Doc`. Encapsulates access to the element collection and exposes engine
 * operations (add/update/move/remove) guaranteed consistent and convergent.
 */
export class WhiteboardBoard {
  readonly doc: CrdtDoc;
  private readonly elements: Y.Map<Y.Map<unknown>>;
  private readonly swimlanes: Y.Map<Y.Map<unknown>>;
  private readonly agentGroups: Y.Map<Y.Map<unknown>>;
  private readonly meta: Y.Map<unknown>;
  /**
   * **Local** origin tagging all transactions of this board. Lets the history
   * (`createHistory`) undo only this user's edits, never the peers'.
   */
  private readonly origin = Symbol('whiteboard-board');
  /**
   * Distinct origin for the schema-version stamp so it is **not** captured by the undo history
   * (which tracks `this.origin` only) — the version marker must survive undo/redo.
   */
  private readonly schemaOrigin = Symbol('whiteboard-schema-version');

  constructor(doc: CrdtDoc) {
    this.doc = doc;
    this.elements = doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY);
    this.swimlanes = doc.getMap<Y.Map<unknown>>(SWIMLANES_KEY);
    this.agentGroups = doc.getMap<Y.Map<unknown>>(AGENT_GROUPS_KEY);
    this.meta = doc.getMap<unknown>(META_KEY);
  }

  /**
   * Creates an undo/redo history backed by the `Y.UndoManager`, **scoped to the local origin**:
   * only edits made through this board can be undone (collaborative updates received from a peer
   * cannot). The caller owns the instance (remember to `destroy()` on unmount).
   */
  createHistory(): WhiteboardHistory {
    const manager = new Y.UndoManager(
      [this.elements, this.swimlanes, this.agentGroups, this.meta],
      { trackedOrigins: new Set([this.origin]) },
    );
    return wrapUndoManager(manager);
  }

  /** Number of elements present. */
  get size(): number {
    return this.elements.size;
  }

  /** True if the element exists. */
  has(id: string): boolean {
    return this.elements.has(id);
  }

  /**
   * Adds an element (validated input). The element is normalized (defaults applied) then written.
   * If an element with the same id already exists, it is replaced (the caller manages id uniqueness).
   */
  addElement(input: unknown): WhiteboardElement {
    const element = parseElement(input);
    this.ensureSchemaVersion();
    this.doc.transact(() => {
      this.elements.set(element.id, recordToYMap(elementToRecord(element)));
    }, this.origin);
    return element;
  }

  /**
   * Applies a partial patch to an element (move, resize, restyle…). Only touches the provided
   * fields → preserves fine-grained merging in collab. No-op if the element does not exist
   * (returns `false`).
   *
   * **Validated write boundary**: the patch is merged onto the current state and the resulting
   * element is revalidated against the zod schema BEFORE any `Y.Map` mutation. An update that
   * would break the "every stored element is valid" invariant (e.g. negative `width`, `NaN`
   * coordinate, `opacity` outside 0..1) throws `WhiteboardParseError` **without mutating the
   * state** — so the reads (`readElement`/`toScene`/…), which revalidate, cannot be poisoned by
   * a write.
   */
  updateElement(id: string, patch: ElementPatch): boolean {
    const ymap = this.elements.get(id);
    if (!ymap) return false;
    // Merges the patch onto the current validated state, then revalidates the full resulting
    // element. Throws (WhiteboardParseError) on invalid input → nothing is written.
    const current = readElement(ymap);
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      // `null` = clear the optional field (e.g. `midpoint` → auto elbow): removed from the
      // revalidated merge AND deleted from the Y.Map below (the schema does not accept `null`).
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    parseElement(merged);
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (value === null) ymap.delete(key);
        else ymap.set(key, value);
      }
    }, this.origin);
    return true;
  }

  /** Relative move (dx, dy). No-op if the element does not exist. */
  moveElement(id: string, dx: number, dy: number): boolean {
    const ymap = this.elements.get(id);
    if (!ymap) return false;
    const x = numberAt(ymap, 'x');
    const y = numberAt(ymap, 'y');
    this.doc.transact(() => {
      ymap.set('x', x + dx);
      ymap.set('y', y + dy);
    }, this.origin);
    return true;
  }

  /** Removes an element. Returns `true` if it existed. */
  removeElement(id: string): boolean {
    if (!this.elements.has(id)) return false;
    this.doc.transact(() => {
      this.elements.delete(id);
    }, this.origin);
    return true;
  }

  // --- swimlanes (process board collection) ---

  /** Adds/replaces a swimlane (validated input). */
  addSwimlane(input: unknown): Swimlane {
    const lane = swimlaneSchema.parse(input);
    this.ensureSchemaVersion();
    this.doc.transact(() => {
      this.swimlanes.set(lane.id, recordToYMap({ ...lane }));
    }, this.origin);
    return lane;
  }

  /** Partial patch of a swimlane. No-op `false` when missing; revalidates before writing. */
  updateSwimlane(id: string, patch: Partial<Omit<Swimlane, 'id'>>): boolean {
    const ymap = this.swimlanes.get(id);
    if (!ymap) return false;
    const merged = { ...(ymap.toJSON() as Swimlane), ...patch };
    swimlaneSchema.parse(merged);
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) ymap.set(key, value);
      }
    }, this.origin);
    return true;
  }

  /** Removes a swimlane. */
  removeSwimlane(id: string): boolean {
    if (!this.swimlanes.has(id)) return false;
    this.doc.transact(() => {
      this.swimlanes.delete(id);
    }, this.origin);
    return true;
  }

  /** Swimlanes sorted by ascending `order`. */
  listSwimlanes(): Swimlane[] {
    const out: Swimlane[] = [];
    for (const ymap of this.swimlanes.values()) out.push(swimlaneSchema.parse(ymap.toJSON()));
    out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return out;
  }

  /** Shared swimlane width (default value when unset). */
  getSwimlanesWidth(): number {
    const value = this.meta.get(SWIMLANES_WIDTH_KEY);
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_SWIMLANES_WIDTH;
  }

  /** Sets the shared swimlane width. */
  setSwimlanesWidth(width: number): void {
    if (!Number.isFinite(width) || width <= 0) return;
    this.doc.transact(() => {
      this.meta.set(SWIMLANES_WIDTH_KEY, width);
    }, this.origin);
  }

  /** Shared document name (`null` when unset). Synced in collab via the meta map. */
  getName(): string | null {
    const value = this.meta.get(DOC_NAME_KEY);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /** Sets the shared document name (ignores an empty string). */
  setName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    this.doc.transact(() => {
      this.meta.set(DOC_NAME_KEY, trimmed);
    }, this.origin);
  }

  /** Shared board background color (ui-kit token or CSS literal); `null` = theme default. */
  getBackground(): string | null {
    const value = this.meta.get(BACKGROUND_KEY);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /** Sets the background color; `null`/empty string **resets** it (back to the theme default). */
  setBackground(color: string | null): void {
    const trimmed = color?.trim() ?? '';
    this.doc.transact(() => {
      if (trimmed.length === 0) this.meta.delete(BACKGROUND_KEY);
      else this.meta.set(BACKGROUND_KEY, trimmed);
    }, this.origin);
  }

  // --- schema version (document format compatibility) ---

  /**
   * Y.Doc schema version stamped in this document. An **unstamped** doc (legacy, or brand-new
   * before its first edit) reads as `1` — the format that predates this marker.
   */
  getSchemaVersion(): number {
    const value = this.meta.get(SCHEMA_VERSION_KEY);
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : DOC_SCHEMA_VERSION;
  }

  /**
   * Compatibility gate. Throws {@link WhiteboardSchemaVersionError} when the document was written
   * by a **newer** schema version than this build supports — a breaking change it cannot safely
   * read. Call it once a document is hydrated (persistence `whenLoaded`, remote sync) before
   * trusting reads. The reverse direction (this build reads an OLDER doc) is always supported
   * ("N+1 reads N") and would migrate on read once a future version needs it.
   */
  assertReadable(): void {
    const found = this.getSchemaVersion();
    if (found > DOC_SCHEMA_VERSION) {
      throw new WhiteboardSchemaVersionError(found, DOC_SCHEMA_VERSION);
    }
  }

  /**
   * Stamps {@link DOC_SCHEMA_VERSION} on first authoring, **only if absent** — a fresh or legacy
   * (v1, unstamped) doc gets marked without clobbering an existing (possibly newer) version. Runs
   * in its own transaction under `schemaOrigin`, so the marker is not undoable. Must be called
   * **before** (never inside) a tracked mutation, else Yjs folds it into `this.origin`.
   */
  private ensureSchemaVersion(): void {
    if (this.meta.has(SCHEMA_VERSION_KEY)) return;
    this.doc.transact(() => {
      this.meta.set(SCHEMA_VERSION_KEY, DOC_SCHEMA_VERSION);
    }, this.schemaOrigin);
  }

  // --- groups (process board collection) ---

  /** Adds/replaces a group (validated input). */
  addAgentGroup(input: unknown): AgentGroup {
    const group = agentGroupSchema.parse(input);
    this.ensureSchemaVersion();
    this.doc.transact(() => {
      this.agentGroups.set(group.id, recordToYMap({ ...group }));
    }, this.origin);
    return group;
  }

  /** Partial patch of a group. No-op `false` when missing; revalidates before writing. */
  updateAgentGroup(id: string, patch: Partial<Omit<AgentGroup, 'id'>>): boolean {
    const ymap = this.agentGroups.get(id);
    if (!ymap) return false;
    const merged = { ...(ymap.toJSON() as AgentGroup), ...patch };
    agentGroupSchema.parse(merged);
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) ymap.set(key, value);
      }
    }, this.origin);
    return true;
  }

  /** Removes a group. */
  removeAgentGroup(id: string): boolean {
    if (!this.agentGroups.has(id)) return false;
    this.doc.transact(() => {
      this.agentGroups.delete(id);
    }, this.origin);
    return true;
  }

  /** Groups (insertion order kept by id). */
  listAgentGroups(): AgentGroup[] {
    const out: AgentGroup[] = [];
    for (const ymap of this.agentGroups.values()) out.push(agentGroupSchema.parse(ymap.toJSON()));
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /** Reads a normalized (validated) element, or `undefined`. */
  getElement(id: string): WhiteboardElement | undefined {
    const ymap = this.elements.get(id);
    if (!ymap) return undefined;
    return readElement(ymap);
  }

  /** Lists all elements sorted by ascending z-order (render order). */
  listElements(): WhiteboardElement[] {
    const out: WhiteboardElement[] = [];
    for (const ymap of this.elements.values()) {
      out.push(readElement(ymap));
    }
    out.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
    return out;
  }

  /** Full snapshot (lossless native format), JSON-serializable. */
  toScene(): Scene {
    const background = this.getBackground();
    return {
      version: 1,
      elements: this.listElements(),
      swimlanes: this.listSwimlanes(),
      swimlanesWidth: this.getSwimlanesWidth(),
      agentGroups: this.listAgentGroups(),
      ...(background ? { background } : {}),
    };
  }

  /**
   * Replaces the whole content with a scene's (import). Validated element by element. Atomic
   * (a single transaction) → one CRDT update, one observer notification.
   */
  loadScene(scene: Scene): void {
    this.ensureSchemaVersion();
    this.doc.transact(() => {
      this.elements.clear();
      for (const element of scene.elements) {
        this.elements.set(element.id, recordToYMap(elementToRecord(element)));
      }
      this.swimlanes.clear();
      for (const lane of scene.swimlanes) this.swimlanes.set(lane.id, recordToYMap({ ...lane }));
      this.agentGroups.clear();
      for (const group of scene.agentGroups)
        this.agentGroups.set(group.id, recordToYMap({ ...group }));
      this.meta.set(SWIMLANES_WIDTH_KEY, scene.swimlanesWidth);
      if (scene.background) this.meta.set(BACKGROUND_KEY, scene.background);
      else this.meta.delete(BACKGROUND_KEY);
    }, this.origin);
  }

  /** Subscribes to changes of **all** board collections. Returns the unsubscriber. */
  observe(handler: () => void): () => void {
    const listener = (): void => handler();
    this.elements.observeDeep(listener);
    this.swimlanes.observeDeep(listener);
    this.agentGroups.observeDeep(listener);
    this.meta.observe(listener);
    return () => {
      this.elements.unobserveDeep(listener);
      this.swimlanes.unobserveDeep(listener);
      this.agentGroups.unobserveDeep(listener);
      this.meta.unobserve(listener);
    };
  }
}

/** Creates a fresh board on a fresh Y.Doc (offline, ready to use). */
export function createBoard(options: CreateDocOptions = {}): WhiteboardBoard {
  return new WhiteboardBoard(createDoc(options));
}

/** Attaches a board view to an existing Y.Doc (shared by other modules / providers). */
export function boardFromDoc(doc: CrdtDoc): WhiteboardBoard {
  const board = new WhiteboardBoard(doc);
  // A view is attached to an **already-hydrated** doc → fail fast on an unreadable (newer) schema
  // version rather than mis-reading. The create-then-hydrate path (standalone) instead calls
  // `assertReadable()` itself after the persistence provider loads.
  board.assertReadable();
  return board;
}

// --- internal helpers ---

function elementToRecord(element: WhiteboardElement): ElementRecord {
  // Element already validated → flat copy of its fields (the points/markers arrays are kept
  // as-is as JSON values; Yjs stores them as consistent opaque values).
  return { ...element };
}

function recordToYMap(record: ElementRecord): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(record)) {
    ymap.set(key, value);
  }
  return ymap;
}

function numberAt(ymap: Y.Map<unknown>, key: string): number {
  const value = ymap.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Rebuilds a validated element from its Y.Map (revalidates: the CRDT state is a boundary). */
function readElement(ymap: Y.Map<unknown>): WhiteboardElement {
  const raw = ymap.toJSON() as unknown;
  // Revalidates through the schema: guarantees defaults + typing even if a peer wrote a partial state.
  const result = elementSchema.safeParse(raw);
  if (result.success) return result.data;
  // Inconsistent state (should not happen through the API): reject it rather than propagate
  // untyped noise. parseElement will raise the typed error.
  return parseElement(raw);
}
