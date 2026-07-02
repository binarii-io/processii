import { describe, expect, it } from 'vitest';
import {
  applyAwarenessUpdate,
  createAwareness,
  createDoc,
  encodeAwarenessUpdate,
} from './crdt/index.js';
import {
  initials,
  presenceCssColor,
  publishCursor,
  publishIdentity,
  publishSelection,
  readParticipants,
  readRemoteCursors,
  readRemoteSelections,
} from './presence.js';
import { presenceCssColor as publicPresenceCssColor } from './index.js';

describe('presence — presenceCssColor', () => {
  it('maps a ui-kit token to var(--color-…)', () => {
    expect(presenceCssColor('accent')).toBe('var(--color-accent)');
    expect(presenceCssColor('success')).toBe('var(--color-success)');
  });
  it('leaves a CSS value (hex/rgb/hsl) as-is', () => {
    expect(presenceCssColor('#1e90ff')).toBe('#1e90ff');
    expect(presenceCssColor('hsl(210, 60%, 45%)')).toBe('hsl(210, 60%, 45%)');
  });
  it('is part of the public surface (README contract: composing a custom layout)', () => {
    expect(publicPresenceCssColor).toBe(presenceCssColor);
  });
});

/** Propagates the awareness state from `from` to `to` (simulates the transport broadcast, no network). */
function sync(
  from: ReturnType<typeof createAwareness>,
  to: ReturnType<typeof createAwareness>,
): void {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'test');
}

describe('presence — curseurs distants', () => {
  it('readRemoteCursors excludes the local client', () => {
    const aw = createAwareness(createDoc({ clientId: 1 }));
    publishIdentity(aw, { id: 'me', name: 'Moi', color: 'accent' });
    publishCursor(aw, { x: 10, y: 20 });
    expect(readRemoteCursors(aw)).toEqual([]);
  });

  it('exposes a peer cursor (name, color, world position)', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(peer, { id: 'p', name: 'Alice', color: 'success' });
    publishCursor(peer, { x: 42, y: 7 });
    sync(peer, local);

    const cursors = readRemoteCursors(local);
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({ name: 'Alice', color: 'success', x: 42, y: 7 });
  });

  it('ignores a peer without a cursor position', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(peer, { id: 'p', name: 'Bob', color: 'accent' });
    sync(peer, local);
    expect(readRemoteCursors(local)).toEqual([]);
  });
});

describe('presence — remote selections', () => {
  it('exposes a peer selection (ids + color), excludes the local one', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(local, { id: 'me', name: 'Moi', color: 'accent' });
    publishSelection(local, ['x']); // locale → exclue
    publishIdentity(peer, { id: 'p', name: 'Alice', color: 'success' });
    publishSelection(peer, ['a', 'b']);
    sync(peer, local);

    const selections = readRemoteSelections(local);
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({ color: 'success', ids: ['a', 'b'] });
  });

  it('ignores a peer with an empty selection', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(peer, { id: 'p', name: 'Bob', color: 'accent' });
    publishSelection(peer, []);
    sync(peer, local);
    expect(readRemoteSelections(local)).toEqual([]);
  });
});

describe('presence — participants (pastilles)', () => {
  it('initials : 1 mot → 2 lettres, 2 mots → initiales, vide → ?', () => {
    expect(initials('Alice')).toBe('AL');
    expect(initials('Jean Pierre')).toBe('JP');
    expect(initials('   ')).toBe('?');
  });

  it('readParticipants includes oneself (self) and the peers having published an identity', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(local, { id: 'me', name: 'Moi', color: 'accent' });
    publishIdentity(peer, { id: 'p', name: 'Alice', color: 'success' });
    sync(peer, local);

    const people = readParticipants(local);
    expect(people).toHaveLength(2);
    expect(people.find((p) => p.self)).toMatchObject({ name: 'Moi' });
    expect(people.find((p) => !p.self)).toMatchObject({ name: 'Alice', color: 'success' });
  });

  it('ignores a peer without a published identity', () => {
    const local = createAwareness(createDoc({ clientId: 1 }));
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(local, { id: 'me', name: 'Moi', color: 'accent' });
    publishCursor(peer, { x: 1, y: 2 }); // no identity (no name)
    sync(peer, local);
    expect(readParticipants(local).map((p) => p.clientId)).toEqual([1]);
  });
});
