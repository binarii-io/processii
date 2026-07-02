import { describe, expect, it } from 'vitest';
import { snapMove } from './snap.js';
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
