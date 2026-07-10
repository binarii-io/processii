import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { createBoard } from './board.js';
import { DEFAULT_SWIMLANES_WIDTH, LEGACY_CLUSTER_ID, parseScene } from './scene.js';

/**
 * Swimlane **clusters** (v2): freely-positioned, aligned lane blocks with magnetic attach/detach.
 * Covers the read-time v1→v2 migration (projection), the cluster-aware geometry, and the
 * move/attach/detach operations (content follows its lane by geometry). Convergence is in
 * `swimlane-cluster.collab.test.ts`.
 */

describe('swimlane clusters — migration (read-time projection)', () => {
  it('a legacy lane (no clusterId) projects onto the single legacy cluster', () => {
    const engine = createEngine({ clientId: 1 });
    // A lane authored without a clusterId (as a v1 build wrote it) → defaults to LEGACY_CLUSTER_ID.
    engine.addSwimlane({ id: 'l1', order: 0, height: 120 });
    expect(engine.listSwimlanes()[0]?.clusterId).toBe(LEGACY_CLUSTER_ID);
    const clusters = engine.listSwimlaneClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ id: LEGACY_CLUSTER_ID, x: 0, y: 0 });
  });

  it('an empty board projects zero clusters (identity comes from lane membership)', () => {
    const engine = createEngine({ clientId: 1 });
    expect(engine.listSwimlaneClusters()).toEqual([]);
  });

  it('the legacy cluster adopts the old shared width as its default width', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setSwimlanesWidth(1500);
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    expect(engine.listSwimlaneClusters()[0]?.width).toBe(1500);
    // Unset → default.
    const fresh = createEngine({ clientId: 2 });
    fresh.addSwimlane({ id: 'l1', order: 0, height: 100 });
    expect(fresh.listSwimlaneClusters()[0]?.width).toBe(DEFAULT_SWIMLANES_WIDTH);
  });

  it('a v1 scene round-trips: lanes land in the legacy cluster on load', () => {
    const engine = createEngine({ clientId: 1 });
    engine.loadScene(
      parseScene({
        version: 1,
        elements: [],
        swimlanes: [
          { id: 'l1', order: 0, height: 100 },
          { id: 'l2', order: 1, height: 100 },
        ],
        swimlanesWidth: 900,
      }),
    );
    expect(engine.listSwimlanes().map((l) => l.clusterId)).toEqual([
      LEGACY_CLUSTER_ID,
      LEGACY_CLUSTER_ID,
    ]);
    expect(engine.listSwimlaneClusters()).toHaveLength(1);
    expect(engine.listSwimlaneClusters()[0]?.width).toBe(900);
  });
});

describe('swimlane clusters — cluster-aware geometry', () => {
  it('bands, header and edges account for the cluster position (x ≠ 0)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.updateSwimlaneCluster(LEGACY_CLUSTER_ID, { x: 500, y: 200, width: 300 });

    // Lane band is positioned at the cluster origin.
    expect(engine.laneBand('l1')).toEqual({ x: 500, y: 200, width: 300, height: 100 });
    expect(engine.laneTop('l1')).toBe(200);
    // Hit-test at a point outside the cluster x-range → no lane.
    expect(engine.laneAtPoint({ x: 50, y: 250 })).toBeUndefined();
    expect(engine.laneAtPoint({ x: 600, y: 250 })).toBe('l1');
    // Header only in the cluster's top-left corner.
    expect(engine.laneHeaderAtPoint({ x: 520, y: 210 })).toBe('l1');
    expect(engine.laneHeaderAtPoint({ x: 50, y: 210 })).toBeUndefined();
    // Right edge carries the cluster id; bottom edge carries the lane id.
    expect(engine.laneEdgeAtPoint({ x: 800, y: 250 }, 6)).toEqual({
      clusterId: LEGACY_CLUSTER_ID,
      edge: 'right',
    });
    expect(engine.laneEdgeAtPoint({ x: 600, y: 300 }, 6)).toEqual({ laneId: 'l1', edge: 'bottom' });
  });

  it('lanes of two clusters stack independently from each cluster origin', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'a2', clusterId: 'A', order: 1, height: 100 });
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.updateSwimlaneCluster('B', { x: 1000, y: 50, width: 200 });

    expect(engine.laneBand('a2')).toMatchObject({ x: 0, y: 100 });
    expect(engine.laneBand('b1')).toMatchObject({ x: 1000, y: 50, width: 200 });
  });
});

describe('swimlane clusters — moveCluster', () => {
  it('translates the cluster and every element inside its lanes', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 200 });
    engine.updateSwimlaneCluster(LEGACY_CLUSTER_ID, { x: 0, y: 0, width: 1000 });
    engine.addElement(
      { kind: 'step', id: 's', x: 20, y: 50, width: 60, height: 40 },
      { select: false },
    );

    expect(engine.moveCluster(LEGACY_CLUSTER_ID, 100, 30)).toBe(true);
    expect(engine.listSwimlaneClusters()[0]).toMatchObject({ x: 100, y: 30 });
    // The element inside the lane band followed the whole cluster.
    expect(engine.board.getElement('s')).toMatchObject({ x: 120, y: 80 });
  });

  it('leaves an element outside the cluster width untouched', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 200 });
    engine.updateSwimlaneCluster(LEGACY_CLUSTER_ID, { x: 0, y: 0, width: 300 });
    engine.addElement(
      { kind: 'step', id: 'out', x: 1000, y: 50, width: 60, height: 40 },
      { select: false },
    );
    engine.moveCluster(LEGACY_CLUSTER_ID, 100, 30);
    expect(engine.board.getElement('out')).toMatchObject({ x: 1000, y: 50 });
  });

  it('no-op (false) on a zero delta or an unknown cluster', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    expect(engine.moveCluster(LEGACY_CLUSTER_ID, 0, 0)).toBe(false);
    expect(engine.moveCluster('ghost', 10, 10)).toBe(false);
  });
});

describe('swimlane clusters — detach', () => {
  it('detaches a lane into its own cluster with a deterministic id, carrying its content', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // 0..100
    engine.addSwimlane({ id: 'l2', order: 1, height: 100 }); // 100..200
    engine.addElement(
      { kind: 'step', id: 's', x: 10, y: 120, width: 40, height: 30 },
      { select: false },
    );

    expect(engine.detachSwimlaneTo('l2', 600, 400)).toBe(true);
    const l2 = engine.listSwimlanes().find((l) => l.id === 'l2');
    expect(l2?.clusterId).toBe('cluster-of:l2');
    // New cluster placed where dropped; old cluster keeps l1.
    const newCluster = engine.listSwimlaneClusters().find((c) => c.id === l2?.clusterId);
    expect(newCluster).toMatchObject({ x: 600, y: 400 });
    // The step inside l2 followed it: band moved (0,100)→(600,400), so (10,120) → (610,420).
    expect(engine.board.getElement('s')).toMatchObject({ x: 610, y: 420 });
    // Two clusters now.
    expect(engine.listSwimlaneClusters()).toHaveLength(2);
  });

  it('is a no-op (false) when the lane is already alone in its cluster', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    expect(engine.detachSwimlaneTo('l1', 500, 500)).toBe(false);
    expect(engine.detachSwimlaneTo('ghost', 0, 0)).toBe(false);
  });
});

describe('swimlane clusters — attach', () => {
  it('attaches a floating lane into another cluster, adopting its x/width and closing the gap', () => {
    const engine = createEngine({ clientId: 1 });
    // Cluster A: two lanes. Lane C: floating on its own.
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'a2', clusterId: 'A', order: 1, height: 100 });
    engine.addSwimlane({ id: 'c1', clusterId: 'C', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.addSwimlaneCluster({ id: 'C', x: 900, y: 300, width: 250 });

    expect(engine.attachSwimlane('c1', 'A')).toBe(true); // appended at the bottom of A
    const c1 = engine.listSwimlanes().find((l) => l.id === 'c1');
    expect(c1?.clusterId).toBe('A');
    expect(c1?.order).toBe(2);
    // It adopts A's x/width and stacks below a2 (y = 200).
    expect(engine.laneBand('c1')).toMatchObject({ x: 0, y: 200, width: 400 });
    // The emptied source cluster is gone.
    expect(
      engine
        .listSwimlaneClusters()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['A']);
  });

  it('tolerates an unknown target cluster (no-op false, lane stays put)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    expect(engine.attachSwimlane('a1', 'does-not-exist')).toBe(false);
    expect(engine.listSwimlanes().find((l) => l.id === 'a1')?.clusterId).toBe('A');
  });
});

describe('swimlane clusters — reorder is scoped to the cluster', () => {
  it('reordering a lane in cluster A does not touch cluster B', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'a2', clusterId: 'A', order: 1, height: 100 });
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.addSwimlaneCluster({ id: 'B', x: 1000, y: 0, width: 400 });

    expect(engine.reorderSwimlane('a1', 1)).toBe(true);
    const aOrder = engine
      .listSwimlanes()
      .filter((l) => l.clusterId === 'A')
      .map((l) => l.id);
    expect(aOrder).toEqual(['a2', 'a1']);
    // Cluster B untouched.
    expect(engine.listSwimlanes().find((l) => l.id === 'b1')?.order).toBe(0);
  });
});

describe('swimlane clusters — persistence round-trip', () => {
  it('toScene/loadScene preserves cluster positions and memberships', () => {
    const board = createBoard({ clientId: 1 });
    const engine = createEngine({ clientId: 2 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.addSwimlaneCluster({ id: 'B', x: 700, y: 250, width: 500 });

    const scene = engine.toScene();
    expect(scene.version).toBe(2);
    expect(scene.swimlaneClusters).toHaveLength(2);

    board.loadScene(parseScene(scene));
    expect(board.listSwimlaneClusters().find((c) => c.id === 'B')).toMatchObject({
      x: 700,
      y: 250,
      width: 500,
    });
    expect(board.toScene()).toEqual(scene);
  });
});

describe('swimlane clusters — atomicity', () => {
  it('detachSwimlaneTo emits a SINGLE CRDT update (cluster + lane + content are one transaction)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    engine.addSwimlane({ id: 'l2', order: 1, height: 100 });
    engine.addElement(
      { kind: 'step', id: 's', x: 10, y: 120, width: 40, height: 30 },
      { select: false },
    );
    let updates = 0;
    const onUpdate = (): void => {
      updates += 1;
    };
    engine.board.doc.on('update', onUpdate);
    engine.detachSwimlaneTo('l2', 600, 400);
    engine.board.doc.off('update', onUpdate);
    // One update means a peer can never observe the lane reassignment without its cluster override.
    expect(updates).toBe(1);
  });

  it('attachSwimlane and moveCluster are each a single CRDT update', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'c1', clusterId: 'C', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.addSwimlaneCluster({ id: 'C', x: 900, y: 0, width: 400 });
    let updates = 0;
    const onUpdate = (): void => {
      updates += 1;
    };
    engine.board.doc.on('update', onUpdate);
    engine.attachSwimlane('c1', 'A');
    expect(updates).toBe(1);
    engine.moveCluster('A', 100, 50);
    expect(updates).toBe(2);
    engine.board.doc.off('update', onUpdate);
  });
});

describe('swimlane clusters — overlapping clusters', () => {
  it('content follows its ASSIGNED lane, not a geometric first-match, when clusters overlap', () => {
    const engine = createEngine({ clientId: 1 });
    // Clusters A and B occupy the SAME space (overlap); their lanes' bands coincide.
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 200 });
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 200 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 400 });
    engine.addSwimlaneCluster({ id: 'B', x: 0, y: 0, width: 400 });
    // Step explicitly assigned to b1; its center falls in BOTH overlapping bands.
    engine.addElement(
      { kind: 'step', id: 's', x: 50, y: 50, width: 40, height: 30, swimlaneId: 'b1' },
      { select: false },
    );
    // Moving cluster B must carry the step (it belongs to b1), even though A's band is iterated first.
    engine.moveCluster('B', 500, 0);
    expect(engine.board.getElement('s')).toMatchObject({ x: 550, y: 50 });
  });
});

describe('swimlane clusters — context-aware creation (addSwimlaneInView)', () => {
  it('on an empty board, a fresh cluster is created centered on the view', () => {
    const engine = createEngine({ clientId: 1 });
    // The user is looking at the world rect (1000,500)-(1800,1100) (e.g. panned far from origin).
    const { lane, band, createdCluster } = engine.addSwimlaneInView(
      { id: 'l1', name: 'Bande', height: 180 },
      { x: 1000, y: 500, width: 800, height: 600 },
    );
    expect(createdCluster).toBe(true);
    expect(lane.clusterId).toBe('cluster-of:l1');
    // Cluster (default width 2000) centered on the view center (1400, 800):
    // x = round(1400 - 1000) = 400 ; y = round(800 - 90) = 710.
    const cluster = engine.getSwimlaneCluster('cluster-of:l1');
    expect(cluster).toMatchObject({ x: 400, y: 710, width: DEFAULT_SWIMLANES_WIDTH });
    // The band is centered on the view horizontally (its center = the view center X).
    expect(band).toEqual({ x: 400, y: 710, width: DEFAULT_SWIMLANES_WIDTH, height: 180 });
    expect(band.x + band.width / 2).toBe(1400);
  });

  it('appends to the cluster the user is looking at (view overlaps its bounds)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // legacy cluster at (0,0), width 2000
    const { lane, band, createdCluster } = engine.addSwimlaneInView(
      { id: 'l2', height: 120 },
      { x: 0, y: 0, width: 800, height: 600 }, // overlaps the legacy band
    );
    expect(createdCluster).toBe(false);
    expect(lane.clusterId).toBe(LEGACY_CLUSTER_ID);
    expect(lane.order).toBe(1); // appended at the bottom
    expect(band).toEqual({ x: 0, y: 100, width: DEFAULT_SWIMLANES_WIDTH, height: 120 });
    expect(engine.listSwimlaneClusters()).toHaveLength(1); // still one block
  });

  it('when panned away from every cluster, a new block is created (no snap-back)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // legacy block spans x:[0,2000], y:[0,100]
    const { lane, createdCluster } = engine.addSwimlaneInView(
      { id: 'l2', height: 120 },
      { x: 5000, y: 5000, width: 800, height: 600 }, // no overlap with the legacy block
    );
    expect(createdCluster).toBe(true);
    expect(lane.clusterId).toBe('cluster-of:l2');
    expect(lane.clusterId).not.toBe(LEGACY_CLUSTER_ID);
    expect(engine.listSwimlaneClusters()).toHaveLength(2); // two independent blocks
  });

  it('ties on visible area break by the leftmost cluster (deterministic)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 2000 }); // spans x:[0,2000]
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'B', x: 3000, y: 0, width: 2000 }); // spans x:[3000,5000]
    // View x:[1500,3500] overlaps A by 500 (1500..2000) and B by 500 (3000..3500) → tie → leftmost A.
    const { lane } = engine.addSwimlaneInView(
      { id: 'c1', height: 100 },
      { x: 1500, y: 0, width: 2000, height: 100 },
    );
    expect(lane.clusterId).toBe('A');
  });

  it('picks the MOST visible cluster when several overlap the view', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 2000 }); // spans x:[0,2000]
    engine.addSwimlane({ id: 'b1', clusterId: 'B', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'B', x: 3000, y: 0, width: 2000 }); // spans x:[3000,5000]
    // View x:[1600,3600] overlaps A by 400 (x:1600..2000) and B by 600 (x:3000..3600) → B wins.
    const { lane } = engine.addSwimlaneInView(
      { id: 'c1', height: 100 },
      { x: 1600, y: 0, width: 2000, height: 100 },
    );
    expect(lane.clusterId).toBe('B');
    expect(lane.order).toBe(1);
  });

  it('without a viewport, preserves the historical placement (legacy block)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 });
    const { lane, createdCluster } = engine.addSwimlaneInView({ id: 'l2', height: 120 });
    expect(createdCluster).toBe(false);
    expect(lane.clusterId).toBe(LEGACY_CLUSTER_ID);
    expect(lane.order).toBe(1);
  });

  it('writes the new cluster override and the lane atomically (one update, single undo step)', () => {
    const engine = createEngine({ clientId: 1 });
    const history = engine.history();
    let updates = 0;
    engine.board.doc.on('update', () => (updates += 1));
    engine.addSwimlaneInView({ id: 'l1', height: 180 }, { x: 0, y: 0, width: 800, height: 600 });
    // Cluster override + lane emit ONE CRDT update (nested transactions flatten) → peers never see
    // a lane pointing at a cluster whose override has not landed.
    expect(updates).toBe(1);
    expect(engine.listSwimlanes()).toHaveLength(1);
    expect(engine.listSwimlaneClusters()).toHaveLength(1);
    // One undo removes BOTH the lane and its cluster override (they are one transaction).
    history.undo();
    expect(engine.listSwimlanes()).toHaveLength(0);
    expect(engine.listSwimlaneClusters()).toHaveLength(0);
  });
});
