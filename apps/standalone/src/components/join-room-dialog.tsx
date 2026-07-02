import { useState } from 'react';
import { Button, Modal, ModalContent, ModalDescription, ModalTitle } from '@binarii/processii/ui';

/**
 * Small **"Join a room"** dialog: credential entry (room + secret) to join an existing session
 * without a link. Creates a dedicated blank document and connects to it (handled by the parent
 * via `onJoin`). Also accepts a **pasted invite link** (`…/#room=…&secret=…`) → extracts the fields.
 */
export interface JoinRoomDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  /** Joins a session (dedicated blank document). */
  onJoin(room: string, secret: string): void;
  /** Disabled in demo mode (no network). */
  readonly disabled?: boolean;
}

/** Extracts room+secret from a pasted `…/#room=…&secret=…` link; otherwise `null`. */
function parseInviteLink(value: string): { room: string; secret: string } | null {
  const hashIndex = value.indexOf('#');
  if (hashIndex < 0) return null;
  const params = new URLSearchParams(value.slice(hashIndex + 1));
  const room = params.get('room');
  const secret = params.get('secret');
  return room && secret ? { room, secret } : null;
}

export function JoinRoomDialog({
  open,
  onOpenChange,
  onJoin,
  disabled = false,
}: JoinRoomDialogProps) {
  const [room, setRoom] = useState('');
  const [secret, setSecret] = useState('');

  // Pasting an invite link into the Room field → room+secret unpacked automatically.
  const onRoomChange = (value: string): void => {
    const parsed = parseInviteLink(value);
    if (parsed) {
      setRoom(parsed.room);
      setSecret(parsed.secret);
    } else {
      setRoom(value);
    }
  };

  const submit = (): void => {
    const r = room.trim();
    const s = secret.trim();
    if (!r || !s) return;
    onJoin(r, s);
    onOpenChange(false);
    setRoom('');
    setSecret('');
  };

  const inputCls =
    'mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-sm">
        <ModalTitle>Rejoindre une room</ModalTitle>
        <ModalDescription>
          Entrez les identifiants partagés (ou collez un lien d'invitation) pour rejoindre la
          session.
        </ModalDescription>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="block">
            <span className="text-xs font-medium text-text">Room</span>
            <input
              autoFocus
              value={room}
              onChange={(e) => onRoomChange(e.target.value)}
              placeholder="nom-de-room ou lien collé"
              aria-label="Room"
              disabled={disabled}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text">Secret</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="clé partagée"
              aria-label="Secret"
              disabled={disabled}
              className={inputCls}
            />
          </label>
          {disabled && (
            <p className="text-xs text-muted">P2P indisponible (mode démo, sans réseau).</p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={disabled || !room.trim() || !secret.trim()}>
              Rejoindre
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
