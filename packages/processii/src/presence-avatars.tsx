import { initials, presenceCssColor, type PresenceParticipant } from './presence.js';

/** ui-kit token (letters/dashes) → a readable `-fg` variant exists; otherwise (free color) white text. */
function isToken(color: string): boolean {
  return /^[a-z-]+$/i.test(color);
}

/**
 * Notion-style live presence: small **round chips** with the **initials** of each connected
 * participant (self included), **colored** by their presence color (ui-kit token). They overlap
 * slightly. Displayed in the topbar when a session is active.
 */
export interface PresenceAvatarsProps {
  readonly users: readonly PresenceParticipant[];
}

export function PresenceAvatars({ users }: PresenceAvatarsProps) {
  if (users.length === 0) return null;
  return (
    <div className="flex items-center -space-x-2" aria-label={`${users.length} participant(s)`}>
      {users.map((user) => (
        <span
          key={user.clientId}
          data-testid="presence-avatar"
          title={user.self ? `${user.name} (vous)` : user.name}
          style={{
            backgroundColor: presenceCssColor(user.color),
            color: isToken(user.color) ? `var(--color-${user.color}-fg)` : '#fff',
          }}
          className="flex size-7 items-center justify-center rounded-full border-2 border-surface text-[11px] font-semibold"
        >
          {initials(user.name)}
        </span>
      ))}
    </div>
  );
}
