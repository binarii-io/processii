import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  clampPanelWidth,
  loadPanelWidth,
  savePanelWidth,
} from './panel-width.js';

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

describe('panel-width', () => {
  beforeEach(() => installMemoryStorage());

  it('clamps within [MIN, MAX]', () => {
    expect(clampPanelWidth(10)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(99999)).toBe(MAX_PANEL_WIDTH);
    expect(clampPanelWidth(400)).toBe(400);
    expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('default when nothing is remembered', () => {
    expect(loadPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('save → load (clamped)', () => {
    savePanelWidth(420);
    expect(loadPanelWidth()).toBe(420);
    savePanelWidth(5000);
    expect(loadPanelWidth()).toBe(MAX_PANEL_WIDTH);
  });

  it('corrupted value → default', () => {
    localStorage.setItem('memorii.whiteboard.ai.width', 'abc');
    expect(loadPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });
});
