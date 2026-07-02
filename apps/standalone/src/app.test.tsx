import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrdtDoc, PersistenceProvider, TransportProvider } from '@binarii/processii';
import { App } from './app.js';
import { createWiring, type StandaloneWiring } from './bootstrap.js';
import { saveCreds } from './lib/session-creds.js';

const participant = { id: 'p1', name: 'Vous', color: 'accent' };

/** Demo-mode wiring: no persistence, no transport → 100% offline mount (no network). */
function demoWiring() {
  return createWiring({
    signalingUrls: ['wss://x.example'],
    stunUrls: ['stun:x:1'],
    iceUrl: '',
    demo: true,
  });
}

// — Fake providers (contracts re-exported by `@binarii/processii`) to test session wiring without a network. —
function fakeTransport(doc: CrdtDoc): TransportProvider {
  return {
    doc,
    kind: 'transport',
    status: 'connected',
    connect: () => Promise.resolve(),
    disconnect: () => {},
    destroy: () => {},
    onStatusChange: () => () => {},
  };
}
function fakePersistence(doc: CrdtDoc): PersistenceProvider {
  return {
    doc,
    kind: 'persistence',
    loaded: true,
    whenLoaded: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    destroy: () => {},
  };
}

// jsdom (vitest) does not expose `localStorage` → in-memory mock (see ai-chat-panel.test). Reinstalled
// **fresh before each test** (isolation) + URL fragment reset (the tests below seed a
// persisted space and an invite link).
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const mock: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key' | 'length'> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
}

beforeEach(() => {
  installMemoryStorage();
  window.location.hash = '';
});

describe('App — site standalone (offline-first)', () => {
  it('mounts without network and offers to create a document', () => {
    render(<App wiring={demoWiring()} participant={participant} />);
    expect(screen.getByRole('heading', { name: /Memorii Whiteboard/i })).toBeInTheDocument();
    expect(screen.getByText('Aucun document ouvert.')).toBeInTheDocument();
  });

  it('creates a document and shows the drawing surface + the toolbar', async () => {
    const user = userEvent.setup();
    render(<App wiring={demoWiring()} participant={participant} />);

    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'Créer un whiteboard' }),
    );

    expect(screen.getByLabelText('Surface de dessin du whiteboard')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /Outils de dessin/i })).toBeInTheDocument();
  });

  it('edits locally: adding a shape requires no peer', async () => {
    const user = userEvent.setup();
    render(<App wiring={demoWiring()} participant={participant} />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'Créer un whiteboard' }),
    );

    const toolbar = screen.getByRole('toolbar', { name: /Outils de dessin/i });
    // No error, no network required: the addition is purely local.
    await user.click(within(toolbar).getByRole('button', { name: 'Rectangle' }));
    await user.click(within(toolbar).getByRole('button', { name: 'Ellipse' }));

    // The surface stays mounted (the local rendering succeeded).
    expect(screen.getByLabelText('Surface de dessin du whiteboard')).toBeInTheDocument();
  });

  it('joins a room via the URL fragment without reloading (hashchange)', async () => {
    window.location.hash = '';
    render(<App wiring={demoWiring()} participant={participant} />);
    expect(screen.getByText('Aucun document ouvert.')).toBeInTheDocument();

    // Pasting the invite link into an already-open tab only changes the fragment (no reload).
    window.location.hash = '#room=salle&secret=clef';
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });

    // A dedicated document is created and the surface shows, without a manual reload.
    expect(await screen.findByLabelText('Surface de dessin du whiteboard')).toBeInTheDocument();
  });

  it('P2P is disabled in demo mode (no real network)', async () => {
    const user = userEvent.setup();
    render(<App wiring={demoWiring()} participant={participant} />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'Créer un whiteboard' }),
    );
    // "Partager" opens the overlay: in demo mode, the toggle is disabled and P2P announced unavailable.
    await user.click(screen.getByRole('button', { name: 'Partager le board' }));

    expect(screen.getByRole('switch', { name: 'Se mettre en ligne' })).toBeDisabled();
    expect(screen.getByText(/P2P indisponible/i)).toBeInTheDocument();
  });

  it('invite link: 1st click joins the RIGHT room even when a shared doc is already active on mount', async () => {
    // Regression: a D0 doc already shared (creds room "old"), restored as the ACTIVE doc on
    // mount, armed a pendingJoin colliding with the doc created by the link → the 1st opening
    // joined the wrong room (or none), hence "you must click twice". We verify the LINK's room
    // is indeed joined from the 1st load.
    localStorage.setItem(
      'memorii.whiteboard.space',
      JSON.stringify([{ id: 'd0', name: 'Ancien' }]), // 1st entry = active doc on mount
    );
    saveCreds('d0', { room: 'old-room', secret: 'old-secret' });
    window.location.hash = '#room=link-room&secret=link-secret'; // link present from load time

    const joinedRooms: string[] = [];
    const wiring: StandaloneWiring = {
      demo: false,
      persistenceFactoryFor: () => (doc) => fakePersistence(doc),
      // Records the room **actually** wired (the factory is called by session.join).
      transportFactoryFor: (room) => (doc) => {
        joinedRooms.push(room);
        return fakeTransport(doc);
      },
    };

    render(<App wiring={wiring} participant={participant} />);

    // The transport must join the LINK's room from the 1st mount (and end up on it).
    await waitFor(() => expect(joinedRooms).toContain('link-room'));
    expect(joinedRooms.at(-1)).toBe('link-room');
  });
});
