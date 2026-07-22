import { describe, expect, it } from 'vitest';
import { snapMove, snapResize } from './snap.js';
import type { BoundingBox } from './engine.js';

const b = (x: number, y: number, width = 50, height = 50): BoundingBox => ({ x, y, width, height });

describe('snapMove — alignment on the other elements', () => {
  it('snaps the left edge onto a close neighbor left edge', () => {
    // box at x=3, neighbor at x=0 → the left snaps to 0 (dx = -3).
    const result = snapMove(b(3, 200), [b(0, 0)], 6);
    expect(result.dx).toBe(-3);
    expect(result.guideX).toBe(0);
  });

  it('snaps the centers', () => {
    // box center x = 100+25=125; neighbor center x = 122+25=147... let's pick a real proximity.
    const moving = b(100, 200); // centre x = 125
    const other = b(102, 0); // centre x = 127 → delta 2
    const result = snapMove(moving, [other], 6);
    expect(result.dx).toBe(2); // 125 -> 127
  });

  it('does not snap beyond the threshold', () => {
    // box X lines [60,85,110] vs neighbor [0,25,50]: everything is > 6 apart.
    const result = snapMove(b(60, 200), [b(0, 0)], 6);
    expect(result).toEqual({ dx: 0, dy: 0 });
  });

  it('snaps independently on X and Y', () => {
    const result = snapMove(b(4, 3), [b(0, 0)], 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(-3);
    expect(result.guideX).toBe(0);
    expect(result.guideY).toBe(0);
  });

  it('without neighbors or with a zero threshold: no snapping', () => {
    expect(snapMove(b(3, 3), [], 6)).toEqual({ dx: 0, dy: 0 });
    expect(snapMove(b(3, 3), [b(0, 0)], 0)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('snapResize — alignment of the dragged edge', () => {
  it('snaps the dragged right edge onto a neighbor edge (changes width, keeps x)', () => {
    // box right edge at 103; neighbor lines [50,75,100] → 100 is 3 away → snap.
    const r = snapResize(b(0, 0, 103, 50), { right: true }, [b(50, 0)], 6);
    expect(r).toMatchObject({ x: 0, y: 0, width: 100, height: 50, guideX: 100 });
    expect(r.guideY).toBeUndefined();
  });

  it('snaps the dragged left edge (moves x and width, keeps the right edge)', () => {
    // box left at 3; neighbor left edge at 0 → snap. Right edge (53) stays put.
    const r = snapResize(b(3, 0, 50, 60), { left: true }, [b(0, 200)], 6);
    expect(r).toMatchObject({ x: 0, width: 53, guideX: 0 });
  });

  it('a corner handle snaps on both axes independently', () => {
    const r = snapResize(b(0, 0, 103, 82), { right: true, bottom: true }, [b(50, 100)], 6);
    // right → 100 (from neighbor left edge), bottom → 80? neighbor Y lines [100,125,150]; 82 vs 100 = 18 > 6 → no snap on Y.
    expect(r).toMatchObject({ width: 100, height: 82, guideX: 100 });
    expect(r.guideY).toBeUndefined();
  });

  it('does not snap beyond the threshold', () => {
    const r = snapResize(b(0, 0, 120, 50), { right: true }, [b(200, 0)], 6);
    expect(r).toEqual({ x: 0, y: 0, width: 120, height: 50 });
  });

  it('skips a snap that would collapse the box below the minimum size', () => {
    // box right at 5; a neighbor line at 1 is within 6 but would make width 1 < minSize 2 → skipped.
    const r = snapResize(b(0, 0, 5, 50), { right: true }, [b(1, 0, 0, 0)], 6, 2);
    expect(r).toEqual({ x: 0, y: 0, width: 5, height: 50 });
  });

  it('without neighbors or with a zero threshold: box unchanged', () => {
    expect(snapResize(b(3, 3, 40, 40), { right: true }, [], 6)).toEqual({
      x: 3,
      y: 3,
      width: 40,
      height: 40,
    });
    expect(snapResize(b(3, 3, 40, 40), { right: true }, [b(0, 0)], 0)).toEqual({
      x: 3,
      y: 3,
      width: 40,
      height: 40,
    });
  });
});
