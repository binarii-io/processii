import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Button,
  IconButton,
  Input,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@binarii/processii/ui';
import {
  ArrowLeft,
  History,
  KeyRound,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { WhiteboardEngine } from '@binarii/processii';
import { clearApiKey, loadApiKey, saveApiKey } from '../ai/api-key.js';
import { createMistralClient, MistralError } from '../ai/mistral-client.js';
import { runAgentLoop } from '../ai/agent-loop.js';
import { loadInstructions, saveInstructions } from '../ai/instructions.js';
import { Markdown } from './markdown.js';
import {
  type Conversation,
  type ThreadItem,
  deleteConversation,
  deriveTitle,
  listConversations,
  loadActiveId,
  loadConversation,
  saveActiveId,
  threadToHistory,
  upsertConversation,
} from '../ai/conversations.js';

/**
 * **AI chat panel** (standalone chrome). Natural-language dialogue with a Mistral assistant that
 * **live-edits the board** via the shared engine (see `docs/ai-chat-brief.md`). Everything is
 * front-side: the user key is stored locally and sent **directly** to Mistral (CORS validated).
 *
 * Persistence: the **conversations** survive a refresh (resume / new / delete), and an editable
 * **"instructions" pre-prompt** (skills) is injected into the system prompt.
 */
export interface AiChatPanelProps {
  readonly engine: WhiteboardEngine;
  /** Forces the board re-render after mutations (the canvas already observes the engine, this is a guarantee). */
  readonly onMutated: () => void;
  readonly onClose: () => void;
}

type View = 'chat' | 'history' | 'settings';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `conv-${Date.now().toString(36)}`;
}

function friendlyError(err: unknown): string {
  if (err instanceof MistralError) {
    switch (err.kind) {
      case 'auth':
        return 'Clé API refusée. Vérifie ta clé Mistral.';
      case 'quota':
        return 'Quota Mistral atteint (429). Réessaie plus tard.';
      case 'network':
        return 'Problème réseau en joignant Mistral.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

// Max number of **automatic continuations** when a turn hits its iteration limit: the assistant
// carries on with the task alone (big process split into several turns), bounded to avoid runaway.
const AUTO_CONTINUE_MAX = 3;

export function AiChatPanel({ engine, onMutated, onClose }: AiChatPanelProps) {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [confirmMode, setConfirmMode] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [convList, setConvList] = useState<Conversation[]>([]);
  const [view, setView] = useState<View>('chat');
  const [instructions, setInstructions] = useState('');
  const [instrDraft, setInstrDraft] = useState('');
  // Prevents saving when a thread is loaded (so its date is not "bumped" on open).
  const suppressPersist = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mount: restores the active conversation (or the most recent, otherwise a new one) + the instructions.
  useEffect(() => {
    setInstructions(loadInstructions());
    const list = listConversations();
    setConvList(list);
    const active = loadActiveId();
    const restore = (active && list.find((c) => c.id === active)) || list[0];
    suppressPersist.current = true;
    if (restore) {
      setConvId(restore.id);
      setThread([...restore.thread]);
      saveActiveId(restore.id);
    } else {
      setConvId(newId());
      setThread([]);
    }
  }, []);

  // Persists the current thread on every change (except when loading an existing thread).
  useEffect(() => {
    if (suppressPersist.current) {
      suppressPersist.current = false;
      return;
    }
    if (!convId || thread.length === 0) return;
    upsertConversation({ id: convId, title: deriveTitle(thread), updatedAt: Date.now(), thread });
    saveActiveId(convId);
    setConvList(listConversations());
  }, [thread, convId]);

  // Auto-scroll to the bottom on every addition. (`scrollTo` absent under jsdom → defensive guard.)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight });
  }, [thread, busy, view]);

  const push = (item: ThreadItem): void => setThread((t) => [...t, item]);

  const saveKey = (): void => {
    const next = keyDraft.trim();
    if (!next) return;
    saveApiKey(next);
    setApiKey(next);
    setKeyDraft(next); // keeps the value in the field (settings); the onboarding switches views
    setEditingKey(false);
  };

  const forgetKey = (): void => {
    clearApiKey();
    setApiKey(null);
    setEditingKey(false);
  };

  const startNewConversation = (): void => {
    suppressPersist.current = true;
    setConvId(newId());
    setThread([]);
    setInput('');
    setView('chat');
  };

  const openConversation = (id: string): void => {
    const conv = loadConversation(id);
    suppressPersist.current = true;
    setConvId(id);
    setThread(conv ? [...conv.thread] : []);
    saveActiveId(id);
    setView('chat');
  };

  const removeConversation = (id: string): void => {
    deleteConversation(id);
    const list = listConversations();
    setConvList(list);
    if (id === convId) {
      if (list[0]) openConversation(list[0].id);
      else startNewConversation();
    }
  };

  const saveInstr = (): void => {
    saveInstructions(instrDraft);
    setInstructions(instrDraft.trim());
  };

  const openSettings = (): void => {
    setInstrDraft(instructions);
    setKeyDraft(apiKey ?? ''); // key field pre-filled, directly editable
    setView('settings');
  };

  const submit = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy || !apiKey) return;
    setInput('');
    push({ kind: 'user', text });
    setBusy(true);
    try {
      const client = createMistralClient({ apiKey });
      let history = threadToHistory(thread); // history before the current message
      let userMessage = text;
      let round = 0;
      // **Auto-continuation**: when a turn hits its iteration limit, it is relaunched
      // automatically (the board state is re-injected each turn) until conclusion or the `AUTO_CONTINUE_MAX` bound.
      for (;;) {
        const result = await runAgentLoop({
          client,
          engine,
          history,
          userMessage,
          onAction: (trace) =>
            push({ kind: 'action', text: trace.message, success: trace.success }),
          onMutated,
          ...(instructions ? { instructions } : {}),
          // Destructive-action confirmation (toggle) — omitted when disabled (no `undefined`).
          ...(confirmMode
            ? {
                confirmDestructive: (tool) =>
                  typeof window !== 'undefined' && typeof window.confirm === 'function'
                    ? window.confirm(`Confirmer l’action « ${tool.name} » ? Elle modifie le board.`)
                    : true,
              }
            : {}),
        });
        if (result.reply) push({ kind: 'assistant', text: result.reply });
        if (result.stoppedReason !== 'max-iterations' || round >= AUTO_CONTINUE_MAX) break;
        round += 1;
        push({
          kind: 'action',
          text: `⏳ Je poursuis automatiquement… (${round}/${AUTO_CONTINUE_MAX})`,
          success: true,
        });
        history = [
          ...history,
          { role: 'user' as const, content: userMessage },
          { role: 'assistant' as const, content: result.reply ?? '' },
        ];
        userMessage = 'Continue et termine ce qui manque, sans refaire ce qui existe déjà.';
      }
    } catch (err) {
      push({ kind: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const needsKey = !apiKey || editingKey;

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex h-full w-full flex-col bg-surface">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {view === 'chat' ? (
              <>
                <Sparkles aria-hidden className="size-4 text-accent" />
                <span className="truncate text-sm font-semibold text-text">Assistant IA</span>
              </>
            ) : (
              <>
                <IconTip label="Retour" onClick={() => setView('chat')}>
                  <ArrowLeft aria-hidden className="size-4" />
                </IconTip>
                <span className="truncate text-sm font-semibold text-text">
                  {view === 'history' ? 'Conversations' : 'Réglages'}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {view === 'chat' && !needsKey && (
              <>
                <IconTip label="Conversations" onClick={() => setView('history')}>
                  <History aria-hidden className="size-4" />
                </IconTip>
                <IconTip label="Nouvelle conversation" onClick={startNewConversation}>
                  <Plus aria-hidden className="size-4" />
                </IconTip>
                <IconTip label="Réglages" onClick={openSettings}>
                  <Settings aria-hidden className="size-4" />
                </IconTip>
              </>
            )}
            <IconTip label="Fermer l’assistant" onClick={onClose}>
              <X aria-hidden className="size-4" />
            </IconTip>
          </div>
        </header>

        {needsKey ? (
          /* API key entry */
          <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
            <p className="text-sm text-text">
              Connecte ta clé API Mistral pour activer l’assistant.
            </p>
            <Input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Clé API Mistral"
              aria-label="Clé API Mistral"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveKey();
              }}
            />
            <p className="text-xs text-muted">
              🔒 Personnelle, stockée <strong>localement</strong> dans ce navigateur, envoyée{' '}
              <strong>uniquement à Mistral</strong>. Jamais sur nos serveurs.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveKey} disabled={!keyDraft.trim()}>
                <KeyRound aria-hidden className="size-4" /> Enregistrer
              </Button>
              {apiKey && (
                <Button size="sm" variant="ghost" onClick={() => setEditingKey(false)}>
                  Annuler
                </Button>
              )}
            </div>
          </div>
        ) : view === 'history' ? (
          /* Conversation list */
          <div className="flex flex-1 flex-col gap-2 overflow-auto p-3">
            <Button size="sm" onClick={startNewConversation}>
              <Plus aria-hidden className="size-4" /> Nouvelle conversation
            </Button>
            {convList.length === 0 && (
              <p className="text-xs text-muted">Aucune conversation enregistrée.</p>
            )}
            {convList.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                  c.id === convId ? 'border-accent bg-accent/5' : 'border-border'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openConversation(c.id)}
                >
                  <div className="truncate text-sm text-text">{c.title}</div>
                  <div className="text-[11px] text-muted">
                    {new Date(c.updatedAt).toLocaleString()}
                  </div>
                </button>
                <IconTip label="Supprimer la conversation" onClick={() => removeConversation(c.id)}>
                  <Trash2 aria-hidden className="size-4" />
                </IconTip>
              </div>
            ))}
          </div>
        ) : view === 'settings' ? (
          /* Settings: API key, confirmation, instructions (pre-prompt) */
          <div className="flex flex-1 flex-col gap-5 overflow-auto p-3">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Clé API Mistral
              </h3>
              <Input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Clé API Mistral"
                aria-label="Clé API Mistral"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveKey();
                }}
              />
              <p className="text-xs text-muted">
                🔒 Stockée <strong>localement</strong>, envoyée{' '}
                <strong>uniquement à Mistral</strong>.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={saveKey}
                  disabled={!keyDraft.trim() || keyDraft.trim() === apiKey}
                >
                  <KeyRound aria-hidden className="size-4" /> Enregistrer
                </Button>
                <Button size="sm" variant="ghost" onClick={forgetKey} disabled={!apiKey}>
                  <Trash2 aria-hidden className="size-4" /> Oublier
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Sécurité</h3>
              <label className="flex items-center gap-2 text-sm text-text">
                <Switch checked={confirmMode} onCheckedChange={setConfirmMode} />
                Confirmer les suppressions
              </label>
            </section>

            <section className="flex flex-1 flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Consignes (pré-prompt)
              </h3>
              <p className="text-xs text-muted">
                Règles durables appliquées à <strong>toutes</strong> les conversations (langue,
                conventions de nommage, style de processus…). Injectées dans le system prompt.
              </p>
              <Textarea
                value={instrDraft}
                onChange={(e) => setInstrDraft(e.target.value)}
                placeholder="Ex. : nomme les étapes à l’infinitif ; relie toujours les étapes dans l’ordre."
                aria-label="Consignes de l’assistant"
                rows={6}
                className="resize-none"
              />
              <div>
                <Button size="sm" onClick={saveInstr} disabled={instrDraft.trim() === instructions}>
                  Enregistrer les consignes
                </Button>
              </div>
            </section>
          </div>
        ) : (
          /* Discussion thread + composer */
          <>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-3">
              {thread.length === 0 && (
                <p className="text-xs text-muted">
                  Demande par ex. « ajoute une étape Validation après Réception et relie-les ».
                </p>
              )}
              {thread.map((item, i) => (
                <ThreadRow key={i} item={item} />
              ))}
              {busy && (
                <div
                  className="flex items-start gap-2"
                  role="status"
                  aria-label="L’assistant écrit…"
                >
                  <Sparkles aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-bg px-3 py-2.5">
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Décris ce que tu veux sur le board…"
                  aria-label="Message à l’assistant"
                  rows={2}
                  className="min-h-[2.5rem] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <IconTip
                  label="Envoyer"
                  variant="primary"
                  onClick={() => void submit()}
                  disabled={busy || !input.trim()}
                >
                  <Send aria-hidden className="size-4" />
                </IconTip>
              </div>
            </div>
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}

/** Icon button with a **visible tooltip** (the label serves as `aria-label` and bubble). */
function IconTip({
  label,
  onClick,
  children,
  variant = 'ghost',
  disabled,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly variant?: 'ghost' | 'primary' | 'secondary';
  readonly disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton label={label} variant={variant} size="sm" onClick={onClick} disabled={disabled}>
          {children}
        </IconButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** "Assistant is typing" indicator: three dots bouncing in cascade (chat classic). */
function TypingDots() {
  return (
    <span className="flex items-center gap-1">
      <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted" />
    </span>
  );
}

function ThreadRow({ item }: { readonly item: ThreadItem }) {
  if (item.kind === 'user') {
    // User bubble aligned right, solid accent background (messaging style).
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-fg shadow-sm">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    // Assistant bubble aligned left (subtle card) + **markdown** rendering (bold, lists, headings…).
    return (
      <div className="flex items-start gap-2">
        <Sparkles aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-bg px-3 py-2 text-sm text-text">
          <Markdown text={item.text} />
        </div>
      </div>
    );
  }
  if (item.kind === 'error') {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-text">
        ⚠️ {item.text}
      </div>
    );
  }
  // Action trace: subtle line.
  return (
    <div className={`pl-6 text-xs ${item.success ? 'text-muted' : 'text-red-500'}`}>
      {item.text}
    </div>
  );
}
