import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentSidebar } from './document-sidebar.js';

function setup(overrides: Partial<Parameters<typeof DocumentSidebar>[0]> = {}) {
  const props = {
    documents: [
      { id: 'a', name: 'Plan' },
      { id: 'b', name: 'Brouillon' },
    ],
    activeId: 'a',
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onJoinRoom: vi.fn(),
    onReorder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    onImportNew: vi.fn(),
    onImportMerge: vi.fn(),
    ...overrides,
  };
  render(<DocumentSidebar {...props} />);
  return props;
}

describe('DocumentSidebar — renommage / suppression', () => {
  it('renames via the pencil: Enter commits the new name', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Renommer Plan' }));
    const input = screen.getByLabelText('Nom du document Plan');
    await user.clear(input);
    await user.type(input, 'Roadmap{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('a', 'Roadmap');
  });

  it('Escape cancels the rename (no call)', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Renommer Plan' }));
    const input = screen.getByLabelText('Nom du document Plan');
    await user.type(input, 'XYZ{Escape}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('double-click on the name opens the rename', async () => {
    const user = userEvent.setup();
    setup();
    await user.dblClick(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByLabelText('Nom du document Plan')).toBeInTheDocument();
  });

  it('deletes via the trash after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Supprimer Brouillon' }));
    expect(props.onDelete).toHaveBeenCalledWith('b');
    confirmSpy.mockRestore();
  });

  it('does not delete when the confirmation is refused', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Supprimer Brouillon' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('"online" globe on the connected document, "offline" on the other shared docs', () => {
    setup({ sessionIds: new Set(['a', 'b']), liveId: 'b' });
    expect(screen.getByLabelText('Session en ligne')).toBeInTheDocument(); // b (connected)
    expect(screen.getByLabelText(/Session partagée \(hors ligne\)/)).toBeInTheDocument(); // a
  });

  it('no globe icon for an unshared document', () => {
    setup({ sessionIds: new Set(['b']), liveId: null });
    // Only b carries a globe; a (unshared) has none.
    expect(screen.getAllByLabelText(/Session partagée|Session en ligne/)).toHaveLength(1);
  });
});

describe('DocumentSidebar — hierarchy (sub-process)', () => {
  it('nests a child document (parentId) under its parent', () => {
    setup({
      documents: [
        { id: 'p', name: 'Parent' },
        { id: 'c', name: 'Enfant', parentId: 'p' },
      ],
      activeId: 'p',
    });
    const childBtn = screen.getByRole('button', { name: 'Enfant' });
    const parentLi = screen.getByRole('button', { name: 'Parent' }).closest('li');
    // The child is rendered **inside** the parent's <li> (nested sub-list).
    expect(parentLi).toContainElement(childBtn);
  });

  it('shows a ⚠ badge on a document linked as a sub-process (child)', () => {
    setup({
      documents: [
        { id: 'p', name: 'Parent' },
        { id: 'c', name: 'Enfant', parentId: 'p' },
      ],
      activeId: 'p',
    });
    expect(screen.getByRole('img', { name: 'Lié comme sous-process' })).toBeInTheDocument();
  });
});
