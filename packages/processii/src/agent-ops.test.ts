import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { AGENT_OPS, AgentOpError, getAgentOp } from './agent-ops.js';
import type { Scene } from './scene.js';

/** Resolve an op by name or fail loudly (keeps the tests readable). */
function op(name: string) {
  const found = getAgentOp(name);
  if (!found) throw new Error(`unknown op: ${name}`);
  return found;
}

describe('agent-ops', () => {
  it('read_board returns a default (idéation, empty) snapshot', () => {
    const engine = createEngine({ clientId: 1 });
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.boardType).toBe('ideation');
    expect(scene.elements).toEqual([]);
  });

  it('add_step creates a step, returns its id, and it is visible via read_board', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_step').run(engine, { name: 'Validate order', x: 40, y: 20 }) as {
      id: string;
    };
    expect(id).toMatch(/^step:/);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({
      kind: 'step',
      id,
      name: 'Validate order',
      x: 40,
      y: 20,
    });
    // add_step must not touch the local selection (agent edits are headless).
    expect(engine.getSelection()).toEqual([]);
  });

  it('add_step accepts an explicit id (deterministic host/test output)', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_step').run(engine, { name: 'A', x: 0, y: 0, id: 'step:custom' }) as {
      id: string;
    };
    expect(id).toBe('step:custom');
    expect(engine.board.getElement('step:custom')).toMatchObject({ kind: 'step', name: 'A' });
  });

  it('connect binds a directed arrow between two existing steps', () => {
    const engine = createEngine({ clientId: 1 });
    const a = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    const b = op('add_step').run(engine, { name: 'B', x: 400, y: 0 }) as { id: string };
    const { id } = op('connect').run(engine, { from: a.id, to: b.id }) as { id: string };
    expect(engine.board.getElement(id)).toMatchObject({
      kind: 'arrow',
      start: a.id,
      end: b.id,
      endArrow: true,
    });
  });

  it('connect throws AgentOpError when an endpoint is missing (no arrow created)', () => {
    const engine = createEngine({ clientId: 1 });
    const a = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    expect(() => op('connect').run(engine, { from: a.id, to: 'ghost' })).toThrow(AgentOpError);
    expect(engine.board.toScene().elements).toHaveLength(1); // only the step
  });

  it('set_board_type updates the type, reflected in read_board', () => {
    const engine = createEngine({ clientId: 1 });
    op('set_board_type').run(engine, { boardType: 'ideation' });
    expect((op('read_board').run(engine, {}) as Scene).boardType).toBe('ideation');
  });

  it('rejects invalid input with a typed AgentOpError and leaves state untouched', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('add_step').run(engine, { name: '', x: 0, y: 0 })).toThrow(AgentOpError);
    expect(() => op('set_board_type').run(engine, { boardType: 'nope' })).toThrow(AgentOpError);
    expect(engine.board.toScene().elements).toEqual([]);
  });

  it('exposes a well-formed catalog (name, description, input schema)', () => {
    expect(AGENT_OPS.length).toBeGreaterThan(0);
    for (const o of AGENT_OPS) {
      expect(o.name).toMatch(/^[a-z_]+$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.inputSchema).toBeDefined();
    }
  });

  // --- element CRUD ---

  it('add_element creates a free shape (with a label), returns its id, visible via read_board', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_element').run(engine, {
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      text: 'Note',
    }) as { id: string };
    expect(id).toMatch(/^el:/);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({
      kind: 'rectangle',
      id,
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      text: 'Note',
    });
    // Like every agent write, add_element must not touch the local selection (headless edits).
    expect(engine.getSelection()).toEqual([]);
  });

  it('add_element rejects a text element without text with a typed AgentOpError', () => {
    const engine = createEngine({ clientId: 1 });
    // A text element requires a label: it must fail as an AgentOpError (this op's contract), not leak
    // the engine's WhiteboardParseError. Rectangles/ellipses keep text optional (covered above).
    expect(() => op('add_element').run(engine, { kind: 'text', x: 0, y: 0 })).toThrow(AgentOpError);
    expect(() => op('add_element').run(engine, { kind: 'text', x: 0, y: 0, text: '' })).toThrow(
      AgentOpError,
    );
    expect((op('read_board').run(engine, {}) as Scene).elements).toHaveLength(0);
    // With a label it succeeds.
    const { id } = op('add_element').run(engine, { kind: 'text', x: 0, y: 0, text: 'Hi' }) as {
      id: string;
    };
    expect(id).toMatch(/^el:/);
  });

  it('add_element applies sensible size defaults and omits text when unset', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_element').run(engine, { kind: 'ellipse', x: 0, y: 0 }) as { id: string };
    const el = engine.board.getElement(id)!;
    expect(el).toMatchObject({ kind: 'ellipse', width: 120, height: 80 });
    expect(el).not.toHaveProperty('text');
  });

  it('add_element accepts an explicit id and rejects an unsupported kind', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_element').run(engine, {
      kind: 'text',
      x: 0,
      y: 0,
      text: 'hi',
      id: 'el:custom',
    }) as { id: string };
    expect(id).toBe('el:custom');
    expect(engine.board.getElement('el:custom')).toMatchObject({ kind: 'text', text: 'hi' });
    // `step` is not a free shape (use add_step): the enum rejects it.
    expect(() => op('add_element').run(engine, { kind: 'step', x: 0, y: 0 })).toThrow(AgentOpError);
  });

  it('add_swimlane creates a lane, returns its id, visible via read_board', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, {
      name: 'Customer',
      laneType: 'user',
      color: 'blue',
    }) as { id: string };
    expect(id).toMatch(/^lane:/);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlanes).toHaveLength(1);
    expect(scene.swimlanes[0]).toMatchObject({
      id,
      name: 'Customer',
      laneType: 'user',
      color: 'blue',
    });
  });

  it('add_swimlane rejects an unknown color with a typed AgentOpError', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('add_swimlane').run(engine, { color: 'chartreuse' })).toThrow(AgentOpError);
    expect(op('read_board').run(engine, {}) as Scene).toMatchObject({ swimlanes: [] });
  });

  it('update_swimlane patches only the provided fields (name/type/color/height)', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, {
      name: 'Customer',
      laneType: 'user',
      color: 'blue',
    }) as { id: string };
    const res = op('update_swimlane').run(engine, {
      id,
      name: 'Support',
      color: 'green',
      height: 220,
    }) as { id: string };
    expect(res.id).toBe(id);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlanes[0]).toMatchObject({
      id,
      name: 'Support',
      laneType: 'user', // untouched
      color: 'green',
      height: 220,
    });
  });

  it('update_swimlane resizes the lane block width via its cluster (width-only call allowed)', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, { name: 'Customer' }) as { id: string };
    // Width lives on the lane's cluster (shared by aligned lanes); a width-only patch is valid.
    const res = op('update_swimlane').run(engine, { id, width: 800 }) as { id: string };
    expect(res.id).toBe(id);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlaneClusters).toHaveLength(1);
    expect(scene.swimlaneClusters[0]).toMatchObject({ width: 800 });
    // The lane itself is untouched (name intact, no width field on a lane).
    expect(scene.swimlanes[0]).toMatchObject({ id, name: 'Customer' });
  });

  it('update_swimlane applies a combined lane+width patch in ONE Yjs transaction', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, { name: 'Customer', color: 'blue' }) as {
      id: string;
    };
    // The lane patch and the cluster width are the op's two internal writes: freeze the
    // one-transaction contract (a peer must never observe one without the other).
    let transactions = 0;
    engine.board.doc.on('afterTransaction', () => {
      transactions += 1;
    });
    op('update_swimlane').run(engine, { id, name: 'Support', width: 900 });
    expect(transactions).toBe(1);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlanes[0]).toMatchObject({ id, name: 'Support', color: 'blue' });
    expect(scene.swimlaneClusters[0]).toMatchObject({ width: 900 });
  });

  it('update_swimlane rejects a width below the canvas handle lower bound (200)', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, {}) as { id: string };
    expect(() => op('update_swimlane').run(engine, { id, width: 150 })).toThrow(AgentOpError);
    // And a width on an unknown lane is a not-found, not a silent no-op.
    expect(() => op('update_swimlane').run(engine, { id: 'lane:ghost', width: 800 })).toThrow(
      AgentOpError,
    );
  });

  it('update_swimlane switches to a custom category with its free label', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, { laneType: 'system' }) as { id: string };
    op('update_swimlane').run(engine, { id, laneType: 'custom', customType: 'Partner' });
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlanes[0]).toMatchObject({ laneType: 'custom', customType: 'Partner' });
  });

  it('update_swimlane throws AgentOpError on unknown id, empty patch and invalid values', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_swimlane').run(engine, {}) as { id: string };
    expect(() => op('update_swimlane').run(engine, { id: 'ghost', name: 'x' })).toThrow(
      AgentOpError,
    );
    // An id-only call would be a silent no-op: surfaced as a typed error instead.
    expect(() => op('update_swimlane').run(engine, { id })).toThrow(AgentOpError);
    // Enum and bounds are enforced at the input boundary (before touching the board).
    expect(() => op('update_swimlane').run(engine, { id, color: 'chartreuse' })).toThrow(
      AgentOpError,
    );
    expect(() => op('update_swimlane').run(engine, { id, height: -10 })).toThrow(AgentOpError);
    // Below the panel's lower bound (min 60) — rejected like the interactive input would.
    expect(() => op('update_swimlane').run(engine, { id, height: 30 })).toThrow(AgentOpError);
  });

  it('delete_swimlane removes the lane but keeps its steps', () => {
    const engine = createEngine({ clientId: 1 });
    const lane = op('add_swimlane').run(engine, { name: 'Customer' }) as { id: string };
    const step = op('add_step').run(engine, {
      name: 'A',
      x: 0,
      y: 0,
      swimlaneId: lane.id,
    }) as { id: string };
    const res = op('delete_swimlane').run(engine, { id: lane.id }) as { id: string };
    expect(res.id).toBe(lane.id);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.swimlanes).toEqual([]);
    expect(scene.elements.map((e) => e.id)).toContain(step.id);
  });

  it('delete_swimlane throws AgentOpError on an unknown id', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('delete_swimlane').run(engine, { id: 'ghost' })).toThrow(AgentOpError);
  });

  it('add_group creates a named group over steps, returns its id, visible via read_board', () => {
    const engine = createEngine({ clientId: 1 });
    const a = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    const { id } = op('add_group').run(engine, { name: 'Agent', stepIds: [a.id] }) as {
      id: string;
    };
    expect(id).toMatch(/^group:/);
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.agentGroups).toHaveLength(1);
    expect(scene.agentGroups[0]).toMatchObject({ id, name: 'Agent', stepIds: [a.id] });
  });

  it('add_group rejects a non-array stepIds with a typed AgentOpError', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('add_group').run(engine, { stepIds: 'nope' })).toThrow(AgentOpError);
  });

  it('move_element shifts an element by a relative delta', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_step').run(engine, { name: 'A', x: 40, y: 20 }) as { id: string };
    const res = op('move_element').run(engine, { id, dx: 10, dy: -5 }) as { id: string };
    expect(res.id).toBe(id);
    expect(engine.board.getElement(id)).toMatchObject({ x: 50, y: 15 });
  });

  it('move_element throws AgentOpError on an unknown id and an invalid delta', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('move_element').run(engine, { id: 'ghost', dx: 1, dy: 1 })).toThrow(
      AgentOpError,
    );
    expect(() => op('move_element').run(engine, { id: 'x', dx: Infinity, dy: 0 })).toThrow(
      AgentOpError,
    );
  });

  it('move_element re-routes bound connectors: an arrow follows the moved element', () => {
    const engine = createEngine({ clientId: 1 });
    const a = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    const b = op('add_step').run(engine, { name: 'B', x: 500, y: 0 }) as { id: string };
    const c = op('connect').run(engine, { from: a.id, to: b.id }) as { id: string };
    const arrowBefore = engine.board.getElement(c.id) as { points: [number, number][] };
    const before = JSON.stringify(arrowBefore.points);
    // Move A far down: without a connector re-route the arrow would stay put (the reported bug).
    op('move_element').run(engine, { id: a.id, dx: 0, dy: 400 });
    const arrowAfter = engine.board.getElement(c.id) as { points: [number, number][] };
    expect(JSON.stringify(arrowAfter.points)).not.toBe(before);
  });

  it('update_element re-routes bound connectors on an absolute position change', () => {
    const engine = createEngine({ clientId: 1 });
    const a = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    const b = op('add_step').run(engine, { name: 'B', x: 500, y: 0 }) as { id: string };
    const c = op('connect').run(engine, { from: a.id, to: b.id }) as { id: string };
    const before = JSON.stringify((engine.board.getElement(c.id) as { points: unknown }).points);
    op('update_element').run(engine, { id: b.id, x: 500, y: 400 });
    expect(JSON.stringify((engine.board.getElement(c.id) as { points: unknown }).points)).not.toBe(
      before,
    );
  });

  it('update_element patches only the provided fields (text/position/size/colors)', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_element').run(engine, {
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text: 'old',
    }) as { id: string };
    const res = op('update_element').run(engine, {
      id,
      text: 'new',
      x: 5,
      width: 140,
      fill: 'accent',
    }) as { id: string };
    expect(res.id).toBe(id);
    expect(engine.board.getElement(id)).toMatchObject({
      text: 'new',
      x: 5,
      y: 0, // untouched
      width: 140,
      height: 60, // untouched
      fill: 'accent',
    });
  });

  it('update_element throws AgentOpError on an unknown id and on an invalid patch value', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    expect(() => op('update_element').run(engine, { id: 'ghost', text: 'x' })).toThrow(
      AgentOpError,
    );
    // A non-positive width is rejected at the input boundary (before touching the board).
    expect(() => op('update_element').run(engine, { id, width: -10 })).toThrow(AgentOpError);
  });

  it('delete_element removes an element, gone from read_board', () => {
    const engine = createEngine({ clientId: 1 });
    const { id } = op('add_step').run(engine, { name: 'A', x: 0, y: 0 }) as { id: string };
    const res = op('delete_element').run(engine, { id }) as { id: string };
    expect(res.id).toBe(id);
    expect((op('read_board').run(engine, {}) as Scene).elements).toEqual([]);
  });

  it('delete_element throws AgentOpError on an unknown id', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() => op('delete_element').run(engine, { id: 'ghost' })).toThrow(AgentOpError);
  });

  it('exposes all twelve ops resolvable by name', () => {
    const names = AGENT_OPS.map((o) => o.name);
    expect(names).toEqual([
      'read_board',
      'add_step',
      'connect',
      'set_board_type',
      'add_element',
      'add_swimlane',
      'update_swimlane',
      'delete_swimlane',
      'add_group',
      'move_element',
      'update_element',
      'delete_element',
    ]);
    for (const name of names) expect(getAgentOp(name)?.name).toBe(name);
  });
});
