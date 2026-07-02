import type {
  CrdtAwareness,
  PersistenceProviderFactory,
  TransportProviderFactory,
} from '@binarii/processii';
import { createIndexeddbProvider } from './crdt/indexeddb-provider.js';
import { createWebrtcProvider, type IceServer } from './crdt/webrtc-provider.js';
import { readEnv, type StandaloneEnv } from './lib/env.js';
import { validateRoomName, validateRoomSecret } from './lib/signaling.js';

/**
 * Loads the ICE servers (STUN + **TURN**) from the `iceUrl` endpoint (our Worker), with an
 * in-memory cache and a **STUN fallback** when the endpoint is absent/unreachable → direct P2P
 * stays possible even without TURN. Preloaded at startup (see `createWiring`) to be ready for the 1st connection.
 */
function makeIceLoader(env: StandaloneEnv): () => readonly IceServer[] {
  const fallback: IceServer[] = env.stunUrls.map((urls) => ({ urls }));
  let cache: readonly IceServer[] = fallback;
  if (env.iceUrl && typeof fetch === 'function') {
    void fetch(env.iceUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const list = (j as { iceServers?: unknown })?.iceServers;
        if (Array.isArray(list) && list.length > 0) cache = list as IceServer[];
      })
      .catch(() => {
        /* unreachable → the STUN fallback is kept */
      });
  }
  return () => cache;
}

/**
 * Runtime wiring of the standalone site from the validated config (`docs/02`: seams = config).
 *
 * - **persistence**: always local (y-indexeddb) → offline-first; one store per document.
 * - **P2P transport**: optional, created **on demand** when the user opens/joins a session
 *   (host/guest). The y-webrtc provider is NEVER constructed at startup: the board is fully
 *   usable offline as long as no session is open.
 * - **demo mode** (E2E/preview): no network, no P2P transport offered.
 */
export interface StandaloneWiring {
  readonly demo: boolean;
  /** Builds a local persistence for a given document. */
  persistenceFactoryFor(documentId: string): PersistenceProviderFactory;
  /**
   * Builds a P2P transport for a session (room + secret). Validates room/secret at the boundary
   * (`SECURITY.md`). `awareness` (optional) is synchronized with the peers (presence cursors).
   * `undefined` in demo mode (no network).
   */
  transportFactoryFor(
    room: string,
    secret: string,
    awareness?: CrdtAwareness,
  ): TransportProviderFactory | undefined;
}

export function createWiring(env: StandaloneEnv = readEnv()): StandaloneWiring {
  // Preloads the ICE servers (STUN+TURN) at startup (except in demo: no network).
  const iceServers = env.demo ? () => env.stunUrls.map((urls) => ({ urls })) : makeIceLoader(env);
  return {
    demo: env.demo,
    persistenceFactoryFor(documentId: string): PersistenceProviderFactory {
      return (doc) => createIndexeddbProvider(`memorii.whiteboard.${documentId}`, doc);
    },
    transportFactoryFor(
      room: string,
      secret: string,
      awareness?: CrdtAwareness,
    ): TransportProviderFactory | undefined {
      if (env.demo) return undefined;
      // Trust boundary: an invalid room/secret is refused before touching the network.
      const safeRoom = validateRoomName(room);
      const safeSecret = validateRoomSecret(secret);
      return (doc) =>
        createWebrtcProvider(
          {
            room: safeRoom,
            secret: safeSecret,
            signalingUrls: env.signalingUrls,
            stunUrls: env.stunUrls,
            iceServers: iceServers(),
            ...(awareness ? { awareness } : {}),
          },
          doc,
        );
    },
  };
}
