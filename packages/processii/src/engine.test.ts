import { describe, expect, it } from 'vitest';
import { createEngine, elementBounds } from './engine.js';

function rect(id: string, x = 0, y = 0): unknown {
  return { kind: 'rectangle', id, x, y, width: 10, height: 10 };
}

describe('engine — editing operations', () => {
  it('adds an element and selects it by default', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'));
    expect(engine.board.size).toBe(1);
    expect(engine.getSelection()).toEqual(['a']);
  });

  it('moves an element (relative) and reads the new position', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 5, 5));
    expect(engine.moveElement('a', 10, -3)).toBe(true);
    const el = engine.board.getElement('a');
    expect(el).toMatchObject({ x: 15, y: 2 });
  });

  it('updates an element via partial patch without touching the rest', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 1, 2));
    engine.updateElement('a', { width: 99 });
    const el = engine.board.getElement('a');
    expect(el).toMatchObject({ x: 1, y: 2, width: 99 });
  });

  it('removes an element and drops it from the selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'));
    expect(engine.removeElement('a')).toBe(true);
    expect(engine.board.size).toBe(0);
    expect(engine.getSelection()).toEqual([]);
  });

  it('move/update/remove on a non-existent id = no-op false', () => {
    const engine = createEngine({ clientId: 1 });
    expect(engine.moveElement('nope', 1, 1)).toBe(false);
    expect(engine.updateElement('nope', { width: 1 })).toBe(false);
    expect(engine.removeElement('nope')).toBe(false);
  });
});

describe('engine — selection (local)', () => {
  it('select ignores non-existent ids', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'), { select: false });
    engine.select(['a', 'ghost']);
    expect(engine.getSelection()).toEqual(['a']);
  });

  it('toggle adds then removes', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'), { select: false });
    engine.toggleSelection('a');
    expect(engine.getSelection()).toEqual(['a']);
    engine.toggleSelection('a');
    expect(engine.getSelection()).toEqual([]);
  });

  it('moves a multi-selection as a block', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0), { select: false });
    engine.addElement(rect('b', 100, 100), { select: false });
    engine.select(['a', 'b']);
    expect(engine.moveSelection(5, 5)).toBe(2);
    expect(engine.board.getElement('a')).toMatchObject({ x: 5, y: 5 });
    expect(engine.board.getElement('b')).toMatchObject({ x: 105, y: 105 });
  });

  it('removes the selection as a block', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'), { select: false });
    engine.addElement(rect('b'), { select: false });
    engine.select(['a', 'b']);
    expect(engine.removeSelected()).toBe(2);
    expect(engine.board.size).toBe(0);
  });

  it('the selection cleans itself of vanished elements', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'));
    engine.board.removeElement('a');
    expect(engine.getSelection()).toEqual([]);
  });
});

describe('engine — geometry & rendering', () => {
  it('boundingBox of a rectangle = its geometry', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 4, 6));
    expect(engine.boundingBox('a')).toEqual({ x: 4, y: 6, width: 10, height: 10 });
  });

  it('boundingBox of a line covers its points (relative to x,y)', () => {
    const bounds = elementBounds({
      kind: 'line',
      id: 'l',
      x: 10,
      y: 20,
      width: 0,
      height: 0,
      angle: 0,
      stroke: 'fg',
      fill: 'transparent',
      strokeWidth: 1,
      opacity: 1,
      z: 0,
      markers: [],
      points: [
        [0, 0],
        [30, 40],
      ],
    });
    expect(bounds).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('selectionBounds encloses the selected elements', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0), { select: false });
    engine.addElement(rect('b', 100, 50), { select: false });
    engine.select(['a', 'b']);
    expect(engine.selectionBounds()).toEqual({ x: 0, y: 0, width: 110, height: 60 });
  });

  it('toRenderModel sorts by z and flags the selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ ...(rect('low') as object), z: 1 }, { select: false });
    engine.addElement({ ...(rect('high') as object), z: 5 }, { select: false });
    engine.select(['high']);
    const model = engine.toRenderModel();
    expect(model.elements.map((e) => e.element.id)).toEqual(['low', 'high']);
    expect(model.elements.find((e) => e.element.id === 'high')?.selected).toBe(true);
  });

  it('observe notifies on mutation', () => {
    const engine = createEngine({ clientId: 1 });
    let calls = 0;
    const off = engine.observe(() => {
      calls++;
    });
    engine.addElement(rect('a'));
    expect(calls).toBeGreaterThan(0);
    off();
  });
});

describe('engine — clipboard (copy / paste)', () => {
  /** Raw arrow bound `start` → `end` (points required by the schema). */
  function arrow(id: string, start?: string, end?: string): unknown {
    return {
      kind: 'arrow',
      id,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [10, 10],
      ],
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    };
  }

  it('copySelection returns null when nothing is selected', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'));
    engine.clearSelection();
    expect(engine.copySelection()).toBeNull();
  });

  it('copySelection captures only the selected elements (marker + version)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a'), { select: false });
    engine.addElement(rect('b'), { select: false });
    engine.select(['a']);
    const payload = engine.copySelection();
    expect(payload?.type).toBe('processii/clipboard');
    expect(payload?.version).toBe(1);
    expect(payload?.elements.map((e) => e.id)).toEqual(['a']);
  });

  it('copySelection is a detached snapshot (later source edits do not mutate it)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 5, 5));
    const payload = engine.copySelection()!;
    engine.moveElement('a', 100, 0);
    expect(payload.elements[0]).toMatchObject({ x: 5, y: 5 });
  });

  it('paste creates fresh ids, nudges the block, and selects the copies', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0));
    const payload = engine.copySelection()!;
    const ids = engine.paste(payload);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('a');
    expect(engine.board.size).toBe(2);
    expect(engine.getSelection()).toEqual(ids);
    // Default nudge (no anchor): copy offset diagonally from the source.
    expect(engine.board.getElement(ids[0]!)).toMatchObject({ x: 16, y: 16 });
  });

  it('paste at an anchor centers the block bounding box on it', () => {
    const engine = createEngine({ clientId: 1 });
    // A 10×10 rect at origin → center (5,5). Pasting centered on (100,100) offsets by (95,95).
    engine.addElement(rect('a', 0, 0));
    const payload = engine.copySelection()!;
    const [id] = engine.paste(payload, { at: { x: 100, y: 100 } });
    expect(engine.board.getElement(id!)).toMatchObject({ x: 95, y: 95 });
  });

  it('paste remaps a connector binding to the pasted copies (both endpoints copied)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0), { select: false });
    engine.addElement(rect('b', 200, 0), { select: false });
    engine.addElement(arrow('arr', 'a', 'b'), { select: false });
    engine.select(['a', 'b', 'arr']);
    const payload = engine.copySelection()!;
    const ids = engine.paste(payload);
    const pastedArrow = ids
      .map((id) => engine.board.getElement(id)!)
      .find((el) => el.kind === 'arrow')!;
    // Re-pointed to the NEW element ids, never the originals.
    expect(pastedArrow).toMatchObject({ kind: 'arrow' });
    if (pastedArrow.kind === 'arrow') {
      expect(pastedArrow.start).toBeDefined();
      expect(pastedArrow.end).toBeDefined();
      expect(ids).toContain(pastedArrow.start);
      expect(ids).toContain(pastedArrow.end);
      expect(pastedArrow.start).not.toBe('a');
      expect(pastedArrow.end).not.toBe('b');
    }
  });

  it('paste drops a connector binding whose target was not copied', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0), { select: false });
    engine.addElement(rect('b', 200, 0), { select: false });
    engine.addElement(arrow('arr', 'a', 'b'), { select: false });
    engine.select(['arr']); // only the connector, not its endpoints
    const [id] = engine.paste(engine.copySelection()!);
    const pasted = engine.board.getElement(id!)!;
    if (pasted.kind === 'arrow') {
      expect(pasted.start).toBeUndefined();
      expect(pasted.end).toBeUndefined();
    }
  });

  it('paste clears a step lane membership and sub-process link', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({
      kind: 'step',
      id: 's',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      swimlaneId: 'lane1',
      subprocessRef: 'doc-x',
      subprocessKind: 'external',
    });
    const [id] = engine.paste(engine.copySelection()!);
    const pasted = engine.board.getElement(id!)!;
    if (pasted.kind === 'step') {
      expect(pasted.swimlaneId).toBeUndefined();
      expect(pasted.subprocessRef).toBeUndefined();
      expect(pasted.subprocessKind).toBeUndefined();
    }
  });

  it('paste is a single undo step (all copies revert at once)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(rect('a', 0, 0), { select: false });
    engine.addElement(rect('b', 50, 0), { select: false });
    engine.select(['a', 'b']);
    const history = engine.history(); // undo manager must exist before the paste transaction
    engine.paste(engine.copySelection()!);
    expect(engine.board.size).toBe(4);
    history.undo();
    expect(engine.board.size).toBe(2);
  });

  it('a payload pastes into another board (inter-board copy)', () => {
    const source = createEngine({ clientId: 1 });
    source.addElement(rect('a', 0, 0));
    const payload = source.copySelection()!;
    const target = createEngine({ clientId: 2 });
    const ids = target.paste(payload);
    expect(target.board.size).toBe(1);
    expect(target.getSelection()).toEqual(ids);
  });

  it('paste lands the copy on top (z above the current max)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ ...(rect('a') as object), z: 5 });
    const [id] = engine.paste(engine.copySelection()!);
    expect(engine.board.getElement(id!)?.z).toBe(6); // topZ (5) + 1
  });
});

describe('engine — z-order (stacking)', () => {
  function at(engine: ReturnType<typeof createEngine>, id: string, z: number) {
    engine.addElement({ ...(rect(id) as object), z }, { select: false });
  }

  it('bringToFront lifts an element above every other', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    at(engine, 'b', 1);
    at(engine, 'c', 2);
    expect(engine.bringToFront(['a'])).toBe(1);
    // listElements is z-ascending → 'a' now last (on top).
    expect(engine.listElements().map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('sendToBack drops an element below every other', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    at(engine, 'b', 1);
    at(engine, 'c', 2);
    expect(engine.sendToBack(['c'])).toBe(1);
    expect(engine.listElements().map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('restacking a multi-selection keeps its members in relative order', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    at(engine, 'b', 1);
    at(engine, 'c', 2);
    engine.bringToFront(['a', 'b']); // a below b originally → stays a then b, both above c
    expect(engine.listElements().map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('defaults to the current selection', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    at(engine, 'b', 1);
    engine.select(['a']);
    engine.bringToFront();
    expect(engine.listElements().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('is a single undo step', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    at(engine, 'b', 1);
    const history = engine.history();
    engine.bringToFront(['a']);
    expect(engine.board.getElement('a')?.z).toBe(2);
    history.undo();
    expect(engine.board.getElement('a')?.z).toBe(0);
  });

  it('empty target = no-op', () => {
    const engine = createEngine({ clientId: 1 });
    at(engine, 'a', 0);
    expect(engine.bringToFront([])).toBe(0);
    expect(engine.sendToBack(['nope'])).toBe(0);
  });
});
