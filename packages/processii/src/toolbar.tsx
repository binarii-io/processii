import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type IconButtonProps,
  type LucideProps,
} from './ui/index.js';
import { Redo2, Trash2, Undo2 } from 'lucide-react';
import type { BoundingBox, WhiteboardEngine } from './engine.js';
import type { Point } from './viewport.js';
import { useWhiteboardTools, type WhiteboardTool } from './use-whiteboard-tools.js';
import { useBoardBackground } from './use-board-background.js';

/**
 * **Local** editing toolbar: adds shapes, deletes the selection, and exposes
 * **undo/redo** (`@binarii/processii` history backed by the `Y.UndoManager`, scoped to local edits).
 * Every edit is immediate and local (offline-first); when a P2P session is open, the Yjs update
 * is propagated to peers by the wired transport — the toolbar does not need to know.
 */
export interface ToolbarProps {
  readonly engine: WhiteboardEngine;
  /** Notifies the parent that an edit happened (React state refresh). */
  readonly onChange?: () => void;
  /** Number of selected elements (enables "Connector" when it equals 2). */
  readonly selectionCount?: number;
  /**
   * Sub-process: creates a child whiteboard (via the host app) and returns its opaque **id**.
   * Present → shows the "Sub-process" button (adds a step linked to this new child).
   */
  readonly onCreateSubprocess?: () => Promise<string | null>;
  /**
   * Returns the world point at the **center of the visible canvas** (or `null` if not known yet).
   * When provided, newly created shapes are dropped there — centered on what the user is currently
   * looking at — instead of at a fixed world position that may be off-screen. Wired by
   * `WhiteboardEditor` from the canvas viewport; absent → the historical fixed placement is used.
   */
  readonly getSpawnCenter?: () => Point | null;
  /**
   * Returns the **world rectangle** currently visible on the canvas (see `visibleWorldRect`), or
   * `null` if not known yet. Drives **context-aware swimlane placement**: a new lane joins the
   * cluster the user is looking at, or — when none is on screen — starts a fresh cluster centered on
   * the view. Wired by `WhiteboardEditor` from the canvas viewport; absent → the historical
   * "stack onto the first block" placement is used.
   */
  readonly getViewRect?: () => BoundingBox | null;
  /**
   * Pans the view so the given world point is centered (e.g. the canvas `ZoomApi.centerOn`). When
   * provided, creating a swimlane that lands off-screen recentres the view to reveal it.
   */
  readonly onCenterView?: (world: Point) => void;
}

/**
 * **Icon-only** tool button: the Lucide icon is decorative (`aria-hidden`) and the `label`
 * serves both as `aria-label` (accessibility, required by `IconButton`) and as a tooltip on
 * hover/keyboard focus — the caption thus stays accessible without visible text.
 */
function ToolButton({
  label,
  tooltip,
  icon: Icon,
  variant = 'secondary',
  beforeSeparator = false,
  ...props
}: {
  readonly label: string;
  /**
   * Tooltip caption; defaults to `label`. Pass a distinct value to explain a
   * **disabled** state (e.g. why the tool is unavailable) — the caption is
   * surfaced even when the button is disabled.
   */
  readonly tooltip?: ReactNode;
  readonly icon: ComponentType<LucideProps>;
  /** Renders a vertical divider just before the button (group boundary). */
  readonly beforeSeparator?: boolean;
} & Omit<IconButtonProps, 'label' | 'children' | 'size'>) {
  const button = (
    <IconButton size="sm" variant={variant} label={label} {...props}>
      <Icon aria-hidden className="size-4" />
    </IconButton>
  );
  return (
    <>
      {beforeSeparator && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
      <Tooltip>
        <TooltipTrigger asChild>
          {props.disabled ? (
            /*
              A disabled <button> emits no pointer/focus events, so it can't be a
              tooltip trigger on its own. Only in that case, wrap it in a focusable
              span that stands in as the trigger — the caption (Radix's
              `aria-describedby`) then lands on the span the user hovers/focuses.
              Enabled buttons stay their own trigger, so the description keeps
              being announced on the focused button (no screen-reader regression).
            */
            <span className="inline-flex shrink-0" tabIndex={0}>
              {button}
            </span>
          ) : (
            button
          )}
        </TooltipTrigger>
        <TooltipContent>{tooltip ?? label}</TooltipContent>
      </Tooltip>
    </>
  );
}

/**
 * Tooltip caption for a headless tool descriptor. Most tools use their label; the connector explains
 * its selection requirement (surfaced even while disabled) — matching the 0.5.0 toolbar copy.
 */
function toolTooltip(tool: WhiteboardTool): ReactNode {
  if (tool.id === 'connector') {
    return tool.disabled
      ? 'Sélectionnez exactement 2 éléments pour les connecter'
      : 'Connecter les 2 éléments sélectionnés';
  }
  return undefined;
}

/**
 * Toolbar **color block**: changes the **board background color** (shared in collab via
 * `engine.setBackground`). The swatch reflects the current background (gradient = theme default);
 * the popover offers a soft-tone palette + a **reset to default**. The background state, palette and
 * write are driven by the headless {@link useBoardBackground} hook (single source of truth, reusable
 * by any host chrome).
 */
function BackgroundPicker({
  engine,
  onChange,
}: {
  readonly engine: WhiteboardEngine;
  readonly onChange?: (() => void) | undefined;
}) {
  const { current, set, palette } = useBoardBackground(engine, onChange);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Couleur du fond"
          title="Couleur du fond"
          className="flex size-8 items-center justify-center rounded-md border border-border bg-surface hover:border-accent"
        >
          <span
            className="size-4 rounded-[4px] border border-black/10"
            style={
              current
                ? { backgroundColor: current }
                : {
                    // Default (theme): subtle checker gradient to signal "automatic".
                    backgroundImage: 'linear-gradient(135deg, #ffffff 0 50%, #d4d4d8 50% 100%)',
                  }
            }
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" aria-label="Couleur du fond du board">
        <div className="grid grid-cols-6 gap-1">
          {palette.map((c) => {
            const active = current === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-label={`Fond ${c.label}`}
                title={c.label}
                onClick={() => set(c.value)}
                className={`size-6 rounded-[5px] border ${
                  active ? 'border-accent ring-2 ring-accent' : 'border-black/10'
                }`}
                style={{ backgroundColor: c.value }}
              />
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => set(null)}
          className={`mt-2 w-full rounded-md border px-2 py-1 text-xs ${
            current ? 'border-border text-text hover:border-accent' : 'border-accent text-accent'
          }`}
        >
          Par défaut (thème)
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function Toolbar({
  engine,
  onChange,
  selectionCount = 0,
  onCreateSubprocess,
  getSpawnCenter,
  getViewRect,
  onCenterView,
}: ToolbarProps) {
  const history = engine.history();
  const [canUndo, setCanUndo] = useState(history.canUndo());
  const [canRedo, setCanRedo] = useState(history.canRedo());

  // Reflects the undo/redo stack state (changes on local edit AND on undo/redo).
  useEffect(() => {
    const refresh = (): void => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    };
    refresh();
    return history.observe(refresh);
  }, [history]);

  // Tool descriptors (logic + board-type gating + disabled states) come from the headless
  // `useWhiteboardTools` hook — the SINGLE source of truth shared with any host that renders its own
  // toolbar. The styled `Toolbar` only maps each descriptor to a `ToolButton`. Undo/redo, delete and
  // the background block are chrome-specific (not "tools") and stay local here.
  const tools = useWhiteboardTools(engine, {
    selectionCount,
    ...(getSpawnCenter ? { getSpawnCenter } : {}),
    ...(getViewRect ? { getViewRect } : {}),
    ...(onCenterView ? { onCenterView } : {}),
    ...(onCreateSubprocess ? { onCreateSubprocess } : {}),
    ...(onChange ? { onChange } : {}),
  });

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex flex-wrap items-center gap-1"
        role="toolbar"
        aria-label="Outils de dessin"
      >
        {tools.map((tool, i) => {
          // A separator precedes the FIRST process tool — visually splitting the generic drawing
          // tools from the process-modelling ones (matches 0.5.0). Since process tools only appear on
          // a process board, the boundary is "the previous tool was in a different group".
          const withSeparator = i > 0 && tool.group !== tools[i - 1]?.group;
          return (
            <ToolButton
              key={tool.id}
              label={tool.label}
              icon={tool.icon}
              disabled={tool.disabled}
              tooltip={toolTooltip(tool)}
              beforeSeparator={withSeparator}
              onClick={tool.run}
            />
          );
        })}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <BackgroundPicker engine={engine} onChange={onChange} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolButton
          label="Annuler"
          icon={Undo2}
          variant="ghost"
          disabled={!canUndo}
          onClick={() => {
            history.undo();
            onChange?.();
          }}
        />
        <ToolButton
          label="Rétablir"
          icon={Redo2}
          variant="ghost"
          disabled={!canRedo}
          onClick={() => {
            history.redo();
            onChange?.();
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolButton
          label="Supprimer"
          icon={Trash2}
          variant="danger"
          disabled={selectionCount < 1}
          onClick={() => {
            engine.removeSelected();
            onChange?.();
          }}
        />
      </div>
    </TooltipProvider>
  );
}
