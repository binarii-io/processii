import { useEffect, useState, type ComponentType } from 'react';
import { Lightbulb, Network, Workflow } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, type LucideProps } from './ui/index.js';
import type { WhiteboardEngine } from './engine.js';
import { BOARD_TYPES, type BoardType } from './scene.js';

/** Type-of-board metadata (label + icon) shown by the {@link BoardTypePicker}. */
const BOARD_TYPE_META: Record<BoardType, { label: string; icon: ComponentType<LucideProps> }> = {
  process: { label: 'Process', icon: Workflow },
  architecture: { label: 'Architecture', icon: Network },
  ideation: { label: 'Idéation', icon: Lightbulb },
};

export interface BoardTypePickerProps {
  readonly engine: WhiteboardEngine;
  /** Notifies the parent that the board type changed (optional React state refresh). */
  readonly onChange?: (() => void) | undefined;
}

/**
 * **Board-type** selector: sets the scene-level classification, shared in collab via
 * `engine.setBoardType`. **Self-contained** — it tracks the engine and reflects external changes
 * (peers, undo/redo) through `board.observe`, so it can be dropped into any host chrome (e.g. next
 * to the document title) without wiring a refresh. The type **gates the process-modelling toolbar
 * tools** (step / sub-process / swimlane / group are shown on the `process` board only); the
 * rendering is otherwise identical per type.
 */
export function BoardTypePicker({ engine, onChange }: BoardTypePickerProps) {
  const [current, setCurrent] = useState<BoardType>(() => engine.getBoardType());

  // Reflect the shared value: reseed on engine change and on any board update (collab, undo/redo).
  useEffect(() => {
    const refresh = (): void => setCurrent(engine.getBoardType());
    refresh();
    return engine.board.observe(refresh);
  }, [engine]);

  const set = (value: BoardType): void => {
    engine.setBoardType(value);
    setCurrent(value);
    onChange?.();
  };

  const CurrentIcon = BOARD_TYPE_META[current].icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Type de board : ${BOARD_TYPE_META[current].label}`}
          title={`Type de board : ${BOARD_TYPE_META[current].label}`}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs text-text hover:border-accent"
        >
          <CurrentIcon aria-hidden className="size-4" />
          <span>{BOARD_TYPE_META[current].label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" aria-label="Type de board">
        {BOARD_TYPES.map((type) => {
          const meta = BOARD_TYPE_META[type];
          const Icon = meta.icon;
          const active = current === type;
          return (
            <button
              key={type}
              type="button"
              aria-current={active}
              onClick={() => set(type)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                active ? 'bg-accent-subtle text-accent' : 'text-text hover:bg-accent-subtle'
              }`}
            >
              <Icon aria-hidden className="size-4" />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
