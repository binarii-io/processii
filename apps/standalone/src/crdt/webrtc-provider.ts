import { WebrtcProvider } from 'y-webrtc';
import type {
  ConnectionStatus,
  CrdtAwareness,
  CrdtDoc,
  TransportProvider,
} from '@binarii/processii';
import type { Doc as YDoc } from 'yjs';

/**
 * The standalone site's **P2P transport** provider: `y-webrtc`. Peers meet through a public
 * **signaling** server (rendezvous) then exchange their Yjs updates **directly** over WebRTC
 * (host/guest star, `docs/01`). The network is wired **here**, never in the
 * `@binarii/processii` engine (which stays DOM-free and testable offline).
 *
 * Conforms to the `@binarii/processii` `TransportProvider` contract (`kind`, `doc`, `status`,
 * `connect`, `disconnect`, `onStatusChange`, `destroy`). Security (`SECURITY.md`):
 *  - `roomName`/`secret` are **validated upstream** (`lib/signaling`) before reaching here;
 *  - `secret` → y-webrtc `password`: encrypts the traffic **end-to-end**, so the public
 *    signaling server never sees the board content;
 *  - **no TURN in V1**: only **STUN** servers are provided. When the ICE negotiation fails
 *    (symmetric NAT), the status stays `disconnected` (the `ConnectionStatus` contract only has
 *    `disconnected | connecting | connected`, no `failed`) — the local board keeps working.
 */
export interface WebrtcProviderConfig {
  /** Room name (validated). Identifies the collaboration session. */
  readonly room: string;
  /** Shared secret (validated) → end-to-end encryption key of the room. */
  readonly secret: string;
  /** Signaling server URLs (ws/wss). */
  readonly signalingUrls: readonly string[];
  /** STUN URLs (direct NAT traversal). Fallback when `iceServers` is not provided. */
  readonly stunUrls: readonly string[];
  /**
   * Full ICE servers (STUN **+ TURN** with credentials), e.g. obtained from the `/ice` endpoint.
   * Takes precedence over `stunUrls`. TURN relays the encrypted traffic when direct P2P fails (NAT).
   */
  readonly iceServers?: readonly IceServer[];
  /** Shared awareness (presence) of the document, when the app manages one. */
  readonly awareness?: CrdtAwareness;
}

/** ICE server (STUN or TURN). `username`/`credential` required for TURN. */
export interface IceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export function createWebrtcProvider(
  config: WebrtcProviderConfig,
  doc: CrdtDoc,
): TransportProvider {
  const provider = new WebrtcProvider(config.room, doc as unknown as YDoc, {
    signaling: [...config.signalingUrls],
    password: config.secret,
    ...(config.awareness ? { awareness: config.awareness as CrdtAwareness } : {}),
    peerOpts: {
      config: {
        // TURN+STUN provided explicitly (NAT relay) otherwise STUN only.
        iceServers:
          config.iceServers && config.iceServers.length > 0
            ? config.iceServers.map((s) => ({
                urls: Array.isArray(s.urls) ? [...s.urls] : s.urls,
                ...(s.username !== undefined ? { username: s.username } : {}),
                ...(s.credential !== undefined ? { credential: s.credential } : {}),
              }))
            : config.stunUrls.map((urls) => ({ urls })),
      },
    },
  });

  // y-webrtc starts looking for peers as soon as it is constructed. Offline-first is respected
  // by constructing this provider ONLY when the user opens/joins a session (see `bootstrap`).
  function deriveStatus(connected: boolean): ConnectionStatus {
    return connected ? 'connected' : 'disconnected';
  }

  let status: ConnectionStatus = deriveStatus(provider.connected);
  const statusListeners = new Set<(s: ConnectionStatus) => void>();

  provider.on('status', ({ connected }: { connected: boolean }) => {
    status = deriveStatus(connected);
    for (const listener of statusListeners) listener(status);
  });

  // Network diagnostics (console): signaling reached, **direct P2P peers** (WebRTC) vs
  // **same-machine** (BroadcastChannel), and initial sync. Decisive: when "direct WebRTC" stays
  // at 0 between two networks, the **direct link is not established** (NAT) — not a sync bug.
  const tag = `[p2p ${config.room}]`;
  provider.on('status', ({ connected }: { connected: boolean }) =>
    console.info(`${tag} signaling ${connected ? 'connecté' : 'déconnecté'}`),
  );
  provider.on('peers', (e: { webrtcPeers?: unknown[]; bcPeers?: unknown[] }) =>
    console.info(
      `${tag} pairs — WebRTC direct: ${e.webrtcPeers?.length ?? 0} · même-machine(BC): ${e.bcPeers?.length ?? 0}`,
    ),
  );
  provider.on('synced', () => console.info(`${tag} sync initiale OK`));

  // Connection type per peer: **DIRECT (P2P)** or **RELAY (TURN)**. Read from the WebRTC stats
  // (the selected ICE candidate pair; `candidateType === 'relay'` = goes through TURN). Inspected
  // shortly after each peer change (letting the ICE negotiation settle).
  type StatsPc = { getStats(): Promise<RTCStatsReport> };
  type WebrtcConn = { peer?: { _pc?: StatsPc } };
  type RoomLike = { webrtcConns?: Map<string, WebrtcConn> };
  const logConnectionTypes = async (): Promise<void> => {
    const room = (provider as unknown as { room?: RoomLike }).room;
    if (!room?.webrtcConns) return;
    for (const [peerId, conn] of room.webrtcConns) {
      const pc = conn.peer?._pc;
      if (!pc?.getStats) continue;
      try {
        const stats = await pc.getStats();
        let pair: RTCIceCandidatePairStats | undefined;
        stats.forEach((r) => {
          if (
            r.type === 'candidate-pair' &&
            (r as RTCIceCandidatePairStats).state === 'succeeded'
          ) {
            const p = r as RTCIceCandidatePairStats;
            if (!pair || p.nominated) pair = p;
          }
        });
        if (!pair) continue;
        const candType = (id: string | undefined): string | undefined =>
          (stats.get(id ?? '') as { candidateType?: string } | undefined)?.candidateType;
        const types = [candType(pair.localCandidateId), candType(pair.remoteCandidateId)];
        const relayed = types.includes('relay');
        console.info(
          `${tag} pair ${peerId.slice(0, 6)} : ${relayed ? 'RELAIS (TURN)' : 'DIRECTE (P2P)'} [${types.join('/')}]`,
        );
      } catch {
        /* stats unavailable: ignored */
      }
    }
  };
  provider.on('peers', () => setTimeout(() => void logConnectionTypes(), 1500));

  return {
    kind: 'transport',
    doc,
    ...(config.awareness ? { awareness: config.awareness } : {}),
    get status() {
      return status;
    },
    connect() {
      provider.connect();
      status = 'connecting';
      for (const listener of statusListeners) listener(status);
      // Resolves when the initial P2P sync is negotiated (y-webrtc emits `synced: true`). In P2P
      // we never know whether a peer exists: it also resolves on the first `status connected` so
      // the wait does not block indefinitely when alone in the room.
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        provider.once('synced', finish);
        provider.once('status', finish);
      });
    },
    disconnect() {
      provider.disconnect();
      status = 'disconnected';
      for (const listener of statusListeners) listener(status);
    },
    onStatusChange(handler: (s: ConnectionStatus) => void): () => void {
      statusListeners.add(handler);
      return () => statusListeners.delete(handler);
    },
    destroy() {
      statusListeners.clear();
      provider.destroy();
    },
  };
}
