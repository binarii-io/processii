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
});
