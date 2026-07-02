import { beforeEach, describe, expect, it } from 'vitest';
import { clearApiKey, loadApiKey, saveApiKey } from './api-key.js';

// jsdom (vitest) does not expose `localStorage` here → minimal in-memory mock (see session-creds.test).
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

describe('api-key', () => {
  beforeEach(() => installMemoryStorage());

  it('returns null when there is no key', () => {
    expect(loadApiKey()).toBeNull();
  });

  it('persists and re-reads a key (trimmed)', () => {
    saveApiKey('  sk-test  ');
    expect(loadApiKey()).toBe('sk-test');
  });

  it('an empty string clears the key', () => {
    saveApiKey('sk-test');
    saveApiKey('   ');
    expect(loadApiKey()).toBeNull();
  });

  it('clearApiKey efface', () => {
    saveApiKey('sk-test');
    clearApiKey();
    expect(loadApiKey()).toBeNull();
  });
});
