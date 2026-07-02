import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { SharePopover, type SharePopoverProps } from './share-popover.js';

const URL = 'https://process.binarii.app/#room=r&secret=s';

function setup(over: Partial<SharePopoverProps> = {}) {
  const props: SharePopoverProps = {
    live: false,
    inviteUrl: null,
    participantsCount: 0,
    name: 'Alex',
    onNameChange: vi.fn(),
    creds: null,
    onToggleOnline: vi.fn(),
    onRegenerate: vi.fn(),
    ...over,
  };
  render(<SharePopover {...props} />);
  return props;
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Partager le board' }));

describe('SharePopover — partage P2P', () => {
  it('offline: the "Se mettre en ligne" toggle calls onToggleOnline(true)', async () => {
    const user = userEvent.setup();
    const props = setup();
    await open(user);
    await user.click(screen.getByRole('switch', { name: 'Se mettre en ligne' }));
    expect(props.onToggleOnline).toHaveBeenCalledWith(true);
  });

  it('online: shows the link and the copy button', async () => {
    const user = userEvent.setup();
    setup({ live: true, inviteUrl: URL, participantsCount: 2, creds: { room: 'r', secret: 's' } });
    await open(user);
    expect(screen.getByLabelText("Lien d'invitation")).toHaveValue(URL);
    expect(screen.getByRole('button', { name: /Copier/i })).toBeInTheDocument();
    expect(screen.getByText(/2 en ligne/i)).toBeInTheDocument();
  });

  it('edits the display name', async () => {
    const user = userEvent.setup();
    const props = setup();
    await open(user);
    const input = screen.getByRole('textbox', { name: 'Votre nom' });
    expect(input).toHaveValue('Alex');
    await user.type(input, '!');
    expect(props.onNameChange).toHaveBeenCalled();
  });

  it('advanced section: room credentials + regenerate', async () => {
    const user = userEvent.setup();
    const props = setup({ live: true, inviteUrl: URL, creds: { room: 'r', secret: 's' } });
    await open(user);
    await user.click(screen.getByRole('button', { name: /Plus d'options de session/i }));
    expect(screen.getByRole('textbox', { name: 'Room de la session' })).toHaveValue('r');
    expect(screen.getByLabelText('Secret de la session')).toHaveValue('s');
    await user.click(screen.getByRole('button', { name: /Régénérer les identifiants/i }));
    expect(props.onRegenerate).toHaveBeenCalledOnce();
  });
});
