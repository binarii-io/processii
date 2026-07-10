import { useCallback, useEffect, useReducer, type ComponentType } from 'react';
import {
  Boxes,
  Circle,
  Group,
  RectangleHorizontal,
  Rows3,
  Spline,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import type { BoundingBox, WhiteboardEngine } from './engine.js';
import type { LucideProps } from './ui/index.js';
import type { Point } from './viewport.js';

/**
 * **Headless** descriptor of a single whiteboard tool — the LOGIC of a toolbar entry with **zero
 * styling**. A host renders its own button chrome from this shape (`icon`, `label`, `disabled`) and
 * calls `run()` to execute the action. The styled default {@link Toolbar} is one such host; any
 * other host (a different design system, a command palette, a keyboard shortcut) consumes the same
 * hook, so the action logic (create a shape, connect, add a swimlane…) lives in exactly one place.
 */
export interface WhiteboardTool {
  /** Stable identifier of the tool (also handy as a React `key`). */
  readonly id:
    | 'rectangle'
    | 'ellipse'
    | 'text'
    | 'sticky'
    | 'connector'
    | 'step'
    | 'subprocess'
    | 'swimlane'
    | 'group';
  /** Human label (product copy, French) — e.g. `'Rectangle'`, `'Étape'`. */
  readonly label: string;
  /** Lucide icon component for the tool (decorative — the host sets `aria-hidden`). */
  readonly icon: ComponentType<LucideProps>;
  /**
   * `'draw'` = generic drawing tool available on **every** board type; `'process'` = process-
   * modelling tool exposed **only** on the `process` board (already filtered out of the returned
   * list on non-process boards — the group is provided so a host can section/label its own chrome).
   */
  readonly group: 'draw' | 'process';
  /**
   * Whether the tool cannot run in the current state (e.g. `connector` needs exactly 2 selected
   * elements; `group` needs at least 1). A host disables its button accordingly.
   */
  readonly disabled: boolean;
  /** Executes the tool's action (mutates the engine, then calls `opts.onChange`). */
  readonly run: () => void;
}

/**
 * Options for {@link useWhiteboardTools} — all optional, mirroring the wiring the styled
 * {@link Toolbar} receives from `WhiteboardEditor`. Absent options fall back to the historical
 * behaviour (fixed placement, legacy swimlane block, no sub-process button).
 */
export interface UseWhiteboardToolsOptions {
  /**
   * Number of currently selected elements. Drives the `disabled` state of `connector` (needs 2) and
   * `group` (needs ≥ 1), and is read by `connector.run`. A host that tracks the selection itself
   * passes it here so the descriptors stay in sync with its chrome.
   */
  readonly selectionCount?: number;
  /**
   * Returns the world point at the **center of the visible canvas** (or `null` if unknown). When
   * provided, new shapes are dropped there — centered on what the user is looking at — instead of at
   * a fixed world position. Mirror of {@link Toolbar}'s prop of the same name.
   */
  readonly getSpawnCenter?: () => Point | null;
  /**
   * Returns the **world rectangle** currently visible on the canvas (see `visibleWorldRect`), or
   * `null` if unknown. Drives context-aware swimlane placement (join the looked-at cluster vs. a
   * fresh one). Mirror of {@link Toolbar}'s prop of the same name.
   */
  readonly getViewRect?: () => BoundingBox | null;
  /**
   * Pans the view so the given world point is centered (e.g. `ZoomApi.centerOn`). When provided,
   * creating a swimlane that lands off-screen recentres the view onto it. Mirror of {@link Toolbar}.
   */
  readonly onCenterView?: (world: Point) => void;
  /**
   * Sub-process: creates a child whiteboard (via the host app) and returns its opaque **id**.
   * **Presence gates the `subprocess` tool** — it only appears in the returned list when this is
   * supplied (and the board is `process`). A resolved `null` (failure/cancel) adds nothing.
   */
  readonly onCreateSubprocess?: () => Promise<string | null>;
  /** Called after every successful edit, so the host can refresh its React state. */
  readonly onChange?: () => void;
}

let seq = 0;
function elementId(): string {
  seq += 1;
  return `el-${Date.now().toString(36)}-${seq}`;
}

/**
 * **Headless whiteboard tools** hook — returns the descriptors of the board's editing tools so a
 * host can render its **own** toolbar (or command palette, shortcuts…) without forking the action
 * logic or overriding CSS. The styled default {@link Toolbar} is refactored to consume this same
 * hook, so there is a single source of truth for what each tool does.
 *
 * **Board-type gating.** The process-modelling tools (`step`, `subprocess`, `swimlane`, `group`)
 * are returned **only** on the `process` board — the exact rule the 0.5.0 `Toolbar` applied. On
 * other board types the list holds just the generic drawing tools (`rectangle`, `ellipse`, `text`,
 * `sticky`, `connector`).
 *
 * **Reactivity.** The hook subscribes to `engine.board.observe`, so the descriptors recompute when
 * the shared board type changes (a peer / undo / the `BoardTypePicker`). Selection-driven `disabled`
 * states come from `opts.selectionCount` (the host owns the local selection), so pass it to keep
 * `connector`/`group` in sync.
 *
 * The `subprocess` tool is present only when `opts.onCreateSubprocess` is supplied.
 */
export function useWhiteboardTools(
  engine: WhiteboardEngine,
  opts: UseWhiteboardToolsOptions = {},
): WhiteboardTool[] {
  const {
    selectionCount = 0,
    getSpawnCenter,
    getViewRect,
    onCenterView,
    onCreateSubprocess,
    onChange,
  } = opts;

  // Recompute on shared board updates (board type changes drive which tools are exposed). The engine
  // has no local React state; a bump forces a re-render so `engine.getBoardType()` is re-read.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => engine.board.observe(forceUpdate), [engine]);

  const add = useCallback(
    (input: Parameters<WhiteboardEngine['addElement']>[0]): void => {
      engine.addElement(input);
      onChange?.();
    },
    [engine, onChange],
  );

  // Top-left corner (world coords) for a new shape of the given size so it ends up **centered on the
  // visible canvas**. Falls back to the historical fixed position when the viewport center is unknown
  // (host not wired / before the first canvas measure).
  const placeAt = useCallback(
    (
      width: number,
      height: number,
      fallbackX: number,
      fallbackY: number,
    ): { x: number; y: number } => {
      const center = getSpawnCenter?.();
      if (!center) return { x: fallbackX, y: fallbackY };
      return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
    },
    [getSpawnCenter],
  );

  const isProcess = engine.getBoardType() === 'process';

  const tools: WhiteboardTool[] = [
    {
      id: 'rectangle',
      label: 'Rectangle',
      icon: Square,
      group: 'draw',
      disabled: false,
      run: () =>
        add({
          kind: 'rectangle',
          id: elementId(),
          ...placeAt(120, 80, 40, 40),
          width: 120,
          height: 80,
          fill: 'surface', // white background by default (theme token: white in light, card in dark)
          stroke: 'transparent', // no outline by default — the shape is detached by its shadow
        }),
    },
    {
      id: 'ellipse',
      label: 'Ellipse',
      icon: Circle,
      group: 'draw',
      disabled: false,
      run: () =>
        add({
          kind: 'ellipse',
          id: elementId(),
          ...placeAt(100, 100, 80, 80),
          width: 100,
          height: 100,
          fill: 'surface',
          stroke: 'transparent',
        }),
    },
    {
      id: 'text',
      label: 'Texte',
      icon: Type,
      group: 'draw',
      disabled: false,
      run: () =>
        add({
          kind: 'text',
          id: elementId(),
          ...placeAt(160, 32, 60, 60),
          width: 160,
          height: 32,
          text: 'Texte',
        }),
    },
    {
      id: 'sticky',
      label: 'Sticky',
      icon: StickyNote,
      group: 'draw',
      disabled: false,
      run: () =>
        add({
          kind: 'text',
          id: elementId(),
          ...placeAt(140, 100, 60, 60),
          width: 140,
          height: 100,
          text: 'Note',
          fill: 'warning-subtle',
        }),
    },
    {
      id: 'connector',
      label: 'Connecteur',
      icon: Spline,
      group: 'draw',
      disabled: selectionCount !== 2,
      run: () => {
        const [a, b] = engine.getSelection();
        if (a && b) {
          engine.connect(elementId(), a, b, { endArrow: true });
          onChange?.();
        }
      },
    },
  ];

  if (isProcess) {
    tools.push({
      id: 'step',
      label: 'Étape',
      icon: RectangleHorizontal,
      group: 'process',
      disabled: false,
      run: () =>
        add({
          kind: 'step',
          id: elementId(),
          ...placeAt(200, 120, 80, 80),
          width: 200,
          height: 120,
          name: 'Étape',
          fill: 'surface', // default item: white background + no outline, detached by its shadow
          stroke: 'transparent',
        }),
    });

    if (onCreateSubprocess) {
      tools.push({
        id: 'subprocess',
        label: 'Sous-process',
        icon: Boxes,
        group: 'process',
        disabled: false,
        run: () => {
          // The host app creates the child whiteboard (parent = current doc) and returns its id; we
          // then add a linked step. Failure/cancel (null) → nothing is added.
          void onCreateSubprocess().then((ref) => {
            if (!ref) return;
            add({
              kind: 'step',
              id: elementId(),
              ...placeAt(200, 120, 80, 80),
              width: 200,
              height: 120,
              name: 'Sous-process',
              subprocessRef: ref,
            });
          });
        },
      });
    }

    tools.push({
      id: 'swimlane',
      label: 'Swimlane',
      icon: Rows3,
      group: 'process',
      disabled: false,
      run: () => {
        // Smart placement: join the cluster the user is looking at, or start a fresh one centered on
        // the view (see `engine.addSwimlaneInView`).
        const visible = getViewRect?.() ?? undefined;
        const { band } = engine.addSwimlaneInView(
          { id: elementId(), name: 'Bande', color: 'neutral', height: 180 },
          visible,
        );
        onChange?.();
        // Always recentre the view on the new lane — both axes, on its band center. A fresh cluster is
        // created centered on the view → no-op there; appending into an existing cluster scrolls the
        // view onto the new band (horizontally onto the cluster center, vertically onto the lane).
        if (onCenterView && visible) {
          onCenterView({ x: band.x + band.width / 2, y: band.y + band.height / 2 });
        }
      },
    });

    tools.push({
      id: 'group',
      label: 'Groupe',
      icon: Group,
      group: 'process',
      disabled: selectionCount < 1,
      run: () => {
        const ids = engine.getSelection();
        if (ids.length > 0) {
          engine.addAgentGroup({ id: elementId(), name: 'Groupe', stepIds: ids });
          onChange?.();
        }
      },
    });
  }

  return tools;
}
