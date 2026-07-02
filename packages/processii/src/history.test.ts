import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { boardFromDoc } from './board.js';
import { createDoc } from './crdt/index.js';

function rect(id: string, x = 0, y = 0): unknown {
  return { kind: 'rectangle', id, x, y, width: 10, height: 10 };
}

describe('history — undo/redo', () => {
  it('undoes then redoes an addition', () => {
    const engine = createEngine({ clientId: 1 });
    const history = engine.history();
    engine.addElement(rect('a'));
    history.stopCapturing();
    expect(engine.board.size).toBe(1);

    history.undo();
    expect(engine.board.size).toBe(0);
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(engine.board.size).toBe(1);
  });

  it('undoes a move', () => {
    const engine = createEngine({ clientId: 1 });
    const history = engine.history();
    engine.addElement(rect('a', 0, 0));
    history.stopCapturing();
    engine.moveElement('a', 50, 20);
    history.stopCapturing();
    expect(engine.board.getElement('a')).toMatchObject({ x: 50, y: 20 });

    history.undo();
    expect(engine.board.getElement('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('canUndo/canRedo reflect the stack state + observe notifies', () => {
    const engine = createEngine({ clientId: 1 });
    const history = engine.history();
    let notified = 0;
    const off = history.observe(() => {
      notified++;
    });
    expect(history.canUndo()).toBe(false);
    engine.addElement(rect('a'));
    history.stopCapturing();
    expect(history.canUndo()).toBe(true);
    expect(notified).toBeGreaterThan(0);
    off();
    history.destroy();
  });

  it('history() always returns the same instance', () => {
    const engine = createEngine({ clientId: 1 });
    expect(engine.history()).toBe(engine.history());
  });

  it('does not undo a peer edits (scoped to the local origin)', () => {
    // Two boards on the same doc = two distinct origins. One's history must not be able to
    // undo what the other wrote.
    const doc = createDoc({ clientId: 1 });
    const mine = boardFromDoc(doc);
    const peer = boardFromDoc(doc);
    const history = mine.createHistory();
    peer.addElement(rect('peer'));
    expect(mine.size).toBe(1);
    history.undo(); // nothing to undo locally
    expect(mine.size).toBe(1);
  });
});

describe('engine — updateSelection (styles)', () => {
  it('applies a style patch to the whole selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'), { select: false });
    engine.addElement(rect('b'), { select: false });
    engine.select(['a', 'b']);
    expect(engine.updateSelection({ stroke: 'accent', strokeWidth: 3 })).toBe(2);
    expect(engine.board.getElement('a')).toMatchObject({ stroke: 'accent', strokeWidth: 3 });
    expect(engine.board.getElement('b')).toMatchObject({ stroke: 'accent', strokeWidth: 3 });
  });
});
