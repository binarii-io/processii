import type { CrdtDoc, PersistenceProvider, TransportProvider } from './crdt/index.js';
import { describe, expect, it } from 'vitest';
import { connectAdapters, createMemoryIdentity, WhiteboardAdapterError } from './adapters.js';
import { createEngine } from './engine.js';

function fakeTransport(doc: CrdtDoc): TransportProvider {
  let destroyed = false;
  return {
    doc,
    kind: 'transport',
    status: 'disconnected',
    connect: async () => undefined,
    disconnect: () => undefined,
    onStatusChange: () => () => undefined,
    destroy: () => {
      destroyed = true;
    },
    get _destroyed() {
      return destroyed;
    },
  } as TransportProvider & { _destroyed: boolean };
}

function fakePersistence(doc: CrdtDoc): PersistenceProvider {
  return {
    doc,
    kind: 'persistence',
    loaded: true,
    whenLoaded: async () => undefined,
    flush: async () => undefined,
    clear: async () => undefined,
    destroy: () => undefined,
  };
}

describe('adapters — identity', () => {
  it('createMemoryIdentity validates and applies the defaults', () => {
    const identity = createMemoryIdentity({ id: 'u1', name: 'Ada' });
    expect(identity.getLocalParticipant()).toEqual({ id: 'u1', name: 'Ada', color: 'accent' });
  });

  it('createMemoryIdentity rejects an invalid input', () => {
    expect(() => createMemoryIdentity({ id: '' })).toThrow();
  });
});

describe('adapters — connexion (offline-first)', () => {
  it('without transport nor persistence, the board stays local and usable', () => {
    const engine = createEngine({ clientId: 1 });
    const session = connectAdapters(engine, {
      identity: createMemoryIdentity({ id: 'u1', name: 'Ada' }),
    });
    expect(session.transport).toBeUndefined();
    expect(session.persistence).toBeUndefined();
    expect(session.identity.name).toBe('Ada');
    // The engine works without network.
    engine.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 1, height: 1 });
    expect(engine.board.size).toBe(1);
    session.disconnect();
  });

  it('instancie transport & persistence via leurs factories', () => {
    const engine = createEngine({ clientId: 1 });
    const session = connectAdapters(engine, {
      identity: createMemoryIdentity({ id: 'u1', name: 'Ada' }),
      transport: fakeTransport,
      persistence: fakePersistence,
    });
    expect(session.transport?.kind).toBe('transport');
    expect(session.persistence?.kind).toBe('persistence');
    session.disconnect();
  });

  it('disconnect destroys the wired providers', () => {
    const engine = createEngine({ clientId: 1 });
    let providerRef: (TransportProvider & { _destroyed: boolean }) | undefined;
    const session = connectAdapters(engine, {
      identity: createMemoryIdentity({ id: 'u1', name: 'Ada' }),
      transport: (doc) => {
        providerRef = fakeTransport(doc) as TransportProvider & { _destroyed: boolean };
        return providerRef;
      },
    });
    session.disconnect();
    expect(providerRef?._destroyed).toBe(true);
  });

  it('rejects a non-conforming transport factory with a typed error', () => {
    const engine = createEngine({ clientId: 1 });
    expect(() =>
      connectAdapters(engine, {
        identity: createMemoryIdentity({ id: 'u1', name: 'Ada' }),
        // @ts-expect-error: factory intentionally non-conforming for the error test.
        transport: (doc: CrdtDoc) => ({ doc, kind: 'persistence' }),
      }),
    ).toThrow(WhiteboardAdapterError);
  });
});
