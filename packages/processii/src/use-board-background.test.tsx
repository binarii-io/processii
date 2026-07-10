import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import {
  BOARD_BACKGROUNDS,
  useBoardBackground,
  type UseBoardBackground,
} from './use-board-background.js';

function renderBackground(
  engine: Parameters<typeof useBoardBackground>[0],
  onChange?: () => void,
): () => UseBoardBackground {
  let latest!: UseBoardBackground;
  function Harness() {
    latest = useBoardBackground(engine, onChange);
    return null;
  }
  render(<Harness />);
  return () => latest;
}

describe('useBoardBackground', () => {
  it('reflects the theme default (null) initially and exposes the palette', () => {
    const engine = createEngine({ clientId: 1 });
    const bg = renderBackground(engine);
    expect(bg().current).toBeNull();
    expect(bg().palette).toBe(BOARD_BACKGROUNDS);
  });

  it('set(value) writes the shared background and calls onChange', () => {
    const engine = createEngine({ clientId: 1 });
    const onChange = vi.fn();
    const bg = renderBackground(engine, onChange);
    act(() => bg().set('#dbeafe'));
    expect(engine.getBackground()).toBe('#dbeafe');
    expect(bg().current).toBe('#dbeafe'); // hook re-read after the shared update
    expect(onChange).toHaveBeenCalled();
  });

  it('set(null) resets to the theme default', () => {
    const engine = createEngine({ clientId: 1 });
    const bg = renderBackground(engine);
    act(() => bg().set('#dbeafe'));
    expect(engine.getBackground()).toBe('#dbeafe');
    act(() => bg().set(null));
    expect(engine.getBackground()).toBeNull();
    expect(bg().current).toBeNull();
  });

  it('reflects an external change (peer/undo) via engine.board.observe', () => {
    const engine = createEngine({ clientId: 1 });
    const bg = renderBackground(engine);
    act(() => engine.setBackground('#dcfce7')); // changed elsewhere, not through the hook
    expect(bg().current).toBe('#dcfce7');
  });
});

describe('BOARD_BACKGROUNDS', () => {
  it('is a non-empty list of { value, label } options', () => {
    expect(BOARD_BACKGROUNDS.length).toBeGreaterThan(0);
    for (const opt of BOARD_BACKGROUNDS) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });
});
