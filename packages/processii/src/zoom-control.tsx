import { cn } from './ui/index.js';

export interface ZoomControlProps {
  /** Current zoom as a percentage (e.g. 100). */
  readonly percent: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Reset to 100 % (triggered by clicking the percentage). */
  readonly onReset: () => void;
  /** Extra classes merged onto the pill — positioning, shadow, `pointer-events-auto`… */
  readonly className?: string;
}

/**
 * Zoom control pill: **−** / current **%** (click = reset to 100 %) / **+**. Purely presentational
 * (DOM/React only, no engine): the host wires the actions — e.g. from `BoardCanvas`'s `onZoomApi` —
 * and positions it via `className` (standalone, e.g. inside a floating bottom bar). `BoardCanvas`
 * renders one itself unless `hideZoomControl` is set.
 */
export function ZoomControl({
  percent,
  onZoomIn,
  onZoomOut,
  onReset,
  className,
}: ZoomControlProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border border-border bg-surface px-1 py-0.5 text-xs text-text',
        className,
      )}
      role="group"
      aria-label="Contrôles de zoom"
    >
      <button
        type="button"
        className="px-1.5 py-0.5 hover:text-accent"
        aria-label="Dézoomer"
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        className="min-w-[3rem] px-1 py-0.5 tabular-nums hover:text-accent"
        aria-label="Réinitialiser le zoom"
        onClick={onReset}
      >
        {percent}%
      </button>
      <button
        type="button"
        className="px-1.5 py-0.5 hover:text-accent"
        aria-label="Zoomer"
        onClick={onZoomIn}
      >
        +
      </button>
    </div>
  );
}
