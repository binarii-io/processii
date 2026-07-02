import { beforeEach, describe, expect, it } from 'vitest';
import { PRESENCE_COLORS, loadIdentity, sanitizeName, saveDisplayName } from './identity.js';

// jsdom (vitest) does not expose `localStorage` here → minimal in-memory mock (the browser has it).
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const mock: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
}

describe('identity — persisted local presence', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  describe('sanitizeName', () => {
    it('strips the control characters but keeps spaces and dashes', () => {
      expect(sanitizeName('Jean\u0000 Pi\u001ferre-2')).toBe('Jean Pierre-2');
    });

    it('bounds the length to 40 characters', () => {
      expect(sanitizeName('a'.repeat(100))).toHaveLength(40);
    });

    it('trims the surrounding spaces', () => {
      expect(sanitizeName('  Alice  ')).toBe('Alice');
    });

    it('generates an auto guest name when the input is empty', () => {
      expect(sanitizeName('   ')).toMatch(/^Invité-\d{4}$/);
    });
  });

  describe('loadIdentity', () => {
    it('generates then persists an auto guest name and a valid color on the first call', () => {
      const id = loadIdentity();
      expect(id.name).toMatch(/^Invité-\d{4}$/);
      expect(PRESENCE_COLORS).toContain(id.color);
      expect(id.id).toBeTruthy();
    });

    it('reuses the persisted name and color on subsequent calls', () => {
      const first = loadIdentity();
      const second = loadIdentity();
      expect(second.name).toBe(first.name);
      expect(second.color).toBe(first.color);
    });

    it('re-reads a name saved by saveDisplayName', () => {
      saveDisplayName('Alice');
      expect(loadIdentity().name).toBe('Alice');
    });

    it('ignores an invalid persisted color and regenerates a valid one', () => {
      localStorage.setItem('memorii.whiteboard.color', 'chartreuse');
      expect(PRESENCE_COLORS).toContain(loadIdentity().color);
    });
  });
});
