import { describe, expect, it } from 'vitest';
import { createEngine } from '@binarii/processii';
import { dispatchToolCall, toolResultMessage } from './dispatcher.js';
import type { ToolContext } from './tools.js';
import type { ToolCall } from './mistral-client.js';

function ctx(): ToolContext {
  let n = 0;
  return { engine: createEngine({ clientId: 1 }), genId: () => `id${++n}` };
}

function call(name: string, args: unknown, id = 'call1'): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

describe('dispatcher', () => {
  it('executes a valid tool_call and mutates the board', () => {
    const c = ctx();
    const out = dispatchToolCall(c, call('addStep', { name: 'Réception' }));
    expect(out.success).toBe(true);
    expect(c.engine.listElements()).toHaveLength(1);
    const msg = toolResultMessage(out);
    expect(msg.role).toBe('tool');
    expect(msg.tool_call_id).toBe('call1');
  });

  it('returns an error (never a throw) for an unknown tool', () => {
    const out = dispatchToolCall(ctx(), call('nope', {}));
    expect(out.success).toBe(false);
    expect(out.error).toContain('inconnu');
  });

  it('returns an error for invalid JSON arguments', () => {
    const bad: ToolCall = {
      id: 'x',
      type: 'function',
      function: { name: 'addStep', arguments: '{not json' },
    };
    const out = dispatchToolCall(ctx(), bad);
    expect(out.success).toBe(false);
    expect(out.error).toContain('JSON');
  });

  it('returns a validation error for a missing argument', () => {
    const out = dispatchToolCall(ctx(), call('addStep', {}));
    expect(out.success).toBe(false);
    expect(toolResultMessage(out).content).toContain('error');
  });

  it('carries the destructive flag from the tool', () => {
    const c = ctx();
    dispatchToolCall(c, call('addStep', { name: 'A' }));
    const out = dispatchToolCall(c, call('deleteElement', { id: 'id1' }));
    expect(out.destructive).toBe(true);
  });
});
