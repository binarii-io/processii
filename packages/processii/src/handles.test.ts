import { describe, expect, it } from 'vitest';
import { parseElement, type WhiteboardElement } from './scene.js';
import {
  elementHandles,
  handleAtPoint,
  hasHandles,
  resizeElement,
  rotateElement,
} from './handles.js';

function box(extra: object = {}): WhiteboardElement {
  return parseElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 100, height: 60, ...extra });
}

describe('handles — geometry', () => {
  it('a rectangle has 8 resize handles + 1 rotation handle', () => {
    const kinds = elementHandles(box()).map((h) => h.kind);
    expect(kinds).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']);
  });

  it('places the corners on the box (no rotation)', () => {
    const handles = elementHandles(box());
    expect(handles.find((h) => h.kind === 'nw')).toMatchObject({ x: 0, y: 0 });
    expect(handles.find((h) => h.kind === 'se')).toMatchObject({ x: 100, y: 60 });
    expect(handles.find((h) => h.kind === 'e')).toMatchObject({ x: 100, y: 30 });
  });

  it('lines (line/arrow) have no handles', () => {
    const line = parseElement({
      kind: 'line',
      id: 'l',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [10, 10],
      ],
    });
    expect(hasHandles(line)).toBe(false);
    expect(elementHandles(line)).toEqual([]);
  });
});

describe('handles — hit-test', () => {
  it('detects the handle under the point (area depends on the zoom)', () => {
    const r = box();
    expect(handleAtPoint(r, { x: 100, y: 60 }, 1)).toBe('se');
    expect(handleAtPoint(r, { x: 50, y: 30 }, 1)).toBeUndefined(); // center = not a handle
  });

  it('detects the rotation handle above the top edge', () => {
    const r = box();
    const rotate = elementHandles(r).find((h) => h.kind === 'rotate');
    expect(rotate).toBeDefined();
    expect(handleAtPoint(r, { x: rotate!.x, y: rotate!.y }, 1)).toBe('rotate');
  });

  it('grabs the whole edge, not only its midpoint square', () => {
    const r = box(); // 100x60 at (0,0)
    // Top edge (y=0) grabbed all along, far from the midpoint square at x=50.
    expect(handleAtPoint(r, { x: 10, y: 0 }, 1)).toBe('n');
    expect(handleAtPoint(r, { x: 90, y: 0 }, 1)).toBe('n');
    // Bottom / left / right edges too.
    expect(handleAtPoint(r, { x: 75, y: 60 }, 1)).toBe('s');
    expect(handleAtPoint(r, { x: 0, y: 12 }, 1)).toBe('w');
    expect(handleAtPoint(r, { x: 100, y: 48 }, 1)).toBe('e');
  });

  it('corners take precedence over the edges', () => {
    const r = box();
    expect(handleAtPoint(r, { x: 0, y: 0 }, 1)).toBe('nw');
    expect(handleAtPoint(r, { x: 100, y: 0 }, 1)).toBe('ne');
    expect(handleAtPoint(r, { x: 0, y: 60 }, 1)).toBe('sw');
    expect(handleAtPoint(r, { x: 100, y: 60 }, 1)).toBe('se');
  });

  it('the edge grab band has a limited thickness (interior stays free to move)', () => {
    const r = box();
    expect(handleAtPoint(r, { x: 20, y: 5 }, 1)).toBe('n'); // 5px inside the top edge → still grabs
    expect(handleAtPoint(r, { x: 20, y: 8 }, 1)).toBeUndefined(); // 8px in → interior (move)
    expect(handleAtPoint(r, { x: 50, y: 30 }, 1)).toBeUndefined(); // center → move
  });

  it('the band scales with the zoom (screen-constant)', () => {
    const r = box();
    // At zoom 2, the 6px screen band is 3 world units → 4px inside is out of the band.
    expect(handleAtPoint(r, { x: 20, y: 4 }, 2)).toBeUndefined();
    expect(handleAtPoint(r, { x: 20, y: 2 }, 2)).toBe('n');
  });

  it('grabs the edges in the local frame of a rotated box', () => {
    const r = box({ angle: Math.PI / 2 });
    // World position of the east-edge midpoint (already rotated) → still detected as 'e'.
    const east = elementHandles(r).find((h) => h.kind === 'e')!;
    expect(handleAtPoint(r, { x: east.x, y: east.y }, 1)).toBe('e');
  });
});

describe('handles — redimensionnement', () => {
  it('se: drags the bottom-right corner, keeps the top-left corner fixed', () => {
    const next = resizeElement(box(), 'se', { x: 200, y: 160 });
    expect(next).toEqual({ x: 0, y: 0, width: 200, height: 160 });
  });

  it('nw: drags the top-left corner, keeps the bottom-right corner fixed', () => {
    const next = resizeElement(box(), 'nw', { x: -20, y: -10 });
    // bottom-right stays at (100,60).
    expect(next).toEqual({ x: -20, y: -10, width: 120, height: 70 });
  });

  it('e: only touches the width', () => {
    const next = resizeElement(box(), 'e', { x: 150, y: 999 });
    expect(next).toEqual({ x: 0, y: 0, width: 150, height: 60 });
  });

  it('bounds the minimum size (no degenerate box)', () => {
    const next = resizeElement(box(), 'e', { x: -50, y: 0 });
    expect(next.width).toBeGreaterThanOrEqual(2);
  });

  it('resizing an element rotated 90° keeps the anchor fixed in the world', () => {
    // 100x60 rectangle rotated +90°. Dragging 'se'; the 'nw' anchor corner (world) must not move.
    const r = box({ angle: Math.PI / 2 });
    const before = elementHandles(r).find((h) => h.kind === 'nw')!;
    const next = resizeElement(r, 'se', { x: 40, y: 240 });
    const resized = parseElement({ ...r, ...next });
    const after = elementHandles(resized).find((h) => h.kind === 'nw')!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('handles — rotation', () => {
  it('handle straight above the center → angle ~0', () => {
    const r = box();
    const c = { x: 50, y: 30 };
    expect(rotateElement(r, { x: c.x, y: c.y - 100 })).toBeCloseTo(0, 6);
  });

  it('handle to the right of the center → +90°', () => {
    const r = box();
    expect(rotateElement(r, { x: 200, y: 30 })).toBeCloseTo(Math.PI / 2, 6);
  });

  it('snapStep snaps to the nearest multiple', () => {
    const r = box();
    // Slightly up-right → ~ close to 0, snaps to 0 with a 15° step.
    const angle = rotateElement(r, { x: 55, y: -100 }, Math.PI / 12);
    expect(angle).toBeCloseTo(0, 6);
  });
});
