/**
 * **Compact summary** of the board state, injected to the model on every user turn (and returned
 * by the `getBoardState` tool). Not the verbose internal JSON: just what the model needs to
 * reason and reference the right ids (steps, links, lanes). Recomputed every turn → the model
 * **always starts from the actual state**, including after manual edits.
 *
 * **Geometry included** (issue #89): a step's lane membership is *geometric* — setting
 * `swimlaneId` does not move the card. Without coordinates, the model believed it was "tidying"
 * cards while they stayed outside the lane, with no way to detect it. The geometry is therefore
 * exposed (card positions, lane top/height, shared width) **and** the **inconsistencies** are
 * flagged (card whose `swimlaneId` does not match its actual position) so the model can fix them.
 */
import type { WhiteboardEngine } from '@binarii/processii';

/** A step's geometry, rounded (the model does not need sub-pixels). */
export interface StepGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardSummary {
  readonly name: string | null;
  readonly background: string | null;
  /** @deprecated Legacy shared width; per-lane `width`/`left` are authoritative (multi-cluster). */
  readonly swimlanesWidth: number;
  readonly swimlanes: ReadonlyArray<{
    id: string;
    name: string;
    color: string;
    /** Id of the **group (cluster)** this lane belongs to (lanes sharing it move together). */
    clusterId: string;
    /** 0-based vertical order **within its cluster**. */
    order: number;
    /** Left edge of the lane's band (world units) — a cluster may sit at x ≠ 0. */
    left: number;
    /** Width of the lane's band (world units) — per cluster, not shared. */
    width: number;
    /** Ordinate of the lane top (world units). */
    top: number;
    /** Lane height (world units). */
    height: number;
  }>;
  readonly steps: ReadonlyArray<
    {
      id: string;
      name: string;
      /** **Assigned** lane (`swimlaneId` field). */
      swimlaneId?: string;
      /** Lane where the card **actually** falls (center), when it differs from the assigned one. */
      actualLaneId?: string;
      /** `true` when a lane is assigned but the card does not fully fit inside it (out of lane). */
      misplaced?: boolean;
      emotion?: string;
    } & StepGeometry
  >;
  readonly connectors: ReadonlyArray<{ id: string; from?: string; to?: string }>;
  readonly shapes: ReadonlyArray<{ id: string; kind: string; text?: string } & StepGeometry>;
}

const round = (n: number): number => Math.round(n);

interface LaneBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Absolute lane band + cluster membership, indexed by id (cluster-aware, not x=0 assumed). */
function laneGeometry(
  engine: WhiteboardEngine,
): Map<string, { band: LaneBox; order: number; name: string; clusterId: string }> {
  const map = new Map<string, { band: LaneBox; order: number; name: string; clusterId: string }>();
  for (const lane of engine.listSwimlanes()) {
    const band = engine.laneBand(lane.id);
    if (!band) continue;
    map.set(lane.id, { band, order: lane.order, name: lane.name, clusterId: lane.clusterId });
  }
  return map;
}

/** Builds the structured summary from the engine (source of truth). */
export function summarizeBoard(engine: WhiteboardEngine): BoardSummary {
  const elements = engine.listElements();
  const lanes = laneGeometry(engine);
  const width = engine.getSwimlanesWidth();
  const steps: Array<BoardSummary['steps'][number]> = [];
  const connectors: Array<BoardSummary['connectors'][number]> = [];
  const shapes: Array<BoardSummary['shapes'][number]> = [];

  for (const el of elements) {
    const geom: StepGeometry = {
      x: round(el.x),
      y: round(el.y),
      width: round(el.width),
      height: round(el.height),
    };
    if (el.kind === 'step') {
      // Lane in which the card's **center** actually falls (may differ from the assigned one).
      const actualLaneId = engine.laneAtPoint({
        x: el.x + el.width / 2,
        y: el.y + el.height / 2,
      });
      // Misplaced = a lane is assigned but the card does not **fully** fit inside its actual band
      // (checked against the lane's real cluster-positioned rectangle, not an x=0 shared-width box).
      let misplaced = false;
      if (el.swimlaneId) {
        const lane = lanes.get(el.swimlaneId);
        const fits =
          lane !== undefined &&
          el.y >= lane.band.y &&
          el.y + el.height <= lane.band.y + lane.band.height &&
          el.x >= lane.band.x &&
          el.x + el.width <= lane.band.x + lane.band.width;
        misplaced = !fits;
      }
      steps.push({
        id: el.id,
        name: el.name,
        ...(el.swimlaneId ? { swimlaneId: el.swimlaneId } : {}),
        ...(el.swimlaneId && actualLaneId !== undefined && actualLaneId !== el.swimlaneId
          ? { actualLaneId }
          : {}),
        ...(misplaced ? { misplaced: true } : {}),
        ...(el.emotion ? { emotion: el.emotion } : {}),
        ...geom,
      });
    } else if (el.kind === 'arrow' || el.kind === 'line') {
      connectors.push({
        id: el.id,
        ...(el.start ? { from: el.start } : {}),
        ...(el.end ? { to: el.end } : {}),
      });
    } else {
      shapes.push({
        id: el.id,
        kind: el.kind,
        ...(typeof el.text === 'string' && el.text.length > 0 ? { text: el.text } : {}),
        ...geom,
      });
    }
  }

  return {
    name: engine.getName(),
    background: engine.getBackground(),
    swimlanesWidth: round(width),
    swimlanes: engine.listSwimlanes().map((l) => {
      const band = lanes.get(l.id)?.band;
      return {
        id: l.id,
        name: l.name,
        color: l.color,
        clusterId: l.clusterId,
        order: l.order,
        left: round(band?.x ?? 0),
        width: round(band?.width ?? width),
        top: round(band?.y ?? 0),
        height: round(l.height),
      };
    }),
    steps,
    connectors,
    shapes,
  };
}

/** Compact, readable text rendering of the summary (for prompt injection). */
export function renderSummaryText(summary: BoardSummary): string {
  const lines: string[] = [];
  lines.push(`Board : « ${summary.name ?? 'Sans titre'} »`);

  if (summary.swimlanes.length > 0) {
    const clusterIds = new Set(summary.swimlanes.map((l) => l.clusterId));
    const multi = clusterIds.size > 1;
    lines.push(
      multi
        ? `Bandes (swimlanes) — ${clusterIds.size} groupes déplaçables {clusterId}, chaque groupe empilé de haut en bas :`
        : 'Bandes (swimlanes) — empilées du haut vers le bas :',
    );
    // Lanes come sorted by cluster then order, so same-group lanes are contiguous.
    for (const l of summary.swimlanes) {
      const grp = multi ? ` {${l.clusterId}}` : '';
      lines.push(
        `  - ${l.id} · ${l.name || '(sans nom)'} [${l.color}]${grp} — x ${l.left}→${l.left + l.width}, y ${l.top}→${l.top + l.height} (hauteur ${l.height})`,
      );
    }
  }

  if (summary.steps.length === 0) {
    lines.push('Étapes : (aucune)');
  } else {
    lines.push('Étapes (x = chronologie gauche→droite, y = bande) :');
    for (const s of summary.steps) {
      const lane = s.swimlaneId ? ` @${s.swimlaneId}` : '';
      const emo = s.emotion ? ` (${s.emotion})` : '';
      const geom = ` [x ${s.x}, y ${s.y}, ${s.width}×${s.height}]`;
      const warn = s.misplaced
        ? ` ⚠ hors de sa bande (${s.actualLaneId ? `tombe dans @${s.actualLaneId}` : 'hors de toute bande'})`
        : '';
      lines.push(`  - ${s.id} · ${s.name || '(sans nom)'}${lane}${emo}${geom}${warn}`);
    }
  }

  if (summary.connectors.length > 0) {
    lines.push('Liens :');
    for (const c of summary.connectors)
      lines.push(`  - ${c.id} : ${c.from ?? '?'} → ${c.to ?? '?'}`);
  }

  if (summary.shapes.length > 0) {
    lines.push('Formes libres :');
    for (const sh of summary.shapes) {
      lines.push(
        `  - ${sh.id} · ${sh.kind}${sh.text ? ` « ${sh.text} »` : ''} [x ${sh.x}, y ${sh.y}, ${sh.width}×${sh.height}]`,
      );
    }
  }

  // Dedicated inconsistency section: crisp and actionable (the model must fix them).
  const misplaced = summary.steps.filter((s) => s.misplaced);
  if (misplaced.length > 0) {
    lines.push('');
    lines.push(
      `⚠ Incohérences — ${misplaced.length} étape(s) avec une bande assignée mais visuellement HORS de cette bande :`,
    );
    for (const s of misplaced) {
      lines.push(
        `  - ${s.id} : assignée @${s.swimlaneId}${s.actualLaneId ? `, mais tombe dans @${s.actualLaneId}` : ', mais hors de toute bande'}`,
      );
    }
    lines.push(
      'Corrige-les avec `moveStepToLane` (range la carte dans sa bande) ou `tidyLayout` (range tout le board).',
    );
  }

  return lines.join('\n');
}
