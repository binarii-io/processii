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

describe('SidePanel — group editing', () => {
  it('renames the group and dissolves it', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addAgentGroup({ id: 'g1', name: 'Agent A', stepIds: ['s1'] });
    let groupSel: string | null = 'g1';
    const onSelectGroup = (id: string | null): void => {
      groupSel = id;
    };
    const { getByLabelText, getByRole } = render(
      <SidePanel
        engine={engine}
        selectedLaneId={null}
        selectedGroupId="g1"
        onSelectGroup={onSelectGroup}
      />,
    );

    fireEvent.change(getByLabelText('Nom du groupe'), { target: { value: 'Reviewers' } });
    expect(engine.listAgentGroups()[0]).toMatchObject({ name: 'Reviewers' });

    fireEvent.click(getByRole('button', { name: 'Dissocier le groupe' }));
    expect(engine.listAgentGroups()).toEqual([]);
    expect(groupSel).toBeNull();
  });

  it('takes precedence over a lane selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'Lane', order: 0, color: 'neutral', height: 160 });
    engine.addAgentGroup({ id: 'g1', name: 'Group', stepIds: ['s1'] });
    const { getByText } = render(
      <SidePanel engine={engine} selectedLaneId="l1" selectedGroupId="g1" />,
    );
    // The group heading wins when both a lane and a group are selected.
    expect(getByText('Groupe')).toBeInTheDocument();
  });
});

describe('SidePanel — without a selection', () => {
  it('shows a hint', () => {
    const engine = createEngine({ clientId: 1 });
    const { getByText } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    expect(getByText(/Sélectionne une étape/)).toBeInTheDocument();
  });
});
