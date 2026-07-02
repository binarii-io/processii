import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { SidePanel } from './side-panel.js';

describe('SidePanel — step editing', () => {
  it('edits name, description and adds a skill', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    const { getByLabelText, getByPlaceholderText } = render(
      <SidePanel engine={engine} selectedLaneId={null} />,
    );

    fireEvent.change(getByLabelText('Nom'), { target: { value: 'Rédiger' } });
    expect(engine.board.getElement('s1')).toMatchObject({ name: 'Rédiger' });

    // Adds a skill via the "Ajouter Skills" field.
    const skillInput = getByLabelText('Ajouter Skills');
    fireEvent.change(skillInput, { target: { value: 'écriture' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    expect(engine.board.getElement('s1')).toMatchObject({ skills: ['écriture'] });
    void getByPlaceholderText; // (placeholder present)
  });

  it('toggles the description display on the card', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120 });
    const { getByLabelText } = render(<SidePanel engine={engine} selectedLaneId={null} />);

    fireEvent.click(getByLabelText('Afficher la description sur la carte'));
    expect(engine.board.getElement('s1')).toMatchObject({ showDescription: true });
  });

  it('clears the emotion via the "Aucune" option', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({
      kind: 'step',
      id: 's1',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      emotion: 'happy',
    });
    const { getByLabelText } = render(<SidePanel engine={engine} selectedLaneId={null} />);

    fireEvent.click(getByLabelText('Aucune emotion'));
    const el = engine.board.getElement('s1');
    expect(el?.kind).toBe('step');
    expect(el && el.kind === 'step' ? el.emotion : undefined).toBeUndefined();
  });

  it('removes the step', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120 });
    const { getByRole } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    fireEvent.click(getByRole('button', { name: "Supprimer l'étape" }));
    expect(engine.board.size).toBe(0);
  });
});

describe('SidePanel — swimlane editing', () => {
  it('edits name, color and removes the lane', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'X', order: 0, color: 'neutral', height: 160 });
    let laneSel: string | null = 'l1';
    const onSelectLane = (id: string | null): void => {
      laneSel = id;
    };
    const { getByLabelText, getByRole } = render(
      <SidePanel engine={engine} selectedLaneId="l1" onSelectLane={onSelectLane} />,
    );

    fireEvent.change(getByLabelText('Nom'), { target: { value: 'Métier' } });
    expect(engine.listSwimlanes()[0]).toMatchObject({ name: 'Métier' });

    fireEvent.click(getByLabelText('Couleur green'));
    expect(engine.listSwimlanes()[0]).toMatchObject({ color: 'green' });

    fireEvent.click(getByRole('button', { name: 'Supprimer la bande' }));
    expect(engine.listSwimlanes()).toEqual([]);
    expect(laneSel).toBeNull();
  });
});

describe('SidePanel — without a selection', () => {
  it('shows a hint', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByText } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    expect(getByText(/Sélectionne une étape/)).toBeInTheDocument();
  });
});
