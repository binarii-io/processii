import { describe, expect, it } from 'vitest';
import { createEngine } from '@binarii/processii';
import { buildSystemPrompt, runAgentLoop } from './agent-loop.js';
import type { ChatMessage, MistralClient } from './mistral-client.js';

/** Fake Mistral client: replays a script of `assistant` replies, no network. */
class ScriptedClient implements MistralClient {
  private i = 0;
  constructor(private readonly script: ChatMessage[]) {}
  async complete(): Promise<ChatMessage> {
    const next = this.script[this.i++];
    if (!next) throw new Error('script épuisé');
    return next;
  }
}

function toolMsg(name: string, args: unknown, id = `t${name}`): ChatMessage {
  return {
    role: 'assistant',
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}

function seqGenId(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe('buildSystemPrompt', () => {
  it('injects the user instructions when provided', () => {
    const engine = createEngine({ clientId: 1 });
    const prompt = buildSystemPrompt(engine, 'Nomme les étapes à l’infinitif.');
    expect(prompt).toContain('Consignes permanentes');
    expect(prompt).toContain('infinitif');
  });

  it('adds no instructions section when empty', () => {
    const engine = createEngine({ clientId: 1 });
    expect(buildSystemPrompt(engine, '   ')).not.toContain('Consignes permanentes');
    expect(buildSystemPrompt(engine)).not.toContain('Consignes permanentes');
  });

  it('injects the process skill when provided', () => {
    const engine = createEngine({ clientId: 1 });
    expect(buildSystemPrompt(engine, undefined, 'GUIDANCE_PROCESS_XYZ')).toContain(
      'GUIDANCE_PROCESS_XYZ',
    );
    expect(buildSystemPrompt(engine)).not.toContain('GUIDANCE_PROCESS_XYZ');
  });
});

describe('runAgentLoop', () => {
  it('chains creations + connection then concludes (board mutated live)', async () => {
    const engine = createEngine({ clientId: 1 });
    const client = new ScriptedClient([
      toolMsg('addStep', { name: 'Réception' }), // id1
      toolMsg('addStep', { name: 'Validation' }), // id2
      toolMsg('connectSteps', { fromId: 'id1', toId: 'id2' }), // id3
      { role: 'assistant', content: 'C’est fait.' },
    ]);

    const mutations: number[] = [];
    const result = await runAgentLoop({
      client,
      engine,
      history: [],
      userMessage: 'ajoute une étape Validation après Réception et relie-les',
      genId: seqGenId(),
      onMutated: () => mutations.push(1),
    });

    expect(result.reply).toBe('C’est fait.');
    expect(result.stoppedReason).toBe('done');
    expect(result.actions).toHaveLength(3);
    const steps = engine.listElements().filter((e) => e.kind === 'step');
    const links = engine.listElements().filter((e) => e.kind === 'arrow');
    expect(steps).toHaveLength(2);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ start: 'id1', end: 'id2' });
    expect(mutations.length).toBe(3); // re-render requested on every mutating turn
  });

  it('stops cleanly on MAX_ITERATIONS', async () => {
    const engine = createEngine({ clientId: 1 });
    // Client always requesting an action → never concludes.
    const client: MistralClient = {
      complete: async () => toolMsg('addStep', { name: 'X' }),
    };
    const result = await runAgentLoop({
      client,
      engine,
      history: [],
      userMessage: 'boucle',
      maxIterations: 2,
      genId: seqGenId(),
    });
    expect(result.stoppedReason).toBe('max-iterations');
    expect(result.reply).toContain('Limite de sécurité');
    expect(engine.listElements().filter((e) => e.kind === 'step')).toHaveLength(2);
  });

  it('refuses an unconfirmed destructive action and does not alter the board', async () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 'id1', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    const client = new ScriptedClient([
      toolMsg('deleteElement', { id: 'id1' }),
      { role: 'assistant', content: 'Suppression annulée.' },
    ]);

    const result = await runAgentLoop({
      client,
      engine,
      history: [],
      userMessage: 'supprime A',
      confirmDestructive: () => false, // l’utilisateur refuse
    });

    expect(engine.board.getElement('id1')).toBeDefined(); // still there
    expect(result.actions[0]?.message).toContain('annulée');
    expect(result.reply).toBe('Suppression annulée.');
  });
});
