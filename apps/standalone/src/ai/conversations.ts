/**
 * AI assistant **conversation persistence** (`localStorage`). A conversation = an exchange
 * thread (display) + a title + a date. Enables **resuming** a conversation after a refresh,
 * **starting a new one**, and deleting one. The API history (`user`/`assistant` messages sent
 * to Mistral) is **rebuilt** from the display thread (`threadToHistory`) — a single stored
 * source. Pattern aligned with `lib/session-creds.ts` (`typeof localStorage` guard, try/catch).
 */
import type { ChatMessage } from './mistral-client.js';

/** Item displayed in the thread (shared with the panel). */
export type ThreadItem =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'action'; readonly text: string; readonly success: boolean }
  | { readonly kind: 'error'; readonly text: string };

export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly thread: readonly ThreadItem[];
}

const KEY = 'memorii.whiteboard.ai.conversations';
const ACTIVE = 'memorii.whiteboard.ai.activeConv';

function readAll(): Conversation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isConversation) : [];
  } catch {
    return [];
  }
}

function writeAll(list: readonly Conversation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota / private mode: not persisted, without crashing
  }
}

function isConversation(v: unknown): v is Conversation {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.updatedAt === 'number' &&
    Array.isArray(c.thread)
  );
}

/** Conversations sorted from most to least recent. */
export function listConversations(): Conversation[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadConversation(id: string): Conversation | null {
  return readAll().find((c) => c.id === id) ?? null;
}

/** Creates or updates a conversation (upsert by id). */
export function upsertConversation(conv: Conversation): void {
  writeAll([...readAll().filter((c) => c.id !== conv.id), conv]);
}

export function deleteConversation(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id));
  if (loadActiveId() === id) clearActiveId();
}

export function loadActiveId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const v = localStorage.getItem(ACTIVE);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveActiveId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE, id);
  } catch {
    /* no-op */
  }
}

export function clearActiveId(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE);
  } catch {
    /* no-op */
  }
}

/** Rebuilds the API history (`user`/`assistant` text) from the display thread. */
export function threadToHistory(thread: readonly ThreadItem[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const item of thread) {
    if (item.kind === 'user') out.push({ role: 'user', content: item.text });
    else if (item.kind === 'assistant') out.push({ role: 'assistant', content: item.text });
  }
  return out;
}

/** Title derived from the first user message (truncated), otherwise a default label. */
export function deriveTitle(thread: readonly ThreadItem[]): string {
  const firstUser = thread.find((i) => i.kind === 'user');
  if (!firstUser) return 'Nouvelle conversation';
  const t = firstUser.text.trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}
