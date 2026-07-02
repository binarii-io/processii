import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger, Switch } from '@binarii/processii/ui';
import { Check, ChevronDown, Copy, Link2, RefreshCw, Share2 } from 'lucide-react';

/**
 * Single sharing overlay (on the "Partager" button) — replaces the old session drawer.
 * Contains: display name, **"Online" toggle** (hosts/cuts the P2P), **invite link** to copy
 * and to **regenerate** (credential rotation → new link), and a collapsible **advanced section**
 * (join by credentials, stop sharing).
 */
export interface SharePopoverProps {
  readonly live: boolean;
  readonly inviteUrl: string | null;
  readonly participantsCount: number;
  readonly name: string;
  onNameChange(next: string): void;
  /** Disables sharing (demo mode, no network). */
  readonly disabled?: boolean;
  /** Credentials of the current session (room + secret), for display/copy. `null` when not shared. */
  readonly creds: { room: string; secret: string } | null;
  onToggleOnline(next: boolean): void;
  /** Regenerates room+secret (new link; reconnects on the new room). */
  onRegenerate(): void;
}

const inputCls =
  'mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * "Connected" LED: small bright green dot + slight glow (no blinking). Literal green assumed
 * (status indicator, like an LED), identical in light/dark.
 */
function LiveDot() {
  return (
    <span
      className="size-1.5 rounded-full bg-green-500 shadow-[0_0_5px_1px_rgba(34,197,94,0.7)]"
      aria-hidden="true"
    />
  );
}

export function SharePopover({
  live,
  inviteUrl,
  participantsCount,
  name,
  onNameChange,
  disabled = false,
  creds,
  onToggleOnline,
  onRegenerate,
}: SharePopoverProps) {
  const [copied, setCopied] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const copy = (): void => {
    if (!inviteUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={live ? 'primary' : 'secondary'} aria-label="Partager le board">
          <Share2 className="size-4" aria-hidden="true" />
          {live ? (
            <span className="flex items-center gap-1.5">
              Partagé
              <LiveDot />
            </span>
          ) : (
            'Partager'
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-medium text-text">Partager le board</p>
        <p className="text-xs text-muted">Collaboration en pair-à-pair, sans compte.</p>

        {/* Display name (presence). */}
        <label className="mt-3 block">
          <span className="text-xs font-medium text-text">Votre nom</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Votre nom"
            aria-label="Votre nom"
            maxLength={40}
            className={inputCls}
          />
        </label>

        {/* Toggle « En ligne ». */}
        <label className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-text">
            {live ? (
              <LiveDot />
            ) : (
              <span className="size-2 rounded-full bg-muted" aria-hidden="true" />
            )}
            En ligne
          </span>
          <Switch
            checked={live}
            disabled={disabled}
            onCheckedChange={onToggleOnline}
            aria-label="Se mettre en ligne"
          />
        </label>

        {live && inviteUrl ? (
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text">
              <Link2 className="size-3.5 text-accent" aria-hidden="true" />
              Lien d'invitation
            </p>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
              <input
                readOnly
                value={inviteUrl}
                aria-label="Lien d'invitation"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent text-xs text-muted outline-none"
              />
              <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={copy}>
                {copied ? (
                  <>
                    <Check className="size-3.5" aria-hidden="true" />
                    Copié
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" aria-hidden="true" />
                    Copier
                  </>
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Toute personne avec le lien rejoint en P2P.
              {participantsCount > 0 && (
                <span className="font-medium text-text"> {participantsCount} en ligne.</span>
              )}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">
            {disabled
              ? 'P2P indisponible (mode démo, sans réseau).'
              : 'Activez « En ligne » pour obtenir un lien d’invitation à partager.'}
          </p>
        )}

        {/* Collapsible advanced section (replaces the old drawer). */}
        <button
          type="button"
          onClick={() => setAdvanced((o) => !o)}
          aria-expanded={advanced}
          className="mt-3 flex w-full items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          Plus d'options de session
        </button>

        {advanced && (
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            {creds ? (
              <>
                <p className="text-xs font-medium text-text">Identifiants de la room</p>
                <label className="block">
                  <span className="text-[11px] text-muted">Room</span>
                  <input
                    readOnly
                    value={creds.room}
                    aria-label="Room de la session"
                    onFocus={(e) => e.currentTarget.select()}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted">Secret</span>
                  <input
                    readOnly
                    value={creds.secret}
                    aria-label="Secret de la session"
                    onFocus={(e) => e.currentTarget.select()}
                    className={inputCls}
                  />
                </label>
                <Button size="sm" variant="secondary" onClick={onRegenerate}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Régénérer les identifiants
                </Button>
                <p className="text-[11px] text-muted">
                  Génère un nouveau room/secret (et un nouveau lien) ; l'ancien lien ne te rejoint
                  plus.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">
                Mettez-vous « En ligne » pour générer les identifiants de la room.
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
