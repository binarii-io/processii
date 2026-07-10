import { useCallback, useEffect, useReducer } from 'react';
import type { WhiteboardEngine } from './engine.js';

/** A single board-background choice: the CSS color `value` + its product `label` (French). */
export interface BoardBackgroundOption {
  readonly value: string;
  readonly label: string;
}

/**
 * **Board background** palette (CSS literals) — the soft-tone swatches the styled default
 * background picker offers. Exported so a host rendering its **own** background chrome reuses the
 * exact same list instead of redeclaring it. `null` (not in this list) means "theme default"
 * (see {@link useBoardBackground}'s `set(null)`).
 */
export const BOARD_BACKGROUNDS: readonly BoardBackgroundOption[] = [
  { value: '#ffffff', label: 'Blanc' },
  { value: '#f4f4f5', label: 'Gris clair' },
  { value: '#fef9c3', label: 'Jaune' },
  { value: '#dcfce7', label: 'Vert' },
  { value: '#dbeafe', label: 'Bleu' },
  { value: '#fae8ff', label: 'Violet' },
  { value: '#ffe4e6', label: 'Rose' },
  { value: '#fff7ed', label: 'Crème' },
  { value: '#e7e5e4', label: 'Pierre' },
  { value: '#334155', label: 'Ardoise' },
  { value: '#0c0c0e', label: 'Noir' },
];

/** Return shape of {@link useBoardBackground}. */
export interface UseBoardBackground {
  /** Current board background (`null` = theme default). Shared in collab via the engine meta map. */
  readonly current: string | null;
  /** Set the board background; `null` (or empty string) resets to the theme default. */
  readonly set: (value: string | null) => void;
  /** The soft-tone palette (same reference as {@link BOARD_BACKGROUNDS}) to render swatches. */
  readonly palette: readonly BoardBackgroundOption[];
}

/**
 * **Headless board-background** hook — exposes the shared board background (read + write) and the
 * palette, so a host renders its **own** background picker without forking the engine wiring or the
 * palette. The styled default background picker (inside {@link Toolbar}) consumes this same hook.
 *
 * The background is a **shared** value (`engine.get/setBackground`, meta map), so the hook tracks it
 * via `engine.board.observe` and reflects external changes (a peer, undo/redo). `set(null)` — or an
 * empty string — resets to the theme default.
 */
export function useBoardBackground(
  engine: WhiteboardEngine,
  onChange?: () => void,
): UseBoardBackground {
  // Reflect the shared value: re-read on any board update (collab, undo/redo, local set).
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => engine.board.observe(forceUpdate), [engine]);

  const set = useCallback(
    (value: string | null): void => {
      engine.setBackground(value);
      onChange?.();
    },
    [engine, onChange],
  );

  return { current: engine.getBackground(), set, palette: BOARD_BACKGROUNDS };
}
