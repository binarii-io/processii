/**
 * The assistant's **permanent instructions** ("pre-prompt" / skills mode), persisted in
 * `localStorage`. Free text provided by the user, **injected into the system prompt** on every
 * turn (see `buildSystemPrompt`). Used to set durable rules: naming conventions, language,
 * process style, business constraints… Persists across reloads and applies to all conversations.
 */
const KEY = 'memorii.whiteboard.ai.instructions';

/** Remembered instructions, or an empty string when none. */
export function loadInstructions(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Remembers the instructions (trimmed). Empty → clears. */
export function saveInstructions(value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const v = value.trim();
    if (v.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* no-op */
  }
}
