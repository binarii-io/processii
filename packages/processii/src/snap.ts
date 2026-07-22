/**
 * Snapping / alignment — snaps a moving box onto the **edges and centers** of the other
 * elements, for clean alignment without manual pixel-perfection. **Pure** logic: takes the
 * proposed box (already moved) + the static boxes, returns a `(dx, dy)` correction to add and
 * the guide lines to draw. Zoom-independent: the caller passes a `threshold` in world units
 * (typically a few screen px divided by the zoom).
 */
import type { BoundingBox } from './engine.js';

/** Snap correction + possible guides (world coordinates of the alignment lines). */
export interface SnapResult {
  readonly dx: number;
  readonly dy: number;
  /** World abscissa of the vertical guide line (when snapping on X). */
  readonly guideX?: number;
  /** World ordinate of the horizontal guide line (when snapping on Y). */
  readonly guideY?: number;
}

/** The three lines of interest of a box on an axis: start, center, end. */
function axisLines(start: number, size: number): readonly number[] {
  return [start, start + size / 2, start + size];
}

/** Best snap on an axis: delta to apply + target value (for the guide), when ≤ threshold. */
function bestSnap(
  movingLines: readonly number[],
  staticLines: readonly number[],
  threshold: number,
): { delta: number; target: number } | undefined {
  let best: { delta: number; target: number } | undefined;
  for (const m of movingLines) {
    for (const s of staticLines) {
      const delta = s - m;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, target: s };
      }
    }
  }
  return best;
}

/**
 * Snaps `box` onto the edges/centers of `others`. Returns the `(dx, dy)` correction to add to
 * the proposed position and, if any, the guide line positions. `(0, 0)` when nothing snaps.
 */
export function snapMove(
  box: BoundingBox,
  others: readonly BoundingBox[],
  threshold: number,
): SnapResult {
  if (others.length === 0 || threshold <= 0) return { dx: 0, dy: 0 };

  const movingX = axisLines(box.x, box.width);
  const movingY = axisLines(box.y, box.height);
  const staticX: number[] = [];
  const staticY: number[] = [];
  for (const o of others) {
    staticX.push(...axisLines(o.x, o.width));
    staticY.push(...axisLines(o.y, o.height));
  }

  const snapX = bestSnap(movingX, staticX, threshold);
  const snapY = bestSnap(movingY, staticY, threshold);

  return {
    dx: snapX?.delta ?? 0,
    dy: snapY?.delta ?? 0,
    ...(snapX ? { guideX: snapX.target } : {}),
    ...(snapY ? { guideY: snapY.target } : {}),
  };
}

/** A gap-measurement segment to draw (equal-spacing guide), in world coordinates. */
export interface SpacingGuide {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Equal-spacing snap result: a per-axis correction (present only when a spacing snap applies on
 * that axis) plus the gap segments to draw. Distinct from {@link SnapResult} (edge/center
 * alignment) — the two combine (align one axis, distribute the other).
 */
export interface SpacingResult {
  /** Horizontal correction (present when a horizontal equal-gap snap applies). */
  readonly dx?: number;
  /** Vertical correction (present when a vertical equal-gap snap applies). */
  readonly dy?: number;
  /** Gap segments to draw (both axes when both snap). Empty when nothing snaps. */
  readonly guides: readonly SpacingGuide[];
}

/** True when the intervals `[a, a+as]` and `[b, b+bs]` overlap (strictly). */
function intervalsOverlap(a: number, as: number, b: number, bs: number): boolean {
  return a < b + bs && b < a + as;
}

/**
 * Best equal-spacing snap of `box` along **one axis**, given the row-mates already filtered to
 * those overlapping `box` on the perpendicular axis. Generic over the axis via accessors: `mainStart`
 * reads the start on the distribution axis (x for horizontal), `mainSize` its size; `box` is
 * `{ start, size }` on that axis; `crossCenter` is where to draw the gap segments (the box center on
 * the perpendicular axis). Returns the delta to add on the main axis + the two gap segments, or
 * `undefined`. Three candidates: **equal gap between** the two neighbors, or **match** the gap of an
 * outer pair to **extend** the row on either side; the closest within `threshold` wins.
 */
function bestSpacing(
  box: { start: number; size: number },
  mates: readonly { start: number; size: number }[],
  crossCenter: number,
  threshold: number,
  seg: (a: number, b: number, cross: number) => SpacingGuide,
): { delta: number; guides: SpacingGuide[] } | undefined {
  if (mates.length < 2) return undefined;
  const bc = box.start + box.size / 2;
  const left = mates
    .filter((m) => m.start + m.size / 2 < bc)
    .sort((a, b) => b.start + b.size - (a.start + a.size)); // nearest (largest right edge) first
  const right = mates.filter((m) => m.start + m.size / 2 >= bc).sort((a, b) => a.start - b.start);
  const L = left[0];
  const LL = left[1];
  const R = right[0];
  const RR = right[1];
  const candidates: { target: number; guides: SpacingGuide[] }[] = [];
  // 1) Equal gap between the left and right neighbours.
  if (L && R) {
    const inner = R.start - (L.start + L.size);
    const gap = (inner - box.size) / 2;
    if (gap > 0) {
      const target = L.start + L.size + gap;
      candidates.push({
        target,
        guides: [
          seg(L.start + L.size, target, crossCenter),
          seg(target + box.size, R.start, crossCenter),
        ],
      });
    }
  }
  // 2) Extend on the right: reproduce the gap of the outer left pair (LL → L) as (L → box).
  if (L && LL) {
    const g = L.start - (LL.start + LL.size);
    if (g > 0) {
      const target = L.start + L.size + g;
      candidates.push({
        target,
        guides: [
          seg(LL.start + LL.size, LL.start + LL.size + g, crossCenter),
          seg(L.start + L.size, target, crossCenter),
        ],
      });
    }
  }
  // 3) Extend on the left: reproduce the gap of the outer right pair (R → RR) as (box → R).
  if (R && RR) {
    const g = RR.start - (R.start + R.size);
    if (g > 0) {
      const target = R.start - g - box.size;
      candidates.push({
        target,
        guides: [
          seg(target + box.size, R.start, crossCenter),
          seg(R.start + R.size, R.start + R.size + g, crossCenter),
        ],
      });
    }
  }
  let best: { delta: number; guides: SpacingGuide[] } | undefined;
  for (const c of candidates) {
    const delta = c.target - box.start;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { delta, guides: c.guides };
    }
  }
  return best;
}

/**
 * **Equal-spacing (distribution) snap** — the smart-guide behavior "two elements have a gap, drop a
 * third and it takes the same gap". Snaps a moving `box` so that, along an axis, it either lands
 * **equidistant** between its two neighbours or **reproduces** the gap of an adjacent pair to extend
 * the row. Considers only `others` that **overlap the box on the perpendicular axis** (a "row"/
 * "column"). Returns the per-axis correction (present only where it snaps) + the gap segments to
 * draw. Pure; pass only **element** bounds (not swimlanes) — a lane band would distort every gap.
 */
export function snapSpacing(
  box: BoundingBox,
  others: readonly BoundingBox[],
  threshold: number,
): SpacingResult {
  if (others.length === 0 || threshold <= 0) return { guides: [] };
  // Horizontal distribution: row-mates overlap the box vertically; gap segments are horizontal.
  const rowMates = others
    .filter((o) => intervalsOverlap(box.y, box.height, o.y, o.height))
    .map((o) => ({ start: o.x, size: o.width }));
  const x = bestSpacing(
    { start: box.x, size: box.width },
    rowMates,
    box.y + box.height / 2,
    threshold,
    (a, b, cross) => ({ x1: a, y1: cross, x2: b, y2: cross }),
  );
  // Vertical distribution: column-mates overlap horizontally; gap segments are vertical.
  const colMates = others
    .filter((o) => intervalsOverlap(box.x, box.width, o.x, o.width))
    .map((o) => ({ start: o.y, size: o.height }));
  const y = bestSpacing(
    { start: box.y, size: box.height },
    colMates,
    box.x + box.width / 2,
    threshold,
    (a, b, cross) => ({ x1: cross, y1: a, x2: cross, y2: b }),
  );
  return {
    ...(x ? { dx: x.delta } : {}),
    ...(y ? { dy: y.delta } : {}),
    guides: [...(x?.guides ?? []), ...(y?.guides ?? [])],
  };
}

/** Which sides a resize handle drags. Only the flagged edges move; the opposite ones stay fixed. */
export interface ResizeEdges {
  readonly left?: boolean;
  readonly right?: boolean;
  readonly top?: boolean;
  readonly bottom?: boolean;
}

/** Adjusted box after resize snapping, plus the guide line(s) to draw. */
export interface ResizeSnapResult {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** World abscissa of the vertical guide line (when the dragged vertical edge snapped). */
  readonly guideX?: number;
  /** World ordinate of the horizontal guide line (when the dragged horizontal edge snapped). */
  readonly guideY?: number;
}

/**
 * Snaps the **dragged edges** of a box being resized onto the edges/centers of `others` — the
 * alignment counterpart of {@link snapMove} for resizing. `edges` says which sides the active
 * handle moves (dragging the east handle → `{ right: true }`, the south-east corner →
 * `{ right, bottom }`). Only those edges move (the opposite edge stays fixed), so the correction
 * changes the **size**, not just the position. A snap that would shrink the box below `minSize`
 * is skipped. Returns the adjusted box plus the guide line(s). **Axis-aligned boxes only** — the
 * caller skips rotated elements. No-op when nothing is within `threshold`.
 */
export function snapResize(
  box: BoundingBox,
  edges: ResizeEdges,
  others: readonly BoundingBox[],
  threshold: number,
  minSize = 0,
): ResizeSnapResult {
  if (others.length === 0 || threshold <= 0) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const staticX: number[] = [];
  const staticY: number[] = [];
  for (const o of others) {
    staticX.push(...axisLines(o.x, o.width));
    staticY.push(...axisLines(o.y, o.height));
  }

  let { x, y, width, height } = box;
  let guideX: number | undefined;
  let guideY: number | undefined;

  // Horizontal axis: a handle drags at most one of left/right.
  if (edges.left) {
    const s = bestSnap([x], staticX, threshold);
    if (s && x + width - s.target >= minSize) {
      width = x + width - s.target;
      x = s.target;
      guideX = s.target;
    }
  } else if (edges.right) {
    const s = bestSnap([x + width], staticX, threshold);
    if (s && s.target - x >= minSize) {
      width = s.target - x;
      guideX = s.target;
    }
  }

  // Vertical axis: a handle drags at most one of top/bottom.
  if (edges.top) {
    const s = bestSnap([y], staticY, threshold);
    if (s && y + height - s.target >= minSize) {
      height = y + height - s.target;
      y = s.target;
      guideY = s.target;
    }
  } else if (edges.bottom) {
    const s = bestSnap([y + height], staticY, threshold);
    if (s && s.target - y >= minSize) {
      height = s.target - y;
      guideY = s.target;
    }
  }

  return {
    x,
    y,
    width,
    height,
    ...(guideX !== undefined ? { guideX } : {}),
    ...(guideY !== undefined ? { guideY } : {}),
  };
}
