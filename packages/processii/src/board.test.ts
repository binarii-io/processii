import { syncDocs } from './crdt/index.js';
import { describe, expect, it } from 'vitest';
import { createBoard } from './board.js';
import { emptyScene, WhiteboardParseError } from './scene.js';

function rect(id: string): unknown {
  return { kind: 'rectangle', id, x: 0, y: 0, width: 10, height: 10 };
}

describe('board — updateElement (validated write boundary)', () => {
  it('applies a valid patch and makes it readable', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('e'));

    expect(board.updateElement('e', { x: 42, opacity: 0.5 })).toBe(true);
    expect(board.getElement('e')).toMatchObject({ x: 42, opacity: 0.5 });
  });

  it('no-op (false) when the element does not exist', () => {
    const board = createBoard({ clientId: 1 });
    expect(board.updateElement('absent', { x: 1 })).toBe(false);
  });

  it.each([
    ['negative width', { width: -5 }],
    ['x = NaN', { x: NaN }],
    ['opacity > 1', { opacity: 1.5 }],
    ['non-finite height', { height: Number.POSITIVE_INFINITY }],
  ])(
    'rejects an invalid patch (%s) with a typed error, without mutating the state',
    (_label, patch) => {
      const board = createBoard({ clientId: 1 });
      board.addElement(rect('e'));
      const before = board.getElement('e');

      expect(() => board.updateElement('e', patch)).toThrow(WhiteboardParseError);

      // State unchanged after the rejection.
      expect(board.getElement('e')).toEqual(before);
    },
  );

  it('an invalid attempt does not break the global reads (no poisoning)', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('a'));
    board.addElement(rect('b'));

    expect(() => board.updateElement('a', { width: -1 })).toThrow(WhiteboardParseError);

    // All reads stay healthy.
    expect(() => board.toScene()).not.toThrow();
    expect(() => board.listElements()).not.toThrow();
    expect(board.listElements()).toHaveLength(2);
    expect(board.getElement('a')).toMatchObject({ width: 10 });
  });

  it('a valid patch remains convergent between two replicas', () => {
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });
    a.addElement(rect('e'));
    syncDocs(a.doc, b.doc);

    a.updateElement('e', { x: 7, stroke: 'accent' });
    syncDocs(a.doc, b.doc);

    expect(a.toScene()).toEqual(b.toScene());
    expect(b.getElement('e')).toMatchObject({ x: 7, stroke: 'accent' });
  });
});

describe('board — shared background color', () => {
  it('default null; set/get + round-trip via toScene', () => {
    const board = createBoard({ clientId: 1 });
    expect(board.getBackground()).toBeNull();
    expect(board.toScene().background).toBeUndefined();

    board.setBackground('#dbeafe');
    expect(board.getBackground()).toBe('#dbeafe');
    expect(board.toScene().background).toBe('#dbeafe');
  });

  it('null/empty string resets (back to the theme default)', () => {
    const board = createBoard({ clientId: 1 });
    board.setBackground('#0c0c0e');
    board.setBackground(null);
    expect(board.getBackground()).toBeNull();
    board.setBackground('#fef9c3');
    board.setBackground('   ');
    expect(board.getBackground()).toBeNull();
  });

  it('loadScene applies (or clears) the background', () => {
    const board = createBoard({ clientId: 1 });
    board.setBackground('#ffffff');
    board.loadScene({
      version: 1,
      elements: [],
      swimlanes: [],
      swimlanesWidth: 1200,
      agentGroups: [],
    });
    expect(board.getBackground()).toBeNull(); // no `background` in the scene → cleared
  });

  it('converges between two replicas', () => {
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });
    a.setBackground('#dcfce7');
    syncDocs(a.doc, b.doc);
    expect(b.getBackground()).toBe('#dcfce7');
  });
});

describe('board — boardType (scene-level classification)', () => {
  it('defaults to idéation and round-trips through toScene', () => {
    const board = createBoard({ clientId: 1 });
    expect(board.getBoardType()).toBe('ideation');
    expect(board.toScene().boardType).toBe('ideation');
  });

  it('setBoardType persists and shows in the snapshot', () => {
    const board = createBoard({ clientId: 1 });
    board.setBoardType('architecture');
    expect(board.getBoardType()).toBe('architecture');
    expect(board.toScene().boardType).toBe('architecture');
  });

  it('ignores an unknown board type (defensive against untyped callers)', () => {
    const board = createBoard({ clientId: 1 });
    board.setBoardType('nope' as never);
    expect(board.getBoardType()).toBe('ideation');
  });

  it('loadScene applies the scene board type', () => {
    const board = createBoard({ clientId: 1 });
    board.loadScene({ ...emptyScene(), boardType: 'ideation' });
    expect(board.getBoardType()).toBe('ideation');
  });
});

describe('board — element data bag (host extension point)', () => {
  it('round-trips an opaque data bag through add + read + toScene', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement({
      ...(rect('e') as object),
      data: { chatMessageId: 'm-42', tags: ['a', 'b'] },
    });
    expect(board.getElement('e')).toMatchObject({
      data: { chatMessageId: 'm-42', tags: ['a', 'b'] },
    });
    expect(board.toScene().elements[0]).toMatchObject({ data: { chatMessageId: 'm-42' } });
  });

  it('updateElement can set then clear the data bag', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('e'));
    expect(board.getElement('e')?.data).toBeUndefined();
    board.updateElement('e', { data: { k: 1 } });
    expect(board.getElement('e')?.data).toEqual({ k: 1 });
    board.updateElement('e', { data: null }); // clear
    expect(board.getElement('e')?.data).toBeUndefined();
  });
});
