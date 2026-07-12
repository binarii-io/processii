import { useState } from 'react';
import { Button, Switch } from './ui/index.js';
import { LANE_PALETTE } from './render.js';
import { SWIMLANE_COLORS, type SwimlaneColor } from './scene.js';
import type { WhiteboardEngine } from './engine.js';

/**
 * **Process board** editing side panel: edits the properties of the selected entity —
 * a **step** (single selection of a `step` element), a **swimlane** (selected via its header) or
 * a **group** (selected via its header). Writes through the engine's validated operations
 * (`updateElement` / `updateSwimlane` / `updateAgentGroup`), so collab + offline + undo apply.
 * Direct read of the engine state on every render (the parent forces the render via `onChange`).
 */
export interface SidePanelProps {
  readonly engine: WhiteboardEngine;
  readonly selectedLaneId: string | null;
  readonly onChange?: () => void;
  /** Deselects the lane after removal. */
  readonly onSelectLane?: (id: string | null) => void;
  /** Selected group id (edited here — name — via its header selection). */
  readonly selectedGroupId?: string | null;
  /** Deselects the group after it is dissolved. */
  readonly onSelectGroup?: (id: string | null) => void;
  /**
   * Sub-process: provides the whiteboard document to link to the step (the app may **create** one
   * or let the user **pick an existing** one) and returns its id — or `null` to cancel.
   */
  readonly onCreateSubprocess?: () => Promise<string | null>;
  /** Sub-process: "enter" the `ref` child whiteboard. */
  readonly onNavigateSubprocess?: (ref: string) => void;
  /**
   * Sub-process: resolves the linked `ref` into a human label (e.g. the document title). Absent
   * or `undefined` result → the panel shows no name (the ref stays opaque, never displayed raw).
   */
  readonly resolveSubprocessLabel?: (ref: string) => string | undefined;
}

/** Swatch of a swimlane color (extension palette; neutral = ui-kit token). */
function laneSwatchColor(color: SwimlaneColor): string {
  const rgb = LANE_PALETTE[color];
  return rgb ? `rgb(${rgb})` : 'var(--color-muted)';
}

/** Label list editing (skills / deliverables): chips + add + remove. */
function LabelList({
  title,
  values,
  onChange,
}: {
  title: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{title}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text"
          >
            {v}
            <button
              type="button"
              aria-label={`Retirer ${v}`}
              className="text-muted hover:text-danger"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={`Ajouter…`}
        aria-label={`Ajouter ${title}`}
        className="rounded border border-input bg-bg px-2 py-1 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  );
}

function field(label: string, control: React.ReactNode): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {control}
    </label>
  );
}

const inputCls =
  'rounded border border-input bg-bg px-2 py-1 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function SidePanel({
  engine,
  selectedLaneId,
  onChange,
  onSelectLane,
  selectedGroupId,
  onSelectGroup,
  onCreateSubprocess,
  onNavigateSubprocess,
  resolveSubprocessLabel,
}: SidePanelProps) {
  const group = selectedGroupId
    ? (engine.listAgentGroups().find((g) => g.id === selectedGroupId) ?? null)
    : null;
  const lane =
    !group && selectedLaneId
      ? (engine.listSwimlanes().find((l) => l.id === selectedLaneId) ?? null)
      : null;
  const selection = engine.getSelection();
  const step =
    !group && !lane && selection.length === 1 ? engine.board.getElement(selection[0]!) : undefined;

  // **Layout-only** container: the card (border, background, shadow, padding) is provided by
  // the host (`editor.tsx`). No chrome here → avoids double border / double padding.
  const wrap = (children: React.ReactNode): React.JSX.Element => (
    <div className="flex flex-col gap-3">{children}</div>
  );

  if (group) {
    return wrap(
      <>
        <h2 className="border-b border-border pb-2 text-sm font-semibold text-text">Groupe</h2>
        {field(
          'Nom',
          <input
            className={inputCls}
            value={group.name}
            placeholder="Groupe"
            aria-label="Nom du groupe"
            autoFocus
            onChange={(e) => {
              engine.updateAgentGroup(group.id, { name: e.target.value });
              onChange?.();
            }}
          />,
        )}
        <Button
          size="sm"
          variant="danger"
          className="mt-1 w-full"
          onClick={() => {
            engine.removeAgentGroup(group.id);
            onSelectGroup?.(null);
            onChange?.();
          }}
        >
          Dissocier le groupe
        </Button>
      </>,
    );
  }

  if (lane) {
    return wrap(
      <>
        <h2 className="border-b border-border pb-2 text-sm font-semibold text-text">Swimlane</h2>
        {field(
          'Nom',
          <input
            className={inputCls}
            value={lane.name}
            onChange={(e) => {
              engine.updateSwimlane(lane.id, { name: e.target.value });
              onChange?.();
            }}
          />,
        )}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Type</span>
          <div className="flex gap-1">
            {(['user', 'system', 'custom'] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={lane.laneType === t ? 'primary' : 'ghost'}
                onClick={() => {
                  engine.updateSwimlane(lane.id, { laneType: t });
                  onChange?.();
                }}
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
        {lane.laneType === 'custom' &&
          field(
            'Type personnalisé',
            <input
              className={inputCls}
              value={lane.customType ?? ''}
              placeholder="ex. Partenaire, Outil…"
              onChange={(e) => {
                engine.updateSwimlane(lane.id, { customType: e.target.value });
                onChange?.();
              }}
            />,
          )}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Couleur</span>
          <div className="flex flex-wrap gap-1">
            {SWIMLANE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => {
                  engine.updateSwimlane(lane.id, { color: c });
                  onChange?.();
                }}
                className={`h-6 w-6 rounded-full border ${lane.color === c ? 'border-accent ring-2 ring-accent' : 'border-border'}`}
                style={{ backgroundColor: laneSwatchColor(c) }}
              />
            ))}
          </div>
        </div>
        {field(
          'Hauteur',
          <input
            type="number"
            min={60}
            className={inputCls}
            value={lane.height}
            onChange={(e) => {
              const h = Number(e.target.value);
              if (Number.isFinite(h) && h >= 60) {
                engine.updateSwimlane(lane.id, { height: h });
                onChange?.();
              }
            }}
          />,
        )}
        <Button
          size="sm"
          variant="danger"
          className="mt-1 w-full"
          onClick={() => {
            engine.removeSwimlane(lane.id);
            onSelectLane?.(null);
            onChange?.();
          }}
        >
          Supprimer la bande
        </Button>
      </>,
    );
  }

  if (step && step.kind === 'step') {
    const s = step;
    return wrap(
      <>
        <h2 className="border-b border-border pb-2 text-sm font-semibold text-text">Étape</h2>
        {field(
          'Nom',
          <input
            className={inputCls}
            value={s.name}
            onChange={(e) => {
              engine.updateElement(s.id, { name: e.target.value });
              onChange?.();
            }}
          />,
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Description</span>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span>Sur la carte</span>
              <Switch
                checked={s.showDescription === true}
                aria-label="Afficher la description sur la carte"
                onCheckedChange={(checked) => {
                  engine.updateElement(s.id, { showDescription: checked });
                  onChange?.();
                }}
              />
            </label>
          </div>
          <textarea
            className={`${inputCls} min-h-16 resize-y`}
            value={s.description}
            onChange={(e) => {
              engine.updateElement(s.id, { description: e.target.value });
              onChange?.();
            }}
          />
        </div>
        <LabelList
          title="Skills"
          values={s.skills}
          onChange={(next) => {
            engine.updateElement(s.id, { skills: next });
            onChange?.();
          }}
        />
        <LabelList
          title="Deliverables"
          values={s.deliverables}
          onChange={(next) => {
            engine.updateElement(s.id, { deliverables: next });
            onChange?.();
          }}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Emotion</span>
          <div className="flex gap-1">
            {/* First option: **no** emotion (clears the field). */}
            <Button
              size="sm"
              variant={!s.emotion ? 'primary' : 'ghost'}
              aria-label="Aucune emotion"
              title="Aucune"
              onClick={() => {
                engine.updateElement(s.id, { emotion: null });
                onChange?.();
              }}
            >
              <span className="text-base">∅</span>
            </Button>
            {(
              [
                ['happy', '😊'],
                ['neutral', '😐'],
                ['sad', '😞'],
              ] as const
            ).map(([em, emoji]) => (
              <Button
                key={em}
                size="sm"
                variant={s.emotion === em ? 'primary' : 'ghost'}
                aria-label={`Emotion ${em}`}
                onClick={() => {
                  engine.updateElement(s.id, { emotion: em });
                  onChange?.();
                }}
              >
                <span className="text-base">{emoji}</span>
              </Button>
            ))}
          </div>
        </div>
        {(onCreateSubprocess || s.subprocessRef) && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Process lié</span>
            {s.subprocessRef ? (
              <>
                {/* Name of the linked document (host-resolved); the raw ref is never displayed. */}
                {resolveSubprocessLabel?.(s.subprocessRef) !== undefined && (
                  <span className="truncate text-sm text-text">
                    {resolveSubprocessLabel(s.subprocessRef)}
                  </span>
                )}
                {/* Indicative kind of the link (display-only): absent = sub-process (default). */}
                <div className="flex gap-1">
                  {(
                    [
                      ['sub', 'Sous-process'],
                      ['external', 'Process externe'],
                    ] as const
                  ).map(([kind, label]) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant={(s.subprocessKind ?? 'sub') === kind ? 'primary' : 'ghost'}
                      aria-label={`Type de lien : ${label}`}
                      onClick={() => {
                        engine.updateElement(s.id, { subprocessKind: kind });
                        onChange?.();
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {onNavigateSubprocess && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onNavigateSubprocess(s.subprocessRef!)}
                    >
                      Ouvrir
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Délier le process"
                    onClick={() => {
                      // Unlink clears the kind too: a future link starts back from the default.
                      engine.updateElement(s.id, { subprocessRef: null, subprocessKind: null });
                      onChange?.();
                    }}
                  >
                    Délier
                  </Button>
                </div>
              </>
            ) : (
              onCreateSubprocess && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Lier un process à cette étape"
                  onClick={() => {
                    void onCreateSubprocess().then((ref) => {
                      if (!ref) return;
                      engine.updateElement(s.id, { subprocessRef: ref });
                      onChange?.();
                    });
                  }}
                >
                  Lier un process
                </Button>
              )
            )}
          </div>
        )}
        <Button
          size="sm"
          variant="danger"
          className="mt-1 w-full"
          onClick={() => {
            engine.removeElement(s.id);
            onChange?.();
          }}
        >
          Supprimer l'étape
        </Button>
      </>,
    );
  }

  return wrap(
    <p className="text-xs text-muted">
      Sélectionne une étape (clic), une bande ou un groupe (clic sur son en-tête) pour éditer ses
      propriétés.
    </p>,
  );
}
