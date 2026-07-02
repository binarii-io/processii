import { describe, expect, it } from 'vitest';
import { parseElement } from './scene.js';
import { boxFromPoints, elementsInBox, hitTest, pointInElement } from './hit-test.js';
import type { WhiteboardElement } from './scene.js';

function rect(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 60,
  extra: object = {},
): WhiteboardElement {
  return parseElement({ kind: 'rectangle', id, x, y, width: w, height: h, ...extra });
}

describe('pointInElement — formes pleines', () => {
  it('rectangle: inside hit, outside missed', () => {
    const r = rect('r', 0, 0, 100, 60);
    expect(pointInElement(r, { x: 50, y: 30 }, 0)).toBe(true);
    expect(pointInElement(r, { x: 200, y: 200 }, 0)).toBe(false);
  });

  it('ellipse: the bbox corner is not inside the ellipse', () => {
    const e = parseElement({ kind: 'ellipse', id: 'e', x: 0, y: 0, width: 100, height: 100 });
    expect(pointInElement(e, { x: 50, y: 50 }, 0)).toBe(true); // centre
    expect(pointInElement(e, { x: 2, y: 2 }, 0)).toBe(false); // coin
  });

  it('rectangle rotated 90°: the point is tested in the local frame', () => {
    // Wide rectangle rotated a quarter turn → becomes "tall" on screen.
    const r = rect('r', 0, 0, 100, 20, { angle: Math.PI / 2 });
    // Center (50,10). After rotation, a point above/below the center falls inside.
    expect(pointInElement(r, { x: 50, y: 50 }, 0)).toBe(true);
    expect(pointInElement(r, { x: 50, y: -30 }, 0)).toBe(true);
    // A point far along the original (wide) axis is no longer inside the rotated shape.
    expect(pointInElement(r, { x: 95, y: 10 }, 0)).toBe(false);
  });
});

describe('pointInElement — lines (tolerance)', () => {
  it('line: hit near a segment, missed beyond the tolerance', () => {
    const line = parseElement({
      kind: 'line',
      id: 'l',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    expect(pointInElement(line, { x: 50, y: 3 }, 6)).toBe(true);
    expect(pointInElement(line, { x: 50, y: 20 }, 6)).toBe(false);
  });
});

describe('hitTest — topmost element', () => {
  it('returns the highest-z element under the point', () => {
    const low = rect('low', 0, 0, 100, 100, { z: 0 });
    const high = rect('high', 0, 0, 100, 100, { z: 5 });
    // Sorted by ascending z like listElements().
    const hit = hitTest([low, high], { x: 50, y: 50 }, 0);
    expect(hit?.id).toBe('high');
  });

  it('returns undefined when nothing is hit', () => {
    expect(hitTest([rect('r', 0, 0)], { x: 500, y: 500 }, 0)).toBeUndefined();
  });
});

describe('elementsInBox — marquee selection', () => {
  it('catches the elements whose bbox intersects the rectangle', () => {
    const a = rect('a', 0, 0, 50, 50);
    const b = rect('b', 200, 200, 50, 50);
    const box = boxFromPoints({ x: -10, y: -10 }, { x: 100, y: 100 });
    expect(elementsInBox([a, b], box)).toEqual(['a']);
  });

  it('boxFromPoints normalizes whatever the corner order', () => {
    expect(boxFromPoints({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 80,
      height: 70,
    });
  });
});
