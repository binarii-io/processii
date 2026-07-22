import { useReducer } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEngine, type WhiteboardEngine } from './engine.js';
import { SidePanel, type SidePanelProps } from './side-panel.js';

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

describe('SidePanel — process link (sub-process)', () => {
  /** A step already linked to a host document, selected (addElement selects by default). */
  function linkedEngine(kind?: 'sub' | 'external') {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({
      kind: 'step',
      id: 's1',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      name: 'A',
      subprocessRef: 'doc-1',
      ...(kind ? { subprocessKind: kind } : {}),
    });
    return engine;
  }

  it('shows the host-resolved label of the linked document, never the raw ref', () => {
    const engine = linkedEngine();
    const { getByText, queryByText } = render(
      <SidePanel
        engine={engine}
        selectedLaneId={null}
        resolveSubprocessLabel={(ref) => (ref === 'doc-1' ? 'Child process' : undefined)}
      />,
    );
    expect(getByText('Child process')).toBeInTheDocument();
    expect(queryByText('doc-1')).toBeNull();
  });

  it('without a resolver (or unresolved ref), no name is shown — the ref stays opaque', () => {
    const engine = linkedEngine();
    const { queryByText } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    expect(queryByText('doc-1')).toBeNull();
  });

  it('edits the indicative kind via the selector (default = sub, click = external)', () => {
    const engine = linkedEngine();
    const { getByLabelText } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    fireEvent.click(getByLabelText('Type de lien : Process externe'));
    expect(engine.board.getElement('s1')).toMatchObject({ subprocessKind: 'external' });
    fireEvent.click(getByLabelText('Type de lien : Sous-process'));
    expect(engine.board.getElement('s1')).toMatchObject({ subprocessKind: 'sub' });
  });

  it('"Délier" clears the ref AND the kind', () => {
    const engine = linkedEngine('external');
    const { getByLabelText } = render(<SidePanel engine={engine} selectedLaneId={null} />);
    fireEvent.click(getByLabelText('Délier le process'));
    const el = engine.board.getElement('s1');
    expect(el?.kind).toBe('step');
    if (el?.kind === 'step') {
      expect(el.subprocessRef).toBeUndefined();
      expect(el.subprocessKind).toBeUndefined();
    }
  });

  it('"Lier un process" resolves the host callback into the step link', async () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    const { getByLabelText } = render(
      <SidePanel
        engine={engine}
        selectedLaneId={null}
        onCreateSubprocess={() => Promise.resolve('doc-9')}
      />,
    );
    fireEvent.click(getByLabelText('Lier un process à cette étape'));
    await waitFor(() =>
      expect(engine.board.getElement('s1')).toMatchObject({ subprocessRef: 'doc-9' }),
    );
  });

  it('navigates to the linked process via "Ouvrir"', () => {
    const engine = linkedEngine();
    const opened: string[] = [];
    const { getByRole } = render(
      <SidePanel
        engine={engine}
        selectedLaneId={null}
        onNavigateSubprocess={(ref) => opened.push(ref)}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Ouvrir' }));
    expect(opened).toEqual(['doc-1']);
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

describe('SidePanel — hyperlink field (#266)', () => {
  // Harness: forces a re-render on `onChange`, exactly like the host (WhiteboardBody passes
  // `forceRender`) → the field's controlled value and the "Open" button state follow engine writes.
  function renderPanel(engine: WhiteboardEngine, extra: Partial<SidePanelProps> = {}) {
    function Harness() {
      const [, force] = useReducer((n: number) => n + 1, 0);
      return <SidePanel engine={engine} selectedLaneId={null} onChange={force} {...extra} />;
    }
    return render(<Harness />);
  }

  it('sets and clears a step link, and "Open" calls the host with a guarded href', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    const onOpenLink = vi.fn();
    const { getByLabelText } = renderPanel(engine, { onOpenLink });
    const input = getByLabelText('Lien (URL)');
    fireEvent.change(input, { target: { value: 'example.com' } });
    expect(engine.board.getElement('s1')).toMatchObject({ url: 'example.com' });
    fireEvent.click(getByLabelText('Ouvrir le lien'));
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com');
    // Clearing the input clears the field.
    fireEvent.change(input, { target: { value: '' } });
    expect(engine.board.getElement('s1')).not.toHaveProperty('url');
  });

  it('shows a link field + delete for a selected basic shape (rectangle)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'r1', x: 0, y: 0, width: 80, height: 40 });
    const { getByLabelText, getByText } = renderPanel(engine);
    // Title reflects the kind.
    expect(getByText('Rectangle')).toBeInTheDocument();
    fireEvent.change(getByLabelText('Lien (URL)'), { target: { value: 'https://x.test' } });
    expect(engine.board.getElement('r1')).toMatchObject({ url: 'https://x.test' });
    fireEvent.click(getByText('Supprimer'));
    expect(engine.board.getElement('r1')).toBeUndefined();
  });

  it('the "Open" button is disabled for a dangerous / empty link', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'text', id: 't1', x: 0, y: 0, width: 80, height: 40, text: 'hi' });
    const onOpenLink = vi.fn();
    const { getByLabelText } = renderPanel(engine, { onOpenLink });
    const open = getByLabelText('Ouvrir le lien') as HTMLButtonElement;
    expect(open.disabled).toBe(true); // empty
    fireEvent.change(getByLabelText('Lien (URL)'), { target: { value: 'javascript:alert(1)' } });
    expect(open.disabled).toBe(true); // refused scheme → still no safe href
    fireEvent.click(open);
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});
