import { beforeEach, describe, expect, it } from 'vitest';
import { clearCreds, listSessionDocIds, loadCreds, saveCreds } from './session-creds.js';

// jsdom (vitest) does not expose `localStorage` here → minimal in-memory mock (the browser has it).
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

describe('session-creds — durable shared sessions', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('save → load round-trip', () => {
    expect(loadCreds('doc1')).toBeNull();
    saveCreds('doc1', { room: 'r1', secret: 's1' });
    expect(loadCreds('doc1')).toEqual({ room: 'r1', secret: 's1' });
  });

  it('clear forgets the session (the doc becomes local again)', () => {
    saveCreds('doc1', { room: 'r1', secret: 's1' });
    clearCreds('doc1');
    expect(loadCreds('doc1')).toBeNull();
  });

  it('listSessionDocIds returns all the shared docs', () => {
    saveCreds('doc1', { room: 'r1', secret: 's1' });
    saveCreds('doc2', { room: 'r2', secret: 's2' });
    expect(listSessionDocIds()).toEqual(new Set(['doc1', 'doc2']));
    clearCreds('doc1');
    expect(listSessionDocIds()).toEqual(new Set(['doc2']));
  });

  it('rejects a corrupted entry (broken JSON or missing fields)', () => {
    localStorage.setItem('memorii.whiteboard.session.bad', '{not json');
    localStorage.setItem(
      'memorii.whiteboard.session.empty',
      JSON.stringify({ room: '', secret: '' }),
    );
    expect(loadCreds('bad')).toBeNull();
    expect(loadCreds('empty')).toBeNull();
  });
});
