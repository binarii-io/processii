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
import type {
  AgentGroup,
  ConnectorSide,
  Scene,
  Swimlane,
  SwimlaneCluster,
  WhiteboardElement,
} from './scene.js';
import type { WhiteboardHistory } from './history.js';
import { connectorGeometry } from './connector.js';

/** Axis-aligned rectangle (world bounding box). */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Absolute world band of each lane, stacked **per cluster** from its (`x`, `y`) by ascending
 * `order`. Pure: used both for the live geometry (`this.clusterMap()`) and to simulate a proposed
 * layout (reorder/move/attach/detach) so element deltas can be computed before writing. A lane
 * whose cluster is absent from `clusters` falls back to origin with `fallbackWidth`.
 */
function stackBands(
  lanes: readonly Swimlane[],
  clusters: ReadonlyMap<string, { x: number; y: number; width: number }>,
  fallbackWidth: number,
): Map<string, BoundingBox> {
  const byCluster = new Map<string, Swimlane[]>();
  for (const lane of lanes) {
    const list = byCluster.get(lane.clusterId);
    if (list) list.push(lane);
    else byCluster.set(lane.clusterId, [lane]);
  }
  const out = new Map<string, BoundingBox>();
  for (const [clusterId, list] of byCluster) {
    const cluster = clusters.get(clusterId);
    const x = cluster?.x ?? 0;
    const width = cluster?.width ?? fallbackWidth;
    let top = cluster?.y ?? 0;
    const sorted = [...list].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const lane of sorted) {
      out.set(lane.id, { x, y: top, width, height: lane.height });
      top += lane.height;
    }
  }
  return out;
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

  // --- swimlane clusters (v2: freely-positioned aligned lane blocks) ---

  /** Clusters referenced by ≥1 lane, with their (stored or synthesized) position/size. */
  listSwimlaneClusters(): SwimlaneCluster[] {
    return this.board.listSwimlaneClusters();
  }
  /** A referenced cluster, or `undefined`. */
  getSwimlaneCluster(id: string): SwimlaneCluster | undefined {
    return this.board.getSwimlaneCluster(id);
  }
  /** Writes a cluster override (existence still requires a lane referencing it). */
  addSwimlaneCluster(input: unknown): SwimlaneCluster {
    return this.board.addSwimlaneCluster(input);
  }
  /** Patches a cluster's position/size (materializes a synthesized cluster on first write). */
  updateSwimlaneCluster(id: string, patch: Partial<Omit<SwimlaneCluster, 'id'>>): boolean {
    return this.board.updateSwimlaneCluster(id, patch);
  }
  /** Removes a cluster override (a still-referenced cluster reverts to the synthesized default). */
  removeSwimlaneCluster(id: string): boolean {
    return this.board.removeSwimlaneCluster(id);
  }

  /** Current clusters keyed by id (for local geometry simulation). */
  private clusterMap(): Map<string, SwimlaneCluster> {
    return new Map(this.listSwimlaneClusters().map((c) => [c.id, c]));
  }

  /**
   * Shifts every non-connector element by the delta of its owning lane's band (before → after).
   * Membership is decided ONCE from the before-bands (element center inside a band). This is the
   * single "content follows its lane" primitive shared by reorder/move/attach/detach.
   */
  private shiftContentByLaneDelta(
    before: ReadonlyMap<string, BoundingBox>,
    after: ReadonlyMap<string, BoundingBox>,
  ): void {
    for (const el of this.listElements()) {
      if (el.kind === 'arrow' || el.kind === 'line') continue;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      // Clusters are freely positioned and can overlap, so a center may fall in several bands. An
      // explicit `swimlaneId` assignment wins over raw geometry; otherwise the first match is kept.
      const assigned = el.kind === 'step' ? el.swimlaneId : undefined;
      let owner: string | undefined;
      let fallback: string | undefined;
      for (const [id, b] of before) {
        if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy < b.y + b.height) {
          if (id === assigned) {
            owner = id;
            break;
          }
          if (fallback === undefined) fallback = id;
        }
      }
      owner = owner ?? fallback;
      if (owner === undefined) continue;
      const a = after.get(owner);
      const b0 = before.get(owner)!;
      if (!a) continue;
      const dx = a.x - b0.x;
      const dy = a.y - b0.y;
      if (dx !== 0 || dy !== 0) this.board.updateElement(el.id, { x: el.x + dx, y: el.y + dy });
    }
  }

  /** Writes the `clusterId`/`order` diffs of `after` vs `before` (no-op when unchanged). */
  private applyLaneAssignments(after: readonly Swimlane[], before: readonly Swimlane[]): void {
    const byId = new Map(before.map((l) => [l.id, l]));
    for (const lane of after) {
      const prev = byId.get(lane.id);
      if (!prev) continue;
      const patch: Partial<Omit<Swimlane, 'id'>> = {};
      if (lane.clusterId !== prev.clusterId) patch.clusterId = lane.clusterId;
      if (lane.order !== prev.order) patch.order = lane.order;
      if (Object.keys(patch).length > 0) this.board.updateSwimlane(lane.id, patch);
    }
  }

  /**
   * **Atomically** commits a lane reassignment (attach/detach share this): optional new cluster
   * override, the lane `clusterId`/`order` diffs, the content shift, an optional empty-source
   * cluster cleanup, and connector re-routing — all in ONE transaction so a peer can never observe
   * the lane pointing at a cluster whose override write hasn't landed yet.
   */
  private commitReassign(
    before: ReadonlyMap<string, BoundingBox>,
    after: ReadonlyMap<string, BoundingBox>,
    afterLanes: readonly Swimlane[],
    lanes: readonly Swimlane[],
    opts: { addCluster?: SwimlaneCluster; removeEmptyCluster?: string } = {},
  ): void {
    this.board.transact(() => {
      if (opts.addCluster) this.board.addSwimlaneCluster(opts.addCluster);
      this.applyLaneAssignments(afterLanes, lanes);
      this.shiftContentByLaneDelta(before, after);
      // Drop a now-empty source override (identity is lane membership; an empty cluster is dead).
      if (
        opts.removeEmptyCluster !== undefined &&
        !afterLanes.some((l) => l.clusterId === opts.removeEmptyCluster)
      ) {
        this.board.removeSwimlaneCluster(opts.removeEmptyCluster);
      }
      this.refreshConnectors();
    });
  }

  /**
   * Reassigns `laneId` to `targetClusterId` at `atIndex` (default: appended), returning the FULL
   * lane list with both the source and target clusters renumbered contiguously (0..n-1). Pure.
   */
  private reassignLanes(
    lanes: readonly Swimlane[],
    laneId: string,
    targetClusterId: string,
    atIndex?: number,
  ): Swimlane[] {
    const moved = lanes.find((l) => l.id === laneId);
    if (!moved) return [...lanes];
    const sourceId = moved.clusterId;
    const byOrder = (a: Swimlane, b: Swimlane): number =>
      a.order - b.order || a.id.localeCompare(b.id);
    const targetLanes = lanes
      .filter((l) => l.clusterId === targetClusterId && l.id !== laneId)
      .sort(byOrder);
    const insertAt = Math.max(0, Math.min(atIndex ?? targetLanes.length, targetLanes.length));
    const newTarget = [...targetLanes];
    newTarget.splice(insertAt, 0, moved);
    const sourceLanes = lanes
      .filter((l) => l.clusterId === sourceId && l.id !== laneId)
      .sort(byOrder);
    const assign = new Map<string, { clusterId: string; order: number }>();
    newTarget.forEach((l, i) => assign.set(l.id, { clusterId: targetClusterId, order: i }));
    if (sourceId !== targetClusterId)
      sourceLanes.forEach((l, i) => assign.set(l.id, { clusterId: sourceId, order: i }));
    return lanes.map((l) => {
      const a = assign.get(l.id);
      return a ? { ...l, clusterId: a.clusterId, order: a.order } : l;
    });
  }

  /**
   * **Reorders** a lane to `targetIndex` **within its own cluster** (0-based). Renumbers that
   * cluster's `order` (0..n-1) and shifts each lane's content by its band-top change (content
   * follows its lane, by geometry — `swimlaneId` not required). Re-routes connectors. No-op
   * `false` if the id is unknown or the index is unchanged.
   */
  reorderSwimlane(id: string, targetIndex: number): boolean {
    const lanes = this.listSwimlanes();
    const lane = lanes.find((l) => l.id === id);
    if (!lane) return false;
    const clusterLanes = lanes.filter((l) => l.clusterId === lane.clusterId);
    const from = clusterLanes.findIndex((l) => l.id === id);
    const to = Math.max(0, Math.min(targetIndex, clusterLanes.length - 1));
    if (to === from) return false;

    const clusters = this.clusterMap();
    const width = this.getSwimlanesWidth();
    const before = stackBands(lanes, clusters, width);

    const reordered = [...clusterLanes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    const newOrder = new Map(reordered.map((l, i) => [l.id, i]));
    const afterLanes = lanes.map((l) =>
      newOrder.has(l.id) ? { ...l, order: newOrder.get(l.id)! } : l,
    );
    const after = stackBands(afterLanes, clusters, width);

    this.board.transact(() => {
      reordered.forEach((l, i) => {
        if (l.order !== i) this.board.updateSwimlane(l.id, { order: i });
      });
      this.shiftContentByLaneDelta(before, after);
      this.refreshConnectors();
    });
    return true;
  }

  /**
   * Translates a whole cluster (its position + the content of every lane in it) by (dx, dy).
   * No-op `false` when the cluster is unknown or the delta is zero.
   */
  moveCluster(clusterId: string, dx: number, dy: number): boolean {
    const clusters = this.clusterMap();
    const cluster = clusters.get(clusterId);
    if (!cluster || (dx === 0 && dy === 0)) return false;
    const lanes = this.listSwimlanes();
    const width = this.getSwimlanesWidth();
    const before = stackBands(lanes, clusters, width);
    const afterClusters = new Map(clusters);
    afterClusters.set(clusterId, { ...cluster, x: cluster.x + dx, y: cluster.y + dy });
    const after = stackBands(lanes, afterClusters, width);

    this.board.transact(() => {
      this.board.updateSwimlaneCluster(clusterId, { x: cluster.x + dx, y: cluster.y + dy });
      this.shiftContentByLaneDelta(before, after);
      this.refreshConnectors();
    });
    return true;
  }

  /**
   * **Attaches** a lane into `targetClusterId` at `atIndex` (default: appended at the bottom). The
   * lane adopts the target cluster's `x`/`width`; its content travels to the new band; the target
   * `order` is renumbered to make room and the source cluster is reflowed (its content shifts up to
   * close the gap). Same-cluster call with an index degrades to `reorderSwimlane`. No-op `false`
   * when the lane or target cluster is unknown.
   */
  attachSwimlane(laneId: string, targetClusterId: string, atIndex?: number): boolean {
    const lanes = this.listSwimlanes();
    const lane = lanes.find((l) => l.id === laneId);
    if (!lane) return false;
    if (lane.clusterId === targetClusterId)
      return atIndex === undefined ? false : this.reorderSwimlane(laneId, atIndex);
    const clusters = this.clusterMap();
    if (!clusters.has(targetClusterId)) return false;
    const width = this.getSwimlanesWidth();
    const sourceId = lane.clusterId;

    const before = stackBands(lanes, clusters, width);
    const afterLanes = this.reassignLanes(lanes, laneId, targetClusterId, atIndex);
    const after = stackBands(afterLanes, clusters, width);

    this.commitReassign(before, after, afterLanes, lanes, { removeEmptyCluster: sourceId });
    return true;
  }

  /**
   * **Detaches** a lane into its own new cluster positioned at (x, y). The new cluster id is
   * DETERMINISTIC and **injective** in the lane (`cluster-of:<laneId>`) — a fixed prefix on the
   * unique lane id, so two peers detaching the same lane converge on the same id (no orphan) and
   * distinct lanes never collide (unlike a `<source>:<lane>` join, where colons in the source id
   * make the mapping ambiguous). The lane adopts the source cluster's width; its content travels
   * with it; the source cluster is reflowed. No-op `false` if the lane is unknown or is already
   * alone in its cluster. Whole op is one atomic transaction.
   */
  detachSwimlaneTo(laneId: string, x: number, y: number): boolean {
    const lanes = this.listSwimlanes();
    const lane = lanes.find((l) => l.id === laneId);
    if (!lane) return false;
    const sourceId = lane.clusterId;
    if (lanes.filter((l) => l.clusterId === sourceId).length <= 1) return false; // already alone
    const newClusterId = `cluster-of:${laneId}`;
    if (newClusterId === sourceId) return false;
    const clusters = this.clusterMap();
    const width = this.getSwimlanesWidth();
    const laneWidth = clusters.get(sourceId)?.width ?? width;

    const before = stackBands(lanes, clusters, width);
    const afterLanes = this.reassignLanes(lanes, laneId, newClusterId, 0);
    const afterClusters = new Map(clusters);
    afterClusters.set(newClusterId, { id: newClusterId, x, y, width: laneWidth });
    const after = stackBands(afterLanes, afterClusters, width);

    this.commitReassign(before, after, afterLanes, lanes, {
      addCluster: { id: newClusterId, x, y, width: laneWidth },
    });
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
  /** Y.Doc schema version stamped in this document (see `DOC_SCHEMA_VERSION`). */
  getSchemaVersion(): number {
    return this.board.getSchemaVersion();
  }
  /**
   * Throws `WhiteboardSchemaVersionError` when the document is newer than this build supports. Call
   * after hydration (persistence `whenLoaded`, remote sync); see `WhiteboardBoard.assertReadable`.
   */
  assertReadable(): void {
    this.board.assertReadable();
  }
  /**
   * Absolute world band of every lane, stacked **per cluster** from its (`x`, `y`). The single
   * source of truth for all lane geometry (hit-test, edges, header, render). Computed on demand.
   */
  private laneBands(): Map<string, BoundingBox> {
    // Fetch the lanes ONCE and thread them into the cluster projection (which would otherwise
    // re-read + re-parse the whole lane collection) — this is the hottest geometry call.
    const lanes = this.listSwimlanes();
    const clusters = new Map(this.board.listSwimlaneClusters(lanes).map((c) => [c.id, c]));
    return stackBands(lanes, clusters, this.getSwimlanesWidth());
  }

  /** Id of the swimlane under the **world** point, or `undefined`. */
  laneAtPoint(p: { x: number; y: number }): string | undefined {
    for (const [id, b] of this.laneBands()) {
      if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return id;
    }
    return undefined;
  }

  /**
   * Swimlane bounding boxes (per-cluster positioned `{ x, y, width, height }`).
   * Used as **snapping/alignment targets**: a moved element can snap to the top/center/bottom
   * and the left/right edge of a lane, in addition to the other elements.
   */
  swimlaneBounds(): BoundingBox[] {
    return [...this.laneBands().values()];
  }

  /** World band (rect) of swimlane `id`, or `undefined`. */
  laneBand(id: string): BoundingBox | undefined {
    return this.laneBands().get(id);
  }

  /** World ordinate of the top of swimlane `id` (its cluster's y + the lanes above it). */
  laneTop(id: string): number {
    return this.laneBands().get(id)?.y ?? 0;
  }

  /** Overall rect of each cluster (its `x`/`width` and the vertical span of its lanes). */
  clusterBounds(): { cluster: SwimlaneCluster; bounds: BoundingBox }[] {
    const bands = this.laneBands();
    const lanesByCluster = new Map<string, string[]>();
    for (const lane of this.listSwimlanes()) {
      const list = lanesByCluster.get(lane.clusterId);
      if (list) list.push(lane.id);
      else lanesByCluster.set(lane.clusterId, [lane.id]);
    }
    const out: { cluster: SwimlaneCluster; bounds: BoundingBox }[] = [];
    for (const cluster of this.listSwimlaneClusters()) {
      const ids = lanesByCluster.get(cluster.id) ?? [];
      const rects = ids.map((id) => bands.get(id)).filter((b): b is BoundingBox => b !== undefined);
      if (rects.length === 0) continue;
      const yTop = Math.min(...rects.map((b) => b.y));
      const yBot = Math.max(...rects.map((b) => b.y + b.height));
      out.push({
        cluster,
        bounds: { x: cluster.x, y: yTop, width: cluster.width, height: yBot - yTop },
      });
    }
    return out;
  }

  /**
   * Swimlane edge under the world point (mouse-resize handle):
   * - `{ laneId, edge: 'bottom' }`: bottom edge of a lane → resizes its **height**;
   * - `{ clusterId, edge: 'right' }`: a cluster's right edge → resizes **that cluster's** width.
   * `tolerance` in world units (typically a few screen px / zoom).
   */
  laneEdgeAtPoint(
    p: { x: number; y: number },
    tolerance = 6,
  ): { laneId?: string; clusterId?: string; edge: 'bottom' | 'right' } | undefined {
    const bands = this.laneBands();
    for (const [id, b] of bands) {
      const bottom = b.y + b.height;
      if (Math.abs(p.y - bottom) <= tolerance && p.x >= b.x && p.x <= b.x + b.width) {
        return { laneId: id, edge: 'bottom' };
      }
    }
    for (const { cluster, bounds } of this.clusterBounds()) {
      const right = cluster.x + cluster.width;
      if (
        Math.abs(p.x - right) <= tolerance &&
        p.y >= bounds.y &&
        p.y <= bounds.y + bounds.height
      ) {
        return { clusterId: cluster.id, edge: 'right' };
      }
    }
    return undefined;
  }

  /**
   * Id of the swimlane whose **header** (top-left corner) is under the world point — used to
   * select/drag a lane without capturing its whole background (marquee stays possible elsewhere).
   */
  laneHeaderAtPoint(
    p: { x: number; y: number },
    headerWidth = 180,
    headerHeight = 28,
  ): string | undefined {
    for (const [id, b] of this.laneBands()) {
      if (p.x >= b.x && p.x <= b.x + headerWidth && p.y >= b.y && p.y < b.y + headerHeight)
        return id;
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

    // Swimlanes: each positioned by its cluster (x, y) and stacked within it.
    const bands = this.laneBands();
    const swimlanes = this.listSwimlanes().map((lane) => {
      const b = bands.get(lane.id);
      return { lane, x: b?.x ?? 0, y: b?.y ?? 0, width: b?.width ?? this.getSwimlanesWidth() };
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

/** Swimlane positioned for rendering (its cluster's `x`/`width`, stacked `y`). */
export interface RenderSwimlane {
  readonly lane: Swimlane;
  readonly x: number;
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
