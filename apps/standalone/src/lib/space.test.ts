import { describe, expect, it } from 'vitest';
import type { PersistenceProvider, PersistenceProviderFactory } from '@binarii/processii';
import { getLocalState } from '@binarii/processii';
import { FakeNetwork } from '../test/fake-transport.js';
import { mountDocument, snapshotDocument } from './space.js';

const participant = { id: 'p1', name: 'Test', color: 'accent' };

describe('mountDocument — offline-first', () => {
  it('mounts a document without any adapter and edits locally', () => {
    const m = mountDocument({ id: 'd1', name: 'Doc', participant });
    expect(m.session.transport).toBeUndefined();
    expect(m.session.persistence).toBeUndefined();

    m.engine.addElement({ kind: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 10 });
    expect(m.engine.listElements()).toHaveLength(1);
    m.dispose();
  });

  it('loads an initial scene on mount (imported document)', () => {
    const scene = {
      version: 1 as const,
      elements: [{ kind: 'ellipse' as const, id: 'e1', x: 1, y: 2, width: 3, height: 4 }],
    };
    const m = mountDocument({ id: 'd2', name: 'Imported', participant, initialScene: scene });
    expect(m.engine.listElements()[0]?.id).toBe('e1');
    expect(snapshotDocument(m).scene.elements).toHaveLength(1);
    m.dispose();
  });

  it('wires an injected persistence (offline-first preserved)', () => {
    let created = false;
    const fakePersistence: PersistenceProviderFactory = (doc): PersistenceProvider => {
      created = true;
      return {
        kind: 'persistence',
        doc,
        get loaded() {
          return true;
        },
        whenLoaded: () => Promise.resolve(),
        flush: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        destroy: () => {},
      };
    };
    const m = mountDocument({
      id: 'd3',
      name: 'Doc',
      participant,
      persistenceFactory: fakePersistence,
    });
    expect(created).toBe(true);
    expect(m.session.persistence?.kind).toBe('persistence');
    m.dispose();
  });

  it('renewAwareness replaces the awareness with a fresh one (clean presence) and republishes the identity', () => {
    const m = mountDocument({ id: 'd4', name: 'Doc', participant });
    const before = m.awareness;
    const fresh = m.renewAwareness(participant);
    expect(fresh).not.toBe(before); // nouvelle instance
    expect(m.awareness).toBe(fresh); // exposed as the current awareness
    // The local identity is republished on the new awareness.
    expect(getLocalState(fresh)).toMatchObject({ name: 'Test', color: 'accent' });
    m.dispose();
  });
});

describe('collaboration P2P (faux transport, 2 pairs)', () => {
  it('two editing peers converge to the same state', async () => {
    const net = new FakeNetwork();
    const factory = net.factory('room-1');

    const host = mountDocument({
      id: 'doc',
      name: 'Shared',
      participant: { id: 'host', name: 'Host', color: 'accent' },
      transportFactory: factory,
    });
    const guest = mountDocument({
      id: 'doc',
      name: 'Shared',
      participant: { id: 'guest', name: 'Guest', color: 'accent' },
      transportFactory: factory,
    });

    await host.session.transport?.connect();
    await guest.session.transport?.connect();

    // Concurrent editing of TWO different elements by each peer.
    host.engine.addElement({ kind: 'rectangle', id: 'r-host', x: 0, y: 0, width: 10, height: 10 });
    guest.engine.addElement({ kind: 'ellipse', id: 'e-guest', x: 5, y: 5, width: 20, height: 20 });

    // Convergence: each peer sees both elements.
    const hostIds = host.engine
      .listElements()
      .map((e) => e.id)
      .sort();
    const guestIds = guest.engine
      .listElements()
      .map((e) => e.id)
      .sort();
    expect(hostIds).toEqual(['e-guest', 'r-host']);
    expect(guestIds).toEqual(['e-guest', 'r-host']);

    host.dispose();
    guest.dispose();
  });

  it('a guest joining afterwards receives the existing state (initial sync)', async () => {
    const net = new FakeNetwork();
    const factory = net.factory('room-2');

    const host = mountDocument({
      id: 'doc',
      name: 'Shared',
      participant: { id: 'host', name: 'Host', color: 'accent' },
      transportFactory: factory,
    });
    await host.session.transport?.connect();
    host.engine.addElement({
      kind: 'rectangle',
      id: 'existing',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const guest = mountDocument({
      id: 'doc',
      name: 'Shared',
      participant: { id: 'guest', name: 'Guest', color: 'accent' },
      transportFactory: factory,
    });
    await guest.session.transport?.connect();

    expect(guest.engine.listElements().map((e) => e.id)).toEqual(['existing']);

    host.dispose();
    guest.dispose();
  });

  it('a modification after convergence propagates too (live)', async () => {
    const net = new FakeNetwork();
    const factory = net.factory('room-3');
    const a = mountDocument({ id: 'doc', name: 'S', participant, transportFactory: factory });
    const b = mountDocument({ id: 'doc', name: 'S', participant, transportFactory: factory });
    await a.session.transport?.connect();
    await b.session.transport?.connect();

    a.engine.addElement({ kind: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 10 });
    b.engine.moveElement('r1', 100, 50);

    expect(a.engine.listElements()[0]?.x).toBe(100);
    expect(a.engine.listElements()[0]?.y).toBe(50);

    a.dispose();
    b.dispose();
  });
});
