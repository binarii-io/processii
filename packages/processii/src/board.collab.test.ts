import { applyUpdate, encodeStateAsUpdate, syncDocs } from './crdt/index.js';
import { describe, expect, it } from 'vitest';
import { boardFromDoc, createBoard } from './board.js';

function rect(id: string, x = 0, y = 0): unknown {
  return { kind: 'rectangle', id, x, y, width: 10, height: 10 };
}

describe('board — collaborative convergence (Yjs)', () => {
  it('creation + move converge between two replicas', () => {
    // Two replicas of the same board, started independently (offline-first).
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });

    // A creates and moves; B creates another element in parallel (concurrent).
    a.addElement(rect('a1', 0, 0));
    a.moveElement('a1', 10, 5);
    b.addElement(rect('b1', 100, 100));

    // Bidirectional exchange (one sync round, as a transport would do).
    syncDocs(a.doc, b.doc);

    // Both replicas see both elements, identical.
    expect(a.toScene()).toEqual(b.toScene());
    expect(a.getElement('a1')).toMatchObject({ x: 10, y: 5 });
    expect(b.getElement('a1')).toMatchObject({ x: 10, y: 5 });
    expect(a.getElement('b1')).toMatchObject({ x: 100, y: 100 });
  });

  it('the shared document name converges (host → guest)', () => {
    const host = createBoard({ clientId: 1 });
    const guest = createBoard({ clientId: 2 });
    // The host names its doc; the guest starts blank (no name).
    host.setName('Parcours client');
    expect(guest.getName()).toBeNull();
    // Sync (as the transport would do) → the guest picks up the host's name.
    syncDocs(host.doc, guest.doc);
    expect(guest.getName()).toBe('Parcours client');
  });

  it('concurrent modifications of different fields merge without loss', () => {
    const a = createBoard({ clientId: 1 });
    a.addElement(rect('e', 0, 0));
    // Bootstraps B from A.
    const b = boardFromDoc(
      ((): import('./crdt/index.js').CrdtDoc => {
        const doc = createBoard({ clientId: 2 }).doc;
        applyUpdate(doc, encodeStateAsUpdate(a.doc));
        return doc;
      })(),
    );

    // Concurrent: A moves in x, B recolors (disjoint fields of the same element).
    a.moveElement('e', 50, 0);
    b.updateElement('e', { stroke: 'accent' });

    syncDocs(a.doc, b.doc);

    const ea = a.getElement('e');
    const eb = b.getElement('e');
    expect(ea).toEqual(eb);
    // Both modifications survive.
    expect(ea).toMatchObject({ x: 50, stroke: 'accent' });
  });

  it('a deletion on one replica propagates to the other', () => {
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });
    a.addElement(rect('x'));
    syncDocs(a.doc, b.doc);
    expect(b.has('x')).toBe(true);

    a.removeElement('x');
    syncDocs(a.doc, b.doc);
    expect(a.has('x')).toBe(false);
    expect(b.has('x')).toBe(false);
    expect(a.toScene()).toEqual(b.toScene());
  });

  it('the update application order does not affect convergence', () => {
    const a = createBoard({ clientId: 1 });
    const b = createBoard({ clientId: 2 });
    const c = createBoard({ clientId: 3 });
    a.addElement(rect('a', 1, 1));
    b.addElement(rect('b', 2, 2));
    c.addElement(rect('c', 3, 3));

    const ua = encodeStateAsUpdate(a.doc);
    const ub = encodeStateAsUpdate(b.doc);
    const uc = encodeStateAsUpdate(c.doc);

    // Applies in two different orders on two fresh docs.
    const left = createBoard({ clientId: 10 });
    applyUpdate(left.doc, ua);
    applyUpdate(left.doc, ub);
    applyUpdate(left.doc, uc);

    const right = createBoard({ clientId: 11 });
    applyUpdate(right.doc, uc);
    applyUpdate(right.doc, ua);
    applyUpdate(right.doc, ub);

    expect(left.toScene()).toEqual(right.toScene());
    expect(left.size).toBe(3);
  });
});
