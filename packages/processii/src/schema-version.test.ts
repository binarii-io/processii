import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { syncDocs } from './crdt/index.js';
import { boardFromDoc, createBoard, DOC_SCHEMA_VERSION, type WhiteboardBoard } from './board.js';
import { LEGACY_CLUSTER_ID, WhiteboardSchemaVersionError } from './scene.js';

const META_KEY = 'whiteboard:meta';
const SCHEMA_VERSION_KEY = 'schemaVersion';
const SWIMLANES_KEY = 'whiteboard:swimlanes';

/** Raw meta map of a board's Y.Doc — to inspect/forge the version marker as a foreign writer would. */
const rawMeta = (board: WhiteboardBoard) => board.doc.getMap<unknown>(META_KEY);

function rect(id: string, x = 0, y = 0): unknown {
  return { kind: 'rectangle', id, x, y, width: 10, height: 10 };
}

describe('board — Y.Doc schema version', () => {
  it('a fresh (unstamped) board reads as the pre-marker baseline (1) and is readable', () => {
    const board = createBoard({ clientId: 1 });
    // No marker yet: an unstamped doc reads as `1` — it may be a legacy v1 document.
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(false);
    expect(board.getSchemaVersion()).toBe(1);
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
    expect(board.getSchemaVersion()).toBe(1); // unstamped → pre-marker baseline
    expect(() => board.assertReadable()).not.toThrow();

    board.addElement(rect('a2'));
    expect(rawMeta(board).has(SCHEMA_VERSION_KEY)).toBe(true);
    expect(board.getSchemaVersion()).toBe(DOC_SCHEMA_VERSION);
  });

  it('is currently v2 (swimlane clusters)', () => {
    expect(DOC_SCHEMA_VERSION).toBe(2);
  });

  it('migrates a v1 doc on read: legacy lanes project onto the single legacy cluster', () => {
    const board = createBoard({ clientId: 1 });
    board.addSwimlane({ id: 'l1', order: 0, height: 100 });
    board.addSwimlane({ id: 'l2', order: 1, height: 100 });
    // Simulate a v1 document: mark version 1 and strip the clusterId key the v2 build now writes.
    rawMeta(board).set(SCHEMA_VERSION_KEY, 1);
    const lanes = board.doc.getMap<Y.Map<unknown>>(SWIMLANES_KEY);
    for (const lane of lanes.values()) lane.delete('clusterId');

    expect(() => board.assertReadable()).not.toThrow(); // v1 ≤ v2 → readable
    expect(board.listSwimlanes().every((l) => l.clusterId === LEGACY_CLUSTER_ID)).toBe(true);
    expect(board.listSwimlaneClusters()).toHaveLength(1);
    expect(board.listSwimlaneClusters()[0]?.id).toBe(LEGACY_CLUSTER_ID);
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

  it('refuses a present-but-malformed marker instead of reading it as v1', () => {
    // A newer version, a non-integer, an out-of-range, or a non-number marker must all be refused
    // (the gate is "refuse, never mis-read"), not optimistically downgraded to the v1 baseline.
    const malformed: unknown[] = [DOC_SCHEMA_VERSION + 0.5, 0, -1, Number.NaN, '2'];
    for (const bad of malformed) {
      const board = createBoard({ clientId: 1 });
      board.addElement(rect('a1'));
      rawMeta(board).set(SCHEMA_VERSION_KEY, bad);
      expect(() => board.assertReadable()).toThrow(WhiteboardSchemaVersionError);
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
