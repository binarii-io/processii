import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AppShell,
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@binarii/processii/ui';
import { Moon, PanelLeft, Sparkles, Sun } from 'lucide-react';
import {
  BoardCanvas,
  PresenceAvatars,
  SidePanel,
  Toolbar,
  observePresence,
  publishIdentity,
  readParticipants,
  viewportCenter,
  type Participant,
  type Point,
  type PresenceParticipant,
  type Size,
  type Viewport,
} from '@binarii/processii';

import { DocumentSidebar } from './components/document-sidebar.js';
import { SharePopover } from './components/share-popover.js';
import { JoinRoomDialog } from './components/join-room-dialog.js';
import { AiChatPanel } from './components/ai-chat-panel.js';
import { clampPanelWidth, loadPanelWidth, savePanelWidth } from './ai/panel-width.js';
import type { StandaloneWiring } from './bootstrap.js';
import { BundleParseError } from './bundle.js';
import { downloadText, readFileText } from './lib/download.js';
import { sanitizeName, saveDisplayName } from './lib/identity.js';
import { generateRoomName, generateRoomSecret } from './lib/signaling.js';
import {
  clearCreds,
  listSessionDocIds,
  loadCreds,
  saveCreds,
  type SessionCreds,
} from './lib/session-creds.js';
import { useSession } from './lib/use-session.js';
import { useSpace } from './lib/use-space.js';
import { useTheme } from './lib/use-theme.js';

/**
 * **Standalone** P2P whiteboard site. Assembles the local multi-document space, the
 * `@binarii/processii` engine rendered on canvas, and the optional P2P session (y-webrtc).
 * Offline-first: everything works without any peer or network; P2P collab plugs in on demand.
 *
 * The `wiring` is **injected** (config boundary): prod = IndexedDB persistence + y-webrtc
 * transport; tests/E2E = demo mode (no network).
 */
export interface AppProps {
  readonly wiring: StandaloneWiring;
  /** Local presence identity (no auth: public site). */
  readonly participant: Participant;
}

export function App({ wiring, participant }: AppProps) {
  const { theme, toggle } = useTheme();
  // `useSpace` does not react to the engine's internal mutations; a render is forced after editing.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  // Swimlane selection (process entity outside the element selection) → drives the side panel.
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  // Latest local viewport (pan/zoom) + canvas size, mirrored from `BoardCanvas`. Kept in a ref (not
  // state): read on demand when creating an item, so it must not trigger a re-render (it changes on
  // every pan/zoom frame). Lets new toolbar items spawn at the center of the visible board.
  const viewRef = useRef<{ viewport: Viewport; size: Size } | null>(null);
  const handleViewportChange = useCallback((viewport: Viewport, size: Size): void => {
    viewRef.current = { viewport, size };
  }, []);
  const getSpawnCenter = useCallback(
    (): Point | null =>
      viewRef.current ? viewportCenter(viewRef.current.viewport, viewRef.current.size) : null,
    [],
  );
  // Collapsible sidebar (macOS-style toggle, like the web app): open by default, the
  // open/close (width) animation is carried by `AppShell` via `sidebarCollapsed`.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // AI assistant module (Mistral chat live-editing the board) — docked right, standalone-specific.
  const [aiOpen, setAiOpen] = useState(false);
  // Module width (persisted + clamped) and resizing state (disables the animation during the drag).
  const [aiWidth, setAiWidth] = useState<number>(() => loadPanelWidth());
  const [aiResizing, setAiResizing] = useState(false);
  const aiWidthRef = useRef(aiWidth);
  aiWidthRef.current = aiWidth;

  // Prevents the **horizontal trackpad swipe** from triggering the browser back/forward
  // (conflicts with the board pan). The default is blocked ONLY for horizontally-dominant wheel
  // events: vertical scrolling (panels) and zoom (ctrl+wheel → deltaY) stay intact, and the
  // canvas still receives the event to pan. **Non-passive** listener (otherwise `preventDefault` is ignored).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  // Deferred session join: wait for a document to be active (created if needed) before wiring
  // the transport (the transport binds to the active document's Y.Doc).
  const [pendingJoin, setPendingJoin] = useState<{
    room: string;
    secret: string;
    mode: 'host' | 'reconnect';
    /** Document **targeted** by the join: the transport only wires when the active doc is THIS doc.
     *  Prevents a pendingJoin of another doc (e.g. the doc restored on mount) from wiring onto the
     *  wrong doc — the race that broke opening an invite link on the 1st click. */
    docId: string;
  } | null>(null);
  // "Join a room" dialog (credential entry), opened from the sidebar.
  const [joinOpen, setJoinOpen] = useState(false);
  // Display name (presence) — editable, persisted. Raw input (spaces allowed while typing);
  // cleaned only at publish/persist time.
  const [name, setName] = useState(participant.name);
  // Documents that are **durable shared sessions** (remembered credentials) → globe icon.
  const [sessionIds, setSessionIds] = useState<Set<string>>(() => listSessionDocIds());
  // Session credentials of the active document (room + secret), when it is shared.
  const [activeCreds, setActiveCreds] = useState<SessionCreds | null>(null);
  // Connected participants (avatar chips) — self included, in session only.
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);

  // Published identity: cleaned name + stable color/id. Used by new document mounts.
  const identity = useMemo<Participant>(
    () => ({ ...participant, name: sanitizeName(name) }),
    [participant, name],
  );
  // Current identity value, readable in the connection effect without making it a dep (otherwise
  // a name change would rewire the transport).
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const space = useSpace({
    participant: identity,
    onSchemaError: (error) => {
      // Minimal feedback (no toast system in this self-contained site); never in SSR/tests.
      console.error(error.message);
      if (typeof window !== 'undefined' && typeof window.alert === 'function')
        window.alert(
          'Ce document a été créé avec une version plus récente de l’application. ' +
            'Mettez-la à jour pour l’ouvrir.',
        );
    },
    // No local persistence in demo mode (E2E/preview without deterministic IndexedDB).
    ...(wiring.demo
      ? {}
      : { persistenceFactoryFor: (id: string) => wiring.persistenceFactoryFor(id) }),
  });
  const session = useSession(space.active);
  const activeId = space.active?.id ?? null;
  // Current `pendingJoin` value, readable in the auto-reconnect effect without making it a dep
  // (otherwise it would re-fire on every change). Avoids clobbering an explicit connection
  // (host/join) already scheduled.
  const pendingRef = useRef(pendingJoin);
  pendingRef.current = pendingJoin;

  // Reloads the shared session list (after creating/forgetting a session).
  const refreshSessions = (): void => setSessionIds(listSessionDocIds());

  // Active document credentials: (re)loaded on every document change.
  useEffect(() => {
    setActiveCreds(activeId ? loadCreds(activeId) : null);
  }, [activeId]);

  // **Auto-reconnect**: opening (or returning to) an already-shared document rewires its session
  // with the **same credentials**. Key = doc id → only fires when *switching* documents, not
  // after a "Leave" on the same doc (where we want to stay disconnected until reopening). In demo
  // mode, the transport is null.
  useEffect(() => {
    if (!activeId || wiring.demo) return;
    // Short-circuits ONLY when a join is already pending **for this precise document**. The
    // original guard ("any pendingJoin wins") wrongly blocked the current doc's reconnection
    // when a pendingJoin of ANOTHER doc lingered (e.g. the doc restored on mount with creds),
    // hence the invite link that "did not open" on the 1st click.
    if (pendingRef.current?.docId === activeId) return;
    const creds = loadCreds(activeId);
    if (creds) setPendingJoin({ ...creds, mode: 'reconnect', docId: activeId });
  }, [activeId, wiring.demo]);

  // Re-publishes the identity on the active document when the name changes (or when switching
  // documents): peers see the up-to-date name. `setLocalState` merges per field → does not touch the cursor.
  useEffect(() => {
    if (space.active) publishIdentity(space.active.awareness, identity);
  }, [identity, space.active]);

  // **E2E affordance** (demo mode `wiring.demo` ONLY): exposes the active board's engine on
  // `window.__wbEngine` so the Playwright tests read the board's **real geometry** — it is
  // rendered on a pixel `<canvas>`, not inspectable via the DOM. No effect outside demo mode;
  // cleaned up on unmount / board switch to leave no dangling reference.
  useEffect(() => {
    if (!wiring.demo) return;
    const g = globalThis as unknown as { __wbEngine?: unknown };
    g.__wbEngine = space.active?.engine;
    return () => {
      delete g.__wbEngine;
    };
  }, [space.active, wiring.demo]);

  const handleNameChange = (next: string): void => {
    setName(next);
    saveDisplayName(next);
  };

  const handleExport = (): void => {
    downloadText('memorii-whiteboard-bundle.json', space.exportBundle());
  };

  const importFile = async (file: File, mode: 'new' | 'merge'): Promise<void> => {
    try {
      const text = await readFileText(file);
      if (mode === 'new') space.importAsNewSpace(text);
      else space.importMerge(text);
    } catch (e) {
      // Untrusted input: reported cleanly without crashing.
      const message = e instanceof BundleParseError ? e.message : 'Import impossible.';
      // Minimal feedback (no toast system in this self-contained site); never in SSR/tests.
      if (typeof window !== 'undefined' && typeof window.alert === 'function')
        window.alert(message);
    }
  };

  // Host: the **current document is shared** (content intentionally broadcast). One is created
  // when none is open. Credentials are **remembered** (reused as-is when the session already
  // exists) → the session is **resumable**: re-hosting does not regenerate new tokens.
  const hostSession = (): void => {
    const id = space.active?.id ?? space.createDocument('Session partagée');
    const creds: SessionCreds = loadCreds(id) ?? {
      room: generateRoomName(),
      secret: generateRoomSecret(),
    };
    saveCreds(id, creds);
    refreshSessions();
    setActiveCreds(creds);
    setPendingJoin({ ...creds, mode: 'host', docId: id });
  };

  // Join: we **always start from a fresh document dedicated** to the session. Never merge the
  // current document (or another local doc) into the room — the content (and the **name**)
  // arrive by sync from the host. The **credentials are saved** then the **auto-reconnect
  // effect** (triggered by the active doc change) wires the transport: the **same path** as
  // opening an already-shared doc. Do NOT wire here in the same batch as the doc change —
  // otherwise, when a session was already running, tearing down the old one and wiring the new
  // one collide and the new doc "does not load" (you had to switch docs / refresh).
  const joinSession = (room: string, secret: string): void => {
    const id = space.createDocument('Session partagée');
    saveCreds(id, { room, secret });
    refreshSessions();
  };

  // Regenerate the credentials: **new** room/secret → new link (the old one no longer reaches
  // us), then reconnect (host) on the new room.
  const regenerateCreds = (): void => {
    const id = space.active?.id;
    if (!id) return;
    const creds: SessionCreds = { room: generateRoomName(), secret: generateRoomSecret() };
    saveCreds(id, creds);
    refreshSessions();
    setActiveCreds(creds);
    setPendingJoin({ ...creds, mode: 'host', docId: id });
  };

  // Leave: the transport is **cut** but the credentials are **kept** → reopening the document
  // reconnects (auto). That is the intended "durable session" nature.
  const leaveSession = (): void => session.leave();

  // Document deletion: also forgets its session (otherwise an orphan entry lingers).
  const handleDelete = (id: string): void => {
    space.removeDocument(id);
    clearCreds(id);
    refreshSessions();
  };

  // Invite link: `…/#room=…&secret=…` → joins automatically, then cleans the fragment
  // (avoids a re-join and limits leaking the secret into the history). The hash is handled **on
  // mount AND on every `hashchange`**: pasting the link into an already-open tab only changes
  // the fragment (no reload) → without listening to `hashchange`, a manual reload was needed.
  const joinFromHashRef = useRef<() => void>(() => {});
  joinFromHashRef.current = (): void => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const room = params.get('room');
    const secret = params.get('secret');
    if (room && secret) {
      joinSession(room, secret);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    joinFromHashRef.current(); // on mount
    const handler = (): void => joinFromHashRef.current();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const live = session.status === 'connected' || session.status === 'connecting';
  // Document currently in an online session (the transport only binds to the active doc).
  const liveId = live ? (space.active?.id ?? null) : null;
  const activeName = space.documents.find((d) => d.id === space.active?.id)?.name ?? '';

  // Shareable invite link (present as soon as a session exists for the active doc).
  const inviteUrl =
    activeCreds && typeof window !== 'undefined'
      ? `${window.location.origin}/#room=${encodeURIComponent(activeCreds.room)}&secret=${encodeURIComponent(activeCreds.secret)}`
      : null;

  // "Online" toggle: hosts (reuses the existing credentials) or cuts the transport.
  const toggleOnline = (next: boolean): void => {
    if (next) hostSession();
    else leaveSession();
  };

  // "X joined the board" notification (light auto-clearing toast).
  const [joinToast, setJoinToast] = useState<string | null>(null);
  const seenPeersRef = useRef<Set<number> | null>(null);

  // Floating properties panel: visible when a lane is selected, or a **step** (click).
  const engineSel = space.active?.engine.getSelection() ?? [];
  const stepSelected =
    engineSel.length === 1 && space.active?.engine.board.getElement(engineSel[0]!)?.kind === 'step';
  const showProps = !!selectedLaneId || stepSelected;

  // Sub-process: creates a **child** whiteboard of the current document (nested in the sidebar)
  // without switching the active document; returns its id to link the step. `null` when no active document.
  const createSubprocess = (): Promise<string | null> => {
    const parentId = space.active?.id;
    return Promise.resolve(
      parentId ? space.createDocument('Sous-process', { parentId, open: false }) : null,
    );
  };

  // Avatar chips: present participants (self included) on the active doc, in session only.
  // Re-subscribes to the current awareness when switching docs or when the session (re)connects
  // (the awareness is renewed on every connection).
  useEffect(() => {
    const awareness = space.active?.awareness;
    if (!awareness || !live) {
      setParticipants([]);
      return;
    }
    const refresh = (): void => setParticipants(readParticipants(awareness));
    refresh();
    return observePresence(awareness, refresh);
  }, [space.active, live]);

  // Detects peer **arrivals** (excluding self) → toast. The first snapshot is ignored (peers
  // already present when going online) to avoid spamming; reset when offline.
  useEffect(() => {
    if (!live) {
      seenPeersRef.current = null;
      return;
    }
    const peers = participants.filter((p) => !p.self);
    const ids = new Set(peers.map((p) => p.clientId));
    const seen = seenPeersRef.current;
    seenPeersRef.current = ids;
    if (seen === null) return; // first snapshot: no notification
    const newcomers = peers.filter((p) => !seen.has(p.clientId));
    if (newcomers.length > 0) {
      setJoinToast(
        newcomers.length === 1
          ? `${newcomers[newcomers.length - 1]!.name} a rejoint le board`
          : `${newcomers.length} personnes ont rejoint le board`,
      );
    }
  }, [participants, live]);

  // Auto-clears the arrival toast.
  useEffect(() => {
    if (!joinToast) return;
    const t = setTimeout(() => setJoinToast(null), 3500);
    return () => clearTimeout(t);
  }, [joinToast]);

  // Wires the transport as soon as a document is active (created above if needed). The
  // **awareness is renewed** before wiring (clean presence on every (re)connection — otherwise
  // peer cursors only reappear after a refresh). The awareness change re-renders the board
  // (re-subscribes the presence) via the `setPendingJoin(null)` that follows.
  useEffect(() => {
    // We wire ONLY when the active doc is the pendingJoin's **target** (`docId`). Otherwise (a
    // pendingJoin of another doc, e.g. the doc restored on mount, while the invite link just
    // activated a new doc), the pendingJoin is **not cleared**: it stays armed for ITS target.
    // Intentional and harmless — it can never wire onto the wrong doc; it will either be
    // consumed when its target becomes the active doc again, or replaced by the current doc's
    // auto-reconnect (if it has creds). We simply wait for the right doc.
    if (!pendingJoin || !space.active || space.active.id !== pendingJoin.docId) return;
    const awareness = space.active.renewAwareness(identityRef.current);
    const factory = wiring.transportFactoryFor(pendingJoin.room, pendingJoin.secret, awareness);
    if (factory) {
      session.join(factory);
      // As the host, the current doc's **name is broadcast** to the peers (via the Y.Doc meta
      // map); a guest will adopt it (effect below). The content syncs by itself.
      if (pendingJoin.mode === 'host') {
        const current = space.documents.find((d) => d.id === space.active?.id)?.name;
        if (current) space.active.engine.setName(current);
      }
    }
    setPendingJoin(null);
  }, [pendingJoin, space.active, space.documents, session, wiring]);

  // **Name** sync in session: the shared name (Y.Doc meta) is adopted as soon as it differs
  // from the local one — that is how a guest picks up the host's document name. Active in
  // session only (otherwise a stale meta name would clobber a purely local rename).
  useEffect(() => {
    if (!liveId || !space.active || space.active.id !== liveId) return;
    const { engine, id } = space.active;
    const reconcile = (): void => {
      const shared = engine.getName();
      if (shared && shared !== activeName) space.renameDocument(id, shared);
    };
    reconcile();
    return engine.observe(reconcile);
  }, [liveId, space, activeName]);

  // Rename: updates the local space and, when the doc is in session, **propagates** the name to the peers.
  const handleRename = (id: string, nextName: string): void => {
    space.renameDocument(id, nextName);
    if (id === liveId && space.active?.id === id) space.active.engine.setName(nextName);
  };

  // AI module resizing: dragging the left handle → the width grows leftwards.
  // During the drag, the width animation is disabled (otherwise it "lags").
  const startAiResize = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiWidthRef.current;
    setAiResizing(true);
    const onMove = (ev: PointerEvent): void =>
      setAiWidth(clampPanelWidth(startW + (startX - ev.clientX)));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setAiResizing(false);
      savePanelWidth(aiWidthRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <AppShell
        sidebarCollapsed={!sidebarOpen}
        sidebar={
          <DocumentSidebar
            documents={space.documents}
            activeId={space.active?.id ?? null}
            liveId={liveId}
            sessionIds={sessionIds}
            onSelect={space.openDocument}
            onCreate={() => space.createDocument()}
            onJoinRoom={() => setJoinOpen(true)}
            onReorder={space.reorderDocuments}
            onRename={handleRename}
            onDelete={handleDelete}
            onExport={handleExport}
            onImportNew={(file) => void importFile(file, 'new')}
            onImportMerge={(file) => void importFile(file, 'merge')}
          />
        }
      >
        {/* Full frame (the `main` padding is cancelled via `-m-4`). Flex row: **board** column
            (canvas + floating chrome) that **shrinks** when the **docked AI module** opens on the right. */}
        <div className="-m-4 flex h-[calc(100%+2rem)] overflow-hidden">
          {/* Board column: the header, tools and properties panel float on top. */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {space.active ? (
              <>
                <div className="absolute inset-0 flex">
                  <BoardCanvas
                    engine={space.active.engine}
                    onChange={forceRender}
                    awareness={space.active.awareness}
                    selectedLaneId={selectedLaneId}
                    onSelectLane={setSelectedLaneId}
                    onViewportChange={handleViewportChange}
                    onNavigateSubprocess={space.openDocument}
                  />
                </div>

                {/* Floating properties panel (under the header) — selected step or lane. */}
                {showProps && (
                  <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-72 flex-col gap-4 overflow-auto rounded-xl border border-border bg-surface p-3 shadow-xl">
                    <SidePanel
                      engine={space.active.engine}
                      selectedLaneId={selectedLaneId}
                      onChange={forceRender}
                      onSelectLane={setSelectedLaneId}
                      onCreateSubprocess={createSubprocess}
                      onNavigateSubprocess={space.openDocument}
                    />
                  </aside>
                )}

                {/* Floating toolbar (bottom-center). Styling (fill/stroke/width) is NOT here:
                  it appears above the selected element (see BoardCanvas). */}
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                  <div className="pointer-events-auto flex max-w-full items-center rounded-2xl border border-border bg-surface p-2 shadow-xl">
                    <Toolbar
                      engine={space.active.engine}
                      onChange={forceRender}
                      selectionCount={space.active.engine.getSelection().length}
                      getSpawnCenter={getSpawnCenter}
                      onCreateSubprocess={createSubprocess}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-text">Aucun document ouvert.</p>
                <Button onClick={() => space.createDocument()}>Créer un whiteboard</Button>
                <p className="text-xs text-muted">
                  …ou « Session » (en haut à droite) pour rejoindre un board partagé.
                </p>
              </div>
            )}

            {/* **Floating** header on top of the board (transparent, no dedicated bar). */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-4 py-3">
              <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                {/* macOS-style sidebar open/close toggle (animation carried by AppShell). */}
                <IconButton
                  label={sidebarOpen ? 'Masquer le menu latéral' : 'Afficher le menu latéral'}
                  variant="secondary"
                  size="sm"
                  aria-expanded={sidebarOpen}
                  onClick={() => setSidebarOpen((o) => !o)}
                >
                  <PanelLeft aria-hidden className="size-4" />
                </IconButton>
                {activeId ? (
                  // Title = name of the open document, **editable by clicking it** (inline rename).
                  // Uncontrolled + `key={activeId}`: remounts with the right name when switching boards.
                  <input
                    key={activeId}
                    defaultValue={activeName}
                    aria-label="Titre du board"
                    placeholder="Sans titre"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      else if (e.key === 'Escape') {
                        e.currentTarget.value = activeName;
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== activeName) handleRename(activeId, next);
                      else e.target.value = activeName; // empty or unchanged → restore
                    }}
                    className="min-w-0 max-w-[40vw] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold text-text outline-none transition-colors hover:border-border focus:border-border focus-visible:ring-2 focus-visible:ring-accent"
                  />
                ) : (
                  <h1 className="text-base font-semibold text-text">Memorii Whiteboard</h1>
                )}
              </div>
              <div className="pointer-events-auto flex items-center gap-2">
                {/* Presence avatars + arrival notification just below. */}
                <div className="relative">
                  <PresenceAvatars users={participants} />
                  <div
                    aria-live="polite"
                    className="pointer-events-none absolute right-full top-1/2 mr-2 transition-all duration-300"
                    style={{
                      opacity: joinToast ? 1 : 0,
                      transform: `translateY(-50%) translateX(${joinToast ? '0' : '4px'})`,
                    }}
                  >
                    {joinToast && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text shadow-md">
                        <span
                          className="size-1.5 rounded-full bg-green-500 shadow-[0_0_5px_1px_rgba(34,197,94,0.7)]"
                          aria-hidden="true"
                        />
                        {joinToast}
                      </span>
                    )}
                  </div>
                </div>
                <SharePopover
                  live={live}
                  inviteUrl={inviteUrl}
                  participantsCount={participants.length}
                  name={name}
                  onNameChange={handleNameChange}
                  disabled={wiring.demo}
                  creds={activeCreds}
                  onToggleOnline={toggleOnline}
                  onRegenerate={regenerateCreds}
                />
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconButton
                        size="sm"
                        variant="secondary"
                        onClick={toggle}
                        label={
                          theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'
                        }
                      >
                        {theme === 'dark' ? (
                          <Sun aria-hidden className="size-4" />
                        ) : (
                          <Moon aria-hidden className="size-4" />
                        )}
                      </IconButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* AI assistant: opens/closes the chat module docked right (NL board editing). */}
                <IconButton
                  size="sm"
                  variant={aiOpen ? 'primary' : 'secondary'}
                  aria-expanded={aiOpen}
                  onClick={() => setAiOpen((o) => !o)}
                  label={aiOpen ? 'Fermer l’assistant IA' : 'Ouvrir l’assistant IA'}
                >
                  <Sparkles aria-hidden className="size-4" />
                </IconButton>
              </div>
            </div>
          </div>

          {/* AI module **docked** right (a real vertical pane, not an overlay). Always mounted;
              chat state preserved. Resizable via the left handle. Clean style: just a `border-l`.
              **Flash-free animation**: the WIDTH changes at once (the canvas resizes only ONCE)
              and the CONTENT slides — otherwise an animated width redraws the canvas in a loop
              for 200ms and makes the board flash. */}
          <div
            inert={!aiOpen}
            style={{ width: aiOpen ? aiWidth : 0 }}
            className={`relative h-full shrink-0 overflow-hidden bg-surface ${
              aiOpen ? 'border-l border-border' : ''
            }`}
          >
            {/* Resize handle (left edge). */}
            {aiOpen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionner le panneau de l’assistant"
                onPointerDown={startAiResize}
                className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-accent/40 active:bg-accent/60"
              />
            )}
            {/* Fixed-width content that **slides** (translateX) on open. */}
            <div
              style={{ width: aiWidth, transform: aiOpen ? 'translateX(0)' : 'translateX(100%)' }}
              className={`h-full ${aiResizing ? '' : 'transition-transform duration-200 ease-out'}`}
            >
              {space.active ? (
                <AiChatPanel
                  engine={space.active.engine}
                  onMutated={forceRender}
                  onClose={() => setAiOpen(false)}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
                  Ouvre ou crée un board pour utiliser l’assistant.
                </div>
              )}
            </div>
          </div>
        </div>
      </AppShell>

      {/* "Join a room" dialog (credential entry / pasted link). */}
      <JoinRoomDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onJoin={joinSession}
        disabled={wiring.demo}
      />
    </>
  );
}
