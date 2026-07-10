import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { BoardTypePicker, BOARD_TYPE_META } from './board-type-picker.js';
import { BOARD_TYPES } from './scene.js';

describe('BoardTypePicker', () => {
  it('shows the default board type (idéation) on the trigger', () => {
    const engine = createEngine({ clientId: 1 });
    render(<BoardTypePicker engine={engine} />);
    // The trigger is labelled by the current type; the default is idéation.
    expect(screen.getByRole('button', { name: 'Type de board : Idéation' })).toBeInTheDocument();
  });

  it('sets the scene-level board type when a type is picked', () => {
    const engine = createEngine({ clientId: 1 });
    render(<BoardTypePicker engine={engine} />);

    fireEvent.click(screen.getByRole('button', { name: 'Type de board : Idéation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Architecture' }));

    expect(engine.getBoardType()).toBe('architecture');
    // The trigger label reflects the new type (component tracks the engine).
    expect(
      screen.getByRole('button', { name: 'Type de board : Architecture' }),
    ).toBeInTheDocument();
  });

  it('reflects an external change (collab/undo) via board.observe', () => {
    const engine = createEngine({ clientId: 1 });
    render(<BoardTypePicker engine={engine} />);
    expect(screen.getByRole('button', { name: 'Type de board : Idéation' })).toBeInTheDocument();

    // A change made elsewhere on the same board (as a peer or undo would) is picked up.
    act(() => {
      engine.setBoardType('process');
    });
    expect(screen.getByRole('button', { name: 'Type de board : Process' })).toBeInTheDocument();
  });
});

describe('BOARD_TYPE_META (headless export)', () => {
  it('carries a label and an icon component for every board type', () => {
    for (const type of BOARD_TYPES) {
      const meta = BOARD_TYPE_META[type];
      expect(typeof meta.label).toBe('string');
      expect(meta.label.length).toBeGreaterThan(0);
      // Lucide icons are `forwardRef` components (a renderable object), not plain functions.
      expect(meta.icon).toBeDefined();
      expect(['function', 'object']).toContain(typeof meta.icon);
    }
  });
});
