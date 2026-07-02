/**
 * The user's **Mistral API key**, persisted in `localStorage`. The key is **personal**,
 * **stored locally** and **sent only to Mistral** (direct browser call — see
 * `docs/ai-chat-brief.md`, CORS section: no backend ever sees it). It is never logged.
 *
 * Pattern aligned with `lib/session-creds.ts`: `typeof localStorage` guard, `try/catch`, minimal
 * validation (non-empty string). Intentionally simple: no local encryption (`localStorage` is
 * already origin-scoped; the UI warning reminds that the key lives in clear on the browser side).
 */

const KEY = 'memorii.whiteboard.mistral-key';

/** Remembered Mistral key, or `null` when absent. */
export function loadApiKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (typeof raw === 'string' && raw.trim().length > 0) return raw;
    return null;
  } catch {
    return null;
  }
}

/** Remembers the key (trimmed). An empty string **clears** the entry. */
export function saveApiKey(value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = value.trim();
    if (trimmed.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, trimmed);
  } catch {
    // Quota / private mode: silent failure, the key just stays unpersisted.
  }
}

/** Clears the remembered key. */
export function clearApiKey(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
