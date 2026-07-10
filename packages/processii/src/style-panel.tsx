import { useState, type ComponentType } from 'react';
import type { LucideProps } from './ui/index.js';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { WhiteboardEngine } from './engine.js';

/**
 * **Compact** style bar (FigJam-like): Fill / Stroke **chips** opening a **second panel** on
 * click. Fill panel = _Fill / No fill_ + palette; Stroke panel = _Solid / Dashed / None_ +
 * palette + width. For a **connector**, arrowheads. Applies to the selection via
 * `engine.updateSelection`; no-op without a selection.
 */
export interface StylePanelProps {
  readonly engine: WhiteboardEngine;
  readonly onChange?: () => void;
}

/**
 * Structured **hues × shades** palette (12 columns, 3 shades dark→light), following the style of
 * the reference editor. Each entry: `[dark, medium, light]`. First column = gray levels.
 */
const HUES: readonly (readonly [string, string, string])[] = [
  ['#111827', '#9ca3af', '#ffffff'],
  ['#1e3a8a', '#3b82f6', '#bfdbfe'],
  ['#0e7490', '#06b6d4', '#a5f3fc'],
  ['#0f766e', '#14b8a6', '#99f6e4'],
  ['#166534', '#22c55e', '#bbf7d0'],
  ['#3f6212', '#84cc16', '#d9f99d'],
  ['#a16207', '#eab308', '#fde68a'],
  ['#c2410c', '#f97316', '#fed7aa'],
  ['#b91c1c', '#ef4444', '#fecaca'],
  ['#9d174d', '#ec4899', '#fbcfe8'],
  ['#6d28d9', '#8b5cf6', '#ddd6fe'],
  ['#7e22ce', '#a855f7', '#e9d5ff'],
];
/** Colors flattened by **shade row** (row 0 = dark, 1 = medium, 2 = light). */
const PALETTE_ROWS: string[][] = [0, 1, 2].map((shade) => HUES.map((h) => h[shade]!));

const STROKE_WIDTHS = [1, 2, 4] as const;

/** Readable ink (black/white) to lay on a color (for the selection checkmark). */
function inkOn(hex: string): string {
  if (!hex.startsWith('#') || hex.length < 7) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111827' : '#ffffff';
}

export function StylePanel({ engine, onChange }: StylePanelProps) {
  const [panel, setPanel] = useState<'fill' | 'stroke' | null>(null);

  const apply = (patch: Parameters<WhiteboardEngine['updateSelection']>[0]): void => {
    engine.updateSelection(patch);
    onChange?.();
  };

  const sel = engine.getSelection();
  const selected = sel.length === 1 ? engine.board.getElement(sel[0]!) : undefined;
  const connector =
    selected && (selected.kind === 'line' || selected.kind === 'arrow') ? selected : undefined;
  // **Text-bearing** elements (#82): alignment + format (bold/italic/underline/strikethrough +
  // size) apply to all of the element's text. Connectors/swimlanes excluded.
  const textEl =
    selected &&
    (selected.kind === 'text' ||
      selected.kind === 'step' ||
      selected.kind === 'rectangle' ||
      selected.kind === 'ellipse')
      ? selected
      : undefined;
  const isTextKind = textEl?.kind === 'text';
  const fmt = textEl as
    | {
        textAlign?: 'left' | 'center' | 'right';
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strike?: boolean;
        fontSize?: number;
      }
    | undefined;
  const align = fmt?.textAlign ?? (isTextKind ? 'left' : 'center');
  const fontSize = fmt?.fontSize ?? (isTextKind ? 16 : 13);
  // "Card" drop shadow: togglable on rectangle/ellipse/text/step (not connectors).
  // **Enabled by default** everywhere (absent = on); only `shadow:false` turns it off.
  const supportsShadow =
    textEl?.kind === 'rectangle' ||
    textEl?.kind === 'ellipse' ||
    textEl?.kind === 'text' ||
    textEl?.kind === 'step';
  const shadowOn = (selected as { shadow?: boolean } | undefined)?.shadow !== false;
  const currentFill = selected?.fill;
  const currentStroke = selected?.stroke;
  const currentDash = selected?.strokeDash ?? 'solid';
  const currentWidth = selected?.strokeWidth ?? 2;
  const hasFill = !!currentFill && currentFill !== 'transparent';
  const hasStroke = !!currentStroke && currentStroke !== 'transparent';

  const isFill = panel === 'fill';
  const current = isFill ? currentFill : currentStroke;

  /** Segmented header tab (Fill/No fill, Solid/Dashed/None). */
  const tab = (label: React.ReactNode, active: boolean, onClick: () => void, ariaLabel: string) => (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 ${
        active ? 'bg-surface font-medium text-text shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  // A connector (line/arrow) has no fill → neither the chip nor the "Fill" panel is offered.
  const fillAvailable = !connector;

  /** Small toggle icon button (alignment / text format). */
  const iconBtn = (
    Icon: ComponentType<LucideProps>,
    label: string,
    active: boolean,
    onClick: () => void,
  ): React.JSX.Element => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md border ${
        active ? 'border-accent bg-accent text-accent-fg' : 'border-border hover:text-accent'
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );

  return (
    <div className="relative flex items-center gap-1.5 text-xs text-text" aria-label="Styles">
      {/* Second panel: segmented header + color grid (+ width for the stroke). */}
      {panel && !(isFill && !fillAvailable) && (
        <div
          role="group"
          aria-label={isFill ? 'Palette de fond' : 'Palette de trait'}
          className="absolute bottom-full right-0 z-10 mb-2 rounded-xl border border-border bg-surface p-2 shadow-xl"
        >
          {/* Segmented header */}
          <div className="mb-2 flex gap-0.5 rounded-lg bg-bg p-0.5">
            {isFill ? (
              <>
                {tab(
                  <>
                    <span className="size-3 rounded-sm bg-accent" /> Remplir
                  </>,
                  hasFill,
                  () => apply({ fill: hasFill ? currentFill! : HUES[4]![2] }),
                  'Remplir',
                )}
                {tab('⦸ Sans fond', !hasFill, () => apply({ fill: 'transparent' }), 'Sans fond')}
              </>
            ) : (
              <>
                {tab(
                  '— Plein',
                  hasStroke && currentDash !== 'dashed',
                  () => apply({ strokeDash: 'solid', ...(hasStroke ? {} : { stroke: '#111827' }) }),
                  'Plein',
                )}
                {tab(
                  '┄ Tirets',
                  hasStroke && currentDash === 'dashed',
                  () =>
                    apply({ strokeDash: 'dashed', ...(hasStroke ? {} : { stroke: '#111827' }) }),
                  'Tirets',
                )}
                {tab('⦸ Aucun', !hasStroke, () => apply({ stroke: 'transparent' }), 'Sans bordure')}
              </>
            )}
          </div>

          {/* Color grid: 3 shades × 12 hues, rounded square swatches. */}
          <div className="flex flex-col gap-1">
            {PALETTE_ROWS.map((row, r) => (
              <div key={r} className="flex gap-1">
                {row.map((color) => {
                  const active = current === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      aria-label={`${isFill ? 'Fond' : 'Trait'} ${color}`}
                      onClick={() => apply(isFill ? { fill: color } : { stroke: color })}
                      className={`flex size-[22px] items-center justify-center rounded-[5px] border ${
                        active ? 'border-accent ring-2 ring-accent' : 'border-black/10'
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {active && (
                        <span className="text-[11px] leading-none" style={{ color: inkOn(color) }}>
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Width (Stroke panel only) */}
          {!isFill && (
            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
              <span className="mr-1 text-muted">Épaisseur</span>
              {STROKE_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  aria-label={`Épaisseur ${width}`}
                  aria-pressed={currentWidth === width}
                  onClick={() => apply({ strokeWidth: width })}
                  className={`flex h-7 w-9 items-center justify-center rounded-md border ${
                    currentWidth === width ? 'border-accent ring-1 ring-accent' : 'border-border'
                  }`}
                >
                  <span
                    className="w-5 rounded-full bg-text"
                    style={{ height: Math.max(1, width) }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Text (#82): alignment + format + size — only on a text-bearing element. */}
      {textEl && fmt && (
        <>
          {iconBtn(AlignLeft, 'Aligner à gauche', align === 'left', () =>
            apply({ textAlign: 'left' }),
          )}
          {iconBtn(AlignCenter, 'Centrer', align === 'center', () =>
            apply({ textAlign: 'center' }),
          )}
          {iconBtn(AlignRight, 'Aligner à droite', align === 'right', () =>
            apply({ textAlign: 'right' }),
          )}
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          {iconBtn(Bold, 'Gras', !!fmt.bold, () => apply({ bold: !fmt.bold }))}
          {iconBtn(Italic, 'Italique', !!fmt.italic, () => apply({ italic: !fmt.italic }))}
          {iconBtn(Underline, 'Souligné', !!fmt.underline, () =>
            apply({ underline: !fmt.underline }),
          )}
          {iconBtn(Strikethrough, 'Barré', !!fmt.strike, () => apply({ strike: !fmt.strike }))}
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <div className="flex items-center gap-0.5" role="group" aria-label="Taille de police">
            <button
              type="button"
              aria-label="Réduire la taille du texte"
              onClick={() => apply({ fontSize: Math.max(8, fontSize - 2) })}
              className="flex size-7 items-center justify-center rounded-md border border-border hover:text-accent"
            >
              <Minus aria-hidden className="size-3.5" />
            </button>
            <span className="w-6 text-center tabular-nums text-muted">{fontSize}</span>
            <button
              type="button"
              aria-label="Augmenter la taille du texte"
              onClick={() => apply({ fontSize: Math.min(96, fontSize + 2) })}
              className="flex size-7 items-center justify-center rounded-md border border-border hover:text-accent"
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
          </div>
          {supportsShadow && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                aria-label="Ombre portée"
                aria-pressed={shadowOn}
                title="Ombre portée"
                onClick={() => apply({ shadow: !shadowOn })}
                className={`flex size-7 items-center justify-center rounded-md border ${
                  shadowOn ? 'border-accent bg-accent-subtle' : 'border-border hover:text-accent'
                }`}
              >
                {/* Small square casting a shadow → explicit metaphor. */}
                <span
                  className="size-3.5 rounded-[3px] bg-text"
                  style={{ boxShadow: shadowOn ? '1px 2px 2px rgba(0,0,0,0.45)' : 'none' }}
                />
              </button>
            </>
          )}
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        </>
      )}

      {/* Fill chip (filled square) — not for connectors (no fill). */}
      {fillAvailable && (
        <button
          type="button"
          aria-label="Fond"
          title="Fond"
          aria-pressed={isFill}
          onClick={() => setPanel(isFill ? null : 'fill')}
          className={`flex size-7 items-center justify-center rounded-md border ${
            isFill ? 'border-accent ring-2 ring-accent' : 'border-border'
          }`}
          style={{ backgroundColor: hasFill ? currentFill : 'transparent' }}
        >
          {!hasFill && <span className="text-[10px] text-muted">∅</span>}
        </button>
      )}

      {/* Stroke chip (bordered square). With no outline ("None"), it is signaled in the preview
          even with the panel closed: neutral dashed border + ∅ glyph (consistent with the "no fill" chip). */}
      <button
        type="button"
        aria-label="Trait"
        title="Trait"
        aria-pressed={panel === 'stroke'}
        onClick={() => setPanel(panel === 'stroke' ? null : 'stroke')}
        className={`flex size-7 items-center justify-center rounded-md bg-surface ${
          hasStroke ? 'border-[3px]' : 'border border-dashed'
        } ${panel === 'stroke' ? 'ring-2 ring-accent' : ''}`}
        style={{ borderColor: hasStroke ? currentStroke : 'var(--color-border)' }}
      >
        {!hasStroke && <span className="text-[10px] leading-none text-muted">∅</span>}
      </button>

      {/* Arrowheads (connectors only) */}
      {connector && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            aria-label="Flèche au début"
            aria-pressed={!!connector.startArrow}
            title="Flèche au début"
            onClick={() => apply({ startArrow: !connector.startArrow })}
            className={`rounded border px-1.5 py-0.5 ${
              connector.startArrow
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border hover:text-accent'
            }`}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Flèche à la fin"
            aria-pressed={!!connector.endArrow}
            title="Flèche à la fin"
            onClick={() => apply({ endArrow: !connector.endArrow })}
            className={`rounded border px-1.5 py-0.5 ${
              connector.endArrow
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border hover:text-accent'
            }`}
          >
            ▶
          </button>
        </>
      )}
    </div>
  );
}
