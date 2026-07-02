import { beforeEach, describe, expect, it } from 'vitest';
import { loadInstructions, saveInstructions } from './instructions.js';

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

describe('instructions (pre-prompt)', () => {
  beforeEach(() => installMemoryStorage());

  it('empty by default', () => {
    expect(loadInstructions()).toBe('');
  });

  it('persists and re-reads (trimmed)', () => {
    saveInstructions('  Nomme les étapes à l’infinitif.  ');
    expect(loadInstructions()).toBe('Nomme les étapes à l’infinitif.');
  });

  it('an empty value clears', () => {
    saveInstructions('quelque chose');
    saveInstructions('   ');
    expect(loadInstructions()).toBe('');
  });
});
