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
import {
  Boxes,
  Circle,
  Group,
  RectangleHorizontal,
  Redo2,
  Rows3,
  Spline,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { WhiteboardEngine } from './engine.js';

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
}

let seq = 0;
function elementId(): string {
  seq += 1;
  return `el-${Date.now().toString(36)}-${seq}`;
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
} & Omit<IconButtonProps, 'label' | 'children' | 'size'>) {
  const button = (
    <IconButton size="sm" variant={variant} label={label} {...props}>
      <Icon aria-hidden className="size-4" />
    </IconButton>
  );
  return (
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
  );
}

/** **Board background** palette (CSS literals) offered by the toolbar color block. */
const BOARD_BACKGROUNDS: readonly { value: string; label: string }[] = [
  { value: '#ffffff', label: 'Blanc' },
  { value: '#f4f4f5', label: 'Gris clair' },
  { value: '#fef9c3', label: 'Jaune' },
  { value: '#dcfce7', label: 'Vert' },
  { value: '#dbeafe', label: 'Bleu' },
  { value: '#fae8ff', label: 'Violet' },
  { value: '#ffe4e6', label: 'Rose' },
  { value: '#fff7ed', label: 'Crème' },
  { value: '#e7e5e4', label: 'Pierre' },
  { value: '#334155', label: 'Ardoise' },
  { value: '#0c0c0e', label: 'Noir' },
];

/**
 * Toolbar **color block**: changes the **board background color** (shared in collab via
 * `engine.setBackground`). The swatch reflects the current background (gradient = theme default);
 * the popover offers a soft-tone palette + a **reset to default**.
 */
function BackgroundPicker({
  engine,
  onChange,
}: {
  readonly engine: WhiteboardEngine;
  readonly onChange?: (() => void) | undefined;
}) {
  const current = engine.getBackground();
  const set = (value: string | null): void => {
    engine.setBackground(value);
    onChange?.();
  };
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
          {BOARD_BACKGROUNDS.map((c) => {
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

  const add = (input: Parameters<WhiteboardEngine['addElement']>[0]): void => {
    engine.addElement(input);
    onChange?.();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex flex-wrap items-center gap-1"
        role="toolbar"
        aria-label="Outils de dessin"
      >
        <ToolButton
          label="Rectangle"
          icon={Square}
          onClick={() =>
            add({
              kind: 'rectangle',
              id: elementId(),
              x: 40,
              y: 40,
              width: 120,
              height: 80,
              fill: 'surface', // white background by default (theme token: white in light, card in dark)
              stroke: 'transparent', // no outline by default — the shape is detached by its shadow
            })
          }
        />
        <ToolButton
          label="Ellipse"
          icon={Circle}
          onClick={() =>
            add({
              kind: 'ellipse',
              id: elementId(),
              x: 80,
              y: 80,
              width: 100,
              height: 100,
              fill: 'surface',
              stroke: 'transparent',
            })
          }
        />
        <ToolButton
          label="Texte"
          icon={Type}
          onClick={() =>
            add({
              kind: 'text',
              id: elementId(),
              x: 60,
              y: 60,
              width: 160,
              height: 32,
              text: 'Texte',
            })
          }
        />
        <ToolButton
          label="Sticky"
          icon={StickyNote}
          onClick={() =>
            add({
              kind: 'text',
              id: elementId(),
              x: 60,
              y: 60,
              width: 140,
              height: 100,
              text: 'Note',
              fill: 'warning-subtle',
            })
          }
        />
        <ToolButton
          label="Connecteur"
          tooltip={
            selectionCount === 2
              ? 'Connecter les 2 éléments sélectionnés'
              : 'Sélectionnez exactement 2 éléments pour les connecter'
          }
          icon={Spline}
          disabled={selectionCount !== 2}
          onClick={() => {
            const [a, b] = engine.getSelection();
            if (a && b) {
              engine.connect(elementId(), a, b, { endArrow: true });
              onChange?.();
            }
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolButton
          label="Étape"
          icon={RectangleHorizontal}
          onClick={() =>
            add({
              kind: 'step',
              id: elementId(),
              x: 80,
              y: 80,
              width: 200,
              height: 120,
              name: 'Étape',
              fill: 'surface', // default item: white background + no outline, detached by its shadow
              stroke: 'transparent',
            })
          }
        />
        {onCreateSubprocess && (
          <ToolButton
            label="Sous-process"
            icon={Boxes}
            onClick={() => {
              // The host app creates the child whiteboard (parent = current doc) and returns its
              // id; we then add a linked step. Failure/cancel (null) → nothing is added.
              void onCreateSubprocess().then((ref) => {
                if (!ref) return;
                add({
                  kind: 'step',
                  id: elementId(),
                  x: 80,
                  y: 80,
                  width: 200,
                  height: 120,
                  name: 'Sous-process',
                  subprocessRef: ref,
                });
              });
            }}
          />
        )}
        <ToolButton
          label="Swimlane"
          icon={Rows3}
          onClick={() => {
            engine.addSwimlane({
              id: elementId(),
              name: 'Bande',
              order: engine.listSwimlanes().length,
              color: 'neutral',
              height: 180,
            });
            onChange?.();
          }}
        />
        <ToolButton
          label="Groupe"
          icon={Group}
          disabled={selectionCount < 1}
          onClick={() => {
            const ids = engine.getSelection();
            if (ids.length > 0) {
              engine.addAgentGroup({ id: elementId(), name: 'Groupe', stepIds: ids });
              onChange?.();
            }
          }}
        />
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
