import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { JoinRoomDialog } from './join-room-dialog.js';

describe('JoinRoomDialog — joining by credentials', () => {
  it('room + secret entry → onJoin and closing', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    const onOpenChange = vi.fn();
    render(<JoinRoomDialog open onOpenChange={onOpenChange} onJoin={onJoin} />);

    await user.type(screen.getByRole('textbox', { name: 'Room' }), 'maroom');
    await user.type(screen.getByLabelText('Secret'), 'sekret');
    await user.click(screen.getByRole('button', { name: /^Rejoindre$/ }));

    expect(onJoin).toHaveBeenCalledWith('maroom', 'sekret');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pasting an invite link unpacks room + secret', () => {
    const onJoin = vi.fn();
    render(<JoinRoomDialog open onOpenChange={vi.fn()} onJoin={onJoin} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Room' }), {
      target: { value: 'https://x/#room=r1&secret=s1' },
    });
    expect(screen.getByRole('textbox', { name: 'Room' })).toHaveValue('r1');
    expect(screen.getByLabelText('Secret')).toHaveValue('s1');
  });

  it('demo mode: actions disabled', () => {
    render(<JoinRoomDialog open onOpenChange={vi.fn()} onJoin={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /^Rejoindre$/ })).toBeDisabled();
    expect(screen.getByText(/P2P indisponible/i)).toBeInTheDocument();
  });
});
