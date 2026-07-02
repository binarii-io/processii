/**
 * Pluggable whiteboard adapters — **transport / persistence / identity**.
 *
 * The engine (`engine.ts`) is intentionally network- and storage-free. Adapters plug the
 * external capabilities **behind typed interfaces**, which makes the same engine reusable:
 * - **in-app**: server websocket transport + IndexedDB/server persistence (offline-first);
 * - **standalone**: y-webrtc P2P transport (host/guest star), local persistence;
 * - **tests**: in-memory adapters.
 *
 * Transport & persistence reuse the provider interfaces of the local CRDT module
 * (`./crdt/`, structurally identical to `crdt-core`'s — ADR 0006: the memorii providers
 * remain assignable). Identity is whiteboard-specific (who draws what, presence).
 */
import {
  isPersistenceProvider,
  isTransportProvider,
  type CrdtDoc,
  type PersistenceProvider,
  type PersistenceProviderFactory,
  type TransportProvider,
  type TransportProviderFactory,
} from './crdt/index.js';
import { z } from 'zod';
import type { WhiteboardEngine } from './engine.js';

/**
 * Local identity of a board participant (who edits, presence label/cursor). Distinct from the
 * auth identity (docs/02 "Identity ≠ Connections"): here it is just the edit attribution and
 * the collaborative presence, provided by the host app.
 */
export const participantSchema = z.object({
  /** Stable id of the participant in the session (clientID-friendly). */
  id: z.string().min(1),
  /** Displayed label (presence cursor). */
  name: z.string().min(1),
  /** Presence color: ui-kit token or free value. */
  color: z.string().min(1).default('accent'),
});
export type Participant = z.infer<typeof participantSchema>;

/** Identity adapter: provides the local participant. Implemented by the host app. */
export interface IdentityAdapter {
  /** Local participant (synchronous, already known after the app's auth). */
  getLocalParticipant(): Participant;
}

/** In-memory identity adapter (tests / standalone without auth). Validates the input. */
export function createMemoryIdentity(input: unknown): IdentityAdapter {
  const participant = participantSchema.parse(input);
  return { getLocalParticipant: () => participant };
}

/**
 * Adapter bundle of a board. Transport and persistence are optional: without them, the board
 * works **purely locally** (offline-first guaranteed by construction).
 */
export interface WhiteboardAdapters {
  readonly identity: IdentityAdapter;
  readonly transport?: TransportProviderFactory;
  readonly persistence?: PersistenceProviderFactory;
}

/** Active handles after connecting a board to its adapters. */
export interface WhiteboardSession {
  readonly identity: Participant;
  readonly transport?: TransportProvider;
  readonly persistence?: PersistenceProvider;
  /** Detaches transport & persistence (the local board survives). */
  disconnect(): void;
}

/**
 * Connects an engine to its adapters: instantiates the transport/persistence providers on the
 * board's Y.Doc (offline-first preserved — if none is provided, just the identity is returned).
 * Validates that the factories do produce conforming providers (boundary → typed errors).
 */
export function connectAdapters(
  engine: WhiteboardEngine,
  adapters: WhiteboardAdapters,
): WhiteboardSession {
  const doc: CrdtDoc = engine.board.doc;

  let transport: TransportProvider | undefined;
  if (adapters.transport) {
    const provider = adapters.transport(doc);
    if (!isTransportProvider(provider)) {
      throw new WhiteboardAdapterError('La factory transport ne produit pas un TransportProvider');
    }
    transport = provider;
  }

  let persistence: PersistenceProvider | undefined;
  if (adapters.persistence) {
    const provider = adapters.persistence(doc);
    if (!isPersistenceProvider(provider)) {
      throw new WhiteboardAdapterError(
        'La factory persistence ne produit pas un PersistenceProvider',
      );
    }
    persistence = provider;
  }

  return {
    identity: adapters.identity.getLocalParticipant(),
    ...(transport ? { transport } : {}),
    ...(persistence ? { persistence } : {}),
    disconnect(): void {
      transport?.destroy();
      persistence?.destroy();
    },
  };
}

/** Typed adapter configuration error. */
export class WhiteboardAdapterError extends Error {
  override readonly name = 'WhiteboardAdapterError';
}
