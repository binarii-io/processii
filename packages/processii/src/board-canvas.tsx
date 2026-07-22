import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { boxFromPoints, elementsInBox, hitTest, DEFAULT_HIT_TOLERANCE } from './hit-test.js';
import {
  handleAtPoint,
  hasHandles,
  resizeElement,
  rotateElement,
  MIN_ELEMENT_SIZE,
  type HandleKind,
} from './handles.js';
import { isColorToken, renderToCanvas, type CanvasLike } from './render.js';
import {
  panBy,
  screenToWorld,
  worldToScreen,
  viewportCenter,
  zoomAt,
  IDENTITY_VIEWPORT,
  type Point,
  type Size,
  type Viewport,
} from './viewport.js';
import { snapMove, snapResize } from './snap.js';
import { connectorElbow } from './connector.js';
import { createMemoryClipboard, type WhiteboardClipboard } from './clipboard.js';
import type { BoundingBox, WhiteboardEngine } from './engine.js';
import type { WhiteboardElement } from './scene.js';
import type { CrdtAwareness } from './crdt/index.js';
import { StylePanel } from './style-panel.js';
import { ZoomControl } from './zoom-control.js';
import {
  observePresence,
  publishCursor,
  publishSelection,
  readRemoteCursors,
  readRemoteSelections,
  type RemoteCursor,
  type RemoteSelection,
} from './presence.js';

/**
 * Interactive drawing surface of the process board: mounts a `WhiteboardEngine` on a 2D `<canvas>`,
 * rendered through a **viewport** (zoom/pan, local state). The canvas **fills its container** (size
 * measured with `ResizeObserver`) unless `width`/`height` are provided (tests).
 *
 * Interactions: selection (click / shift / marquee), move (with snapping), resize+rotate handles,
 * **mouse-driven swimlane resizing** (bottom edge = height, right edge = shared width),
 * lane selection (header click), double-click = text/name editing, wheel pan / ⌘-wheel zoom,
 * space/middle-click pan, keyboard undo/redo, Delete/Escape. The **cursor** reflects the available action.
 */
/** Imperative zoom actions surfaced by {@link BoardCanvas} through `onZoomApi`. */
export interface ZoomApi {
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly reset: () => void;
  /** Pans the view (keeping the current zoom) so the world point `world` sits at the canvas center. */
  readonly centerOn: (world: Point) => void;
}

export interface BoardCanvasProps {
  readonly engine: WhiteboardEngine;
  /** Fixed size (tests); otherwise the canvas fills its container. */
  readonly width?: number;
  readonly height?: number;
  readonly onChange?: () => void;
  readonly awareness?: CrdtAwareness;
  readonly selectedLaneId?: string | null;
  readonly onSelectLane?: (id: string | null) => void;
  /** Selected group (highlighted); selected by clicking its header. Editing is done in the side panel. */
  readonly selectedGroupId?: string | null;
  readonly onSelectGroup?: (id: string | null) => void;
  /** Sub-process: double-click on a linked step → "enter" the `ref` child whiteboard. */
  readonly onNavigateSubprocess?: (ref: string) => void;
  /** Initial zoom (and "reset view" zoom). Defaults to `1`. Used e.g. to zoom out an embedded
   *  demo on a small screen so the whole board fits without changing its proportions. */
  readonly initialZoom?: number;
  /**
   * Notified whenever the local **viewport** (pan/zoom) or the canvas **size** changes. Lets the
   * host (e.g. `WhiteboardEditor`) place freshly created items at the center of what the user is
   * currently looking at (`viewportCenter`) instead of a fixed world position. Local presentation
   * state only — never persisted or shared.
   */
  readonly onViewportChange?: (viewport: Viewport, size: Size) => void;
  /** Hide the built-in zoom control so the host can render its own {@link ZoomControl} (e.g. inside
   *  a floating bottom bar), wired via {@link onZoomApi}. */
  readonly hideZoomControl?: boolean;
  /** Receives the zoom actions once available (and again when they change, e.g. on canvas resize),
   *  so a host can drive an external {@link ZoomControl}. */
  readonly onZoomApi?: (api: ZoomApi) => void;
  /**
   * Storage medium for copy/paste (`Ctrl/⌘+C`/`X`/`V`). Injected by the host to back the clipboard
   * with the **system clipboard** (`navigator.clipboard`, works across tabs) — see
   * {@link WhiteboardClipboard}. Omitted → a shared **in-memory** clipboard: copy/paste works within
   * the same page (across boards) but not across tabs.
   */
  readonly clipboard?: WhiteboardClipboard;
  /**
   * Right-click on the surface. Called with the pointer **page** coordinates (for a fixed-position
   * menu) and the **selection to act on** — right-clicking an unselected element selects it first;
   * right-clicking empty space clears the selection (`ids` empty). The native browser menu is
   * suppressed only when this is provided, so the host can render its own context menu (z-order,
   * copy/paste…). Omitted → the browser's default menu shows.
   */
  readonly onContextMenu?: (at: Point, ids: string[]) => void;
}

/**
 * Default clipboard when the host injects none. **Module-level** (shared by every `BoardCanvas` on
 * the page) so a copy in one board pastes into another opened in the same SPA. Never crosses tabs
 * (a host wires a `navigator.clipboard` adapter for that).
 */
const sharedMemoryClipboard = createMemoryClipboard();

/** Snapping threshold, in screen pixels (converted to world units via the zoom). */
const SNAP_SCREEN_THRESHOLD = 6;
/** Tolerance (screen px) to grab a swimlane edge. */
const LANE_EDGE_TOLERANCE = 6;
/**
 * Magnetic threshold (screen px) for a dragged lane to attach to / stay in a cluster. Larger than
 * the plain snap so lane attach feels "sticky"; beyond it the lane detaches into its own cluster.
 */
const LANE_MAGNET_THRESHOLD = 28;
/** Width (screen px) of the cluster **move grip** on a cluster's left edge (drag = move the block). */
const LANE_GRIP_WIDTH = 12;

/** CSS cursor per transform-handle kind. */
const HANDLE_CURSOR: Record<HandleKind, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  rotate: 'grab',
};

/** Transient state of an in-progress pointer gesture. */
type Interaction =
  | { readonly mode: 'idle' }
  | { readonly mode: 'panning'; lastScreen: Point }
  | {
      readonly mode: 'moving';
      readonly startWorld: Point;
      readonly startBounds: BoundingBox;
      readonly otherBounds: readonly BoundingBox[];
      applied: Point;
    }
  | {
      readonly mode: 'resizing';
      readonly id: string;
      readonly handle: Exclude<HandleKind, 'rotate'>;
      // Snap targets (other elements + swimlanes), captured once at the start of the gesture.
      readonly otherBounds: readonly BoundingBox[];
    }
  | { readonly mode: 'rotating'; readonly id: string }
  | { readonly mode: 'laneResizeH'; readonly laneId: string }
  | { readonly mode: 'laneResizeW'; readonly clusterId: string }
  | {
      // Header drag of a single lane: preview only, committed on release as reorder / attach / detach.
      readonly mode: 'laneMove';
      readonly laneId: string;
      readonly clusterId: string;
      readonly grabDx: number;
      readonly grabDy: number;
    }
  | {
      // Grip drag of a whole cluster: live translation (lanes + contents) with edge snapping.
      readonly mode: 'clusterMove';
      readonly clusterId: string;
      readonly startWorld: Point;
      readonly startBounds: BoundingBox;
      readonly otherBounds: readonly BoundingBox[];
      applied: Point;
    }
  | { readonly mode: 'marquee'; readonly startWorld: Point; readonly additive: boolean };

/**
 * Drop slot for a cursor at world ordinate `y` over a cluster's `lanes` (in order, stacked from
 * `clusterTop`): the hovered lane's top half inserts before it, the bottom half after. Returns the
 * insertion `boundary` (0..n) and the world `dropY` (top of that boundary, for the drop line).
 */
function dropSlot(
  lanes: readonly { readonly height: number }[],
  clusterTop: number,
  y: number,
): { boundary: number; dropY: number } {
  const tops: number[] = [];
  let acc = clusterTop;
  for (const lane of lanes) {
    tops.push(acc);
    acc += lane.height;
  }
  let hovered = 0;
  for (let i = 0; i < lanes.length; i += 1) if (y >= tops[i]!) hovered = i;
  const boundary =
    lanes.length === 0
      ? 0
      : y < tops[hovered]! + lanes[hovered]!.height / 2
        ? hovered
        : hovered + 1;
  let dropY = clusterTop;
  for (let i = 0; i < boundary; i += 1) dropY += lanes[i]!.height;
  return { boundary, dropY };
}

function screenPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Connection-handle directions (N/E/S/W). */
type ConnectDir = 'n' | 'e' | 's' | 'w';
const CONNECT_DIRS: readonly ConnectDir[] = ['n', 'e', 's', 'w'];

/** **World** point at the middle of a box side (anchor of a connector/connection handle). */
function sideAnchor(b: BoundingBox, dir: ConnectDir): Point {
  switch (dir) {
    case 'n':
      return { x: b.x + b.width / 2, y: b.y };
    case 's':
      return { x: b.x + b.width / 2, y: b.y + b.height };
    case 'w':
      return { x: b.x, y: b.y + b.height / 2 };
    case 'e':
      return { x: b.x + b.width, y: b.y + b.height / 2 };
  }
}

/** Opposite side (to anchor the created shape facing the source). */
function oppositeSide(dir: ConnectDir): ConnectDir {
  return dir === 'n' ? 's' : dir === 's' ? 'n' : dir === 'e' ? 'w' : 'e';
}

/** Side of `box` closest to point `p` (to anchor on the drop target). */
function nearestSide(box: BoundingBox, p: Point): ConnectDir {
  const d = {
    w: Math.abs(p.x - box.x),
    e: Math.abs(p.x - (box.x + box.width)),
    n: Math.abs(p.y - box.y),
    s: Math.abs(p.y - (box.y + box.height)),
  };
  return (Object.keys(d) as ConnectDir[]).reduce((best, k) => (d[k] < d[best] ? k : best), 'w');
}

/** Generates an element id (prefix distinct from other id sources, collision-free). */
let connSeq = 0;
function genElementId(): string {
  connSeq += 1;
  return `el-${Date.now().toString(36)}-q${connSeq}`;
}

/**
 * Builds a token → **actual color** resolver reading the active theme (`--color-<token>` via
 * `getComputedStyle`). Required for the 2D Canvas, which cannot paint `var(--color-…)`.
 * Rebuilt on every frame → follows the light/dark theme.
 */
function makeColorResolver(): (value: string) => string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return (value) => value;
  }
  const styles = getComputedStyle(document.documentElement);
  const cache = new Map<string, string>();
  return (value) => {
    if (value === 'transparent' || value === 'none') return 'transparent';
    if (!isColorToken(value)) return value;
    let resolved = cache.get(value);
    if (resolved === undefined) {
      resolved = styles.getPropertyValue(`--color-${value}`).trim() || value;
      cache.set(value, resolved);
    }
    return resolved;
  };
}

/** CSS color for the DOM (editing overlay): token → var(--color-…), literal → as-is. */
function cssColor(value: string): string {
  if (value === 'transparent' || value === 'none') return 'transparent';
  return isColorToken(value) ? `var(--color-${value})` : value;
}

/**
 * **contentEditable** in-place editor: renders exactly like the card (h+v centering via flex for
 * a step) → what you type matches what will be displayed. Uncontrolled: initial value set on
 * mount, read on commit. Enter commits, Shift+Enter inserts a newline, Escape cancels.
 */
function InlineEditor({
  initial,
  style,
  decoration,
  onCommit,
  onCancel,
}: {
  initial: string;
  style: React.CSSProperties | undefined;
  /** `text-decoration-line` (underline/strikethrough): set on the editable because it is not inherited by a child block. */
  decoration: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    el.focus();
    if (typeof window !== 'undefined' && window.getSelection && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // Mount-only: we do not resync the DOM on keystrokes (uncontrolled).
  }, [initial]);
  // The **container** owns the box (position/background/border/centering); the **editable** is a child
  // inheriting the typography. A flex-centered contentEditable shows its caret at the top while it is
  // empty; making it a child of the flex container guarantees one line → caret centered from the start.
  return (
    <div className="absolute" style={style}>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Éditer le texte"
        className="outline-none"
        style={{ width: '100%', textDecorationLine: decoration }}
        onBlur={() => onCommit(ref.current?.textContent ?? '')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onCommit(ref.current?.textContent ?? '');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}

export function BoardCanvas({
  engine,
  width,
  height,
  onChange,
  awareness,
  selectedLaneId,
  onSelectLane,
  selectedGroupId,
  onSelectGroup,
  onNavigateSubprocess,
  initialZoom = 1,
  onViewportChange,
  hideZoomControl,
  onZoomApi,
  clipboard = sharedMemoryClipboard,
  onContextMenu,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fixedSize = width !== undefined && height !== undefined;
  const [measured, setMeasured] = useState({ w: width ?? 800, h: height ?? 600 });
  const size = fixedSize ? { w: width, h: height } : measured;
  // Shared board background color (re-read on every render; the parent forces a render via onChange).
  const background = engine.getBackground();
  // Canvas rendering scale. We target the screen density (Retina/HiDPI) BUT with a **minimum of 2×**
  // (supersampling): on a 1× screen, drawing at 2× then letting the browser downscale noticeably
  // smooths edges (curves, rounded corners, text) — as close as possible to the extension's vector
  // rendering. Capped at 3× for performance. (Without this, a 1× bitmap looks jagged on rounded shapes.)
  const dpr =
    typeof window !== 'undefined' ? Math.min(Math.max(window.devicePixelRatio || 1, 2), 3) : 2;

  const [viewport, setViewportState] = useState<Viewport>(IDENTITY_VIEWPORT);
  const vpRef = useRef<Viewport>(viewport);
  const interaction = useRef<Interaction>({ mode: 'idle' });
  const marquee = useRef<BoundingBox | undefined>(undefined);
  // Ids intersected by the in-progress marquee (selection preview before release).
  const marqueeHits = useRef<string[]>([]);
  const guides = useRef<{ x?: number; y?: number } | undefined>(undefined);
  // Preview of the **lane header drag**: ghost (translucent lane following the cursor, in world
  // coords) + optional drop line (reorder/attach) + the action to commit on release.
  const laneDrag = useRef<
    | {
        ghost: BoundingBox;
        dropLine?: { x0: number; x1: number; y: number };
        commit:
          | { kind: 'reorder'; laneId: string; targetIndex: number }
          | { kind: 'attach'; laneId: string; targetClusterId: string; atIndex: number }
          | { kind: 'detach'; laneId: string; x: number; y: number }
          | { kind: 'none' };
      }
    | undefined
  >(undefined);
  // Cluster whose left-edge move grip is currently hovered → the grip is revealed only then (kept in
  // a ref: the canvas is redrawn directly, no React re-render on every hover move).
  const hoveredGripCluster = useRef<string | null>(null);
  const spaceHeld = useRef(false);
  const [percent, setPercent] = useState(100);
  const [editing, setEditing] = useState<{
    id: string;
    field: 'text' | 'name';
    value: string;
  } | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  // Remote selections (collab): drawn on the canvas → kept in a ref (no React re-render).
  const remoteSelectionsRef = useRef<RemoteSelection[]>([]);
  // Last published local selection (key) → avoids rewriting the awareness on every draw.
  const lastSelKeyRef = useRef<string | null>(null);
  // Measured width of the contextual style bar → to keep it inside the frame (horizontal clamp).
  const [styleBarW, setStyleBarW] = useState(0);
  const styleBarRef = useRef<HTMLDivElement | null>(null);
  // Hovered element (box) → shows the N/E/S/W connection handles.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Connector drag from a handle: start (click) in a ref, live line (screen) in state.
  const connectRef = useRef<{
    fromId: string;
    dir: ConnectDir;
    startX: number;
    startY: number;
  } | null>(null);
  const [connectLine, setConnectLine] = useState<{
    ax: number;
    ay: number;
    tx: number;
    ty: number;
  } | null>(null);
  // Target hovered during a connector drag → shows its anchor points (drop zones).
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  // Active side (closest to the cursor) on the target → only that anchor point is highlighted.
  const [dragSide, setDragSide] = useState<ConnectDir | null>(null);
  // World origin (0,0) centered on screen: wait for the first real measure, then center once.
  const hasMeasuredRef = useRef(false);
  const centeredRef = useRef(false);

  const setViewport = useCallback((next: Viewport): void => {
    vpRef.current = next;
    setViewportState(next);
    setPercent(Math.round(next.zoom * 100));
  }, []);

  // Resets the view: 100% zoom and **world origin (0,0) at the middle** of the canvas.
  const resetView = useCallback((): void => {
    setViewport({ x: size.w / 2, y: size.h / 2, zoom: initialZoom });
  }, [setViewport, size.w, size.h, initialZoom]);

  // Zoom in/out around the canvas centre. Exposed to the host (`onZoomApi`) so an external zoom
  // control can drive them; also used by the built-in one.
  const zoomIn = useCallback(
    () => setViewport(zoomAt(vpRef.current, 1.2, { x: size.w / 2, y: size.h / 2 })),
    [setViewport, size.w, size.h],
  );
  const zoomOut = useCallback(
    () => setViewport(zoomAt(vpRef.current, 1 / 1.2, { x: size.w / 2, y: size.h / 2 })),
    [setViewport, size.w, size.h],
  );
  // Pans so a world point lands at the canvas center (current zoom kept). Used e.g. to reveal a
  // freshly created swimlane that landed off-screen at the bottom of a tall cluster.
  const centerOn = useCallback(
    (world: Point): void => {
      const { zoom } = vpRef.current;
      setViewport({ x: size.w / 2 - world.x * zoom, y: size.h / 2 - world.y * zoom, zoom });
    },
    [setViewport, size.w, size.h],
  );
  useEffect(() => {
    onZoomApi?.({ zoomIn, zoomOut, reset: resetView, centerOn });
  }, [onZoomApi, zoomIn, zoomOut, resetView, centerOn]);

  // Responsive size: measures the container (unless a fixed size is imposed by the tests).
  useEffect(() => {
    if (fixedSize) return;
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        hasMeasuredRef.current = true;
        setMeasured({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fixedSize]);

  // Centers the world origin (0,0) at the middle of the canvas, **once**, on the first real measure.
  useEffect(() => {
    if (fixedSize || centeredRef.current || !hasMeasuredRef.current) return;
    if (size.w > 0 && size.h > 0) {
      centeredRef.current = true;
      resetView();
    }
  }, [fixedSize, size.w, size.h, resetView]);

  // Mirror the viewport (pan/zoom) and canvas size to the host after each change, so it can drop
  // freshly created items at the center of the visible area (see `onViewportChange`). Cheap: the
  // host just stores the latest value; it does not force a re-render here.
  useEffect(() => {
    onViewportChange?.(viewport, { width: size.w, height: size.h });
  }, [onViewportChange, viewport, size.w, size.h]);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    // Base = HiDPI scale; all rendering then happens in **CSS** coordinates (crisp on Retina).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const surface = ctx as unknown as CanvasLike;
    // Build the theme color resolver **once** per frame (each call runs getComputedStyle) and reuse
    // it for the board, the grip overlay and the lane-drag overlay below.
    const resolveColor = makeColorResolver();
    renderToCanvas(surface, engine.toRenderModel(), {
      clear: { width: size.w, height: size.h },
      viewport: vpRef.current,
      resolveColor,
      // Semi-transparent gray: visible on light AND dark backgrounds (passes through the resolver as-is).
      dotGrid: { color: 'rgba(130, 130, 140, 0.45)' },
      ...(marquee.current ? { marquee: marquee.current } : {}),
      ...(marqueeHits.current.length ? { marqueeHighlightIds: marqueeHits.current } : {}),
      ...(guides.current ? { guides: guides.current } : {}),
      ...(selectedLaneId ? { selectedLaneId } : {}),
      ...(selectedGroupId ? { selectedGroupId } : {}),
      ...(remoteSelectionsRef.current.length
        ? {
            remoteSelections: remoteSelectionsRef.current.map((s) => ({
              ids: s.ids,
              color: s.color,
            })),
          }
        : {}),
      // During in-place editing, the DOM overlay replaces the card → hide selection/handles and
      // the edited element itself (otherwise its canvas border shows under the overlay).
      ...(editing ? { suppressSelection: true, hiddenElementId: editing.id } : {}),
    });
    // Cluster **move grip**: an accent bar on the left edge of the **hovered** cluster (drag = move
    // the whole linked block), plus a subtle outline of that block so the user sees the set of lanes
    // that will move. Revealed on hover only; hidden during a drag (the ghost is the focus then).
    if (
      !laneDrag.current &&
      interaction.current.mode !== 'clusterMove' &&
      hoveredGripCluster.current
    ) {
      const hovered = engine
        .clusterBounds()
        .find((c) => c.cluster.id === hoveredGripCluster.current);
      if (hovered) {
        const vp = vpRef.current;
        const accent = resolveColor('accent');
        const top = worldToScreen(vp, { x: hovered.bounds.x, y: hovered.bounds.y });
        const bot = worldToScreen(vp, {
          x: hovered.bounds.x + hovered.bounds.width,
          y: hovered.bounds.y + hovered.bounds.height,
        });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.save();
        // Outline of the whole block that will move.
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(top.x, top.y, bot.x - top.x, bot.y - top.y);
        // The grip bar itself.
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = accent;
        ctx.fillRect(top.x, top.y, LANE_GRIP_WIDTH, bot.y - top.y);
        ctx.restore();
      }
    }
    // **Lane header drag** overlay: ghost (translucent footprint of the dragged lane following the
    // cursor, dashed accent border) + optional drop line (reorder/attach slot). Detach shows the
    // ghost floating with no drop line.
    const ld = laneDrag.current;
    if (ld) {
      const vp = vpRef.current;
      const accent = resolveColor('accent');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (ld.dropLine) {
        const dl = worldToScreen(vp, { x: ld.dropLine.x0, y: ld.dropLine.y });
        const dr = worldToScreen(vp, { x: ld.dropLine.x1, y: ld.dropLine.y });
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(dl.x, dl.y);
        ctx.lineTo(dr.x, dr.y);
        ctx.stroke();
      }
      const g0 = worldToScreen(vp, { x: ld.ghost.x, y: ld.ghost.y });
      const g1 = worldToScreen(vp, {
        x: ld.ghost.x + ld.ghost.width,
        y: ld.ghost.y + ld.ghost.height,
      });
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = accent;
      ctx.fillRect(g0.x, g0.y, g1.x - g0.x, g1.y - g0.y);
      ctx.globalAlpha = 1;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.strokeRect(g0.x, g0.y, g1.x - g0.x, g1.y - g0.y);
      ctx.restore();
    }
    // Publishes the **local selection** to peers when it changes (others see it highlighted).
    if (awareness) {
      const sel = engine.getSelection();
      const key = sel.join(',');
      if (key !== lastSelKeyRef.current) {
        lastSelKeyRef.current = key;
        publishSelection(awareness, sel);
      }
    }
  }, [engine, size.w, size.h, selectedLaneId, selectedGroupId, editing, awareness, dpr]);

  useEffect(() => {
    draw();
    const unobserve = engine.observe(draw);
    return () => unobserve();
  }, [engine, draw, viewport]);

  // Wheel zoom/pan: native non-passive listener so preventDefault() is allowed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const pivot = screenPoint(canvas, event.clientX, event.clientY);
      if (event.ctrlKey || event.metaKey) {
        setViewport(zoomAt(vpRef.current, Math.exp(-event.deltaY * 0.002), pivot));
      } else {
        setViewport(panBy(vpRef.current, -event.deltaX, -event.deltaY));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (!awareness) return;
    // New awareness (mount / reconnection) → republish the local selection on the next draw.
    lastSelKeyRef.current = null;
    const refresh = (): void => {
      setRemoteCursors(readRemoteCursors(awareness));
      // Remote selections: in a ref + canvas redraw (the highlight is painted, not DOM).
      remoteSelectionsRef.current = readRemoteSelections(awareness);
      draw();
    };
    refresh();
    return observePresence(awareness, refresh);
  }, [awareness, draw]);

  // Redraws when the theme changes (colors resolved via getComputedStyle change).
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => draw());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, [draw]);

  /**
   * Snapping/alignment targets: the **non**-selected elements **plus** the **swimlanes**
   * (edges + centers). Additive → the existing block-to-block snapping is unchanged.
   */
  const snapTargets = (): BoundingBox[] => {
    const selected = new Set(engine.getSelection());
    const elements = engine
      .listElements()
      .filter((el) => !selected.has(el.id))
      .map((el) => engine.boundingBox(el.id))
      .filter((b): b is BoundingBox => b !== undefined);
    return [...elements, ...engine.swimlaneBounds()];
  };

  /** Cluster whose inner **left-edge move grip** is under the world point, or `null`. */
  const gripClusterAtPoint = (world: Point, zoom: number): string | null => {
    const grip = LANE_GRIP_WIDTH / zoom;
    for (const { cluster, bounds } of engine.clusterBounds()) {
      if (
        world.x >= bounds.x &&
        world.x <= bounds.x + grip &&
        world.y >= bounds.y &&
        world.y <= bounds.y + bounds.height
      ) {
        return cluster.id;
      }
    }
    return null;
  };

  /** Cursor to display on hover (action available under the pointer). */
  const cursorFor = (world: Point, zoom: number): string => {
    if (spaceHeld.current) return 'grab';
    const sel = engine.getSelection();
    if (sel.length === 1) {
      const el = engine.board.getElement(sel[0]!);
      if (el && hasHandles(el)) {
        const handle = handleAtPoint(el, world, zoom);
        if (handle) return HANDLE_CURSOR[handle];
      }
    }
    const edge = engine.laneEdgeAtPoint(world, LANE_EDGE_TOLERANCE / zoom);
    if (edge) return edge.edge === 'right' ? 'ew-resize' : 'ns-resize';
    // Cluster grip → move the whole block; lane header → drag the single lane.
    if (gripClusterAtPoint(world, zoom)) return 'grab';
    if (engine.laneHeaderAtPoint(world)) return 'grab';
    if (hitTest(engine.listElements(), world, DEFAULT_HIT_TOLERANCE / zoom)) return 'move';
    // Group header → click to select/rename (no drag: a group is a computed box, not movable).
    if (engine.groupHeaderAtPoint(world)) return 'pointer';
    return 'default';
  };

  /**
   * Disambiguates a **lane header drag** into a preview (`laneDrag`): the ghost follows the cursor,
   * and the action is one of reorder (still over its own cluster), attach (near another cluster's
   * band, magnetic), or detach (far from every cluster → its own new block). Preview only; the
   * board is mutated on release.
   */
  const computeLaneDrag = (
    state: { laneId: string; clusterId: string; grabDx: number; grabDy: number },
    world: Point,
  ): NonNullable<typeof laneDrag.current> => {
    const magnet = LANE_MAGNET_THRESHOLD / vpRef.current.zoom;
    const lanes = engine.listSwimlanes();
    const laneHeight = lanes.find((l) => l.id === state.laneId)?.height ?? 160;
    const ownWidth =
      engine.getSwimlaneCluster(state.clusterId)?.width ?? engine.getSwimlanesWidth();
    const gx = world.x - state.grabDx; // ghost top-left (visual, follows the cursor)
    const gy = world.y - state.grabDy;

    // Candidate cluster under the **cursor** (± magnet on both axes); nearest wins, own on tie.
    let best: { id: string; bounds: BoundingBox; width: number; dist: number } | null = null;
    for (const { cluster, bounds } of engine.clusterBounds()) {
      const inX = world.x >= bounds.x - magnet && world.x <= bounds.x + bounds.width + magnet;
      if (!inX) continue;
      if (world.y < bounds.y - magnet || world.y > bounds.y + bounds.height + magnet) continue;
      const dist =
        world.y < bounds.y
          ? bounds.y - world.y
          : world.y > bounds.y + bounds.height
            ? world.y - (bounds.y + bounds.height)
            : 0;
      if (!best || dist < best.dist || (dist === best.dist && cluster.id === state.clusterId)) {
        best = { id: cluster.id, bounds, width: cluster.width, dist };
      }
    }

    if (!best) {
      // Detach: floats where dropped (keeps the source width), no drop line.
      return {
        ghost: { x: gx, y: gy, width: ownWidth, height: laneHeight },
        commit: { kind: 'detach', laneId: state.laneId, x: gx, y: gy },
      };
    }

    // Drop slot among the target cluster's lanes (at their real positions).
    const clusterLanes = lanes.filter((l) => l.clusterId === best!.id);
    const { boundary, dropY } = dropSlot(clusterLanes, best.bounds.y, world.y);
    const ghost = { x: best.bounds.x, y: gy, width: best.width, height: laneHeight };
    const dropLine = { x0: best.bounds.x, x1: best.bounds.x + best.width, y: dropY };
    if (best.id === state.clusterId) {
      // Reorder within own cluster: adjust the index for the dragged lane's own removal.
      const fromIndex = clusterLanes.findIndex((l) => l.id === state.laneId);
      const targetIndex = boundary <= fromIndex ? boundary : boundary - 1;
      return { ghost, dropLine, commit: { kind: 'reorder', laneId: state.laneId, targetIndex } };
    }
    return {
      ghost,
      dropLine,
      commit: { kind: 'attach', laneId: state.laneId, targetClusterId: best.id, atIndex: boundary },
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture?.(event.pointerId);
    setHoveredId(null); // hides the connection handles during a gesture
    hoveredGripCluster.current = null; // hide the hover grip once a gesture begins
    const screen = screenPoint(canvas, event.clientX, event.clientY);

    if (event.button === 1 || spaceHeld.current) {
      interaction.current = { mode: 'panning', lastScreen: screen };
      return;
    }
    if (event.button !== 0) return;

    const world = screenToWorld(vpRef.current, screen);
    const zoom = vpRef.current.zoom;

    // 1) Transform handles on a single box-shaped selection.
    const selection = engine.getSelection();
    if (selection.length === 1) {
      const id = selection[0]!;
      const el = engine.board.getElement(id);
      if (el && hasHandles(el)) {
        const handle = handleAtPoint(el, world, zoom);
        if (handle === 'rotate') {
          interaction.current = { mode: 'rotating', id };
          return;
        }
        if (handle) {
          interaction.current = { mode: 'resizing', id, handle, otherBounds: snapTargets() };
          return;
        }
      }
    }

    // 2) Swimlane edge → mouse-driven resizing (before element selection). Right edge = the
    //    cluster's shared width; bottom edge = that lane's height.
    const edge = engine.laneEdgeAtPoint(world, LANE_EDGE_TOLERANCE / zoom);
    if (edge) {
      interaction.current =
        edge.edge === 'right'
          ? { mode: 'laneResizeW', clusterId: edge.clusterId! }
          : { mode: 'laneResizeH', laneId: edge.laneId! };
      return;
    }

    // 3) Cluster **move grip** (left edge) → drag the whole linked block. Before element hit-test
    //    (it sits at the very left) and before the lane header (which starts at the same x).
    const gripId = gripClusterAtPoint(world, zoom);
    if (gripId) {
      const cb = engine.clusterBounds().find((c) => c.cluster.id === gripId);
      if (cb) {
        onSelectLane?.(null);
        onSelectGroup?.(null);
        engine.clearSelection();
        interaction.current = {
          mode: 'clusterMove',
          clusterId: gripId,
          startWorld: world,
          startBounds: cb.bounds,
          otherBounds: engine
            .clusterBounds()
            .filter((c) => c.cluster.id !== gripId)
            .map((c) => c.bounds),
          applied: { x: 0, y: 0 },
        };
        marquee.current = undefined;
        guides.current = undefined;
        laneDrag.current = undefined;
        onChange?.();
        draw();
        return;
      }
    }

    // 4) Selection / move / marquee.
    const tolerance = DEFAULT_HIT_TOLERANCE / zoom;
    const hit = hitTest(engine.listElements(), world, tolerance);
    if (hit) {
      onSelectLane?.(null);
      onSelectGroup?.(null);
      if (event.shiftKey) {
        engine.toggleSelection(hit.id);
        interaction.current = { mode: 'idle' };
      } else {
        if (!engine.getSelection().includes(hit.id)) engine.select([hit.id]);
        const startBounds = engine.selectionBounds();
        interaction.current = startBounds
          ? {
              mode: 'moving',
              startWorld: world,
              startBounds,
              otherBounds: snapTargets(),
              applied: { x: 0, y: 0 },
            }
          : { mode: 'idle' };
      }
    } else {
      const laneId = engine.laneHeaderAtPoint(world);
      // A group header only wins when no lane header is under the point (lanes take precedence).
      const groupId = laneId ? undefined : engine.groupHeaderAtPoint(world);
      if (laneId) {
        const lane = engine.listSwimlanes().find((l) => l.id === laneId);
        const band = engine.laneBand(laneId);
        engine.clearSelection();
        onSelectLane?.(laneId);
        onSelectGroup?.(null);
        // Selects the lane AND arms the **header drag**: a plain click (no movement) only selects;
        // dragging previews reorder / attach / detach and commits on release. `grabD*` = cursor↔
        // band-top-left offset, so the ghost follows naturally.
        interaction.current = {
          mode: 'laneMove',
          laneId,
          clusterId: lane?.clusterId ?? '',
          grabDx: world.x - (band?.x ?? 0),
          grabDy: world.y - (band?.y ?? 0),
        };
      } else if (groupId) {
        // Group header click: select the group (edited in the side panel). No drag gesture — a
        // group is a computed box over its steps, not a movable entity.
        engine.clearSelection();
        onSelectLane?.(null);
        onSelectGroup?.(groupId);
        interaction.current = { mode: 'idle' };
      } else {
        onSelectLane?.(null);
        onSelectGroup?.(null);
        if (!event.shiftKey) engine.clearSelection();
        interaction.current = { mode: 'marquee', startWorld: world, additive: event.shiftKey };
      }
    }
    marquee.current = undefined;
    guides.current = undefined;
    laneDrag.current = undefined;
    onChange?.();
    draw();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screen = screenPoint(canvas, event.clientX, event.clientY);
    if (awareness) publishCursor(awareness, screenToWorld(vpRef.current, screen));
    const state = interaction.current;
    const world = screenToWorld(vpRef.current, screen);

    if (state.mode === 'idle') {
      canvas.style.cursor = cursorFor(world, vpRef.current.zoom);
      // Hover → reveal the cluster move grip when over its left-edge zone (redraw on change only).
      const gripId = gripClusterAtPoint(world, vpRef.current.zoom);
      if (gripId !== hoveredGripCluster.current) {
        hoveredGripCluster.current = gripId;
        draw();
      }
      // Hover → connection handles on the box element under the pointer.
      const hit = hitTest(engine.listElements(), world, DEFAULT_HIT_TOLERANCE / vpRef.current.zoom);
      const id = hit && hasHandles(hit) ? hit.id : null;
      if (id !== hoveredId) setHoveredId(id);
      return;
    }

    if (state.mode === 'panning') {
      setViewport(
        panBy(vpRef.current, screen.x - state.lastScreen.x, screen.y - state.lastScreen.y),
      );
      interaction.current = { mode: 'panning', lastScreen: screen };
      return;
    }

    if (state.mode === 'resizing') {
      const el = engine.board.getElement(state.id);
      if (el) {
        const resized = resizeElement(el, state.handle, world);
        // Align the dragged edge(s) onto the other elements' edges/centers, drawing the same guides
        // as a move. Axis-aligned boxes only: a rotated box has no horizontal/vertical edge to align.
        if (el.angle === 0) {
          const snapped = snapResize(
            resized,
            {
              left: state.handle.includes('w'),
              right: state.handle.includes('e'),
              top: state.handle.includes('n'),
              bottom: state.handle.includes('s'),
            },
            state.otherBounds,
            SNAP_SCREEN_THRESHOLD / vpRef.current.zoom,
            MIN_ELEMENT_SIZE,
          );
          engine.updateElement(state.id, {
            x: snapped.x,
            y: snapped.y,
            width: snapped.width,
            height: snapped.height,
          });
          guides.current =
            snapped.guideX !== undefined || snapped.guideY !== undefined
              ? {
                  ...(snapped.guideX !== undefined ? { x: snapped.guideX } : {}),
                  ...(snapped.guideY !== undefined ? { y: snapped.guideY } : {}),
                }
              : undefined;
        } else {
          engine.updateElement(state.id, resized);
          guides.current = undefined;
        }
        engine.refreshConnectors();
        draw();
      }
      return;
    }

    if (state.mode === 'rotating') {
      const el = engine.board.getElement(state.id);
      if (el) {
        engine.updateElement(state.id, {
          angle: rotateElement(el, world, event.shiftKey ? Math.PI / 12 : 0),
        });
        engine.refreshConnectors();
      }
      return;
    }

    if (state.mode === 'laneResizeH') {
      const newHeight = Math.max(60, world.y - engine.laneTop(state.laneId));
      engine.updateSwimlane(state.laneId, { height: newHeight });
      engine.refreshConnectors();
      return;
    }

    if (state.mode === 'laneResizeW') {
      const cluster = engine.getSwimlaneCluster(state.clusterId);
      if (cluster)
        engine.updateSwimlaneCluster(state.clusterId, {
          width: Math.max(200, world.x - cluster.x),
        });
      engine.refreshConnectors();
      return;
    }

    if (state.mode === 'laneMove') {
      canvas.style.cursor = 'grabbing';
      laneDrag.current = computeLaneDrag(state, world);
      draw();
      return;
    }

    if (state.mode === 'clusterMove') {
      const raw = { x: world.x - state.startWorld.x, y: world.y - state.startWorld.y };
      const proposed: BoundingBox = {
        x: state.startBounds.x + raw.x,
        y: state.startBounds.y + raw.y,
        width: state.startBounds.width,
        height: state.startBounds.height,
      };
      const snap = snapMove(
        proposed,
        state.otherBounds,
        SNAP_SCREEN_THRESHOLD / vpRef.current.zoom,
      );
      const target = { x: raw.x + snap.dx, y: raw.y + snap.dy };
      engine.moveCluster(state.clusterId, target.x - state.applied.x, target.y - state.applied.y);
      state.applied = target;
      guides.current =
        snap.guideX !== undefined || snap.guideY !== undefined
          ? {
              ...(snap.guideX !== undefined ? { x: snap.guideX } : {}),
              ...(snap.guideY !== undefined ? { y: snap.guideY } : {}),
            }
          : undefined;
      draw();
      return;
    }

    if (state.mode === 'moving') {
      const raw = { x: world.x - state.startWorld.x, y: world.y - state.startWorld.y };
      const proposed: BoundingBox = {
        x: state.startBounds.x + raw.x,
        y: state.startBounds.y + raw.y,
        width: state.startBounds.width,
        height: state.startBounds.height,
      };
      const snap = snapMove(
        proposed,
        state.otherBounds,
        SNAP_SCREEN_THRESHOLD / vpRef.current.zoom,
      );
      const target = { x: raw.x + snap.dx, y: raw.y + snap.dy };
      engine.moveSelection(target.x - state.applied.x, target.y - state.applied.y);
      engine.refreshConnectors();
      state.applied = target;
      guides.current =
        snap.guideX !== undefined || snap.guideY !== undefined
          ? {
              ...(snap.guideX !== undefined ? { x: snap.guideX } : {}),
              ...(snap.guideY !== undefined ? { y: snap.guideY } : {}),
            }
          : undefined;
      draw();
      return;
    }

    if (state.mode === 'marquee') {
      marquee.current = boxFromPoints(state.startWorld, world);
      // Preview: highlight of the elements already intersected by the box, updated on every frame.
      marqueeHits.current = elementsInBox(engine.listElements(), marquee.current);
      draw();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const state = interaction.current;
    if (canvas?.hasPointerCapture?.(event.pointerId))
      canvas.releasePointerCapture?.(event.pointerId);

    if (state.mode === 'marquee' && marquee.current) {
      const inside = elementsInBox(engine.listElements(), marquee.current);
      engine.select(
        state.additive ? Array.from(new Set([...engine.getSelection(), ...inside])) : inside,
      );
    }
    // Lane header drag: the reorder / attach / detach is **committed** on release (no-op if the
    // gesture never moved — a plain header click only selects).
    if (state.mode === 'laneMove' && laneDrag.current) {
      const c = laneDrag.current.commit;
      if (c.kind === 'reorder') engine.reorderSwimlane(c.laneId, c.targetIndex);
      else if (c.kind === 'attach') engine.attachSwimlane(c.laneId, c.targetClusterId, c.atIndex);
      else if (c.kind === 'detach') engine.detachSwimlaneTo(c.laneId, c.x, c.y);
    }
    // Cluster grip with **no drag** = a plain click: select the lane under the grip rather than
    // leaving the block deselected (the grip zone shadows the header's left edge, which used to
    // select). A real drag (applied != 0) already moved the cluster live and must not re-select.
    if (state.mode === 'clusterMove' && state.applied.x === 0 && state.applied.y === 0) {
      onSelectLane?.(engine.laneAtPoint(state.startWorld) ?? null);
    }
    marquee.current = undefined;
    marqueeHits.current = [];
    guides.current = undefined;
    laneDrag.current = undefined;
    interaction.current = { mode: 'idle' };
    onChange?.();
    draw();
  };

  // Clones the source shape (same type/style/content) at (x,y); returns the new id.
  const cloneShapeAt = (src: WhiteboardElement, x: number, y: number): string => {
    const id = genElementId();
    const clone: WhiteboardElement = { ...src, id, x, y };
    // An item **created/connected** from a step starts **blank**: the sub-process link belongs to
    // the source step (otherwise two steps would point to the same child document). Not copied.
    if (clone.kind === 'step') delete clone.subprocessRef;
    engine.addElement(clone);
    return id;
  };

  // Creates the same shape **in the given direction**, aligned and spaced from the source.
  const createInDirection = (src: WhiteboardElement, dir: ConnectDir): string => {
    const GAP = 48;
    let { x, y } = src;
    if (dir === 'e') x = src.x + src.width + GAP;
    else if (dir === 'w') x = src.x - src.width - GAP;
    else if (dir === 's') y = src.y + src.height + GAP;
    else y = src.y - src.height - GAP;
    return cloneShapeAt(src, x, y);
  };

  /**
   * Starts from a connection handle: a **click** creates the same shape in the direction and links
   * it; a **drag** draws a connector up to the dropped shape (or creates a shape at the drop point
   * if it is empty space), linked to the source. Tracked via window listeners (drag outside the dot).
   */
  const startConnect =
    (fromId: string, dir: ConnectDir) =>
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = canvasRef.current;
      const box = engine.boundingBox(fromId);
      if (!canvas || !box) return;
      const anchor = worldToScreen(vpRef.current, sideAnchor(box, dir));
      connectRef.current = { fromId, dir, startX: event.clientX, startY: event.clientY };
      setConnectLine({ ax: anchor.x, ay: anchor.y, tx: anchor.x, ty: anchor.y });

      const onMove = (e: PointerEvent): void => {
        const c = canvasRef.current;
        if (!c) return;
        const sp = screenPoint(c, e.clientX, e.clientY);
        setConnectLine((prev) => (prev ? { ...prev, tx: sp.x, ty: sp.y } : prev));
        // Shape under the pointer (≠ source) → show its anchor points, and highlight the side
        // closest to the cursor (the one the link will attach to).
        const world = screenToWorld(vpRef.current, sp);
        const hit = hitTest(
          engine.listElements(),
          world,
          DEFAULT_HIT_TOLERANCE / vpRef.current.zoom,
        );
        const target = hit && hit.id !== fromId && hasHandles(hit) ? hit : null;
        const tid = target?.id ?? null;
        setDragTargetId((prev) => (prev !== tid ? tid : prev));
        const tb = target ? engine.boundingBox(target.id) : undefined;
        const side = tb ? nearestSide(tb, world) : null;
        setDragSide((prev) => (prev !== side ? side : prev));
      };
      const onUp = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const ref = connectRef.current;
        connectRef.current = null;
        setConnectLine(null);
        setDragTargetId(null);
        setDragSide(null);
        const c = canvasRef.current;
        if (!ref || !c) return;
        const src = engine.board.getElement(ref.fromId);
        if (!src) return;
        const moved = Math.hypot(e.clientX - ref.startX, e.clientY - ref.startY) > 6;
        const world = screenToWorld(vpRef.current, screenPoint(c, e.clientX, e.clientY));
        let targetId: string;
        let endSide: ConnectDir = oppositeSide(ref.dir);
        if (moved) {
          const hit = hitTest(
            engine.listElements(),
            world,
            DEFAULT_HIT_TOLERANCE / vpRef.current.zoom,
          );
          if (hit && hit.id !== ref.fromId && hasHandles(hit)) {
            targetId = hit.id;
            // Anchor side = the one closest to the cursor (= the highlighted dot). Allows a loop.
            const tb = engine.boundingBox(hit.id);
            if (tb) endSide = nearestSide(tb, world);
          } else {
            targetId = cloneShapeAt(src, world.x - src.width / 2, world.y - src.height / 2);
          }
        } else {
          targetId = createInDirection(src, ref.dir);
        }
        // Connector created by drag: default arrow on the **destination tip**.
        engine.connect(genElementId(), ref.fromId, targetId, {
          startSide: ref.dir,
          endSide,
          endArrow: true,
        });
        engine.select([targetId]);
        setHoveredId(null);
        onChange?.();
        draw();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = screenToWorld(vpRef.current, screenPoint(canvas, event.clientX, event.clientY));
    const hit = hitTest(engine.listElements(), world, DEFAULT_HIT_TOLERANCE / vpRef.current.zoom);
    if (hit?.kind === 'text') setEditing({ id: hit.id, field: 'text', value: hit.text });
    else if (hit?.kind === 'rectangle' || hit?.kind === 'ellipse') {
      // Basic shape: double-click → write a centered label "inside" the shape (like a step).
      setEditing({ id: hit.id, field: 'text', value: hit.text ?? '' });
    } else if (hit?.kind === 'step') {
      // Step linked to a sub-process → "enter" the child whiteboard (no inline editing).
      if (hit.subprocessRef && onNavigateSubprocess) {
        onNavigateSubprocess(hit.subprocessRef);
        return;
      }
      setEditing({ id: hit.id, field: 'name', value: hit.name });
    }
  };

  const commitEditing = (text: string): void => {
    if (editing) {
      engine.updateElement(editing.id, { [editing.field]: text });
      engine.refreshConnectors();
      setEditing(null);
      onChange?.();
    }
  };

  /**
   * Screen style of the in-place editor, **overlaid exactly on the element** to give the feeling
   * of editing "inside the card". For a step: same box, card background, centered text (hides the
   * title underneath). For a text: top-aligned, transparent/sticky background.
   */
  const editorStyle = (): { style: React.CSSProperties; decoration: string } | undefined => {
    if (!editing) return undefined;
    const el = engine.board.getElement(editing.id);
    if (
      !el ||
      (el.kind !== 'text' && el.kind !== 'step' && el.kind !== 'rectangle' && el.kind !== 'ellipse')
    )
      return undefined;
    const origin = worldToScreen(vpRef.current, { x: el.x, y: el.y });
    const zoom = vpRef.current.zoom;
    // Per-element text formatting (#82) → editor CSS, faithful to the canvas rendering (WYSIWYG).
    const fontStyle = el.italic ? 'italic' : 'normal';
    const decoration =
      [el.underline ? 'underline' : '', el.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ') || 'none';
    if (el.kind === 'rectangle' || el.kind === 'ellipse') {
      // WYSIWYG: we redraw the shape (background/border) under the centered text (h+v), since the
      // actual element is hidden while editing. Ellipse → 50% border radius to match the oval.
      const noBorder = el.stroke === 'transparent';
      const hasFill = el.fill !== 'transparent';
      return {
        decoration,
        style: {
          position: 'absolute',
          left: origin.x,
          top: origin.y,
          width: el.width * zoom,
          height: el.height * zoom,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: el.textAlign ?? 'center',
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          fontSize: (el.fontSize ?? 13) * zoom,
          fontWeight: el.bold ? 700 : 400,
          fontStyle,
          lineHeight: 1.25,
          padding: 8 * zoom,
          background: hasFill ? cssColor(el.fill) : 'transparent',
          color: cssColor(noBorder ? 'text' : el.stroke),
          border: noBorder ? 'none' : `${el.strokeWidth * zoom}px solid ${cssColor(el.stroke)}`,
          borderRadius: el.kind === 'ellipse' ? '50%' : 0,
          boxShadow:
            hasFill && el.shadow !== false
              ? `0 ${4 * zoom}px ${16 * zoom}px rgba(0, 0, 0, 0.12)`
              : 'none',
        },
      };
    }
    if (el.kind === 'step') {
      // Strict WYSIWYG: same colors as the card (fill/stroke/width), centered text (h+v).
      const noBorder = el.stroke === 'transparent';
      return {
        decoration,
        style: {
          position: 'absolute',
          left: origin.x,
          top: origin.y,
          width: el.width * zoom,
          height: el.height * zoom,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: el.textAlign ?? 'center',
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          fontSize: (el.fontSize ?? 13) * zoom,
          fontWeight: el.bold ? 700 : 600, // step: semi-bold title by default
          fontStyle,
          lineHeight: 1.25,
          padding: 10 * zoom,
          background: cssColor(el.fill === 'transparent' ? 'surface' : el.fill),
          color: cssColor(noBorder ? 'text' : el.stroke),
          border: noBorder ? 'none' : `${el.strokeWidth * zoom}px solid ${cssColor(el.stroke)}`,
          borderRadius: 10 * zoom, // rounded corners, like the rendered card
          // **Default** step shadow (WYSIWYG with the rendered card); `false` disables it.
          boxShadow:
            el.shadow !== false ? `0 ${4 * zoom}px ${16 * zoom}px rgba(0, 0, 0, 0.12)` : 'none',
        },
      };
    }
    // Text / sticky: top-aligned (no vertical centering) — same colors as the rendering.
    const hasBg = el.fill !== 'transparent';
    return {
      decoration,
      style: {
        position: 'absolute',
        left: origin.x,
        top: origin.y,
        width: Math.max(el.width * zoom, 40),
        height: Math.max(el.height * zoom, el.fontSize * zoom + 8),
        boxSizing: 'border-box',
        textAlign: el.textAlign ?? 'left',
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        fontSize: el.fontSize * zoom,
        fontWeight: el.bold ? 700 : 400,
        fontStyle,
        lineHeight: 1,
        padding: hasBg ? 6 * zoom : 0,
        background: hasBg ? cssColor(el.fill) : 'transparent',
        color: cssColor(el.stroke),
        boxShadow:
          hasBg && el.shadow !== false
            ? `0 ${4 * zoom}px ${16 * zoom}px rgba(0, 0, 0, 0.12)`
            : 'none',
      },
    };
  };

  // --- Clipboard (copy / cut / paste / duplicate) ---
  // Copy/cut serialize the selection into a portable payload (`engine.copySelection`); paste/duplicate
  // re-id + offset it (`engine.paste`). The store may be async (system clipboard) → fire-and-forget,
  // redrawing once the read/write settles.
  const copySelection = (): void => {
    const payload = engine.copySelection();
    if (payload) void clipboard.write(payload);
  };
  const cutSelection = (): void => {
    const payload = engine.copySelection();
    if (!payload) return;
    void clipboard.write(payload);
    engine.removeSelected();
    onChange?.();
    draw();
  };
  const pasteClipboard = (): void => {
    void Promise.resolve(clipboard.read()).then((payload) => {
      if (!payload) return;
      // Paste centered on what the user is currently looking at (visible even after panning away).
      engine.paste(payload, {
        at: viewportCenter(vpRef.current, { width: size.w, height: size.h }),
      });
      onChange?.();
      draw();
    });
  };
  const duplicateSelection = (): void => {
    const payload = engine.copySelection();
    if (!payload) return;
    engine.paste(payload); // no anchor → fixed nudge offset next to the source
    onChange?.();
    draw();
  };

  // Right-click → host context menu. Selects the element under the cursor first (unless already in
  // the selection), so the menu acts on what was clicked; empty space clears the selection. Only
  // suppresses the native menu when a host handler is provided.
  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!onContextMenu) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = screenToWorld(vpRef.current, screenPoint(canvas, event.clientX, event.clientY));
    const hit = hitTest(engine.listElements(), world, DEFAULT_HIT_TOLERANCE / vpRef.current.zoom);
    if (hit) {
      if (!engine.getSelection().includes(hit.id)) engine.select([hit.id]);
      onSelectLane?.(null);
      onSelectGroup?.(null);
    } else {
      engine.clearSelection();
    }
    onChange?.();
    draw();
    onContextMenu({ x: event.clientX, y: event.clientY }, engine.getSelection());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'z' || event.key === 'y')) {
      event.preventDefault();
      const history = engine.history();
      if (event.key === 'y' || event.shiftKey) history.redo();
      else history.undo();
      onChange?.();
      draw();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const k = event.key.toLowerCase();
      if (k === 'c' || k === 'x' || k === 'v' || k === 'd') {
        event.preventDefault();
        if (k === 'c') copySelection();
        else if (k === 'x') cutSelection();
        else if (k === 'v') pasteClipboard();
        else duplicateSelection();
        return;
      }
    }
    if ((event.key === 'Enter' || event.key === 'F2') && !editing) {
      // Direct editing of the selected element (step → name, text → content).
      const sel = engine.getSelection();
      if (sel.length === 1) {
        const el = engine.board.getElement(sel[0]!);
        if (el?.kind === 'step') {
          event.preventDefault();
          setEditing({ id: el.id, field: 'name', value: el.name });
          return;
        }
        if (el?.kind === 'text' || el?.kind === 'rectangle' || el?.kind === 'ellipse') {
          event.preventDefault();
          setEditing({ id: el.id, field: 'text', value: el.text ?? '' });
          return;
        }
      }
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (engine.getSelection().length > 0) {
        event.preventDefault();
        engine.removeSelected();
        onChange?.();
        draw();
      }
    } else if (event.key === 'Escape') {
      engine.clearSelection();
      onChange?.();
      draw();
    }
  };

  // Connection handles (N/E/S/W) around the hovered element (screen coords, follows pan/zoom).
  const connectHandles = ((): { dir: ConnectDir; fromId: string; x: number; y: number }[] => {
    if (!hoveredId || editing || connectLine) return [];
    const box = engine.boundingBox(hoveredId);
    if (!box) return [];
    // Dots **on the edge** of the item (not outside): otherwise, moving towards them, the cursor
    // crosses empty space → the hover is lost → they disappear before being reached.
    return CONNECT_DIRS.map((dir) => {
      const s = worldToScreen(viewport, sideAnchor(box, dir));
      return { dir, fromId: hoveredId, x: s.x, y: s.y };
    });
  })();

  // Anchor points of the **target** during a connector drag (explicit drop zones).
  const dropHandles = ((): { dir: ConnectDir; x: number; y: number }[] => {
    if (!connectLine || !dragTargetId) return [];
    const box = engine.boundingBox(dragTargetId);
    if (!box) return [];
    return CONNECT_DIRS.map((dir) => {
      const s = worldToScreen(viewport, sideAnchor(box, dir));
      return { dir, x: s.x, y: s.y };
    });
  })();

  // **Elbow** handle of a selected connector (single, bound): at the middle of the crossing
  // segment. Dragging it moves the segment (`y` axis → up/down, `x` → left/right);
  // double-click or center snap → recentered (auto). See `connectorElbow` / `setConnectorMidpoint`.
  const elbowHandle = ((): { id: string; x: number; y: number; axis: 'x' | 'y' } | null => {
    if (editing || connectLine) return null;
    const sel = engine.getSelection();
    if (sel.length !== 1) return null;
    const el = engine.board.getElement(sel[0]!);
    if (!el || (el.kind !== 'line' && el.kind !== 'arrow') || !el.start || !el.end) return null;
    const a = engine.boundingBox(el.start);
    const b = engine.boundingBox(el.end);
    if (!a || !b) return null;
    const elbow = connectorElbow(a, b, {
      ...(el.startSide ? { startSide: el.startSide } : {}),
      ...(el.endSide ? { endSide: el.endSide } : {}),
      ...(el.midpoint !== undefined ? { midpoint: el.midpoint } : {}),
    });
    const s = worldToScreen(viewport, elbow.handle);
    return { id: el.id, x: s.x, y: s.y, axis: elbow.axis };
  })();

  const startElbowDrag =
    (id: string, axis: 'x' | 'y') =>
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onMove = (e: PointerEvent): void => {
        const el = engine.board.getElement(id);
        if (!el || (el.kind !== 'line' && el.kind !== 'arrow') || !el.start || !el.end) return;
        const a = engine.boundingBox(el.start);
        const b = engine.boundingBox(el.end);
        if (!a || !b) return;
        const def = connectorElbow(a, b, {
          ...(el.startSide ? { startSide: el.startSide } : {}),
          ...(el.endSide ? { endSide: el.endSide } : {}),
        }).default;
        const world = screenToWorld(vpRef.current, screenPoint(canvas, e.clientX, e.clientY));
        const coord = axis === 'y' ? world.y : world.x;
        // Center snap (~6px screen) → recenter (midpoint cleared), otherwise manual position.
        engine.setConnectorMidpoint(
          id,
          Math.abs(coord - def) <= 6 / vpRef.current.zoom ? null : coord,
        );
        onChange?.();
        draw();
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  // Contextual style bar (fill/stroke/width): anchored **above** the top-center of the selection
  // (flips below when too close to the top edge). Hidden during in-place editing.
  const styleAnchor = ((): { x: number; topY: number; botY: number } | null => {
    if (editing) return null;
    const selected = engine.toRenderModel().elements.filter((e) => e.selected);
    if (selected.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const it of selected) {
      minX = Math.min(minX, it.bounds.x);
      minY = Math.min(minY, it.bounds.y);
      maxX = Math.max(maxX, it.bounds.x + it.bounds.width);
      maxY = Math.max(maxY, it.bounds.y + it.bounds.height);
    }
    const center = (minX + maxX) / 2;
    const top = worldToScreen(viewport, { x: center, y: minY });
    const bottom = worldToScreen(viewport, { x: center, y: maxY });
    return { x: top.x, topY: top.y, botY: bottom.y };
  })();
  // Above when there is enough room (the ~26px selection frame + the bar), otherwise below.
  const styleAbove = !styleAnchor || styleAnchor.topY > 84;
  const styleShown = styleAnchor !== null;
  // Measures the bar width **when it appears** (not on every render → avoids a setState loop
  // via an inline ref-callback).
  useLayoutEffect(() => {
    if (styleShown && styleBarRef.current) {
      const w = styleBarRef.current.offsetWidth;
      setStyleBarW((prev) => (prev !== w ? w : prev));
    }
  }, [styleShown]);
  // Horizontal clamp to keep the bar fully inside the frame (otherwise clipped by overflow-hidden).
  const styleLeft = styleAnchor
    ? styleBarW
      ? Math.min(Math.max(styleAnchor.x, styleBarW / 2 + 8), size.w - styleBarW / 2 - 8)
      : styleAnchor.x
    : 0;

  return (
    <div
      ref={wrapperRef}
      className={fixedSize ? 'relative inline-block' : 'relative min-h-0 min-w-0 flex-1'}
    >
      <canvas
        ref={canvasRef}
        width={Math.round(size.w * dpr)}
        height={Math.round(size.h * dpr)}
        style={{
          width: size.w,
          height: size.h,
          // Shared board background (collab): overrides the theme default (class below) when set.
          ...(background ? { backgroundColor: cssColor(background) } : {}),
        }}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        onPointerLeave={() => {
          if (awareness) publishCursor(awareness, null);
          if (hoveredGripCluster.current) {
            hoveredGripCluster.current = null; // hide the grip when the cursor leaves the surface
            draw();
          }
        }}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className="block touch-none bg-[#f4f4f5] outline-none dark:bg-[#0c0c0e]"
        aria-label="Surface de dessin du whiteboard"
        role="img"
      />
      {/* Connection handles on hover: click = same shape in the direction; drag = connector. */}
      {connectHandles.map((h) => (
        <button
          key={h.dir}
          type="button"
          aria-label={`Connecter (${{ n: 'haut', e: 'droite', s: 'bas', w: 'gauche' }[h.dir]})`}
          onPointerDown={startConnect(h.fromId, h.dir)}
          className="absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent bg-surface shadow transition-transform hover:scale-150"
          style={{ left: h.x, top: h.y }}
        />
      ))}
      {/* Elbow handle of a selected connector: drag to move the middle segment
          (up/down or left/right); double-click to recenter (auto). */}
      {elbowHandle && (
        <button
          type="button"
          aria-label="Déplacer le coude du connecteur"
          onPointerDown={startElbowDrag(elbowHandle.id, elbowHandle.axis)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            engine.setConnectorMidpoint(elbowHandle.id, null);
            onChange?.();
            draw();
          }}
          className={`absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow transition-transform hover:scale-150 ${
            elbowHandle.axis === 'y' ? 'cursor-ns-resize' : 'cursor-ew-resize'
          }`}
          style={{ left: elbowHandle.x, top: elbowHandle.y }}
        />
      )}
      {/* Anchor points of the target during a drag: only the **active** side (closest to the
          cursor, = where the link will attach) is highlighted; the others stay subtle. */}
      {dropHandles.map((h) => {
        const active = h.dir === dragSide;
        return (
          <span
            key={h.dir}
            aria-hidden="true"
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
              active
                ? 'z-20 size-4 border-2 border-accent bg-accent shadow'
                : 'z-10 size-2 border border-muted bg-surface opacity-50'
            }`}
            style={{ left: h.x, top: h.y }}
          />
        );
      })}
      {/* Connector line being drawn (drag from a handle). */}
      {connectLine && (
        <svg
          className="pointer-events-none absolute inset-0 z-10"
          width={size.w}
          height={size.h}
          aria-hidden="true"
        >
          <line
            x1={connectLine.ax}
            y1={connectLine.ay}
            x2={connectLine.tx}
            y2={connectLine.ty}
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        </svg>
      )}
      {styleAnchor && (
        <div
          ref={styleBarRef}
          className={`pointer-events-auto absolute z-20 -translate-x-1/2 ${
            styleAbove ? '-translate-y-full' : ''
          }`}
          style={{
            left: styleLeft,
            top: styleAbove ? styleAnchor.topY - 12 : styleAnchor.botY + 12,
          }}
        >
          <div className="rounded-xl border border-border bg-surface p-1.5 shadow-xl">
            <StylePanel
              engine={engine}
              onChange={() => {
                onChange?.();
                draw();
              }}
            />
          </div>
        </div>
      )}
      {remoteCursors.map((cursor) => {
        const pos = worldToScreen(viewport, { x: cursor.x, y: cursor.y });
        if (pos.x < 0 || pos.y < 0 || pos.x > size.w || pos.y > size.h) return null;
        return (
          <div
            key={cursor.clientId}
            className="pointer-events-none absolute z-10 select-none"
            style={{ left: pos.x, top: pos.y }}
            aria-hidden="true"
          >
            {/* **Arrow** cursor (multiplayer style): the tip is exactly on the peer's position,
                filled with their color, white outline to stay readable on any background. */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              className="block drop-shadow-sm"
              style={{ color: cssColor(cursor.color) }}
            >
              <path
                d="M0 0 L11 4 L4 11 Z"
                fill="currentColor"
                stroke="white"
                strokeWidth="1"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span
              className="absolute left-3.5 top-3.5 whitespace-nowrap rounded px-1 text-[10px] text-white"
              style={{ backgroundColor: cssColor(cursor.color) }}
            >
              {cursor.name}
            </span>
          </div>
        );
      })}
      {editing
        ? (() => {
            const ed = editorStyle();
            return (
              <InlineEditor
                initial={editing.value}
                style={ed?.style}
                decoration={ed?.decoration ?? 'none'}
                onCommit={(text) => commitEditing(text)}
                onCancel={() => setEditing(null)}
              />
            );
          })()
        : null}
      {!hideZoomControl && (
        <ZoomControl
          className="absolute bottom-[26px] right-2 shadow-sm"
          percent={percent}
          onZoomOut={zoomOut}
          onReset={resetView}
          onZoomIn={zoomIn}
        />
      )}
    </div>
  );
}
