import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  IDENTITY_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  setZoom,
  viewportCenter,
  worldToScreen,
  zoomAt,
  type Viewport,
} from './viewport.js';

describe('viewport — world ↔ screen transforms', () => {
  it('identity: world = screen', () => {
    expect(worldToScreen(IDENTITY_VIEWPORT, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(screenToWorld(IDENTITY_VIEWPORT, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('worldToScreen and screenToWorld are inverses', () => {
    const vp: Viewport = { x: 30, y: -15, zoom: 2 };
    const world = { x: 12.5, y: 7 };
    const screen = worldToScreen(vp, world);
    expect(screenToWorld(vp, screen)).toEqual(world);
  });

  it('applies pan + zoom: screen = world*zoom + (x,y)', () => {
    const vp: Viewport = { x: 100, y: 50, zoom: 2 };
    expect(worldToScreen(vp, { x: 10, y: 10 })).toEqual({ x: 120, y: 70 });
  });
});

describe('viewport — center of the visible canvas', () => {
  it('identity: center is the geometric middle of the canvas', () => {
    expect(viewportCenter(IDENTITY_VIEWPORT, { width: 800, height: 600 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('follows pan/zoom: the world point under the screen center is returned', () => {
    const vp: Viewport = { x: 100, y: 50, zoom: 2 };
    const size = { width: 800, height: 600 };
    // Same as inverting the screen mid-point through the viewport.
    expect(viewportCenter(vp, size)).toEqual(screenToWorld(vp, { x: 400, y: 300 }));
    // A shape centered here lands under the screen center once transformed back.
    expect(worldToScreen(vp, viewportCenter(vp, size))).toEqual({ x: 400, y: 300 });
  });
});

describe('viewport — pan', () => {
  it('translates the view without changing the zoom', () => {
    const vp = panBy({ x: 5, y: 5, zoom: 3 }, 10, -2);
    expect(vp).toEqual({ x: 15, y: 3, zoom: 3 });
  });
});

describe('viewport — zoom', () => {
  it('clampZoom saturates at the bounds and rejects NaN', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('zoomAt keeps the point under the pivot still on screen', () => {
    const vp = IDENTITY_VIEWPORT;
    const pivot = { x: 200, y: 120 };
    const worldUnderPivot = screenToWorld(vp, pivot);
    const zoomed = zoomAt(vp, 2, pivot);
    expect(zoomed.zoom).toBe(2);
    // The world point under the pivot must land exactly back under the screen pivot.
    expect(worldToScreen(zoomed, worldUnderPivot)).toEqual(pivot);
  });

  it('zoomAt saturates and returns the viewport unchanged when the bound blocks', () => {
    const vp: Viewport = { x: 0, y: 0, zoom: MAX_ZOOM };
    expect(zoomAt(vp, 2, { x: 0, y: 0 })).toBe(vp);
  });

  it('setZoom reaches an absolute zoom around the pivot', () => {
    const vp = setZoom(IDENTITY_VIEWPORT, 4, { x: 50, y: 50 });
    expect(vp.zoom).toBe(4);
    expect(worldToScreen(vp, screenToWorld(IDENTITY_VIEWPORT, { x: 50, y: 50 }))).toEqual({
      x: 50,
      y: 50,
    });
  });
});
