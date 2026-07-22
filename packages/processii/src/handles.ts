/**
 * Transform handles — resize (8 handles) + rotation (1 handle) of a **box-shaped** element
 * (rectangle / ellipse / text). **Pure, DOM-free** logic: handle geometry, hit-test and new
 * state computation, reused by the renderer (`render.ts`) and by the interaction layer (the
 * standalone canvas). Lines (line/arrow) have no box handles (point-level editing belongs to
 * another lot).
 *
 * Everything is **rotation-aware**: handles are placed on the element's local (unrotated) box
 * then rotated around its center by `angle`; resizing brings the pointer back into the local
 * frame, adjusts the dragged edge while keeping the opposite edge **fixed in the world**, then
 * shifts the origin to absorb the center displacement induced by the rotation.
 */
import { type Point } from './viewport.js';
import type { WhiteboardElement } from './scene.js';

/** The 8 resize handles + the rotation handle. */
export type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** A handle positioned in the world (already rotated by the element's angle). */
export interface Handle {
  readonly kind: HandleKind;
  readonly x: number;
  readonly y: number;
}

/** Size (screen px) of a handle square — used for drawing and for the click area. */
export const HANDLE_SCREEN_SIZE = 8;
/**
 * Perpendicular thickness (screen px) of the grab band along **the whole edge** of a box. The
 * entire border resizes (top/bottom → height, left/right → width), not only the small square drawn
 * at the edge midpoint — so grabbing an edge is intuitive. Corners keep priority (both axes), and
 * the connection dot rendered on top of the midpoint keeps creating linked items.
 */
export const EDGE_GRAB_SCREEN = 6;
/** Distance (screen px) of the rotation handle above the top edge. */
export const ROTATE_HANDLE_OFFSET = 22;
/** Minimum size (world units) of a resized element — avoids degenerate boxes. */
export const MIN_ELEMENT_SIZE = 2;

/** Element with a box (handles applicable): not the lines (line/arrow). */
export function hasHandles(element: WhiteboardElement): boolean {
  return (
    element.kind === 'rectangle' ||
    element.kind === 'ellipse' ||
    element.kind === 'text' ||
    element.kind === 'step'
  );
}

function rotateAround(p: Point, c: Point, angle: number): Point {
  if (angle === 0) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function center(element: WhiteboardElement): Point {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

/**
 * World positions of a box-shaped element's handles, rotated by its angle. `zoom` keeps the
 * rotation-handle offset constant on screen. Empty array when the element has no handles.
 */
export function elementHandles(element: WhiteboardElement, zoom = 1): Handle[] {
  if (!hasHandles(element)) return [];
  const c = center(element);
  const { x, y, width: w, height: h } = element;
  const cx = x + w / 2;
  const rotateOffset = ROTATE_HANDLE_OFFSET / zoom;
  const local: { kind: HandleKind; x: number; y: number }[] = [
    { kind: 'nw', x, y },
    { kind: 'n', x: cx, y },
    { kind: 'ne', x: x + w, y },
    { kind: 'e', x: x + w, y: y + h / 2 },
    { kind: 'se', x: x + w, y: y + h },
    { kind: 's', x: cx, y: y + h },
    { kind: 'sw', x, y: y + h },
    { kind: 'w', x, y: y + h / 2 },
    { kind: 'rotate', x: cx, y: y - rotateOffset },
  ];
  return local.map((handle) => {
    const world = rotateAround({ x: handle.x, y: handle.y }, c, element.angle);
    return { kind: handle.kind, x: world.x, y: world.y };
  });
}

/**
 * Handle under the world point `p`, or `undefined`. Corners and the rotation knob keep a small
 * square catch area (`HANDLE_SCREEN_SIZE` px on screen, divided by the zoom in world units); the
 * four **edges** are grabbed along their **whole length** within a `EDGE_GRAB_SCREEN` px band, so
 * the entire border resizes (not only the square drawn at the midpoint). Everything is tested in
 * the element's local (unrotated) frame, so a rotated box keeps axis-aligned edge grabs.
 */
export function handleAtPoint(
  element: WhiteboardElement,
  p: Point,
  zoom = 1,
): HandleKind | undefined {
  if (!hasHandles(element)) return undefined;
  const c = center(element);
  const { x, y, width: w, height: h } = element;

  // Rotation knob: small square above the top-center (tested in world coordinates).
  const rotReach = HANDLE_SCREEN_SIZE / zoom;
  const rot = rotateAround({ x: x + w / 2, y: y - ROTATE_HANDLE_OFFSET / zoom }, c, element.angle);
  if (Math.abs(p.x - rot.x) <= rotReach && Math.abs(p.y - rot.y) <= rotReach) return 'rotate';

  // Corners + edges: bring the pointer back into the element's local (unrotated) frame so the box
  // is axis-aligned and the edges are horizontal/vertical.
  const local = rotateAround(p, c, -element.angle);
  const band = EDGE_GRAB_SCREEN / zoom;
  const left = x;
  const right = x + w;
  const top = y;
  const bottom = y + h;
  const nearLeft = Math.abs(local.x - left) <= band;
  const nearRight = Math.abs(local.x - right) <= band;
  const nearTop = Math.abs(local.y - top) <= band;
  const nearBottom = Math.abs(local.y - bottom) <= band;
  const withinX = local.x >= left - band && local.x <= right + band;
  const withinY = local.y >= top - band && local.y <= bottom + band;

  // Corners first (resize on both axes), then the full-length edges.
  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearRight) return 'se';
  if (nearBottom && nearLeft) return 'sw';
  if (nearTop && withinX) return 'n';
  if (nearBottom && withinX) return 's';
  if (nearLeft && withinY) return 'w';
  if (nearRight && withinY) return 'e';
  return undefined;
}

/** New geometry (x,y,width,height) after dragging a resize handle to `p`. */
export function resizeElement(
  element: WhiteboardElement,
  handle: Exclude<HandleKind, 'rotate'>,
  p: Point,
): { x: number; y: number; width: number; height: number } {
  const cOld = center(element);
  // Pointer brought back into the element's local (unrotated) frame.
  const local = rotateAround(p, cOld, -element.angle);

  let left = element.x;
  let top = element.y;
  let right = element.x + element.width;
  let bottom = element.y + element.height;

  if (handle.includes('w')) left = local.x;
  if (handle.includes('e')) right = local.x;
  if (handle.includes('n')) top = local.y;
  if (handle.includes('s')) bottom = local.y;

  // Keeps a minimum size: the dragged edge is bounded, the opposite edge stays fixed.
  if (handle.includes('w')) left = Math.min(left, right - MIN_ELEMENT_SIZE);
  if (handle.includes('e')) right = Math.max(right, left + MIN_ELEMENT_SIZE);
  if (handle.includes('n')) top = Math.min(top, bottom - MIN_ELEMENT_SIZE);
  if (handle.includes('s')) bottom = Math.max(bottom, top + MIN_ELEMENT_SIZE);

  const nx = left;
  const ny = top;
  const nw = right - left;
  const nh = bottom - top;

  // "Anchor" corner (edge opposite to the dragged one): it must stay still **in the world**.
  const anchorOldLocal: Point = {
    x: handle.includes('w') ? element.x + element.width : element.x,
    y: handle.includes('n') ? element.y + element.height : element.y,
  };
  const anchorNewLocal: Point = {
    x: handle.includes('w') ? nx + nw : nx,
    y: handle.includes('n') ? ny + nh : ny,
  };
  const anchorWorldOld = rotateAround(anchorOldLocal, cOld, element.angle);
  const cNew: Point = { x: nx + nw / 2, y: ny + nh / 2 };
  const anchorWorldNew = rotateAround(anchorNewLocal, cNew, element.angle);

  return {
    x: nx + (anchorWorldOld.x - anchorWorldNew.x),
    y: ny + (anchorWorldOld.y - anchorWorldNew.y),
    width: nw,
    height: nh,
  };
}

/**
 * New angle (radians) when dragging the rotation handle to `p`. Angle 0 matches the handle
 * straight above the center. `snapStep` (radians) snaps the angle to the nearest multiple
 * (e.g. `Math.PI / 12` = 15°) — typically while Shift is held.
 */
export function rotateElement(element: WhiteboardElement, p: Point, snapStep = 0): number {
  const c = center(element);
  // atan2(dy, dx) + PI/2: handle above (dy<0, dx=0) → angle 0.
  let angle = Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2;
  if (snapStep > 0) angle = Math.round(angle / snapStep) * snapStep;
  // Normalizes into (-PI, PI].
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  return angle;
}
