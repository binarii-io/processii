import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
// Everything below comes from the React-FREE subpaths ONLY (`/core` + `/agent-ops`), exactly as a
// Node backend would import them — no `.` main entry, so no React on the import path.
import { engineFromDoc, boardFromDoc, createEngine, type Scene } from './core.js';
import { getAgentOp } from './agent-ops.js';

/** Resolve an op by name or fail loudly (keeps the tests readable). */
function op(name: string) {
  const found = getAgentOp(name);
  if (!found) throw new Error(`unknown op: ${name}`);
  return found;
}

/**
 * Proof of the headless "server host" flow (the point of the `/core` subpath): from a **raw, empty
 * `Y.Doc`**, `/core` builds an engine and `/agent-ops` mutates it — the writes land **on that very
 * `Y.Doc`** (so a Hocuspocus/Yjs server would broadcast them), and `read_board` sees them back.
 */
describe('core subpath — headless engine building from a Y.Doc (server host)', () => {
  it('builds an engine from an empty Y.Doc, applies agent-ops, and mutations land on that Y.Doc', () => {
    // A pure `new Y.Doc()` — the doc a server owns for a room. `CrdtDoc` IS `Y.Doc`, so it is
    // accepted by `engineFromDoc` with zero adaptation.
    const doc = new Y.Doc();
    const engine = engineFromDoc(doc);

    // add_step → returns { id }; the step must appear as a real entry in the doc's element Y.Map.
    const { id: stepA } = op('add_step').run(engine, { name: 'Valider', x: 40, y: 20 }) as {
      id: string;
    };
    expect(stepA).toMatch(/^step:/);

    const { id: stepB } = op('add_step').run(engine, { name: 'Expédier', x: 400, y: 20 }) as {
      id: string;
    };

    // connect → a bound directed arrow between the two steps.
    const { id: arrow } = op('connect').run(engine, { from: stepA, to: stepB }) as { id: string };
    expect(arrow).toMatch(/^arrow:/);

    // --- The mutations are ON the Y.Doc itself, not a detached in-memory store. ---
    // Elements live in the top-level Y.Map keyed 'whiteboard:elements' (board.ts). Reading it
    // straight off the raw `doc` (no engine involved) must show all three entries.
    const rawElements = doc.getMap('whiteboard:elements');
    expect(rawElements.has(stepA)).toBe(true);
    expect(rawElements.has(stepB)).toBe(true);
    expect(rawElements.has(arrow)).toBe(true);

    // --- read_board sees the same state through the engine. ---
    const scene = op('read_board').run(engine, {}) as Scene;
    expect(scene.elements.map((e) => e.id).sort()).toEqual([stepA, stepB, arrow].sort());
    expect(scene.elements.find((e) => e.id === stepA)).toMatchObject({
      kind: 'step',
      name: 'Valider',
      x: 40,
      y: 20,
    });
    expect(scene.elements.find((e) => e.id === arrow)).toMatchObject({
      kind: 'arrow',
      start: stepA,
      end: stepB,
      endArrow: true,
    });
  });

  it('a second engine reattached to the same Y.Doc reads the agent writes (server ↔ sync parity)', () => {
    // Mirrors "the server mutated the room doc; a fresh reader/replica sees it".
    const doc = new Y.Doc();
    const writer = engineFromDoc(doc);
    const { id } = op('add_step').run(writer, { name: 'Étape', x: 0, y: 0 }) as { id: string };

    // A different engine view attached to the SAME doc.
    const reader = engineFromDoc(doc);
    const scene = op('read_board').run(reader, {}) as Scene;
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({ id, kind: 'step', name: 'Étape' });
  });

  it('exposes the builders needed by a host: engineFromDoc, boardFromDoc, createEngine', () => {
    // Type/shape smoke: all four building blocks are reachable from `/core` and interchangeable.
    const doc = new Y.Doc();
    expect(typeof engineFromDoc).toBe('function');
    expect(typeof boardFromDoc).toBe('function');
    expect(typeof createEngine).toBe('function');

    // createEngine(boardFromDoc(doc)) is NOT the path (createEngine builds its own board), but
    // engineFromDoc(doc) === new WhiteboardEngine(boardFromDoc(doc)) — verify equivalence of reads.
    const viaEngineFromDoc = engineFromDoc(doc);
    op('add_step').run(viaEngineFromDoc, { name: 'X', x: 1, y: 2, id: 'step:x' });
    const board = boardFromDoc(doc);
    expect(board.getElement('step:x')).toMatchObject({ kind: 'step', name: 'X' });
  });
});
