/**
 * **Fake transport conforming to the `TransportProvider` contract** — P2P collaboration
 * testable **without real WebRTC or network** (rule: NO real WebRTC in tests).
 *
 * A `FakeNetwork` plays the role of the P2P mesh: each attached provider relays its Yjs updates
 * (`update` event) to all the other docs of the **same room** and applies theirs. That is
 * exactly the expected semantics of a transport (convergent Yjs update sync), pluggable via
 * `connectAdapters`/`useSession` in place of y-webrtc.
 */
import { applyUpdate, encodeStateAsUpdate } from '@binarii/processii';
import type {
  ConnectionStatus,
  CrdtDoc,
  TransportProvider,
  TransportProviderFactory,
} from '@binarii/processii';

const ORIGIN = Symbol('fake-transport');

interface Member {
  readonly doc: CrdtDoc;
  readonly onUpdate: (update: Uint8Array, origin: unknown) => void;
}

export class FakeNetwork {
  private readonly rooms = new Map<string, Set<Member>>();

  /** Transport factory for a given room (to pass to `connectAdapters`/`useSession`). */
  factory(room: string): TransportProviderFactory {
    return (doc: CrdtDoc): TransportProvider => this.attach(room, doc);
  }

  private attach(room: string, doc: CrdtDoc): TransportProvider {
    const members = this.rooms.get(room) ?? new Set<Member>();
    this.rooms.set(room, members);

    const statusListeners = new Set<(s: ConnectionStatus) => void>();
    let status: ConnectionStatus = 'disconnected';

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === ORIGIN) return; // avoids echo loops
      for (const member of members) {
        if (member.doc !== doc) member.onUpdate(update, ORIGIN);
      }
    };
    const member: Member = {
      doc,
      onUpdate: (update, origin) => applyUpdate(doc, update, origin),
    };

    return {
      kind: 'transport',
      doc,
      get status() {
        return status;
      },
      connect() {
        members.add(member);
        doc.on('update', onUpdate);
        // Initial sync: exchanges the full state with the peers already present.
        for (const other of members) {
          if (other.doc !== doc) {
            member.onUpdate(encodeStateAsUpdate(other.doc), ORIGIN);
            other.onUpdate(encodeStateAsUpdate(doc), ORIGIN);
          }
        }
        status = 'connected';
        for (const l of statusListeners) l(status);
        return Promise.resolve();
      },
      disconnect() {
        members.delete(member);
        doc.off('update', onUpdate);
        status = 'disconnected';
        for (const l of statusListeners) l(status);
      },
      onStatusChange(handler) {
        statusListeners.add(handler);
        return () => statusListeners.delete(handler);
      },
      destroy() {
        members.delete(member);
        doc.off('update', onUpdate);
        statusListeners.clear();
      },
    };
  }
}
