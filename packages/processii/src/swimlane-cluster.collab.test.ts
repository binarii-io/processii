import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { syncDocs } from './crdt/index.js';
import { createEngine, type WhiteboardEngine } from './engine.js';
import { LEGACY_CLUSTER_ID } from './scene.js';

/**
 * CRDT convergence of the swimlane-cluster operations. The safety property under test: cluster
 * **identity is defined by lane membership** and all migration/detach ids are **deterministic**, so
 * concurrent structural edits on two peers converge (no orphan cluster, no lane pointing nowhere).
 */

/** Two engines seeded with the same lanes/clusters, already synced. */
function seeded(setup: (e: WhiteboardEngine) => void): [WhiteboardEngine, WhiteboardEngine] {
  const a = createEngine({ clientId: 1 });
  const b = createEngine({ clientId: 2 });
  setup(a);
  syncDocs(a.board.doc, b.board.doc);
  return [a, b];
}

describe('swimlane clusters — convergence', () => {
  it('concurrent detach of the SAME lane converges to one cluster (deterministic id, no orphan)', () => {
    const [a, b] = seeded((e) => {
      e.addSwimlane({ id: 'l1', order: 0, height: 100 });
      e.addSwimlane({ id: 'l2', order: 1, height: 100 });
    });

    // Both peers detach l2 — to different drop points.
    a.detachSwimlaneTo('l2', 600, 400);
    b.detachSwimlaneTo('l2', 900, 100);
    syncDocs(a.board.doc, b.board.doc);

    expect(a.toScene()).toEqual(b.toScene());
    // l2 landed in the single deterministic cluster; no lane is orphaned.
    const expectedId = 'cluster-of:l2';
    expect(a.listSwimlanes().find((l) => l.id === 'l2')?.clusterId).toBe(expectedId);
    expect(
      a
        .listSwimlaneClusters()
        .map((c) => c.id)
        .sort(),
    ).toEqual([LEGACY_CLUSTER_ID, expectedId].sort());
  });

  it('attach into a cluster REMOVED on the other peer still converges (lane not orphaned)', () => {
    const [a, b] = seeded((e) => {
      e.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
      e.addSwimlane({ id: 'c1', clusterId: 'C', order: 0, height: 100 });
      e.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
      e.addSwimlaneCluster({ id: 'C', x: 900, y: 0, width: 400 });
    });

    // A attaches c1 into A; B concurrently removes the A cluster OVERRIDE.
    a.attachSwimlane('c1', 'A');
    b.removeSwimlaneCluster('A');
    syncDocs(a.board.doc, b.board.doc);

    expect(a.toScene()).toEqual(b.toScene());
    // c1 is a member of A (identity survives the removed override — synthesized if needed).
    const c1 = a.listSwimlanes().find((l) => l.id === 'c1');
    expect(c1?.clusterId).toBe('A');
    expect(a.listSwimlaneClusters().some((c) => c.id === 'A')).toBe(true);
  });

  it('concurrent moveCluster of the same cluster converges (per-field LWW)', () => {
    const [a, b] = seeded((e) => {
      e.addSwimlane({ id: 'l1', order: 0, height: 100 });
      e.updateSwimlaneCluster(LEGACY_CLUSTER_ID, { x: 0, y: 0, width: 500 });
    });

    a.moveCluster(LEGACY_CLUSTER_ID, 100, 0);
    b.moveCluster(LEGACY_CLUSTER_ID, 0, 50);
    syncDocs(a.board.doc, b.board.doc);

    expect(a.toScene()).toEqual(b.toScene());
  });

  it('reorder on one peer and attach into the same cluster on the other converge', () => {
    const [a, b] = seeded((e) => {
      e.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
      e.addSwimlane({ id: 'a2', clusterId: 'A', order: 1, height: 100 });
      e.addSwimlane({ id: 'c1', clusterId: 'C', order: 0, height: 100 });
      e.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
      e.addSwimlaneCluster({ id: 'C', x: 900, y: 0, width: 400 });
    });

    a.reorderSwimlane('a1', 1); // A becomes [a2, a1]
    b.attachSwimlane('c1', 'A'); // c1 appended into A
    syncDocs(a.board.doc, b.board.doc);

    expect(a.toScene()).toEqual(b.toScene());
    // All three lanes end up in A, with a total (deterministic) ordering.
    expect(a.listSwimlanes().filter((l) => l.clusterId === 'A')).toHaveLength(3);
  });

  it('concurrent addSwimlaneInView on two peers converges (injective per-lane clusters)', () => {
    const [a, b] = seeded(() => {}); // empty boards, already synced
    // Each peer creates a lane while looking at a different, empty area → a fresh cluster each.
    a.addSwimlaneInView({ id: 'la', height: 120 }, { x: 0, y: 0, width: 800, height: 600 });
    b.addSwimlaneInView({ id: 'lb', height: 120 }, { x: 5000, y: 5000, width: 800, height: 600 });
    syncDocs(a.board.doc, b.board.doc);

    expect(a.toScene()).toEqual(b.toScene());
    // Both lanes survive in their own injective cluster — no collision, no orphan.
    expect(
      a
        .listSwimlanes()
        .map((l) => l.id)
        .sort(),
    ).toEqual(['la', 'lb']);
    expect(
      a
        .listSwimlaneClusters()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['cluster-of:la', 'cluster-of:lb']);
  });

  it('a legacy doc (lanes without clusterId) projects the same cluster on both peers', () => {
    const a = createEngine({ clientId: 1 });
    a.addSwimlane({ id: 'l1', order: 0, height: 100 });
    a.addSwimlane({ id: 'l2', order: 1, height: 100 });
    // Simulate a v1 build: strip the clusterId key the current build now writes.
    const laneMap = a.board.doc.getMap<Y.Map<unknown>>('whiteboard:swimlanes');
    for (const lane of laneMap.values()) lane.delete('clusterId');

    const b = createEngine({ clientId: 2 });
    syncDocs(a.board.doc, b.board.doc);

    // Both peers project the identical legacy cluster (constant id → peer-stable).
    expect(a.listSwimlanes().every((l) => l.clusterId === LEGACY_CLUSTER_ID)).toBe(true);
    expect(b.listSwimlanes().every((l) => l.clusterId === LEGACY_CLUSTER_ID)).toBe(true);
    expect(a.toScene()).toEqual(b.toScene());

    // A concurrent edit on each peer still converges.
    a.addElement(
      { kind: 'rectangle', id: 'ra', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    b.addElement(
      { kind: 'rectangle', id: 'rb', x: 5, y: 5, width: 10, height: 10 },
      { select: false },
    );
    syncDocs(a.board.doc, b.board.doc);
    expect(a.toScene()).toEqual(b.toScene());
  });
});
