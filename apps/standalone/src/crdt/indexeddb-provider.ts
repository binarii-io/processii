import { IndexeddbPersistence } from 'y-indexeddb';
import type { CrdtDoc, PersistenceProvider } from '@binarii/processii';
import type { Doc as YDoc } from 'yjs';

/**
 * The standalone site's **local persistence** provider: `y-indexeddb`. Makes the app
 * **offline-first**: the space and its documents are reloaded from IndexedDB **before (or
 * without) any connected peer** (`AGENTS.md`: "do not break offline-first"). Same pattern as
 * the memorii web app, conforming to the `PersistenceProvider` contract re-exported by
 * `@binarii/processii` (ADR 0006).
 *
 * The `key` isolates several documents in the same browser (one store per document).
 */
export function createIndexeddbProvider(key: string, doc: CrdtDoc): PersistenceProvider {
  const persistence = new IndexeddbPersistence(key, doc as unknown as YDoc);
  let loaded = false;
  const whenLoadedPromise = persistence.whenSynced.then(() => {
    loaded = true;
  });

  return {
    kind: 'persistence',
    doc,
    get loaded() {
      return loaded;
    },
    whenLoaded() {
      return whenLoadedPromise;
    },
    flush() {
      return persistence.whenSynced.then(() => undefined);
    },
    clear() {
      return persistence.clearData();
    },
    destroy() {
      return persistence.destroy();
    },
  };
}
