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
