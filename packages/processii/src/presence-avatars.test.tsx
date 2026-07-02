import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceAvatars } from './presence-avatars.js';

describe('PresenceAvatars', () => {
  it('renders nothing without a participant', () => {
    const { container } = render(<PresenceAvatars users={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one initials chip per participant (title = name, "vous" for self)', () => {
    render(
      <PresenceAvatars
        users={[
          { clientId: 1, name: 'Alice Martin', color: 'accent', self: true },
          { clientId: 2, name: 'Bob', color: 'success', self: false },
        ]}
      />,
    );
    const pills = screen.getAllByTestId('presence-avatar');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent('AM');
    expect(pills[0]).toHaveAttribute('title', 'Alice Martin (vous)');
    expect(pills[1]).toHaveTextContent('BO');
    expect(pills[1]).toHaveAttribute('title', 'Bob');
  });
});
