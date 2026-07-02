import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConnectionStatus,
  TransportProvider,
  TransportProviderFactory,
} from '@binarii/processii';
import type { MountedDocument } from './space.js';

/**
 * Manages a **P2P session** wired on the fly onto the active document. The board is already
 * mounted locally (offline-first); here a y-webrtc transport is attached/detached **without
 * unmounting the engine**.
 *
 * The transport operates directly on the engine's Y.Doc (`engine.board.doc`) — updates received
 * from peers converge into the board and trigger the re-render via `engine.observe` (board-canvas).
 */
export interface SessionApi {
  readonly status: ConnectionStatus | 'offline';
  join(transportFactory: TransportProviderFactory): void;
  leave(): void;
}

export function useSession(active: MountedDocument | null): SessionApi {
  const [status, setStatus] = useState<ConnectionStatus | 'offline'>('offline');
  const transportRef = useRef<TransportProvider | null>(null);

  const leave = useCallback(() => {
    transportRef.current?.destroy();
    transportRef.current = null;
    setStatus('offline');
  }, []);

  // Leaves the session when the active document changes or disappears (avoids a transport leak).
  useEffect(() => leave, [active, leave]);

  const join = useCallback(
    (transportFactory: TransportProviderFactory) => {
      if (!active) return;
      transportRef.current?.destroy();
      const transport = transportFactory(active.engine.board.doc);
      transportRef.current = transport;
      setStatus(transport.status);
      transport.onStatusChange(setStatus);
      void transport.connect();
    },
    [active],
  );

  return { status, join, leave };
}
