import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { StylePanel } from './style-panel.js';

describe('StylePanel — selection styles', () => {
  it('applies fill/stroke (palette, via the panels) + width', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 });
    const { getByLabelText } = render(<StylePanel engine={engine} />);

    fireEvent.click(getByLabelText('Fond')); // opens the fill panel
    fireEvent.click(getByLabelText('Fond #22c55e'));
    fireEvent.click(getByLabelText('Trait')); // opens the stroke panel
    fireEvent.click(getByLabelText('Trait #3b82f6'));
    fireEvent.click(getByLabelText('Épaisseur 4')); // width lives in the Stroke panel

    expect(engine.board.getElement('a')).toMatchObject({
      stroke: '#3b82f6',
      fill: '#22c55e',
      strokeWidth: 4,
    });
  });

  it('stroke: color, "Tirets" (style), "Aucun" (no border)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 });
    const { getByLabelText, rerender } = render(<StylePanel engine={engine} />);

    fireEvent.click(getByLabelText('Trait'));
    fireEvent.click(getByLabelText('Trait #111827'));
    expect(engine.board.getElement('a')).toMatchObject({ stroke: '#111827' });

    fireEvent.click(getByLabelText('Tirets'));
    expect(engine.board.getElement('a')).toMatchObject({ strokeDash: 'dashed' });

    fireEvent.click(getByLabelText('Sans bordure'));
    expect(engine.board.getElement('a')).toMatchObject({ stroke: 'transparent' });
    // The Stroke chip preview signals the missing outline (∅ glyph), panel open OR closed.
    // (In real usage, the parent re-renders via `onChange`; here we force the re-render to re-read the state.)
    rerender(<StylePanel engine={engine} />);
    expect(getByLabelText('Trait').textContent).toContain('∅');
  });

  it('text (#82): alignment + bold/italic/underline/strikethrough + size on a shape', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 120, height: 80 });
    const { getByLabelText } = render(<StylePanel engine={engine} />);

    fireEvent.click(getByLabelText('Aligner à droite'));
    expect(engine.board.getElement('a')).toMatchObject({ textAlign: 'right' });

    fireEvent.click(getByLabelText('Gras'));
    fireEvent.click(getByLabelText('Italique'));
    fireEvent.click(getByLabelText('Souligné'));
    fireEvent.click(getByLabelText('Barré'));
    expect(engine.board.getElement('a')).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
    });

    // Size: default 13 for a shape → +2.
    fireEvent.click(getByLabelText('Augmenter la taille du texte'));
    expect(engine.board.getElement('a')).toMatchObject({ fontSize: 15 });
  });

  it('drop shadow: togglable on a shape (enabled by default → off)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 120, height: 80 });
    const { getByLabelText } = render(<StylePanel engine={engine} />);

    const toggle = getByLabelText('Ombre portée');
    expect(toggle).toHaveAttribute('aria-pressed', 'true'); // enabled by default
    fireEvent.click(toggle);
    expect(engine.board.getElement('a')).toMatchObject({ shadow: false });
  });

  it('connector: no text control (alignment/format) nor shadow', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.connect('c', 'a', 'b');
    const { queryByLabelText } = render(<StylePanel engine={engine} />);
    expect(queryByLabelText('Gras')).toBeNull();
    expect(queryByLabelText('Centrer')).toBeNull();
    expect(queryByLabelText('Ombre portée')).toBeNull();
  });

  it('without a selection: no-op (no error)', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByLabelText } = render(<StylePanel engine={engine} />);
    fireEvent.click(getByLabelText('Fond'));
    fireEvent.click(getByLabelText('Fond #3b82f6'));
    expect(engine.board.size).toBe(0);
  });

  it('selected connector: offers the arrowheads and toggles them', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 50, height: 50 },
      { select: false },
    );
    engine.connect('c', 'a', 'b'); // selects the 'c' connector
    const { getByLabelText, queryByLabelText } = render(<StylePanel engine={engine} />);

    // No fill on a connector (chip hidden), but the stroke remains.
    expect(queryByLabelText('Fond')).toBeNull();
    expect(getByLabelText('Trait')).toBeInTheDocument();
    fireEvent.click(getByLabelText('Flèche à la fin'));
    expect(engine.board.getElement('c')).toMatchObject({ endArrow: true });
    fireEvent.click(getByLabelText('Flèche au début'));
    expect(engine.board.getElement('c')).toMatchObject({ startArrow: true });
  });

  it('non-connector shape: no arrow controls', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 });
    const { queryByLabelText } = render(<StylePanel engine={engine} />);
    expect(queryByLabelText('Flèche à la fin')).toBeNull();
  });

  it('sets and clears a link via the contextual Link panel (#266)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 });
    const { getByLabelText } = render(<StylePanel engine={engine} />);
    fireEvent.click(getByLabelText('Lien')); // opens the link sub-panel
    fireEvent.change(getByLabelText('Lien (URL)'), { target: { value: 'example.com' } });
    expect(engine.board.getElement('a')).toMatchObject({ url: 'example.com' });
    fireEvent.change(getByLabelText('Lien (URL)'), { target: { value: '' } });
    expect(engine.board.getElement('a')).not.toHaveProperty('url');
  });

  it('the Link button is not offered for a connector', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({
      kind: 'arrow',
      id: 'l',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [10, 10],
      ],
    });
    const { queryByLabelText } = render(<StylePanel engine={engine} />);
    expect(queryByLabelText('Lien')).toBeNull();
  });
});
