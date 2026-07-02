/**
 * Tests of the **vendored** CRDT module (ADR 0006) — adapted from `crdt-core`: the same
 * guarantees (convergence, idempotence, offline→resync, presence, provider contracts) proved on
 * the local copy, so the decoupling degrades nothing.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  applyAwarenessUpdate,
  applyUpdate,
  clearLocalState,
  createAwareness,
  createDoc,
  destroyAwareness,
  diffUpdate,
  encodeAwarenessUpdate,
  encodeStateAsUpdate,
  encodeStateVector,
  getLocalState,
  getStates,
  isPersistenceProvider,
  isTransportProvider,
  mergeUpdates,
  onAwarenessChange,
  onUpdate,
  setLocalState,
  syncDocs,
  type ConnectionStatus,
  type PersistenceProvider,
  type PersistenceProviderFactory,
  type TransportProvider,
  type TransportProviderFactory,
} from './index.js';

function text(doc: ReturnType<typeof createDoc>): Y.Text {
  return doc.getText('content');
}

describe('crdt/doc — creation & options', () => {
  it('creates a document with a deterministic clientId', () => {
    const doc = createDoc({ clientId: 42 });
    expect(doc.clientID).toBe(42);
    doc.destroy();
  });

  it('assigns a random clientId by default', () => {
    const a = createDoc();
    const b = createDoc();
    expect(typeof a.clientID).toBe('number');
    expect(typeof b.clientID).toBe('number');
    a.destroy();
    b.destroy();
  });
});

describe('crdt/doc — 2-client convergence (concurrent updates)', () => {
  it('converges on concurrent edits at the same spot', () => {
    const alice = createDoc({ clientId: 1 });
    const bob = createDoc({ clientId: 2 });

    text(alice).insert(0, 'Hello');
    syncDocs(alice, bob);
    expect(text(bob).toString()).toBe('Hello');

    // CONCURRENT edits (no sync in between) at the same offset.
    text(alice).insert(5, ' Alice');
    text(bob).insert(5, ' Bob');

    const aToB = diffUpdate(alice, encodeStateVector(bob));
    const bToA = diffUpdate(bob, encodeStateVector(alice));
    applyUpdate(bob, aToB);
    applyUpdate(alice, bToA);

    expect(text(alice).toString()).toBe(text(bob).toString());
    expect(text(alice).toString()).toContain('Alice');
    expect(text(alice).toString()).toContain('Bob');
    [alice, bob].forEach((d) => d.destroy());
  });

  it('replays offline edits on reconnection (offline → resync)', () => {
    const server = createDoc({ clientId: 1 });
    const client = createDoc({ clientId: 2 });

    text(server).insert(0, 'doc:');
    syncDocs(server, client);

    // The client goes OFFLINE and edits; the server receives other edits meanwhile.
    text(client).insert(text(client).length, ' offline-edit');
    text(server).insert(text(server).length, ' server-edit');

    syncDocs(client, server);

    expect(text(client).toString()).toBe(text(server).toString());
    expect(text(client).toString()).toContain('offline-edit');
    expect(text(client).toString()).toContain('server-edit');
    [server, client].forEach((d) => d.destroy());
  });
});

describe('crdt/doc — updates: idempotence, merge, observation', () => {
  it('applies an update twice with no effect (idempotent)', () => {
    const a = createDoc({ clientId: 1 });
    const b = createDoc({ clientId: 2 });
    text(a).insert(0, 'abc');
    const u = encodeStateAsUpdate(a);
    applyUpdate(b, u);
    applyUpdate(b, u); // simulated network duplicate
    expect(text(b).toString()).toBe('abc');
    [a, b].forEach((d) => d.destroy());
  });

  it('mergeUpdates produces an equivalent update', () => {
    const src = createDoc({ clientId: 1 });
    text(src).insert(0, 'a');
    const u1 = encodeStateAsUpdate(src);
    text(src).insert(1, 'b');
    const u2 = diffUpdate(src, encodeStateVector(createDoc()));
    const merged = mergeUpdates([u1, u2]);

    const target = createDoc({ clientId: 2 });
    applyUpdate(target, merged);
    expect(text(target).toString()).toBe('ab');
    [src, target].forEach((d) => d.destroy());
  });

  it('onUpdate notifies with the origin and unsubscribes', () => {
    const doc = createDoc({ clientId: 1 });
    const remote = createDoc({ clientId: 2 });
    remote.getText('content').insert(0, 'z');

    const origins: unknown[] = [];
    const off = onUpdate(doc, (_u, origin) => origins.push(origin));

    text(doc).insert(0, 'x'); // local origin
    applyUpdate(doc, encodeStateAsUpdate(remote), 'remote'); // explicit origin, real delta

    off();
    text(doc).insert(0, 'y'); // must no longer notify

    expect(origins.length).toBe(2);
    expect(origins[1]).toBe('remote');
    [doc, remote].forEach((d) => d.destroy());
  });
});

describe('crdt/awareness — local state & propagation', () => {
  it('sets, merges per field, and clears the local state', () => {
    const doc = createDoc({ clientId: 1 });
    const aw = createAwareness(doc);

    setLocalState(aw, { name: 'Alice', cursor: 3 });
    expect(getLocalState(aw)).toEqual({ name: 'Alice', cursor: 3 });

    setLocalState(aw, { cursor: 7 }); // merge: name kept
    expect(getLocalState(aw)).toEqual({ name: 'Alice', cursor: 7 });

    clearLocalState(aw);
    expect(getLocalState(aw)).toBeNull();

    destroyAwareness(aw);
    doc.destroy();
  });

  it('propagates presence via encode/apply and getStates returns a defensive copy', () => {
    const docA = createDoc({ clientId: 1 });
    const docB = createDoc({ clientId: 2 });
    const awA = createAwareness(docA);
    const awB = createAwareness(docB);

    setLocalState(awA, { name: 'Alice', color: '#f00' });
    applyAwarenessUpdate(awB, encodeAwarenessUpdate(awA), 'remote');

    const seen = getStates(awB);
    expect(seen.get(docA.clientID)).toEqual({ name: 'Alice', color: '#f00' });

    seen.clear(); // snapshot mutation: the awareness stays intact
    expect(getStates(awB).get(docA.clientID)).toEqual({ name: 'Alice', color: '#f00' });

    [awA, awB].forEach(destroyAwareness);
    [docA, docB].forEach((d) => d.destroy());
  });

  it('notifies changes with their origin and unsubscribes', () => {
    const docA = createDoc({ clientId: 1 });
    const docB = createDoc({ clientId: 2 });
    const awA = createAwareness(docA);
    const awB = createAwareness(docB);

    const changes: { added: readonly number[]; origin: unknown }[] = [];
    const off = onAwarenessChange(awB, (change, origin) =>
      changes.push({ added: change.added, origin }),
    );

    setLocalState(awA, { name: 'Alice' });
    applyAwarenessUpdate(awB, encodeAwarenessUpdate(awA), 'remote');

    off();
    setLocalState(awA, { name: 'Alice2' });
    applyAwarenessUpdate(awB, encodeAwarenessUpdate(awA), 'remote'); // no longer notified

    expect(changes.length).toBe(1);
    expect(changes[0]?.added).toContain(docA.clientID);
    expect(changes[0]?.origin).toBe('remote');

    [awA, awB].forEach(destroyAwareness);
    [docA, docB].forEach((d) => d.destroy());
  });
});

/**
 * IN-MEMORY implementations of the provider contracts, without network dependency: prove that
 * the vendored interfaces are implementable AND compatible with the injected factories.
 */
function createMemoryTransport(
  doc: ReturnType<typeof createDoc>,
  awareness?: ReturnType<typeof createAwareness>,
): TransportProvider {
  let status: ConnectionStatus = 'disconnected';
  const handlers = new Set<(s: ConnectionStatus) => void>();
  const set = (s: ConnectionStatus): void => {
    status = s;
    handlers.forEach((h) => h(s));
  };
  return {
    kind: 'transport',
    doc,
    ...(awareness ? { awareness } : {}),
    get status() {
      return status;
    },
    async connect() {
      set('connecting');
      set('connected');
    },
    disconnect() {
      set('disconnected');
    },
    onStatusChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    destroy() {
      handlers.clear();
      set('disconnected');
    },
  };
}

type MemoryStore = Map<string, Uint8Array>;

function createMemoryPersistence(store: MemoryStore, key: string): PersistenceProviderFactory {
  return (doc): PersistenceProvider => {
    let loaded = false;
    return {
      kind: 'persistence',
      doc,
      get loaded() {
        return loaded;
      },
      async whenLoaded() {
        const persisted = store.get(key);
        if (persisted) applyUpdate(doc, persisted, 'persistence');
        loaded = true;
      },
      async flush() {
        store.set(key, encodeStateAsUpdate(doc));
      },
      async clear() {
        store.delete(key);
      },
      destroy() {
        /* no-op */
      },
    };
  };
}

describe('crdt/providers — type guards & contracts (in-memory impl)', () => {
  it('distinguishes transport from persistence', () => {
    const doc = createDoc({ clientId: 1 });
    const transport = createMemoryTransport(doc);
    const persistence = createMemoryPersistence(new Map(), 'k')(doc);

    expect(isTransportProvider(transport)).toBe(true);
    expect(isPersistenceProvider(transport)).toBe(false);
    expect(isPersistenceProvider(persistence)).toBe(true);
    expect(isTransportProvider(persistence)).toBe(false);
    doc.destroy();
  });

  it('transport: follows the status cycle and notifies', async () => {
    const doc = createDoc({ clientId: 1 });
    const aw = createAwareness(doc);
    const factory: TransportProviderFactory = (d, opts) =>
      createMemoryTransport(d, opts?.awareness);
    const provider = factory(doc, { awareness: aw });

    const seen: ConnectionStatus[] = [];
    const off = provider.onStatusChange((s) => seen.push(s));

    expect(provider.status).toBe('disconnected');
    await provider.connect();
    expect(provider.status).toBe('connected');
    expect(provider.awareness).toBe(aw);

    provider.disconnect();
    expect(provider.status).toBe('disconnected');

    await provider.destroy();
    expect(seen).toEqual(['connecting', 'connected', 'disconnected']);
    off();
    doc.destroy();
  });

  it('persistence: flushes then reloads the state into a NEW document (round-trip)', async () => {
    const store: MemoryStore = new Map();
    const factory: PersistenceProviderFactory = createMemoryPersistence(store, 'doc:1');

    const doc1 = createDoc({ clientId: 1 });
    doc1.getText('content').insert(0, 'persisted');
    const p1 = factory(doc1);
    expect(p1.loaded).toBe(false);
    await p1.flush();
    doc1.destroy();

    const doc2 = createDoc({ clientId: 1 });
    const p2 = factory(doc2);
    await p2.whenLoaded();
    expect(p2.loaded).toBe(true);
    expect(doc2.getText('content').toString()).toBe('persisted');

    await p2.clear();
    const doc3 = createDoc({ clientId: 1 });
    const p3 = factory(doc3);
    await p3.whenLoaded();
    expect(doc3.getText('content').toString()).toBe('');

    [doc2, doc3].forEach((d) => d.destroy());
  });
});
