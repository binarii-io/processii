import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CrdtAwareness, CrdtDoc } from './crdt/index.js';
import { engineFromDoc, type BoundingBox, type WhiteboardEngine } from './engine.js';
import { publishIdentity } from './presence.js';
import { BoardCanvas, type ZoomApi } from './board-canvas.js';
import { SidePanel } from './side-panel.js';
import { Toolbar } from './toolbar.js';
import {
  viewportCenter,
  visibleWorldRect,
  type Point,
  type Size,
  type Viewport,
} from './viewport.js';

/**
 * Presence identity of the local collaborator (name + ui-kit token color) — displayed on the
 * remote cursors/selections. Same shape as the `collaborator` of `@app/notes` (`NotesEditor`),
 * for identical wiring on the apps' side.
 */
export interface WhiteboardCollaborator {
  readonly name: string;
  readonly color: string;
}

export interface WhiteboardEditorProps {
  /**
   * Engine mounted on the document's `Y.Doc`. **Shared instance**: toolbar, canvas and
   * properties panel act on it → do not create a second one (the selection is local to the
   * engine). To start from a `CrdtDoc`, use `useWhiteboardEngine(doc)`.
   */
  readonly engine: WhiteboardEngine;
  /** Shared awareness (remote cursors/selections + local identity). */
  readonly awareness?: CrdtAwareness;
  /** Local identity published into the awareness on mount (presence). */
  readonly collaborator?: WhiteboardCollaborator;
  /**
   * Editing allowed (default `true`). In read-only mode, the toolbar and the properties panel
   * are hidden (the canvas stays navigable: pan/zoom/selection, local state with no effect on the doc).
   */
  readonly editable?: boolean;
  /**
   * **Sub-process** — creates a child whiteboard linked to a step: the host app creates the
   * document (parent = current document), **without switching the active document**, and
   * returns its **id** (or `null`). Absent → the sub-process action is not offered.
   */
  readonly onCreateSubprocess?: () => Promise<string | null>;
  /** **Sub-process** — "enter" the `ref` child whiteboard (double-click / Open button). */
  readonly onNavigateSubprocess?: (ref: string) => void;
  /** Class of the full-frame container (positioning by the host app). */
  readonly className?: string;
}

/**
 * **Full editing surface** of the whiteboard, shared by `apps/web` (server sync) and
 * `apps/whiteboard-standalone` (P2P). Composes the drawing surface (`BoardCanvas`), the floating
 * toolbar (`Toolbar`, bottom-center) and the contextual properties panel (`SidePanel`, under the
 * top-right corner) in a **full-frame** container. In-canvas presence (cursors/selections) is
 * handled by `BoardCanvas` via the `awareness`; the avatar chips remain the host app's
 * responsibility (per-app chrome).
 *
 * No business state of its own: all shared state lives in the `Y.Doc` (via `engine`). The editor
 * only holds locally the **selected lane** and a refresh counter (React re-render when the
 * engine changes, to reflect selection/count in the toolbar and the panel).
 */
export function WhiteboardEditor({
  engine,
  awareness,
  collaborator,
  editable = true,
  onCreateSubprocess,
  onNavigateSubprocess,
  className,
}: WhiteboardEditorProps) {
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // Latest local viewport (pan/zoom) + canvas size, mirrored from `BoardCanvas`. Kept in a ref, not
  // state: it is only read on demand when creating an item, so it must not trigger a re-render (it
  // changes on every pan/zoom frame). Presentation state — never persisted or shared.
  const viewRef = useRef<{ viewport: Viewport; size: Size } | null>(null);
  const handleViewportChange = useCallback((viewport: Viewport, size: Size): void => {
    viewRef.current = { viewport, size };
  }, []);

  // World point at the center of the visible canvas (or `null` before the first measure). Passed to
  // the toolbar so new items spawn where the user is looking, not at a fixed off-screen position.
  const getSpawnCenter = useCallback(
    (): Point | null =>
      viewRef.current ? viewportCenter(viewRef.current.viewport, viewRef.current.size) : null,
    [],
  );
  // World rectangle currently on screen — drives context-aware swimlane placement (join the
  // looked-at cluster vs. a fresh centered one).
  const getViewRect = useCallback(
    (): BoundingBox | null =>
      viewRef.current ? visibleWorldRect(viewRef.current.viewport, viewRef.current.size) : null,
    [],
  );
  // Imperative view control from the canvas (pan-to-center) — lets a newly created off-screen lane
  // be revealed.
  const zoomApiRef = useRef<ZoomApi | null>(null);
  const handleZoomApi = useCallback((api: ZoomApi): void => {
    zoomApiRef.current = api;
  }, []);
  const centerView = useCallback((world: Point): void => {
    zoomApiRef.current?.centerOn(world);
  }, []);

  // Publishes the local identity (name/color) into the awareness — once per (awareness, collaborator).
  useEffect(() => {
    if (awareness && collaborator) publishIdentity(awareness, collaborator);
  }, [awareness, collaborator]);

  // Re-render when the engine changes (local selection, remote deletions…) to keep the
  // toolbar (count) and the panel (selected step/lane) consistent.
  useEffect(() => engine.observe(forceRender), [engine]);

  // Floating properties panel: visible when a lane is selected, or a **step** (click).
  const engineSel = engine.getSelection();
  const stepSelected =
    engineSel.length === 1 && engine.board.getElement(engineSel[0]!)?.kind === 'step';
  const showProps = editable && (!!selectedLaneId || stepSelected);

  return (
    <div className={className ?? 'relative h-full w-full overflow-hidden'}>
      <div className="absolute inset-0 flex">
        <BoardCanvas
          engine={engine}
          onChange={forceRender}
          {...(awareness ? { awareness } : {})}
          selectedLaneId={selectedLaneId}
          onSelectLane={setSelectedLaneId}
          onViewportChange={handleViewportChange}
          onZoomApi={handleZoomApi}
          {...(onNavigateSubprocess ? { onNavigateSubprocess } : {})}
        />
      </div>

      {/* Floating properties panel (top-right corner, under a possible floating header of the
          host app) — selected step or lane. */}
      {showProps && (
        <aside
          aria-label="Propriétés"
          className="absolute right-3 top-14 z-20 flex max-h-[calc(100%-4.5rem)] w-72 flex-col overflow-auto rounded-xl border border-border bg-surface p-4 shadow-lg ring-1 ring-black/5"
        >
          <SidePanel
            engine={engine}
            selectedLaneId={selectedLaneId}
            onChange={forceRender}
            onSelectLane={setSelectedLaneId}
            {...(onCreateSubprocess ? { onCreateSubprocess } : {})}
            {...(onNavigateSubprocess ? { onNavigateSubprocess } : {})}
          />
        </aside>
      )}

      {/* Floating toolbar (bottom-center). Styling (fill/stroke/width) is NOT here: it appears
          above the selected element (see BoardCanvas). */}
      {editable && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full items-center rounded-2xl border border-border bg-surface p-2 shadow-xl">
            <Toolbar
              engine={engine}
              onChange={forceRender}
              selectionCount={engineSel.length}
              getSpawnCenter={getSpawnCenter}
              getViewRect={getViewRect}
              onCenterView={centerView}
              {...(onCreateSubprocess ? { onCreateSubprocess } : {})}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mounts a `WhiteboardEngine` on a `CrdtDoc` (memoized by `doc` identity). For consumers that
 * start from a CRDT document (e.g. `apps/web` via `openDocument`) rather than an already-created
 * engine. Returns `null` while the `doc` is unavailable.
 */
export function useWhiteboardEngine(doc: CrdtDoc | null | undefined): WhiteboardEngine | null {
  return useMemo(() => (doc ? engineFromDoc(doc) : null), [doc]);
}
