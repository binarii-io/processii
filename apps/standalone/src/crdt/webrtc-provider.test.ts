import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrdtAwareness, CrdtDoc, ConnectionStatus } from '@binarii/processii';

/**
 * Unit tests of the **real** P2P transport (`createWebrtcProvider`) — exported by `src/index.ts`
 * and reused by #17 (vscode-ext). `y-webrtc` is fully mocked: **no real network WebRTC**, only
 * the wiring and the mapping to the `@binarii/processii` `TransportProvider`/`ConnectionStatus`
 * contract are verified. These tests must fail when the mapping regresses.
 */

type StatusHandler = (e: { connected: boolean }) => void;
type SyncedHandler = (e: { synced: boolean }) => void;
type Handler = StatusHandler | SyncedHandler;

/** Mockable double of `y-webrtc`: captures the construction args and drives the events by hand. */
class FakeWebrtcProvider {
  static lastInstance: FakeWebrtcProvider | undefined;
  static instances: FakeWebrtcProvider[] = [];

  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  destroyCalls = 0;

  private readonly on_: Map<string, Set<Handler>> = new Map();
  private readonly once_: Map<string, Set<Handler>> = new Map();

  constructor(
    readonly roomName: string,
    readonly doc: unknown,
    readonly opts: {
      signaling?: string[];
      password?: string;
      awareness?: unknown;
      peerOpts?: { config?: { iceServers?: { urls: string }[] } };
    },
  ) {
    FakeWebrtcProvider.lastInstance = this;
    FakeWebrtcProvider.instances.push(this);
  }

  on(event: string, handler: Handler): void {
    if (!this.on_.has(event)) this.on_.set(event, new Set());
    this.on_.get(event)!.add(handler);
  }

  once(event: string, handler: Handler): void {
    if (!this.once_.has(event)) this.once_.set(event, new Set());
    this.once_.get(event)!.add(handler);
  }

  /** Simulates a y-webrtc event (fires the persistent `on` listeners + the ephemeral `once` ones). */
  emit(event: string, payload: { connected: boolean } | { synced: boolean }): void {
    for (const h of this.on_.get(event) ?? []) (h as (p: typeof payload) => void)(payload);
    const once = this.once_.get(event);
    if (once) {
      for (const h of once) (h as (p: typeof payload) => void)(payload);
      once.clear();
    }
  }

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

vi.mock('y-webrtc', () => ({
  WebrtcProvider: vi
    .fn()
    .mockImplementation(
      (roomName: string, doc: unknown, opts: ConstructorParameters<typeof FakeWebrtcProvider>[2]) =>
        new FakeWebrtcProvider(roomName, doc, opts),
    ),
}));

// Imported after the mock so `y-webrtc` is already replaced.
const { createWebrtcProvider } = await import('./webrtc-provider.js');

/** Fake `CrdtDoc`/`CrdtAwareness`: the provider only passes them to (mocked) `y-webrtc`. */
const fakeDoc = { __doc: true } as unknown as CrdtDoc;
const fakeAwareness = { __awareness: true } as unknown as CrdtAwareness;

const baseConfig = {
  room: 'room-1',
  secret: 's3cret',
  signalingUrls: ['wss://signaling.example'],
  stunUrls: ['stun:stun.example:19302'],
} as const;

function lastProvider(): FakeWebrtcProvider {
  const inst = FakeWebrtcProvider.lastInstance;
  if (!inst) throw new Error('aucune instance y-webrtc construite');
  return inst;
}

beforeEach(() => {
  FakeWebrtcProvider.lastInstance = undefined;
  FakeWebrtcProvider.instances = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createWebrtcProvider — construction & y-webrtc wiring', () => {
  it('passes room, doc, signaling and secret (password) to y-webrtc', () => {
    createWebrtcProvider(baseConfig, fakeDoc);
    const p = lastProvider();
    expect(p.roomName).toBe('room-1');
    expect(p.doc).toBe(fakeDoc);
    expect(p.opts.signaling).toEqual(['wss://signaling.example']);
    expect(p.opts.password).toBe('s3cret');
  });

  it('maps stunUrls → iceServers (peerOpts.config), no TURN', () => {
    createWebrtcProvider(
      { ...baseConfig, stunUrls: ['stun:a.example:1', 'stun:b.example:2'] },
      fakeDoc,
    );
    expect(lastProvider().opts.peerOpts?.config?.iceServers).toEqual([
      { urls: 'stun:a.example:1' },
      { urls: 'stun:b.example:2' },
    ]);
  });

  it('wires the awareness when provided', () => {
    createWebrtcProvider({ ...baseConfig, awareness: fakeAwareness }, fakeDoc);
    expect(lastProvider().opts.awareness).toBe(fakeAwareness);
  });

  it('exposes the awareness on the TransportProvider when provided', () => {
    const t = createWebrtcProvider({ ...baseConfig, awareness: fakeAwareness }, fakeDoc);
    expect(t.awareness).toBe(fakeAwareness);
  });

  it('neither exposes nor wires an awareness when absent', () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    expect(lastProvider().opts.awareness).toBeUndefined();
    expect(t.awareness).toBeUndefined();
  });

  it('conforms to the TransportProvider contract shape', () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    expect(t.kind).toBe('transport');
    expect(t.doc).toBe(fakeDoc);
    expect(typeof t.connect).toBe('function');
    expect(typeof t.disconnect).toBe('function');
    expect(typeof t.onStatusChange).toBe('function');
    expect(typeof t.destroy).toBe('function');
  });
});

describe('createWebrtcProvider — connected state → ConnectionStatus mapping', () => {
  it("starts at 'disconnected' (not connected yet)", () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    expect(t.status).toBe('disconnected');
  });

  it("event status connected:true → 'connected'", () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    lastProvider().emit('status', { connected: true });
    expect(t.status).toBe('connected');
  });

  it("status event connected:false → 'disconnected' (the contract has no 'failed')", () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    lastProvider().emit('status', { connected: true });
    expect(t.status).toBe('connected');
    lastProvider().emit('status', { connected: false });
    expect(t.status).toBe('disconnected');
  });

  it('notifies the onStatusChange listeners on every change', () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const seen: ConnectionStatus[] = [];
    t.onStatusChange((s) => seen.push(s));
    lastProvider().emit('status', { connected: true });
    lastProvider().emit('status', { connected: false });
    expect(seen).toEqual(['connected', 'disconnected']);
  });

  it('an unsubscribed listener no longer receives changes', () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const seen: ConnectionStatus[] = [];
    const off = t.onStatusChange((s) => seen.push(s));
    off();
    lastProvider().emit('status', { connected: true });
    expect(seen).toEqual([]);
  });
});

describe('createWebrtcProvider — connect()', () => {
  it("calls provider.connect() and moves to 'connecting' (notified)", () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const seen: ConnectionStatus[] = [];
    t.onStatusChange((s) => seen.push(s));
    void t.connect();
    expect(lastProvider().connectCalls).toBe(1);
    expect(t.status).toBe('connecting');
    expect(seen).toEqual(['connecting']);
  });

  it('resolves the promise on the synced event (initial sync negotiated)', async () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const promise = t.connect();
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    lastProvider().emit('synced', { synced: true });
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves the promise on a status change (alone-in-the-room case)', async () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const promise = t.connect();
    lastProvider().emit('status', { connected: true });
    await expect(promise).resolves.toBeUndefined();
  });

  it('does not resolve twice when both synced then status arrive', async () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const promise = t.connect();
    const p = lastProvider();
    p.emit('synced', { synced: true });
    p.emit('status', { connected: true });
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('createWebrtcProvider — disconnect() & destroy()', () => {
  it("disconnect() calls provider.disconnect() and goes back to 'disconnected' (notified)", () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    lastProvider().emit('status', { connected: true });
    const seen: ConnectionStatus[] = [];
    t.onStatusChange((s) => seen.push(s));
    t.disconnect();
    expect(lastProvider().disconnectCalls).toBe(1);
    expect(t.status).toBe('disconnected');
    expect(seen).toEqual(['disconnected']);
  });

  it('destroy() destroys the underlying provider and cuts the listeners', () => {
    const t = createWebrtcProvider(baseConfig, fakeDoc);
    const seen: ConnectionStatus[] = [];
    t.onStatusChange((s) => seen.push(s));
    t.destroy();
    expect(lastProvider().destroyCalls).toBe(1);
    // After destroy, no application listener must be notified anymore.
    lastProvider().emit('status', { connected: true });
    expect(seen).toEqual([]);
  });
});
