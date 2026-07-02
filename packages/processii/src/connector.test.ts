import { describe, expect, it } from 'vitest';
import { borderPoint, connectorElbow, connectorGeometry } from './connector.js';
import { createEngine } from './engine.js';
import type { BoundingBox } from './engine.js';

/** Absolute coordinates of a connector's points (origin + relative points). */
function absPoints(geo: { x: number; y: number; points: [number, number][] }): [number, number][] {
  return geo.points.map(([px, py]) => [geo.x + px, geo.y + py]);
}

const box = (x: number, y: number, w = 100, h = 100): BoundingBox => ({
  x,
  y,
  width: w,
  height: h,
});

describe('connector — pure geometry', () => {
  it('borderPoint clips on the border towards the target', () => {
    // box centered (50,50). Target far right → right edge (100,50).
    expect(borderPoint(box(0, 0), { x: 1000, y: 50 })).toEqual({ x: 100, y: 50 });
    // Target far below → bottom edge (50,100).
    expect(borderPoint(box(0, 0), { x: 50, y: 1000 })).toEqual({ x: 50, y: 100 });
  });

  it('links two boxes edge to edge (horizontally aligned) → straight line', () => {
    const a = box(0, 0); // center (50,50), right edge x=100
    const b = box(200, 0); // center (250,50), left edge x=200
    const geo = connectorGeometry(a, b);
    expect(geo).toEqual({
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
  });

  it('offset boxes → **orthogonal** path (axis-aligned segments, ≥ 3 points)', () => {
    const geo = connectorGeometry(box(0, 0), box(300, 300));
    expect(geo.points.length).toBeGreaterThanOrEqual(3);
    // Every segment is horizontal OR vertical (never diagonal).
    for (let i = 1; i < geo.points.length; i += 1) {
      const [px, py] = geo.points[i - 1]!;
      const [cx, cy] = geo.points[i]!;
      expect(px === cx || py === cy).toBe(true);
    }
  });

  it('connectorElbow — axis + default center depending on the routing', () => {
    // h↔h (diagonally offset boxes) → **vertical** crossing segment (x axis).
    const hh = connectorElbow(box(0, 0), box(300, 300));
    expect(hh.axis).toBe('x');
    expect(hh.default).toBe(200); // (stubA.x=124 + stubB.x=276) / 2
    expect(hh.pos).toBe(hh.default); // without midpoint → centered
    // v↔v (one above the other) → **horizontal** segment (y axis).
    const vv = connectorElbow(box(0, 0), box(0, 300));
    expect(vv.axis).toBe('y');
    expect(vv.default).toBe(200);
    // mixed (start north, end west) → y axis (horizontal segment), center = arrival stub.
    const mixed = connectorElbow(box(0, 0), box(300, 300), { startSide: 'n', endSide: 'w' });
    expect(mixed.axis).toBe('y');
    expect(mixed.default).toBe(350); // stubB.y = west edge of b (y=350)
  });

  it('midpoint moves the crossing segment (h↔h → left/right offset)', () => {
    const a = box(0, 0);
    const b = box(300, 300);
    // Without midpoint: vertical crossing centered at x=200.
    expect(absPoints(connectorGeometry(a, b)).map(([x]) => x)).toContain(200);
    // With midpoint=240: the vertical crossing moves to x=240 (and no longer 200).
    const xs = absPoints(connectorGeometry(a, b, { midpoint: 240 })).map(([x]) => x);
    expect(xs).toContain(240);
    expect(xs).not.toContain(200);
  });

  it('midpoint moves the horizontal segment (offset v↔v → up/down)', () => {
    const a = box(0, 0);
    const b = box(200, 300); // offset in x → the crossing segment has a non-zero length
    const ys = absPoints(connectorGeometry(a, b, { midpoint: 160 })).map(([, y]) => y);
    expect(ys).toContain(160);
  });

  it('midpoint == default → identical to the centered routing (no regression)', () => {
    const a = box(0, 0);
    const b = box(300, 300);
    expect(connectorGeometry(a, b, { midpoint: 200 })).toEqual(connectorGeometry(a, b));
  });

  it('mixed: default = L (2 segments); off-center midpoint = orthogonal Z (≥ 3 segments)', () => {
    const a = box(0, 0);
    const b = box(300, 300);
    const l = connectorGeometry(a, b, { startSide: 'n', endSide: 'w' });
    expect(l.points.length).toBe(3); // L: 3 points = 2 segments
    const z = connectorGeometry(a, b, { startSide: 'n', endSide: 'w', midpoint: 100 });
    expect(z.points.length).toBeGreaterThan(3); // Z: horizontal segment offset to y=100
    expect(absPoints(z).map(([, y]) => y)).toContain(100);
    for (let i = 1; i < z.points.length; i += 1) {
      const [px, py] = z.points[i - 1]!;
      const [cx, cy] = z.points[i]!;
      expect(px === cx || py === cy).toBe(true); // always orthogonal
    }
  });

  it('stacked boxes (same coords) → keeps ≥ 2 finite points (never "Invalid input")', () => {
    // Two steps on top of each other (e.g. one moved onto the other): the simplification
    // would collapse to 1 point. The guard falls back to [start, end] → valid path (≥ 2 finite points).
    const geo = connectorGeometry(box(120, 80, 200, 120), box(120, 80, 200, 120));
    expect(geo.points.length).toBeGreaterThanOrEqual(2);
    for (const [px, py] of geo.points) {
      expect(Number.isFinite(px)).toBe(true);
      expect(Number.isFinite(py)).toBe(true);
    }
  });

  it('pinned anchor sides (n→n) → loop passing **above** both boxes', () => {
    const a = box(0, 0, 100, 60);
    const b = box(200, 0, 100, 60); // same row
    const geo = connectorGeometry(a, b, { startSide: 'n', endSide: 'n' });
    // Starts from the top of a (origin y=0 = top edge) and one point rises above (relative y < 0).
    expect(geo.y).toBe(0);
    expect(Math.min(...geo.points.map(([, y]) => y))).toBeLessThan(0);
    // Always orthogonal.
    for (let i = 1; i < geo.points.length; i += 1) {
      const [px, py] = geo.points[i - 1]!;
      const [cx, cy] = geo.points[i]!;
      expect(px === cx || py === cy).toBe(true);
    }
  });
});

describe('engine — connect / refreshConnectors', () => {
  it('connect creates a routed bound arrow between two elements', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 100, height: 100 },
      { select: false },
    );
    const arrow = engine.connect('c', 'a', 'b');
    expect(arrow?.kind).toBe('arrow');
    expect(engine.board.getElement('c')).toMatchObject({ start: 'a', end: 'b', x: 100, y: 50 });
  });

  it('connect returns undefined when an endpoint is missing', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    expect(engine.connect('c', 'a', 'ghost')).toBeUndefined();
  });

  it('refreshConnectors re-routes the arrow when a linked element moves', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.connect('c', 'a', 'b');
    // Moves b down: the arrow must re-route.
    engine.moveElement('b', 0, 300);
    expect(engine.refreshConnectors()).toBe(1);
    const arrow = engine.board.getElement('c');
    // b is now bottom-right → the arrow's endpoint is no longer at y=50.
    expect(arrow?.points?.[1]?.[1]).not.toBe(0);
  });

  const connected = () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 300, y: 300, width: 100, height: 100 },
      { select: false },
    );
    engine.connect('c', 'a', 'b'); // h↔h: vertical crossing centered at x=200
    return engine;
  };
  const crossingXs = (engine: ReturnType<typeof connected>) => {
    const el = engine.board.getElement('c');
    return (el?.points ?? []).map(([px]) => (el?.x ?? 0) + px);
  };

  it('setConnectorMidpoint moves the elbow then recenters (null)', () => {
    const engine = connected();
    expect(engine.setConnectorMidpoint('c', 240)).toBe(true);
    expect(engine.board.getElement('c')?.midpoint).toBe(240);
    expect(crossingXs(engine)).toContain(240);
    // null → elbow recentered (field cleared); crossing back at x=200.
    engine.setConnectorMidpoint('c', null);
    expect(engine.board.getElement('c')?.midpoint).toBeUndefined();
    expect(crossingXs(engine)).toContain(200);
  });

  it('connect / refresh on stacked elements do not throw and keep the link', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 0, y: 0, width: 100, height: 100 }, // exactly on a
      { select: false },
    );
    expect(() => engine.connect('c', 'a', 'b')).not.toThrow(); // ⬅️ used to throw "points: Invalid input"
    expect(engine.board.getElement('c')).toMatchObject({ start: 'a', end: 'b' }); // link created
    // Move b away: the link must re-route cleanly (and still hold).
    engine.moveElement('b', 400, 0);
    expect(() => engine.refreshConnectors()).not.toThrow();
    expect(engine.board.getElement('c')).toMatchObject({ start: 'a', end: 'b' });
  });

  it('refreshConnectors: a degenerate connector does not interrupt the re-routing of the others', () => {
    const engine = createEngine({ clientId: 1 });
    // "Normal" link a→b.
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 400, y: 0, width: 100, height: 100 },
      { select: false },
    );
    engine.connect('ab', 'a', 'b');
    // "Degenerate" link x→y (stacked boxes).
    engine.addElement(
      { kind: 'rectangle', id: 'x', x: 0, y: 300, width: 100, height: 100 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'y', x: 0, y: 300, width: 100, height: 100 },
      { select: false },
    );
    engine.connect('xy', 'x', 'y');
    engine.moveElement('a', 0, 60);
    // No exception, and BOTH bound connectors are counted (neither froze the loop).
    expect(engine.refreshConnectors()).toBe(2);
  });

  it('setConnectorMidpoint refuses a non-connector element', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    expect(engine.setConnectorMidpoint('r', 5)).toBe(false);
  });

  it('refreshConnectors keeps the manual midpoint after moving a box', () => {
    const engine = connected();
    engine.setConnectorMidpoint('c', 240);
    engine.moveElement('a', 0, 50);
    expect(engine.refreshConnectors()).toBe(1);
    expect(engine.board.getElement('c')?.midpoint).toBe(240);
    expect(crossingXs(engine)).toContain(240);
  });
});
