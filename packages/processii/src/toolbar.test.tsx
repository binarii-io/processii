import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import { Toolbar } from './toolbar.js';

describe('Toolbar — shapes + undo/redo', () => {
  it('adds a shape then undoes it via "Annuler"', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole } = render(<Toolbar engine={engine} />);

    fireEvent.click(getByRole('button', { name: 'Rectangle' }));
    expect(engine.board.size).toBe(1);

    fireEvent.click(getByRole('button', { name: 'Annuler' }));
    expect(engine.board.size).toBe(0);

    fireEvent.click(getByRole('button', { name: 'Rétablir' }));
    expect(engine.board.size).toBe(1);
  });

  it('"Annuler" is disabled when there is nothing to undo', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole } = render(<Toolbar engine={engine} />);
    expect(getByRole('button', { name: 'Annuler' })).toBeDisabled();
  });

  it('"Supprimer" is disabled without a selection, enabled as soon as an element is selected', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole, rerender } = render(<Toolbar engine={engine} selectionCount={0} />);
    expect(getByRole('button', { name: 'Supprimer' })).toBeDisabled();

    // Engine mutation → the Toolbar (history observer) updates its state: wrap in act().
    act(() => {
      engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 });
    });
    rerender(<Toolbar engine={engine} selectionCount={1} />);
    const del = getByRole('button', { name: 'Supprimer' });
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    expect(engine.board.size).toBe(0);
  });

  it('"Connecteur" is enabled with 2 selected elements and creates a bound arrow', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.select(['a', 'b']);
    const { getByRole } = render(<Toolbar engine={engine} selectionCount={2} />);
    const connect = getByRole('button', { name: 'Connecteur' });
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);
    const arrow = engine.listElements().find((e) => e.kind === 'arrow');
    expect(arrow).toMatchObject({ start: 'a', end: 'b' });
  });

  it('"Connecteur" is disabled outside a 2-element selection', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole } = render(<Toolbar engine={engine} selectionCount={1} />);
    expect(getByRole('button', { name: 'Connecteur' })).toBeDisabled();
  });

  it('"Connecteur", while disabled, explains that exactly 2 elements are required', async () => {
    const engine = createEngine({ clientId: 1 });
    render(<Toolbar engine={engine} selectionCount={1} />);

    const connect = screen.getByRole('button', { name: 'Connecteur' });
    expect(connect).toBeDisabled();

    // A disabled <button> emits no pointer/focus events, so the hint has to be
    // reachable through the focusable span wrapper ToolButton adds around it.
    fireEvent.focus(connect.parentElement as HTMLElement);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/exactement 2 éléments/i);
  });

  it('an enabled tool button carries its tooltip description on the button itself (a11y)', async () => {
    const engine = createEngine({ clientId: 1 });
    render(<Toolbar engine={engine} />);

    // Enabled buttons are their own tooltip trigger (no span wrapper), so the
    // Radix `aria-describedby` lands on the focused button — screen readers
    // announce the caption. Guards against regressing to a span-only trigger.
    const rect = screen.getByRole('button', { name: 'Rectangle' });
    fireEvent.focus(rect);
    const tip = await screen.findByRole('tooltip');
    expect(rect).toHaveAttribute('aria-describedby', tip.id);
  });
});

describe('Toolbar — process board', () => {
  it('adds a step (step element)', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole } = render(<Toolbar engine={engine} />);
    fireEvent.click(getByRole('button', { name: 'Étape' }));
    expect(engine.listElements().some((e) => e.kind === 'step')).toBe(true);
  });

  it('adds a swimlane', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByRole } = render(<Toolbar engine={engine} />);
    fireEvent.click(getByRole('button', { name: 'Swimlane' }));
    expect(engine.listSwimlanes()).toHaveLength(1);
  });

  it('groups the selected steps (enabled when the selection is non-empty)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 100, height: 60 });
    const { getByRole } = render(<Toolbar engine={engine} selectionCount={1} />);
    const groupBtn = getByRole('button', { name: 'Groupe' });
    expect(groupBtn).not.toBeDisabled();
    fireEvent.click(groupBtn);
    expect(engine.listAgentGroups()).toHaveLength(1);
    expect(engine.listAgentGroups()[0]?.stepIds).toEqual(['s1']);
  });
});

describe('Toolbar — background color', () => {
  it('the color block changes the board background, and "Par défaut" resets it', async () => {
    const engine = createEngine({ clientId: 1 });
    render(<Toolbar engine={engine} />);

    fireEvent.click(screen.getByRole('button', { name: 'Couleur du fond' }));
    const blue = await screen.findByRole('button', { name: 'Fond Bleu' });
    fireEvent.click(blue);
    expect(engine.getBackground()).toBe('#dbeafe');

    // The popover stays open (successive tries): "Par défaut" resets.
    fireEvent.click(screen.getByRole('button', { name: /Par défaut/ }));
    expect(engine.getBackground()).toBeNull();
  });
});

describe('Toolbar — sub-process', () => {
  it('the Sub-process button creates a child (callback) then adds a linked step', async () => {
    const engine = createEngine({ clientId: 1 });
    const onCreateSubprocess = vi.fn().mockResolvedValue('child-1');
    render(<Toolbar engine={engine} onCreateSubprocess={onCreateSubprocess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sous-process' }));
    expect(onCreateSubprocess).toHaveBeenCalledOnce();
    await waitFor(() => {
      const steps = engine.listElements().filter((e) => e.kind === 'step');
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ subprocessRef: 'child-1' });
    });
  });

  it('without onCreateSubprocess, no Sub-process button', () => {
    render(<Toolbar engine={createEngine({ clientId: 1 })} />);
    expect(screen.queryByRole('button', { name: 'Sous-process' })).not.toBeInTheDocument();
  });

  it('callback resolving null → no step added', async () => {
    const engine = createEngine({ clientId: 1 });
    render(<Toolbar engine={engine} onCreateSubprocess={() => Promise.resolve(null)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sous-process' }));
    await Promise.resolve();
    expect(engine.listElements().filter((e) => e.kind === 'step')).toHaveLength(0);
  });
});
