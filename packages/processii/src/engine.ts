/**
 * Whiteboard engine — **local** orchestration layer on top of the CRDT board.
 *
 * Responsibilities:
 * - high-level operations (add/move/remove, move a selection as a block);
 * - **local selection**: the selection is per-user, hence **ephemeral and outside the
 *   CRDT** (shared collab goes through the awareness — `./crdt/awareness.ts` —, wired externally);
 * - rendering geometry computations (bounding box) reused by the renderers.
 *
 * The engine is **DOM-free**: it runs in Node (tests), in a worker, in the P2P standalone
 * and in the web app with no environment dependency. Concrete rendering (canvas, SVG) is plugged
 * in by the `render.ts` renderers, which consume `engine.toRenderModel()`.
 */
import { boardFromDoc, createBoard, WhiteboardBoard, type ElementPatch } from './board.js';
import type { CrdtDoc } from './crdt/index.js';
import type { CreateDocOptions } from './crdt/index.js';
import type { AgentGroup, ConnectorSide, Scene, Swimlane, WhiteboardElement } from './scene.js';
import type { WhiteboardHistory } from './history.js';
import { connectorGeometry } from './connector.js';

/** Axis-aligned rectangle (world bounding box). */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class WhiteboardEngine {
  readonly board: WhiteboardBoard;
  private selection = new Set<string>();
  private historyInstance?: WhiteboardHistory;

  constructor(board: WhiteboardBoard) {
    this.board = board;
  }

  /**
   * Undo/redo history of the document (created lazily and memoized: one per engine). Scoped
   * to local edits — does not undo updates received from peers.
   */
  history(): WhiteboardHistory {
    return (this.historyInstance ??= this.board.createHistory());
  }

  // --- editing operations (delegate to the CRDT board) ---

  /** Adds a validated element. Selects it by default (common editing UX). */
  addElement(input: unknown, options: { select?: boolean } = {}): WhiteboardElement {
    const element = this.board.addElement(input);
    if (options.select !== false) {
      this.selection = new Set([element.id]);
    }
    return element;
  }

  /** Partial patch of an element (resize/restyle/absolute move). */
  updateElement(id: string, patch: ElementPatch): boolean {
    return this.board.updateElement(id, patch);
  }

  /** Relative move of an element. */
  moveElement(id: string, dx: number, dy: number): boolean {
    return this.board.moveElement(id, dx, dy);
  }

  /** Removes an element and drops it from the selection. */
  removeElement(id: string): boolean {
    this.selection.delete(id);
    return this.board.removeElement(id);
  }

  /** Removes all selected elements. Returns the number removed. */
  removeSelected(): number {
    let count = 0;
    for (const id of this.selection) {
      if (this.board.removeElement(id)) count++;
    }
    this.selection.clear();
    return count;
  }

  // --- selection (local, outside the CRDT) ---

  /** Replaces the selection. Ignores non-existent ids. */
  select(ids: readonly string[]): void {
    this.selection = new Set(ids.filter((id) => this.board.has(id)));
  }

  /** Adds/removes an id from the selection (multi-selection toggle). */
  toggleSelection(id: string): void {
    if (!this.board.has(id)) return;
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
  }

  /** Clears the selection. */
  clearSelection(): void {
    this.selection.clear();
  }

  /** Selected ids (filtered from elements that vanished in collab). */
  getSelection(): string[] {
    return [...this.selection].filter((id) => this.board.has(id));
  }

  /** Moves all selected elements as a block. Returns the number moved. */
  moveSelection(dx: number, dy: number): number {
    let count = 0;
    for (const id of this.getSelection()) {
      if (this.board.moveElement(id, dx, dy)) count++;
    }
    return count;
  }

  /**
   * Applies a patch (typically **style**: `stroke`/`fill`/`strokeWidth`/`opacity`) to all
   * selected elements. Returns the number of modified elements. Invalid patches throw
   * (validated board boundary) without mutating the state.
   */
  updateSelection(patch: ElementPatch): number {
    let count = 0;
    for (const id of this.getSelection()) {
      if (this.board.updateElement(id, patch)) count++;
    }
    return count;
  }

  // --- bound connectors ---

  /**
   * Creates a **bound arrow** linking two elements (`startId` → `endId`), routed edge to edge.
   * Links are kept: the arrow re-routes via `refreshConnectors` when a linked element moves.
   * Returns the created element (selected by default), or `undefined` if an endpoint is missing.
   */
  connect(
    id: string,
    startId: string,
    endId: string,
    opts: {
      startSide?: ConnectorSide;
      endSide?: ConnectorSide;
      startArrow?: boolean;
      endArrow?: boolean;
    } = {},
  ): WhiteboardElement | undefined {
    const a = this.boundingBox(startId);
    const b = this.boundingBox(endId);
    if (!a || !b) return undefined;
    const geo = connectorGeometry(a, b, opts);
    return this.addElement({
      kind: 'arrow',
      id,
      x: geo.x,
      y: geo.y,
      width: 0,
      height: 0,
      points: geo.points,
      start: startId,
      end: endId,
      ...(opts.startSide ? { startSide: opts.startSide } : {}),
      ...(opts.endSide ? { endSide: opts.endSide } : {}),
      ...(opts.startArrow ? { startArrow: true } : {}),
      ...(opts.endArrow ? { endArrow: true } : {}),
    });
  }

  /**
   * Re-routes every **bound** connector (line/arrow) whose both endpoints exist. Call after a
   * move/resize. Returns the number of connectors updated.
   */
  refreshConnectors(): number {
    let count = 0;
    for (const el of this.listElements()) {
      if ((el.kind === 'line' || el.kind === 'arrow') && el.start && el.end) {
        const a = this.boundingBox(el.start);
        const b = this.boundingBox(el.end);
        if (a && b) {
          const geo = connectorGeometry(a, b, {
            ...(el.startSide ? { startSide: el.startSide } : {}),
            ...(el.endSide ? { endSide: el.endSide } : {}),
            ...(el.midpoint !== undefined ? { midpoint: el.midpoint } : {}),
          });
          // **Isolation**: updating one connector must NOT interrupt the re-routing of the
          // others. `updateElement` throws on invalid geometry; without this guard, a single
          // degenerate link would freeze ALL subsequent links on move (see `connectorGeometry`,
          // ≥ 2 points guard).
          try {
            if (this.board.updateElement(el.id, { x: geo.x, y: geo.y, points: geo.points }))
              count++;
          } catch {
            // Connector skipped for this pass; the others keep being re-routed.
          }
        }
      }
    }
    return count;
  }

  /**
   * Moves (or recenters) the **elbow** of a bound connector: `value` = world coordinate of the
   * crossing segment (axis derived from the routing, see `connectorElbow`); `null` = back to the
   * **auto-centered** elbow. Persists `midpoint` then re-routes the connector. No-op `false` if
   * the element is not a connector bound at both existing endpoints.
   */
  setConnectorMidpoint(id: string, value: number | null): boolean {
    const el = this.board.getElement(id);
    if (!el || (el.kind !== 'line' && el.kind !== 'arrow') || !el.start || !el.end) return false;
    const a = this.boundingBox(el.start);
    const b = this.boundingBox(el.end);
    if (!a || !b) return false;
    if (!this.board.updateElement(id, { midpoint: value })) return false;
    const geo = connectorGeometry(a, b, {
      ...(el.startSide ? { startSide: el.startSide } : {}),
      ...(el.endSide ? { endSide: el.endSide } : {}),
      ...(value !== null ? { midpoint: value } : {}),
    });
    this.board.updateElement(id, { x: geo.x, y: geo.y, points: geo.points });
    return true;
  }

  // --- process board: swimlanes & groups (delegations to the CRDT board) ---

  addSwimlane(input: unknown): Swimlane {
    return this.board.addSwimlane(input);
  }
  updateSwimlane(id: string, patch: Partial<Omit<Swimlane, 'id'>>): boolean {
    return this.board.updateSwimlane(id, patch);
  }
  removeSwimlane(id: string): boolean {
    return this.board.removeSwimlane(id);
  }
  listSwimlanes(): Swimlane[] {
    return this.board.listSwimlanes();
  }
  /**
   * **Reorders** a lane to the target index (0-based, final position in the list sorted by `order`).
   * Renumbers the `order` field of every lane (`0..n-1`) **and moves the cards with their lane**:
   * each attached step (`swimlaneId`) is shifted in `y` by the change of its lane's **top**, so it
   * visually stays inside (dragging a lane = its content comes along). Re-routes the connectors.
   * No-op `false` if the id is unknown or the final index is unchanged.
   */
  reorderSwimlane(id: string, targetIndex: number): boolean {
    const lanes = this.listSwimlanes(); // sorted by `order`
    const from = lanes.findIndex((l) => l.id === id);
    if (from === -1) return false;
    const to = Math.max(0, Math.min(targetIndex, lanes.length - 1));
    if (to === from) return false;

    // Top of each lane BEFORE (sum of the heights above), to measure the card offset.
    const topBefore = new Map<string, number>();
    let acc = 0;
    for (const l of lanes) {
      topBefore.set(l.id, acc);
      acc += l.height;
    }

    // New order: remove the dragged lane then reinsert it at the target index.
    const reordered = [...lanes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);

    // Renumbers `order` (0..n-1) and records the new top of each lane.
    const topAfter = new Map<string, number>();
    acc = 0;
    for (let i = 0; i < reordered.length; i += 1) {
      const l = reordered[i]!;
      topAfter.set(l.id, acc);
      acc += l.height;
      if (l.order !== i) this.board.updateSwimlane(l.id, { order: i });
    }

    // Carries each lane's **content**, by **geometry**: any non-connector element whose CENTER
    // falls inside a lane follows that lane (shifted by the top delta). We do NOT restrict to
    // steps "attached" (`swimlaneId`) — a card simply **dropped/moved by hand** into a lane
    // (without swimlaneId) must follow too. Membership uses EXACTLY the `laneAtPoint`
    // semantics: center vertically inside the lane **AND** `x ∈ [0, shared width]` — an element
    // horizontally outside the lanes "belongs" to none and must not be moved. Connectors do not
    // move here: they re-route via `refreshConnectors` according to their endpoints.
    const width = this.getSwimlanesWidth();
    const laneAtCenter = (cx: number, cy: number): string | undefined => {
      if (cx < 0 || cx > width) return undefined; // outside the lanes' width → no lane
      for (const l of lanes) {
        const t = topBefore.get(l.id)!;
        if (cy >= t && cy < t + l.height) return l.id;
      }
      return undefined;
    };
    for (const el of this.listElements()) {
      if (el.kind === 'arrow' || el.kind === 'line') continue;
      const inLane = laneAtCenter(el.x + el.width / 2, el.y + el.height / 2);
      if (inLane === undefined) continue;
      const dy = (topAfter.get(inLane) ?? 0) - (topBefore.get(inLane) ?? 0);
      if (dy !== 0) this.board.updateElement(el.id, { y: el.y + dy });
    }

    this.refreshConnectors();
    return true;
  }
  getSwimlanesWidth(): number {
    return this.board.getSwimlanesWidth();
  }
  setSwimlanesWidth(width: number): void {
    this.board.setSwimlanesWidth(width);
  }
  /** Shared document name (`null` when unset) — synchronized in collab. */
  getName(): string | null {
    return this.board.getName();
  }
  /** Sets the shared document name (broadcast to peers). */
  setName(name: string): void {
    this.board.setName(name);
  }
  /** Board background color (`null` = theme default) — synchronized in collab. */
  getBackground(): string | null {
    return this.board.getBackground();
  }
  /** Sets the board background color; `null` resets it. Broadcast to peers. */
  setBackground(color: string | null): void {
    this.board.setBackground(color);
  }
  /** Id of the swimlane under the **world** point, or `undefined`. Stacked by `order`. */
  laneAtPoint(p: { x: number; y: number }): string | undefined {
    const width = this.getSwimlanesWidth();
    if (p.x < 0 || p.x > width) return undefined;
    let top = 0;
    for (const lane of this.listSwimlanes()) {
      if (p.y >= top && p.y < top + lane.height) return lane.id;
      top += lane.height;
    }
    return undefined;
  }

  /**
   * Swimlane bounding boxes (each lane = `{ x:0, y, width: shared width, height }`).
   * Used as **snapping/alignment targets**: a moved element can snap to the top/center/bottom
   * and the left/right edge of a lane, in addition to the other elements.
   */
  swimlaneBounds(): BoundingBox[] {
    const width = this.getSwimlanesWidth();
    let top = 0;
    const out: BoundingBox[] = [];
    for (const lane of this.listSwimlanes()) {
      out.push({ x: 0, y: top, width, height: lane.height });
      top += lane.height;
    }
    return out;
  }

  /** World ordinate of the top of swimlane `id` (sum of the heights of the lanes above). */
  laneTop(id: string): number {
    let top = 0;
    for (const lane of this.listSwimlanes()) {
      if (lane.id === id) return top;
      top += lane.height;
    }
    return top;
  }

  /**
   * Swimlane edge under the world point (mouse-resize handle):
   * - `{ laneId, edge: 'bottom' }`: bottom edge of a lane → resizes its **height**;
   * - `{ edge: 'right' }`: shared right edge → resizes the **width** of all lanes.
   * `tolerance` in world units (typically a few screen px / zoom).
   */
  laneEdgeAtPoint(
    p: { x: number; y: number },
    tolerance = 6,
  ): { laneId?: string; edge: 'bottom' | 'right' } | undefined {
    const lanes = this.listSwimlanes();
    if (lanes.length === 0) return undefined;
    const width = this.getSwimlanesWidth();
    let top = 0;
    let total = 0;
    for (const lane of lanes) total += lane.height;
    for (const lane of lanes) {
      const bottom = top + lane.height;
      if (Math.abs(p.y - bottom) <= tolerance && p.x >= 0 && p.x <= width) {
        return { laneId: lane.id, edge: 'bottom' };
      }
      top += lane.height;
    }
    if (Math.abs(p.x - width) <= tolerance && p.y >= 0 && p.y <= total) return { edge: 'right' };
    return undefined;
  }

  /**
   * Id of the swimlane whose **header** (top-left corner) is under the world point — used to
   * select a lane without capturing its whole background (marquee stays possible elsewhere).
   */
  laneHeaderAtPoint(
    p: { x: number; y: number },
    headerWidth = 180,
    headerHeight = 28,
  ): string | undefined {
    if (p.x < 0 || p.x > headerWidth) return undefined;
    let top = 0;
    for (const lane of this.listSwimlanes()) {
      if (p.y >= top && p.y < top + headerHeight) return lane.id;
      top += lane.height;
    }
    return undefined;
  }

  addAgentGroup(input: unknown): AgentGroup {
    return this.board.addAgentGroup(input);
  }
  updateAgentGroup(id: string, patch: Partial<Omit<AgentGroup, 'id'>>): boolean {
    return this.board.updateAgentGroup(id, patch);
  }
  removeAgentGroup(id: string): boolean {
    return this.board.removeAgentGroup(id);
  }
  listAgentGroups(): AgentGroup[] {
    return this.board.listAgentGroups();
  }

  // --- reading / geometry ---

  /** Lists the elements sorted by z-order (render order). */
  listElements(): WhiteboardElement[] {
    return this.board.listElements();
  }

  /** Lossless native snapshot. */
  toScene(): Scene {
    return this.board.toScene();
  }

  /** Loads a scene (replaces the content). */
  loadScene(scene: Scene): void {
    this.board.loadScene(scene);
    // The selection may reference vanished ids: it is cleaned lazily on read.
  }

  /** Bounding box of an element (world). `undefined` when missing. */
  boundingBox(id: string): BoundingBox | undefined {
    const element = this.board.getElement(id);
    return element ? elementBounds(element) : undefined;
  }

  /** Bounding box enclosing the current selection, or `undefined` when the selection is empty. */
  selectionBounds(): BoundingBox | undefined {
    const boxes = this.getSelection()
      .map((id) => this.board.getElement(id))
      .filter((e): e is WhiteboardElement => e !== undefined)
      .map(elementBounds);
    return unionBounds(boxes);
  }

  /**
   * Ready-to-draw render model: sorted elements + selection flag. The renderers
   * (`render.ts`) consume this without knowing about the CRDT.
   */
  toRenderModel(): RenderModel {
    const selected = new Set(this.getSelection());
    const elements = this.listElements();
    const boundsById = new Map(elements.map((e) => [e.id, elementBounds(e)]));

    // Stacked swimlanes: cumulative y following the order; shared width.
    const width = this.getSwimlanesWidth();
    let top = 0;
    const swimlanes = this.listSwimlanes().map((lane) => {
      const y = top;
      top += lane.height;
      return { lane, y, width };
    });

    // Groups: bounding box enclosing the member steps + margin.
    const GROUP_PADDING = 16;
    const agentGroups = this.listAgentGroups()
      .map((group) => {
        const boxes = group.stepIds
          .map((id) => boundsById.get(id))
          .filter((b): b is BoundingBox => b !== undefined);
        const union = unionBounds(boxes);
        if (!union) return undefined;
        return {
          group,
          bounds: {
            x: union.x - GROUP_PADDING,
            y: union.y - GROUP_PADDING,
            width: union.width + GROUP_PADDING * 2,
            height: union.height + GROUP_PADDING * 2,
          },
        };
      })
      .filter((g): g is RenderAgentGroup => g !== undefined);

    return {
      elements: elements.map((element) => ({
        element,
        selected: selected.has(element.id),
        bounds: boundsById.get(element.id) ?? elementBounds(element),
      })),
      swimlanes,
      agentGroups,
    };
  }

  /** Subscribes to board changes (collab + local editing). */
  observe(handler: () => void): () => void {
    return this.board.observe(handler);
  }
}

/** Element + rendering metadata. */
export interface RenderItem {
  readonly element: WhiteboardElement;
  readonly selected: boolean;
  readonly bounds: BoundingBox;
}

/** Swimlane positioned for rendering (cumulative y + shared width). */
export interface RenderSwimlane {
  readonly lane: Swimlane;
  readonly y: number;
  readonly width: number;
}

/** Group with its computed bounding box (encloses the member steps + margin). */
export interface RenderAgentGroup {
  readonly group: AgentGroup;
  readonly bounds: BoundingBox;
}

/** Target-independent render model (canvas/SVG/test). */
export interface RenderModel {
  readonly elements: readonly RenderItem[];
  readonly swimlanes: readonly RenderSwimlane[];
  readonly agentGroups: readonly RenderAgentGroup[];
}

/** Creates an engine on a fresh board (offline). */
export function createEngine(options: CreateDocOptions = {}): WhiteboardEngine {
  return new WhiteboardEngine(createBoard(options));
}

/** Creates an engine plugged on an existing Y.Doc (shared with the sync providers). */
export function engineFromDoc(doc: CrdtDoc): WhiteboardEngine {
  return new WhiteboardEngine(boardFromDoc(doc));
}

// --- geometry ---

/** Bounding box of an element, accounting for points (line/arrow) otherwise width/height. */
export function elementBounds(element: WhiteboardElement): BoundingBox {
  if (element.kind === 'line' || element.kind === 'arrow') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of element.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return {
      x: element.x + minX,
      y: element.y + minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

function unionBounds(boxes: readonly BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
