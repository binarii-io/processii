import { describe, expect, it } from 'vitest';
import { syncDocs } from './crdt/index.js';
import { boardFromDoc, createBoard, DOC_SCHEMA_VERSION, type WhiteboardBoard } from './board.js';
import { WhiteboardSchemaVersionError } from './scene.js';

const META_KEY = 'whiteboard:meta';
const SCHEMA_VERSION_KEY = 'schemaVersion';

/** Raw meta map of a board's Y.Doc — to inspect/forge the version marker as a foreign writer would. */
const rawMeta = (board: WhiteboardBoard) => board.doc.getMap<unknown>(META_KEY);

function rect(id: string, x = 0, y = 0): unknown {
  return { kind: 'rectangle', id, x, y, width: 10, height: 10 };
}

describe('board — Y.Doc schema version', () => {
  it('a fresh board defaults to the current version and is readable before any edit', () => {
    const board = createBoard({ clientId: 1 });
    // No marker yet: an unstamped doc reads as the current baseline.
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(false);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
    expect(() => board.assertReadable()).not.toThrow();
  });

  it('stamps the current version on first authoring', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('a1'));
    expect(rawMeta(board).get(SCHEMA_VERSION_KEY)).toBe(DOC_SCHEMA_VERSION);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
  });

  it('treats an unstamped legacy doc as the baseline and re-stamps on the next edit', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('a1'));
    // Simulate a legacy doc (written before the marker existed): strip the key.
    rawMeta(board).delete(SCHEMA_VERSION_KEY);
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(false);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
    expect(() => board.assertReadable()).not.toThrow();

    board.addElement(rect('a2'));
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(true);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
  });

  it('refuses a document written by a newer schema version', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('a1'));
    rawMeta(board).set(SCHEMA_VERSION_KEY, DOC_SCHEMA_VERSION + 1);

    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION + 1);
    expect(() => board.assertReadable()).toThrow(WhiteboardSchemaVersionError);
    try {
      board.assertReadable();
      throw new Error('assertReadable should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WhiteboardSchemaVersionError);
      const schemaError = error as WhiteboardSchemaVersionError;
      expect(schemaError.found).toBe(DOC_SCHEMA_VERSION + 1);
      expect(schemaError.supported).toBe(DOC_SCHEMA_VERSION);
    }
  });

  it('boardFromDoc fails fast when attached to an unreadable (newer) doc', () => {
    const source = createBoard({ clientId: 1 });
    source.addElement(rect('a1'));
    rawMeta(source).set(SCHEMA_VERSION_KEY, DOC_SCHEMA_VERSION + 1);
    // Attaching a view to the already-hydrated doc must throw, not mis-read.
    expect(() => boardFromDoc(source.doc)).toThrow(WhiteboardSchemaVersionError);
  });

  it('keeps the schema version out of the scene snapshot', () => {
    const board = createBoard({ clientId: 1 });
    board.addElement(rect('a1'));
    // toScene carries the Scene/bundle `version`, never the Y.Doc `schemaVersion`.
    expect('schemaVersion' in board.toScene()).toBe(false);
  });

  it('converges across replicas without leaking the marker into toScene', () => {
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });
    a.addElement(rect('a1', 0, 0));
    b.addElement(rect('b1', 100, 100));

    syncDocs(a.doc, b.doc);

    // Both stamped the identical version → converges trivially.
    expect(a.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
    expect(b.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
    expect(a.toScene()).toEqual(b.toScene());
  });

  it('does not place the version marker on the undo stack', () => {
    const board = createBoard({ clientId: 1 });
    const history = board.createHistory();
    board.addElement(rect('a1'));
    expect(board.size).toBe(1);

    history.undo();

    // The element is undone; the version marker (stamped outside the tracked origin) survives.
    expect(board.size).toBe(0);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(true);
  });
});
