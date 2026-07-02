import { describe, expect, it } from 'vitest';
import { createEngine } from '@binarii/processii';
import { renderSummaryText, summarizeBoard } from './board-summary.js';

function engineWithLane() {
  const engine = createEngine({ clientId: 1 });
  engine.addSwimlane({ id: 'l1', name: 'RH', order: 0 }); // top 0, default height 160
  return engine;
}

function addStep(
  engine: ReturnType<typeof createEngine>,
  e: { id: string; x: number; y: number; swimlaneId?: string; height?: number },
): void {
  engine.addElement(
    {
      kind: 'step',
      id: e.id,
      x: e.x,
      y: e.y,
      width: 200,
      height: e.height ?? 120,
      name: e.id,
      ...(e.swimlaneId ? { swimlaneId: e.swimlaneId } : {}),
    },
    { select: false },
  );
}

describe('board-summary — geometry', () => {
  it('exposes the shared width and the lane geometry (top/height/order)', () => {
    const engine = engineWithLane();
    const s = summarizeBoard(engine);
    expect(s.swimlanesWidth).toBeGreaterThan(0);
    expect(s.swimlanes).toHaveLength(1);
    expect(s.swimlanes[0]).toMatchObject({ id: 'l1', top: 0, height: 160, order: 0 });
  });

  it('exposes the geometry (x/y/width/height) of each step', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 20, swimlaneId: 'l1' });
    const step = summarizeBoard(engine).steps.find((p) => p.id === 's1')!;
    expect(step).toMatchObject({ x: 300, y: 20, width: 200, height: 120 });
  });

  it('flags a MISPLACED step (swimlaneId set but outside the lane)', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 800, swimlaneId: 'l1' }); // y well below the lane
    const step = summarizeBoard(engine).steps.find((p) => p.id === 's1')!;
    expect(step.misplaced).toBe(true);
    expect(step.swimlaneId).toBe('l1');
  });

  it('does NOT flag a step correctly placed inside its lane', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 20, swimlaneId: 'l1' }); // 20→140 within [0,160]
    const step = summarizeBoard(engine).steps.find((p) => p.id === 's1')!;
    expect(step.misplaced).toBeUndefined();
  });

  it('fills actualLaneId when the card falls into ANOTHER lane than the assigned one', () => {
    const engine = engineWithLane();
    engine.addSwimlane({ id: 'l2', name: 'Manager', order: 1 }); // top 160, hauteur 160
    addStep(engine, { id: 's1', x: 300, y: 200, swimlaneId: 'l1' }); // assigned l1 but falls into l2
    const step = summarizeBoard(engine).steps.find((p) => p.id === 's1')!;
    expect(step.misplaced).toBe(true);
    expect(step.actualLaneId).toBe('l2');
  });
});

describe('board-summary — rendu texte', () => {
  it('renders the width, the lane and step geometry', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 20, swimlaneId: 'l1' });
    const text = renderSummaryText(summarizeBoard(engine));
    expect(text).toContain('Largeur partagée des bandes');
    expect(text).toContain('hauteur 160');
    expect(text).toMatch(/s1 .*x 300, y 20, 200×120/);
  });

  it('adds a ⚠ inconsistencies section when a step is outside its lane', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 800, swimlaneId: 'l1' });
    const text = renderSummaryText(summarizeBoard(engine));
    expect(text).toContain('Incohérences');
    expect(text).toContain('moveStepToLane');
    expect(text).toMatch(/s1 .*hors de sa bande/);
  });

  it('no inconsistencies section when everything is well placed', () => {
    const engine = engineWithLane();
    addStep(engine, { id: 's1', x: 300, y: 20, swimlaneId: 'l1' });
    const text = renderSummaryText(summarizeBoard(engine));
    expect(text).not.toContain('Incohérences');
  });
});
