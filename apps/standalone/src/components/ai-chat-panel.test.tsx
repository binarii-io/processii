import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createEngine } from '@binarii/processii';
import { AiChatPanel } from './ai-chat-panel.js';

// jsdom (vitest) does not expose `localStorage` → in-memory mock (see session-creds.test).
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

describe('AiChatPanel', () => {
  beforeEach(() => installMemoryStorage());

  it('without a key: invites to connect a Mistral key', () => {
    render(
      <AiChatPanel engine={createEngine({ clientId: 1 })} onMutated={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Clé API Mistral')).toBeInTheDocument();
    // No message input area until the key is set.
    expect(screen.queryByLabelText('Message à l’assistant')).not.toBeInTheDocument();
  });

  it('with a remembered key: shows the message composer', () => {
    localStorage.setItem('memorii.whiteboard.mistral-key', 'sk-test');
    render(
      <AiChatPanel engine={createEngine({ clientId: 1 })} onMutated={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Message à l’assistant')).toBeInTheDocument();
    expect(screen.queryByLabelText('Clé API Mistral')).not.toBeInTheDocument();
  });
});
