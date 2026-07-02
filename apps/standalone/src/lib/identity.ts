/**
 * **Local presence** identity (public site, no auth — docs/01): a display name and a cursor
 * color, persisted in `localStorage` to stay stable across reloads. This is what the other
 * peers of a P2P session see (named cursors). No sensitive data: purely cosmetic and public.
 */
import type { Participant } from '@binarii/processii';

const NAME_KEY = 'memorii.whiteboard.name';
const COLOR_KEY = 'memorii.whiteboard.color';

/** Cursor colors (existing ui-kit tokens) — distinct enough to tell peers apart. */
export const PRESENCE_COLORS = ['accent', 'success', 'warning', 'danger'] as const;
export type PresenceColor = (typeof PRESENCE_COLORS)[number];

function randomUint32(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] ?? 0;
  }
  return 0;
}

function randomSuffix(): string {
  return ((randomUint32() % 9000) + 1000).toString();
}

function pickColor(): PresenceColor {
  return PRESENCE_COLORS[randomUint32() % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0];
}

function read(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode: ignored */
  }
}

/** Cleans a typed name: strips control characters, bounds the length, never empty. */
export function sanitizeName(name: string): string {
  const cleaned = Array.from(name)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : `Invité-${randomSuffix()}`;
}

/** Persists the display name (cleaned; never empty). */
export function saveDisplayName(name: string): void {
  write(NAME_KEY, sanitizeName(name));
}

/**
 * Loads (or creates + persists) the local identity. On the very first load, a random
 * `Invité-XXXX` name and color are generated and frozen: peers no longer all show up as "Vous".
 */
export function loadIdentity(): Participant {
  const id = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'local';

  let name = read(NAME_KEY);
  if (!name) {
    name = `Invité-${randomSuffix()}`;
    write(NAME_KEY, name);
  }

  let color = read(COLOR_KEY);
  if (!color || !(PRESENCE_COLORS as readonly string[]).includes(color)) {
    color = pickColor();
    write(COLOR_KEY, color);
  }

  return { id, name, color };
}
