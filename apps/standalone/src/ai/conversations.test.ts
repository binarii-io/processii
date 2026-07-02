import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ThreadItem,
  clearActiveId,
  deleteConversation,
  deriveTitle,
  listConversations,
  loadActiveId,
  loadConversation,
  saveActiveId,
  threadToHistory,
  upsertConversation,
} from './conversations.js';

function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const mock: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key' | 'length'> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
}

const thread = (text: string): ThreadItem[] => [{ kind: 'user', text }];

describe('conversations', () => {
  beforeEach(() => installMemoryStorage());

  it('upsert + list sorted by descending date', () => {
    upsertConversation({ id: 'a', title: 'A', updatedAt: 1, thread: thread('a') });
    upsertConversation({ id: 'b', title: 'B', updatedAt: 3, thread: thread('b') });
    upsertConversation({ id: 'c', title: 'C', updatedAt: 2, thread: thread('c') });
    expect(listConversations().map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('upsert updates an existing conversation (no duplicate)', () => {
    upsertConversation({ id: 'a', title: 'V1', updatedAt: 1, thread: [] });
    upsertConversation({ id: 'a', title: 'V2', updatedAt: 2, thread: [] });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('V2');
  });

  it('load and delete', () => {
    upsertConversation({ id: 'a', title: 'A', updatedAt: 1, thread: thread('a') });
    expect(loadConversation('a')?.title).toBe('A');
    deleteConversation('a');
    expect(loadConversation('a')).toBeNull();
  });

  it('delete clears the active id when it pointed to it', () => {
    upsertConversation({ id: 'a', title: 'A', updatedAt: 1, thread: [] });
    saveActiveId('a');
    deleteConversation('a');
    expect(loadActiveId()).toBeNull();
  });

  it('active id : save / load / clear', () => {
    expect(loadActiveId()).toBeNull();
    saveActiveId('x');
    expect(loadActiveId()).toBe('x');
    clearActiveId();
    expect(loadActiveId()).toBeNull();
  });

  it('threadToHistory only keeps user/assistant', () => {
    const t: ThreadItem[] = [
      { kind: 'user', text: 'salut' },
      { kind: 'action', text: '✅ x', success: true },
      { kind: 'assistant', text: 'ok' },
      { kind: 'error', text: 'boom' },
    ];
    expect(threadToHistory(t)).toEqual([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('deriveTitle from the first user message (truncated)', () => {
    expect(deriveTitle([])).toBe('Nouvelle conversation');
    expect(deriveTitle(thread('Ajoute une étape'))).toBe('Ajoute une étape');
    const long = 'x'.repeat(60);
    expect(deriveTitle(thread(long)).endsWith('…')).toBe(true);
  });

  it('robust read when the storage is corrupted', () => {
    localStorage.setItem('memorii.whiteboard.ai.conversations', '{not json');
    expect(listConversations()).toEqual([]);
  });
});
