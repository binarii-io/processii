/**
 * Bound connectors — pure geometry of an arrow/line linking two elements. The path goes edge to
 * edge: the **centers** of the two boxes are joined and each end is clipped on its box's
 * **border** (the arrow touches the shapes, never crosses them). When a linked element moves,
 * `connectorGeometry` is called again to re-route (see `engine.refreshConnectors`). DOM-free, testable.
 */
import type { BoundingBox } from './engine.js';
import type { ConnectorSide } from './scene.js';
import type { Point } from './viewport.js';

/** Side of `box` facing the `toward` point (from the center) — for auto anchoring. */
function facingSide(box: BoundingBox, toward: Point): ConnectorSide {
  const dx = toward.x - (box.x + box.width / 2);
  const dy = toward.y - (box.y + box.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** Midpoint of side `side` of `box`. */
function sideMidpoint(box: BoundingBox, side: ConnectorSide): Point {
  switch (side) {
    case 'n':
      return { x: box.x + box.width / 2, y: box.y };
    case 's':
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case 'w':
      return { x: box.x, y: box.y + box.height / 2 };
    case 'e':
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

/** Unit vector pointing out of side `side`. */
function outward(side: ConnectorSide): Point {
  switch (side) {
    case 'n':
      return { x: 0, y: -1 };
    case 's':
      return { x: 0, y: 1 };
    case 'w':
      return { x: -1, y: 0 };
    case 'e':
      return { x: 1, y: 0 };
  }
}

/** Point on the border of `box` in the direction of `target` (from the box center). */
export function borderPoint(box: BoundingBox, target: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Scale to reach the closest border on each axis; the most constraining one wins.
  const scaleX = dx !== 0 ? box.width / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? box.height / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(scaleX, scaleY);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Removes the **redundant** intermediate points of an **orthogonal** polyline: a point collinear
 * with its two neighbors (same x or same y) adds nothing. Consequence: an aligned path collapses
 * to a **straight line**, an offset path keeps its right-angle **elbows**.
 */
function simplifyOrthogonal(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const prev = out[out.length - 1];
    const next = pts[i + 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue; // exact duplicate
    if (prev && next) {
      const colinear = (prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y);
      if (colinear) continue;
    }
    out.push(p);
  }
  return out;
}

/** "Stub" length: perpendicular segment through which the connector leaves/enters a box. */
const STUB = 24;

/** Common routing options: anchor sides + manual elbow position. */
export interface ConnectorRouteOpts {
  startSide?: ConnectorSide;
  endSide?: ConnectorSide;
  /** World coordinate of the crossing segment (axis derived from the routing). Absent = centered elbow. */
  midpoint?: number;
}

/** Resolved endpoints (anchor point + stub + orientation) on both sides of the connector. */
interface Route {
  start: Point;
  end: Point;
  stubA: Point;
  stubB: Point;
  /** `true` when the side is vertical (n/s) → leaves/enters vertically. */
  va: boolean;
  vb: boolean;
}

function resolveRoute(a: BoundingBox, b: BoundingBox, opts: ConnectorRouteOpts): Route {
  const ca: Point = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb: Point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const sa = opts.startSide ?? facingSide(a, cb);
  const sb = opts.endSide ?? facingSide(b, ca);
  const start = sideMidpoint(a, sa);
  const end = sideMidpoint(b, sb);
  const oa = outward(sa);
  const ob = outward(sb);
  return {
    start,
    end,
    stubA: { x: start.x + oa.x * STUB, y: start.y + oa.y * STUB },
    stubB: { x: end.x + ob.x * STUB, y: end.y + ob.y * STUB },
    va: sa === 'n' || sa === 's',
    vb: sb === 'n' || sb === 's',
  };
}

/**
 * Elbow (crossing segment) of the connector: on which **axis** it moves, its **default**
 * (centered) position and its **effective** position (`midpoint` when provided). `handle` is the
 * **world** point where the drag handle sits (middle of the crossing segment). Used by the
 * routing **and** the UI (draggable handle). The axis:
 * - two vertical sides → **horizontal** crossing segment → `y` axis (up/down);
 * - two horizontal sides → **vertical** segment → `x` axis (left/right);
 * - mixed → the segment perpendicular to the `start` exit (axis `y` if `start` is vertical, else `x`).
 */
export function connectorElbow(
  a: BoundingBox,
  b: BoundingBox,
  opts: ConnectorRouteOpts = {},
): { axis: 'x' | 'y'; pos: number; default: number; handle: Point } {
  const { stubA, stubB, va, vb } = resolveRoute(a, b, opts);
  let axis: 'x' | 'y';
  let def: number;
  if (va && vb) {
    axis = 'y';
    def = (stubA.y + stubB.y) / 2;
  } else if (!va && !vb) {
    axis = 'x';
    def = (stubA.x + stubB.x) / 2;
  } else if (va) {
    // start vertical, end horizontal → horizontal crossing segment (at the arrival stub level).
    axis = 'y';
    def = stubB.y;
  } else {
    // start horizontal, end vertical → vertical crossing segment.
    axis = 'x';
    def = stubB.x;
  }
  const pos = opts.midpoint ?? def;
  const handle: Point =
    axis === 'y' ? { x: (stubA.x + stubB.x) / 2, y: pos } : { x: pos, y: (stubA.y + stubB.y) / 2 };
  return { axis, pos, default: def, handle };
}

/**
 * Origin + (relative) points of a connector linking box `a` to box `b`, **right-angle routed**
 * (Manhattan). Each end anchors at the **middle of a side**: `startSide`/`endSide` when provided
 * (allows a loop, e.g. `n`→`n`), otherwise the side facing the other box. The path exits
 * perpendicularly (stub), crosses through a **crossing segment** (elbow), then enters. The
 * position of that segment is **centered by default** or imposed by `midpoint` (see
 * `connectorElbow`) → movable elbow. Collinear points are simplified → an aligned/centered case
 * becomes a **straight line** again (or an **L** in the mixed case).
 */
export function connectorGeometry(
  a: BoundingBox,
  b: BoundingBox,
  opts: ConnectorRouteOpts = {},
): { x: number; y: number; points: [number, number][] } {
  const { start, end, stubA, stubB } = resolveRoute(a, b, opts);
  const { axis, pos } = connectorElbow(a, b, opts);

  // Crossing segment placed at `pos`: horizontal (`y` axis, crossing at y=pos) or vertical
  // (`x` axis, crossing at x=pos). `simplifyOrthogonal` then reduces a centered/aligned crossing
  // to a straight line (parallel sides) or to an L (mixed sides).
  const bends: Point[] =
    axis === 'y'
      ? [
          { x: stubA.x, y: pos },
          { x: stubB.x, y: pos },
        ]
      : [
          { x: pos, y: stubA.y },
          { x: pos, y: stubB.y },
        ];

  const pts = simplifyOrthogonal([start, stubA, ...bends, stubB, end]);
  // **Anti-degeneration guard**: when the two boxes **coincide** (e.g. a step dropped on another,
  // or stacked by the layout), all points anchor at the same place and `simplifyOrthogonal`
  // reduces the path to **a single point** — yet the schema requires ≥ 2 points (`scene.ts`).
  // We then fall back to the raw `[start, end]` segment (at worst zero-length, harmless): the
  // connector stays **valid and bound**, and re-routes normally as soon as the boxes move apart.
  // Without this guard, `addElement`/`updateElement` would throw "points: Invalid input" →
  // link not created / not re-routed.
  const safe = pts.length >= 2 ? pts : [start, end];
  const origin = safe[0] ?? start;
  return {
    x: origin.x,
    y: origin.y,
    points: safe.map((p): [number, number] => [p.x - origin.x, p.y - origin.y]),
  };
}
