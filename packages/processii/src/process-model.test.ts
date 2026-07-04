import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { LEGACY_CLUSTER_ID, parseElement, parseScene, type Scene } from './scene.js';

/**
 * "Process board" model (B1): rich `step` node + swimlanes/agentGroups collections, carried by
 * the CRDT board (Yjs). Verifies validation/defaults, CRUD, `toScene`/`loadScene` round-trip.
 */

describe('scene — step element', () => {
  it('validates a step and applies the defaults (empty skills/deliverables)', () => {
    const step = parseElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120 });
    expect(step).toMatchObject({
      kind: 'step',
      name: '',
      description: '',
      skills: [],
      deliverables: [],
    });
  });

  it('keeps name/description/skills/deliverables/emotion/swimlaneId', () => {
    const step = parseElement({
      kind: 'step',
      id: 's1',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      name: 'Rédiger',
      description: 'Premier jet',
      skills: ['écriture'],
      deliverables: ['brief'],
      emotion: 'happy',
      swimlaneId: 'lane-1',
    });
    expect(step).toMatchObject({
      name: 'Rédiger',
      skills: ['écriture'],
      deliverables: ['brief'],
      emotion: 'happy',
      swimlaneId: 'lane-1',
    });
  });

  it('rejects an invalid emotion', () => {
    expect(() =>
      parseElement({ kind: 'step', id: 's', x: 0, y: 0, width: 10, height: 10, emotion: 'angry' }),
    ).toThrow();
  });
});

describe('board — swimlanes', () => {
  it('adds, updates, lists (sorted by order) and removes', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l2', name: 'Système', order: 1, color: 'blue', height: 140 });
    engine.addSwimlane({ id: 'l1', name: 'Métier', order: 0, color: 'green', height: 160 });
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l1', 'l2']); // sorted by order

    expect(engine.updateSwimlane('l1', { name: 'Business' })).toBe(true);
    expect(engine.listSwimlanes()[0]).toMatchObject({ id: 'l1', name: 'Business' });

    expect(engine.removeSwimlane('l2')).toBe(true);
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l1']);
    expect(engine.updateSwimlane('ghost', { name: 'x' })).toBe(false);
  });

  it('laneTop = sum of the heights above; laneEdgeAtPoint detects bottom and right edges', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 });
    expect(engine.laneTop('l1')).toBe(0);
    expect(engine.laneTop('l2')).toBe(100);
    // Bottom edge of l1 at y=100.
    expect(engine.laneEdgeAtPoint({ x: 50, y: 100 }, 6)).toEqual({ laneId: 'l1', edge: 'bottom' });
    // Cluster right edge at x = width (default 2000) → carries the (legacy) cluster id.
    expect(engine.laneEdgeAtPoint({ x: 2000, y: 50 }, 6)).toEqual({
      clusterId: LEGACY_CLUSTER_ID,
      edge: 'right',
    });
    // Far from any edge → undefined.
    expect(engine.laneEdgeAtPoint({ x: 500, y: 40 }, 6)).toBeUndefined();
  });

  it('swimlaneBounds exposes each lane as a snapping target (x:0, cumulative y, shared width)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setSwimlanesWidth(1500);
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 });
    expect(engine.swimlaneBounds()).toEqual([
      { x: 0, y: 0, width: 1500, height: 100 },
      { x: 0, y: 100, width: 1500, height: 160 },
    ]);
  });

  it('shared width: default then set', () => {
    const engine = createEngine({ clientId: 1 });
    expect(engine.getSwimlanesWidth()).toBe(2000);
    engine.setSwimlanesWidth(3200);
    expect(engine.getSwimlanesWidth()).toBe(3200);
    engine.setSwimlanesWidth(-5); // invalid → ignored
    expect(engine.getSwimlanesWidth()).toBe(3200);
  });

  it('rejects an invalid swimlane (height ≤ 0)', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => engine.addSwimlane({ id: 'l', height: 0 })).toThrow();
  });
});

describe('board — swimlane reordering (reorderSwimlane)', () => {
  it('renumbers `order` and changes the list order', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 });
    engine.addSwimlane({ id: 'l3', order: 2, height: 120 });
    expect(engine.reorderSwimlane('l1', 2)).toBe(true); // l1 → last position
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l2', 'l3', 'l1']);
    expect(engine.listSwimlanes().map((l) => l.order)).toEqual([0, 1, 2]); // renumbered 0..n-1
  });

  it('carries the cards: a step `y` follows its lane top change', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // top 0
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 }); // top 100
    engine.addElement(
      { kind: 'step', id: 's', x: 10, y: 120, width: 50, height: 40, swimlaneId: 'l2' },
      { select: false },
    );
    // l2 moves to the top → its top goes from 100 to 0 (delta -100).
    expect(engine.reorderSwimlane('l2', 0)).toBe(true);
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l2', 'l1']);
    expect(engine.laneTop('l2')).toBe(0);
    // The card followed its lane: y 120 → 20 (still inside lane l2, now 0..160).
    expect(engine.board.getElement('s')?.y).toBe(20);
  });

  it('also carries an element WITHOUT swimlaneId (by geometry: center inside the lane)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // top 0
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 }); // top 100
    // Step simply DROPPED into lane l2, without `swimlaneId` (center y = 130 ∈ [100, 260)).
    engine.addElement(
      { kind: 'step', id: 's', x: 10, y: 110, width: 50, height: 40 },
      { select: false },
    );
    engine.reorderSwimlane('l2', 0); // l2 moves to the top → top 100 → 0 (delta -100)
    expect(engine.board.getElement('s')?.y).toBe(10); // 110 − 100: follows the lane despite the missing swimlaneId
  });

  it('does NOT carry an element horizontally OUTSIDE the lanes (x beyond the shared width)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setSwimlanesWidth(1000);
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // top 0
    engine.addSwimlane({ id: 'l2', order: 1, height: 160 }); // top 100
    // Vertical center INSIDE lane l2, but x beyond the shared width → belongs to no lane
    // (consistent with `laneAtPoint`): must NOT be moved.
    engine.addElement(
      { kind: 'step', id: 'out', x: 2000, y: 120, width: 50, height: 40 },
      { select: false },
    );
    // Control: an element properly inside l2 (x within the width) follows the lane.
    engine.addElement(
      { kind: 'step', id: 'in', x: 10, y: 120, width: 50, height: 40 },
      { select: false },
    );
    engine.reorderSwimlane('l2', 0); // l2 → top 100 → 0 (delta -100)
    expect(engine.board.getElement('out')?.y).toBe(120); // unchanged (outside the lanes' width)
    expect(engine.board.getElement('in')?.y).toBe(20); // 120 − 100: carried along
  });

  it('no-op (`false`) when the index is unchanged or the id is unknown', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.addSwimlane({ id: 'l2', order: 1, height: 100 });
    expect(engine.reorderSwimlane('l1', 0)).toBe(false); // already at index 0
    expect(engine.reorderSwimlane('ghost', 1)).toBe(false);
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l1', 'l2']); // unchanged
  });

  it('clamps an out-of-bounds index (→ last position)', () => {
    const engine = createEngine({ clientId: 1 });
    for (const id of ['l1', 'l2', 'l3'])
      engine.addSwimlane({ id, order: ['l1', 'l2', 'l3'].indexOf(id), height: 100 });
    expect(engine.reorderSwimlane('l1', 99)).toBe(true); // clamp → last
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l2', 'l3', 'l1']);
  });
});

describe('board — shared document name (meta)', () => {
  it('null by default; set then get; empty string ignored; trim', () => {
    const engine = createEngine({ clientId: 1 });
    expect(engine.getName()).toBeNull();
    engine.setName('  Parcours client  ');
    expect(engine.getName()).toBe('Parcours client');
    engine.setName('   '); // empty after trim → ignored
    expect(engine.getName()).toBe('Parcours client');
  });
});

describe('board — agentGroups', () => {
  it('adds, updates the stepIds, lists and removes', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addAgentGroup({ id: 'g1', name: 'Agent A', stepIds: ['s1'] });
    expect(engine.listAgentGroups()).toHaveLength(1);
    expect(engine.updateAgentGroup('g1', { stepIds: ['s1', 's2'] })).toBe(true);
    expect(engine.listAgentGroups()[0]).toMatchObject({ stepIds: ['s1', 's2'] });
    expect(engine.removeAgentGroup('g1')).toBe(true);
    expect(engine.listAgentGroups()).toEqual([]);
  });
});

describe('board — toScene/loadScene round-trip (full process model)', () => {
  it('persists elements + swimlanes + groups + width', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    engine.addSwimlane({ id: 'l1', name: 'Métier', order: 0 });
    engine.addAgentGroup({ id: 'g1', name: 'Agent', stepIds: ['s1'] });
    engine.setSwimlanesWidth(2500);

    const scene: Scene = engine.toScene();
    expect(scene.swimlanes).toHaveLength(1);
    expect(scene.agentGroups).toHaveLength(1);
    expect(scene.swimlanesWidth).toBe(2500);

    // Reload into a fresh engine → identical state.
    const restored = createEngine({ clientId: 2 });
    restored.loadScene(parseScene(scene));
    expect(restored.listElements()[0]).toMatchObject({ kind: 'step', name: 'A' });
    expect(restored.listSwimlanes()[0]).toMatchObject({ id: 'l1', name: 'Métier' });
    expect(restored.listAgentGroups()[0]).toMatchObject({ id: 'g1', stepIds: ['s1'] });
    expect(restored.getSwimlanesWidth()).toBe(2500);
  });

  it('observe notifies on a swimlane mutation', () => {
    const engine = createEngine({ clientId: 1 });
    let calls = 0;
    const off = engine.observe(() => {
      calls++;
    });
    engine.addSwimlane({ id: 'l1', name: 'X', order: 0 });
    expect(calls).toBeGreaterThan(0);
    off();
  });
});
