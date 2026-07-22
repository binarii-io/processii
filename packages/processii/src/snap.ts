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
