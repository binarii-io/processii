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
