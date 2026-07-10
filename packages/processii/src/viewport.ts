/**
 * Viewport — **world ↔ screen** transform of the whiteboard (zoom + pan).
 *
 * The engine (`board`/`engine`) stores absolute **world** coordinates, screen-independent:
 * that is what converges in collab and persists offline. Zoom and pan are on the contrary a
 * **local presentation** state (per-user, like the selection) — so they live here, outside the
 * CRDT, as a pure, stateless transform.
 *
 * Convention: `screen = world * zoom + (x, y)`. In other words `(x, y)` is the **screen**
 * position (in CSS pixels) of the world point `(0, 0)`, and `zoom` the scale factor (1 = 100%).
 * All functions are pure (no mutation, no DOM access) → testable without a browser.
 */

/** Local presentation state: screen translation of the world origin + scale factor. */
export interface Viewport {
  /** Screen position (px) of the world point (0,0). */
  readonly x: number;
  /** Screen position (px) of the world point (0,0). */
  readonly y: number;
  /** Scale factor (1 = 100%). Always within [MIN_ZOOM, MAX_ZOOM]. */
  readonly zoom: number;
}

/** A 2D point (world or screen depending on the context). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Zoom bounds: below/above, the zoom saturates (UX: no infinite or inverted zoom). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/** Neutral viewport: world origin at top-left, scale 1. */
export const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** Saturates a zoom factor within the allowed bounds (also rejects NaN → MIN_ZOOM). */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Converts a **screen** point (CSS px, relative to the canvas) into **world** coordinates. */
export function screenToWorld(viewport: Viewport, screen: Point): Point {
  return {
    x: (screen.x - viewport.x) / viewport.zoom,
    y: (screen.y - viewport.y) / viewport.zoom,
  };
}

/** Converts a **world** point into **screen** coordinates (CSS px, relative to the canvas). */
export function worldToScreen(viewport: Viewport, world: Point): Point {
  return {
    x: world.x * viewport.zoom + viewport.x,
    y: world.y * viewport.zoom + viewport.y,
  };
}

/** Canvas dimensions in CSS pixels (screen space). */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * World point currently at the **center of the visible canvas** (of the given CSS-pixel size),
 * under this viewport. Pure companion of {@link screenToWorld}: this is where a freshly created
 * item should be dropped so it appears in the middle of what the user is actually looking at,
 * whatever the current pan/zoom — rather than at a fixed world position that may have scrolled
 * off-screen.
 */
export function viewportCenter(viewport: Viewport, size: Size): Point {
  return screenToWorld(viewport, { x: size.width / 2, y: size.height / 2 });
}

/**
 * World **rectangle** currently visible on a canvas of the given CSS-pixel size, under this
 * viewport: the on-screen region `[0, width] × [0, height]` mapped back into world coordinates
 * (top-left = `screenToWorld(0, 0)`, extents divided by the zoom). Pure companion of
 * {@link viewportCenter}; lets a host reason about *what the user is currently looking at* (e.g.
 * whether an existing swimlane cluster is on screen), not only where the view center is. The result
 * is structurally a world `BoundingBox`.
 */
export function visibleWorldRect(
  viewport: Viewport,
  size: Size,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
}

/** Pan: translates the view by a **screen** delta (px). The zoom is unchanged. */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { x: viewport.x + dxScreen, y: viewport.y + dyScreen, zoom: viewport.zoom };
}

/**
 * Zoom **anchored** on a screen point (typically the cursor): multiplies the zoom by `factor`
 * and adjusts the pan so the world point under `pivot` stays **still on screen**. This is the
 * expected wheel-zoom UX. The resulting zoom saturates within [MIN_ZOOM, MAX_ZOOM]; if the
 * saturation prevents it from changing, the viewport is returned unchanged.
 */
export function zoomAt(viewport: Viewport, factor: number, pivot: Point): Viewport {
  const nextZoom = clampZoom(viewport.zoom * factor);
  if (nextZoom === viewport.zoom) return viewport;
  // World point currently under the screen pivot: it must stay under the pivot after zooming.
  const world = screenToWorld(viewport, pivot);
  return {
    x: pivot.x - world.x * nextZoom,
    y: pivot.y - world.y * nextZoom,
    zoom: nextZoom,
  };
}

/** Sets an absolute zoom while keeping `pivot` (default: screen origin) still. */
export function setZoom(viewport: Viewport, zoom: number, pivot: Point = { x: 0, y: 0 }): Viewport {
  const target = clampZoom(zoom);
  return zoomAt(viewport, target / viewport.zoom, pivot);
}
