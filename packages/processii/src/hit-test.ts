/**
 * Hit-testing — "which element is under this world point?" and "which elements fall inside this
 * rectangle?". **Pure, DOM-free** logic (like the rest of the engine): takes elements + **world**
 * coordinates (already unprojected from the viewport by the caller) and returns ids.
 *
 * The test is **rotation**-aware: for solid shapes (rectangle/ellipse/text) the point is brought
 * back into the element's local frame (inverse rotation around the center) before testing; for
 * lines (line/arrow) the distance to the segments is measured, with a tolerance.
 */
import { elementBounds, type BoundingBox } from './engine.js';
import type { Point } from './viewport.js';
import type { WhiteboardElement } from './scene.js';

/** Default tolerance (world units) to select a thin line by click. */
export const DEFAULT_HIT_TOLERANCE = 6;

/** Center of an element's bounding box (rotation center). */
function center(element: WhiteboardElement): Point {
  const b = elementBounds(element);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Brings `p` back into the element's local frame (cancels its rotation around its center). */
function toLocal(element: WhiteboardElement, p: Point): Point {
  if (element.angle === 0) return p;
  const c = center(element);
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Distance from a point to the segment [a, b] (world units). */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * True when the world point `p` touches the element. `tolerance` widens the lines (line/arrow)
 * and gives a click margin at the edges; it is typically `DEFAULT_HIT_TOLERANCE / zoom` to stay
 * constant on screen.
 */
export function pointInElement(
  element: WhiteboardElement,
  p: Point,
  tolerance = DEFAULT_HIT_TOLERANCE,
): boolean {
  if (element.kind === 'line' || element.kind === 'arrow') {
    const pts = element.points.map(([px, py]) => ({ x: element.x + px, y: element.y + py }));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a && b && distanceToSegment(p, a, b) <= tolerance) return true;
    }
    return false;
  }

  const local = toLocal(element, p);
  if (element.kind === 'ellipse') {
    const rx = element.width / 2;
    const ry = element.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (local.x - (element.x + rx)) / rx;
    const ny = (local.y - (element.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  // rectangle & text: local bbox, widened by the tolerance.
  return (
    local.x >= element.x - tolerance &&
    local.x <= element.x + element.width + tolerance &&
    local.y >= element.y - tolerance &&
    local.y <= element.y + element.height + tolerance
  );
}

/**
 * **Topmost** element (max z) touched by the world point, or `undefined`. `elements` is assumed
 * sorted by ascending z-order (like `engine.listElements()`), so it is walked in reverse to
 * favor the top.
 */
export function hitTest(
  elements: readonly WhiteboardElement[],
  p: Point,
  tolerance = DEFAULT_HIT_TOLERANCE,
): WhiteboardElement | undefined {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element && pointInElement(element, p, tolerance)) return element;
  }
  return undefined;
}

/** True when two axis-aligned bounding boxes overlap (edges included). */
function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

/**
 * Ids of the elements whose bounding box **intersects** the world rectangle `box` (marquee
 * selection). Intersection is used (not strict inclusion): more forgiving UX, grazed elements
 * are caught. The result follows the order of `elements`.
 */
export function elementsInBox(elements: readonly WhiteboardElement[], box: BoundingBox): string[] {
  const ids: string[] = [];
  for (const element of elements) {
    if (boxesIntersect(elementBounds(element), box)) ids.push(element.id);
  }
  return ids;
}

/** Builds a normalized bounding box from two world corners (marquee). */
export function boxFromPoints(a: Point, b: Point): BoundingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
