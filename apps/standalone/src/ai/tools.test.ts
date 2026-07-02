import { describe, expect, it } from 'vitest';
import { createEngine } from '@binarii/processii';
import { TOOLS, TOOLS_BY_NAME, type ToolContext } from './tools.js';

function ctxWithSeq(): { ctx: ToolContext; engine: ReturnType<typeof createEngine> } {
  const engine = createEngine({ clientId: 1 });
  let n = 0;
  const ctx: ToolContext = { engine, genId: () => `id${++n}` };
  return { ctx, engine };
}

describe('tools — registre & JSON Schema', () => {
  it('exposes the expected tools, indexed by name', () => {
    for (const name of [
      'addStep',
      'connectSteps',
      'deleteElement',
      'addSwimlane',
      'getBoardState',
    ]) {
      expect(TOOLS_BY_NAME.has(name)).toBe(true);
    }
    expect(TOOLS.length).toBeGreaterThanOrEqual(10);
  });

  it('addStep has an object JSON Schema with the required name property', () => {
    const schema = TOOLS_BY_NAME.get('addStep')!.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.name).toBeDefined();
    expect(schema.required).toContain('name');
  });

  it('the enums (emotion+none, color) appear in the schema', () => {
    // The emotion (with 'none' to clear) is on updateStep, not on addStep (creation without emotion).
    const upd = JSON.stringify(TOOLS_BY_NAME.get('updateStep')!.parameters);
    expect(upd).toContain('happy');
    expect(upd).toContain('none');
    expect(JSON.stringify(TOOLS_BY_NAME.get('addStep')!.parameters)).not.toContain('emotion');
    const lane = JSON.stringify(TOOLS_BY_NAME.get('addSwimlane')!.parameters);
    expect(lane).toContain('neutral');
  });

  it('deleteElement is flagged destructive', () => {
    expect(TOOLS_BY_NAME.get('deleteElement')!.destructive).toBe(true);
    expect(TOOLS_BY_NAME.get('addStep')!.destructive).toBe(false);
  });
});

describe('tools — handlers on the engine', () => {
  it('addStep creates a step and returns its id', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'Réception' });
    expect(res.id).toBe('id1');
    const el = engine.board.getElement('id1');
    expect(el?.kind).toBe('step');
    expect(el && 'name' in el ? el.name : null).toBe('Réception');
  });

  it('connectSteps links two existing steps', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' }); // id1
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'B' }); // id2
    const res = TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 'id1', toId: 'id2' });
    const arrow = engine.board.getElement(String(res.id));
    expect(arrow).toMatchObject({ start: 'id1', end: 'id2' });
  });

  it('deleteElement purges the orphan connectors', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' }); // id1
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'B' }); // id2
    TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 'id1', toId: 'id2' }); // id3
    const res = TOOLS_BY_NAME.get('deleteElement')!.run(ctx, { id: 'id1' });
    expect(res.removedConnectors).toBe(1);
    expect(engine.board.getElement('id1')).toBeUndefined();
    expect(engine.board.getElement('id3')).toBeUndefined();
  });

  it('addStep refuses a non-existent swimlane', () => {
    const { ctx } = ctxWithSeq();
    expect(() =>
      TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'X', swimlaneId: 'nope' }),
    ).toThrow();
  });

  it('addStep rejects an invalid argument (missing name) via zod', () => {
    const { ctx } = ctxWithSeq();
    expect(() => TOOLS_BY_NAME.get('addStep')!.run(ctx, {})).toThrow();
  });

  it("updateStep with emotion='none' removes the emotion (clear)", () => {
    const { ctx, engine } = ctxWithSeq();
    // Step created WITH an emotion (directly, addStep no longer sets one).
    engine.addElement({
      kind: 'step',
      id: 's1',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      name: 'A',
      emotion: 'happy',
    });
    expect(engine.board.getElement('s1')).toMatchObject({ emotion: 'happy' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: 's1', emotion: 'none' });
    const el = engine.board.getElement('s1') as { emotion?: string } | undefined;
    expect(el?.emotion).toBeUndefined();
  });

  it('addStep never sets an emotion at creation', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'Sans émotion' });
    const el = engine.board.getElement(String(res.id));
    expect(el && 'emotion' in el ? el.emotion : undefined).toBeUndefined();
  });

  it('updateStep applies the text alignment (textAlign)', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: String(res.id), textAlign: 'left' });
    const el = engine.board.getElement(String(res.id)) as { textAlign?: string } | undefined;
    expect(el?.textAlign).toBe('left');
  });

  it('updateStep applies formatting and colors', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, {
      id: String(res.id),
      bold: true,
      fill: '#ef4444',
      fontSize: 18,
    });
    const el = engine.board.getElement(String(res.id)) as
      | { bold?: boolean; fill?: string; fontSize?: number }
      | undefined;
    expect(el?.bold).toBe(true);
    expect(el?.fill).toBe('#ef4444');
    expect(el?.fontSize).toBe(18);
  });

  it('updateStep moves a step and keeps the connectors valid', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' }); // id1
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'B' }); // id2
    TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 'id1', toId: 'id2' }); // id3
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: 'id1', x: 500, y: 400 });
    expect(engine.board.getElement('id1')).toMatchObject({ x: 500, y: 400 });
    expect(engine.board.getElement('id3')).toMatchObject({ start: 'id1', end: 'id2' });
  });

  it('updateShape modifies a free shape (text + color)', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addShape')!.run(ctx, { kind: 'rectangle', text: 'X' });
    TOOLS_BY_NAME.get('updateShape')!.run(ctx, { id: String(res.id), text: 'Y', fill: 'accent' });
    const el = engine.board.getElement(String(res.id)) as
      | { text?: string; fill?: string }
      | undefined;
    expect(el?.text).toBe('Y');
    expect(el?.fill).toBe('accent');
  });

  it('updateShape refuses a step (reserved for free shapes)', () => {
    const { ctx } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    expect(() =>
      TOOLS_BY_NAME.get('updateShape')!.run(ctx, { id: String(res.id), text: 'x' }),
    ).toThrow();
  });

  it('updateStep shows the description as soon as one is set (auto showDescription)', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: String(res.id), description: 'Détails' });
    const el = engine.board.getElement(String(res.id)) as
      | { description?: string; showDescription?: boolean }
      | undefined;
    expect(el?.description).toBe('Détails');
    expect(el?.showDescription).toBe(true);
  });

  it('updateStep: empty description = no-op (does not overwrite an existing description)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, {
      id: 's',
      name: 'A',
      description: 'Détails importants',
    });
    const res = TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: 's', description: '   ' }); // vide
    const el = engine.board.getElement('s') as
      | { description?: string; showDescription?: boolean }
      | undefined;
    expect(el?.description).toBe('Détails importants');
    expect(el?.showDescription).toBe(true);
    expect(res.descriptionSet).toBe(false);
  });

  it('addStep with a description sets it AND shows it', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, {
      id: 's',
      name: 'A',
      description: 'Corps',
    });
    const el = engine.board.getElement('s') as
      | { description?: string; showDescription?: boolean }
      | undefined;
    expect(el?.description).toBe('Corps');
    expect(el?.showDescription).toBe(true);
    expect(res.descriptionSet).toBe(true);
  });

  it('updateStep respecte showDescription=false explicite', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, {
      id: String(res.id),
      description: 'X',
      showDescription: false,
    });
    const el = engine.board.getElement(String(res.id)) as { showDescription?: boolean } | undefined;
    expect(el?.showDescription).toBe(false);
  });

  it('addStep shows the description provided at creation', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A', description: 'Détails' });
    const el = engine.board.getElement(String(res.id)) as { showDescription?: boolean } | undefined;
    expect(el?.showDescription).toBe(true);
  });

  it('updateStep repositions the step INSIDE the targeted swimlane (not just the swimlaneId)', () => {
    const { ctx, engine } = ctxWithSeq();
    const lane = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Lane' }); // id1
    const step = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A', x: 50, y: 999 }); // id2 outside any lane
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: String(step.id), swimlaneId: String(lane.id) });
    const el = engine.board.getElement(String(step.id))!;
    const top = engine.laneTop(String(lane.id));
    expect((el as { swimlaneId?: string }).swimlaneId).toBe(String(lane.id));
    expect(el.y).not.toBe(999); // was indeed moved
    expect(el.y).toBeGreaterThanOrEqual(top);
    expect(el.y).toBeLessThan(top + 160); // inside the lane (default height 160)
  });

  it('updateStep honors an explicit y even with swimlaneId', () => {
    const { ctx, engine } = ctxWithSeq();
    const lane = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Lane' });
    const step = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A', x: 50, y: 100 });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, {
      id: String(step.id),
      swimlaneId: String(lane.id),
      y: 777,
    });
    expect(engine.board.getElement(String(step.id))!.y).toBe(777);
  });

  it('addSwimlane sets the laneType (user/system/custom)', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Employé', laneType: 'user' });
    const lane = engine.listSwimlanes().find((l) => l.id === String(res.id));
    expect(lane?.laneType).toBe('user');
  });

  it('addStep left-aligns the text by default', () => {
    const { ctx, engine } = ctxWithSeq();
    const res = TOOLS_BY_NAME.get('addStep')!.run(ctx, { name: 'A' });
    const el = engine.board.getElement(String(res.id)) as { textAlign?: string } | undefined;
    expect(el?.textAlign).toBe('left');
  });

  it('addSwimlane reuses a lane with the same name (anti-duplicate)', () => {
    const { ctx, engine } = ctxWithSeq();
    const a = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Employé', laneType: 'user' });
    const b = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: '  employé ' }); // same name (case/spaces)
    expect(b.id).toBe(a.id);
    expect(b.existed).toBe(true);
    expect(engine.listSwimlanes()).toHaveLength(1);
  });

  it('addHandoff creates the vertically aligned sent/received pair + link', () => {
    const { ctx, engine } = ctxWithSeq();
    const l1 = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Employé', laneType: 'user' });
    const l2 = TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { name: 'Manager', laneType: 'user' });
    const res = TOOLS_BY_NAME.get('addHandoff')!.run(ctx, {
      fromLaneId: String(l1.id),
      toLaneId: String(l2.id),
      sent: 'J’ai transmis',
      received: 'J’ai reçu',
    });
    const sent = engine.board.getElement(String(res.sentId))!;
    const received = engine.board.getElement(String(res.receivedId))!;
    expect(sent.x).toBe(received.x); // same x = vertically aligned
    expect((sent as { swimlaneId?: string }).swimlaneId).toBe(String(l1.id));
    expect((received as { swimlaneId?: string }).swimlaneId).toBe(String(l2.id));
    expect(engine.board.getElement(String(res.connectorId))).toMatchObject({
      start: String(res.sentId),
      end: String(res.receivedId),
    });
  });

  it('the model picks its own ids and reuses them to connect', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'sign', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'register', name: 'B' });
    const link = TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 'sign', toId: 'register' });
    expect(engine.board.getElement('sign')?.kind).toBe('step');
    expect(engine.board.getElement(String(link.id))).toMatchObject({
      start: 'sign',
      end: 'register',
    });
  });

  it('addStep accepts the swimlane by NAME (case-insensitive)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'rh', name: 'RH', laneType: 'user' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: 'A', swimlaneId: 'rh' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, {
      id: 's2',
      name: 'B',
      swimlaneId: 'r h'.replace(' ', ''),
    }); // 'rh'
    const a = engine.board.getElement('s1') as { swimlaneId?: string } | undefined;
    expect(a?.swimlaneId).toBe('rh');
    // by name with different case
    const byName = TOOLS_BY_NAME.get('addStep')!.run(ctx, {
      id: 's3',
      name: 'C',
      swimlaneId: 'rh',
    });
    expect((engine.board.getElement(String(byName.id)) as { swimlaneId?: string }).swimlaneId).toBe(
      'rh',
    );
  });

  it('addStep refuses an already-used id (collision)', () => {
    const { ctx } = ctxWithSeq();
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'dup', name: 'A' });
    expect(() => TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'dup', name: 'B' })).toThrow();
  });

  it('the lanes widen to contain the steps', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, {
      id: 's1',
      name: '1',
      swimlaneId: 'l1',
      x: 5000,
      y: 50,
    });
    expect(engine.getSwimlanesWidth()).toBeGreaterThanOrEqual(5200);
  });

  it('connectFlow links a sequence of ids in one call (and skips duplicates)', () => {
    const { ctx, engine } = ctxWithSeq();
    for (const id of ['a', 'b', 'c']) TOOLS_BY_NAME.get('addStep')!.run(ctx, { id, name: id });
    const r1 = TOOLS_BY_NAME.get('connectFlow')!.run(ctx, { ids: ['a', 'b', 'c'] });
    expect(r1.created).toBe(2); // a→b, b→c
    expect(engine.listElements().filter((e) => e.kind === 'arrow')).toHaveLength(2);
    const r2 = TOOLS_BY_NAME.get('connectFlow')!.run(ctx, { ids: ['a', 'b', 'c'] }); // replay
    expect(r2.created).toBe(0); // no duplicate
    expect(engine.listElements().filter((e) => e.kind === 'arrow')).toHaveLength(2);
  });

  it('tidyFlow completes the missing sequence links per lane (left→right)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'a', name: '1', swimlaneId: 'l1', x: 100, y: 50 });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'b', name: '2', swimlaneId: 'l1', x: 400, y: 50 });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'c', name: '3', swimlaneId: 'l1', x: 700, y: 50 });
    const res = TOOLS_BY_NAME.get('tidyFlow')!.run(ctx, {});
    expect(res.created).toBe(2); // a→b, b→c
    const arrows = engine.listElements().filter((e) => e.kind === 'arrow');
    expect(arrows.map((a) => `${a.start}->${a.end}`).sort()).toEqual(['a->b', 'b->c']);
  });

  it('tidyFlow fixes a reversed intra-lane link (left→right direction)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'a', name: '1', swimlaneId: 'l1', x: 100, y: 50 });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 'b', name: '2', swimlaneId: 'l1', x: 400, y: 50 });
    // backwards link b→a (right→left)
    TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 'b', toId: 'a' });
    const res = TOOLS_BY_NAME.get('tidyFlow')!.run(ctx, {});
    expect(res.fixed).toBe(1);
    const arrows = engine.listElements().filter((e) => e.kind === 'arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ start: 'a', end: 'b' });
  });

  it('connectSteps ALLOWS an inter-lane link (override possible, no hard block)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l2', name: 'B' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', swimlaneId: 'l1' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's2', name: '2', swimlaneId: 'l2' });
    const link = TOOLS_BY_NAME.get('connectSteps')!.run(ctx, { fromId: 's1', toId: 's2' });
    expect(engine.board.getElement(String(link.id))).toMatchObject({ start: 's1', end: 's2' });
  });

  it('the x flow is GLOBAL (continuous chronology, never reset per lane)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l2', name: 'B' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', swimlaneId: 'l1' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's2', name: '2', swimlaneId: 'l2' }); // another lane
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's3', name: '3', swimlaneId: 'l1' }); // back to lane 1
    const x1 = engine.board.getElement('s1')!.x;
    const x2 = engine.board.getElement('s2')!.x;
    const x3 = engine.board.getElement('s3')!.x;
    expect(x1).toBeGreaterThanOrEqual(240); // starts after the lane label
    expect(x2).toBeGreaterThan(x1); // 2nd step (other lane) to the right, not at its lane start
    expect(x3).toBeGreaterThan(x2);
  });
});

describe('tools — lane placement & resizing (#89)', () => {
  it('exposes moveStepToLane, setLanesWidth and tidyLayout', () => {
    for (const name of ['moveStepToLane', 'setLanesWidth', 'tidyLayout']) {
      expect(TOOLS_BY_NAME.has(name)).toBe(true);
    }
  });

  it('moveStepToLane ACTUALLY places the card inside the lane (y inside the lane + swimlaneId)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' }); // lane 0
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l2', name: 'B' }); // lane 1 (lower)
    // step outside any lane (very low y)
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', x: 300, y: 9999 });
    const res = TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 's1', laneId: 'l2' });
    const el = engine.board.getElement('s1')!;
    const top = engine.laneTop('l2');
    const lane = engine.listSwimlanes().find((l) => l.id === 'l2')!;
    expect((el as { swimlaneId?: string }).swimlaneId).toBe('l2');
    expect(el.y).toBeGreaterThanOrEqual(top);
    expect(el.y + el.height).toBeLessThanOrEqual(top + lane.height);
    expect(res.ok).toBe(true);
    // The card now falls geometrically inside the targeted lane.
    expect(engine.laneAtPoint({ x: el.x + el.width / 2, y: el.y + el.height / 2 })).toBe('l2');
  });

  it('moveStepToLane keeps x by default and accepts an explicit x', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', x: 500, y: 10 });
    TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 's1', laneId: 'l1' });
    expect(engine.board.getElement('s1')!.x).toBe(500); // x kept
    TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 's1', laneId: 'l1', x: 800 });
    expect(engine.board.getElement('s1')!.x).toBe(800); // explicit x applied
  });

  it('moveStepToLane ENLARGES the lane when the card is taller than it', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' }); // default height 160
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: 's1', height: 300 }); // taller than the lane
    const res = TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 's1', laneId: 'l1' });
    const lane = engine.listSwimlanes().find((l) => l.id === 'l1')!;
    expect(res.grewLane).toBe(true);
    expect(lane.height).toBeGreaterThanOrEqual(300); // the lane contains the card
    const el = engine.board.getElement('s1')!;
    expect(el.y).toBeGreaterThanOrEqual(engine.laneTop('l1'));
    expect(el.y + el.height).toBeLessThanOrEqual(engine.laneTop('l1') + lane.height);
  });

  it('moveStepToLane refuses a non-existent step or lane', () => {
    const { ctx } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1' });
    expect(() =>
      TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 'nope', laneId: 'l1' }),
    ).toThrow();
    expect(() =>
      TOOLS_BY_NAME.get('moveStepToLane')!.run(ctx, { stepId: 's1', laneId: 'nope' }),
    ).toThrow();
  });

  it('updateSwimlane changes the height and recenters the attached steps', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' }); // lane 0
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l2', name: 'B' }); // lane 1
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's2', name: '2', swimlaneId: 'l2' });
    const before = engine.board.getElement('s2')!.y;
    TOOLS_BY_NAME.get('updateSwimlane')!.run(ctx, { id: 'l1', height: 400 }); // pushes l2 down
    const lane1 = engine.listSwimlanes().find((l) => l.id === 'l1')!;
    expect(lane1.height).toBe(400);
    const after = engine.board.getElement('s2')!;
    expect(after.y).not.toBe(before); // recentered inside its shifted lane
    const top2 = engine.laneTop('l2');
    expect(after.y).toBeGreaterThanOrEqual(top2);
  });

  it('updateSwimlane exposes height in its JSON Schema', () => {
    const schema = JSON.stringify(TOOLS_BY_NAME.get('updateSwimlane')!.parameters);
    expect(schema).toContain('height');
  });

  it('setLanesWidth sets the shared width but does not cut the existing cards', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', x: 1500, y: 10 }); // far right
    const res = TOOLS_BY_NAME.get('setLanesWidth')!.run(ctx, { width: 300 }); // trop petit
    expect(res.clamped).toBe(true);
    expect(engine.getSwimlanesWidth()).toBeGreaterThanOrEqual(1500); // no card cut
    const res2 = TOOLS_BY_NAME.get('setLanesWidth')!.run(ctx, { width: 4000 });
    expect(res2.clamped).toBe(false);
    expect(engine.getSwimlanesWidth()).toBe(4000);
  });

  it('tidyLayout grows the too-small lanes and recenters, without shrinking', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    TOOLS_BY_NAME.get('addStep')!.run(ctx, { id: 's1', name: '1', swimlaneId: 'l1' });
    TOOLS_BY_NAME.get('updateStep')!.run(ctx, { id: 's1', height: 500 }); // overflows the lane (160)
    const res = TOOLS_BY_NAME.get('tidyLayout')!.run(ctx, {});
    const lane = engine.listSwimlanes().find((l) => l.id === 'l1')!;
    expect(res.grownLanes).toBe(1);
    expect(lane.height).toBeGreaterThanOrEqual(500);
    // re-run: nothing to grow, no shrinking
    const res2 = TOOLS_BY_NAME.get('tidyLayout')!.run(ctx, {});
    expect(res2.grownLanes).toBe(0);
    expect(engine.listSwimlanes().find((l) => l.id === 'l1')!.height).toBe(lane.height);
  });
});

describe('tools — lane reordering (reorderSwimlane)', () => {
  it('expose reorderSwimlane', () => {
    expect(TOOLS_BY_NAME.has('reorderSwimlane')).toBe(true);
  });

  it('moves a lane by toIndex (and renumbers)', () => {
    const { ctx, engine } = ctxWithSeq();
    for (const [id, name] of [
      ['l1', 'A'],
      ['l2', 'B'],
      ['l3', 'C'],
    ])
      TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id, name });
    TOOLS_BY_NAME.get('reorderSwimlane')!.run(ctx, { laneId: 'l1', toIndex: 2 });
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l2', 'l3', 'l1']);
    expect(engine.listSwimlanes().map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it('places a lane before / after another (by name)', () => {
    const { ctx, engine } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'rh', name: 'RH' });
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'mgr', name: 'Manager' });
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'sys', name: 'Système' });
    // Système just ABOVE RH.
    TOOLS_BY_NAME.get('reorderSwimlane')!.run(ctx, { laneId: 'sys', before: 'RH' });
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['sys', 'rh', 'mgr']);
    // RH just AFTER Manager.
    TOOLS_BY_NAME.get('reorderSwimlane')!.run(ctx, { laneId: 'rh', after: 'Manager' });
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['sys', 'mgr', 'rh']);
  });

  it('refuses an unknown lane', () => {
    const { ctx } = ctxWithSeq();
    TOOLS_BY_NAME.get('addSwimlane')!.run(ctx, { id: 'l1', name: 'A' });
    expect(() =>
      TOOLS_BY_NAME.get('reorderSwimlane')!.run(ctx, { laneId: 'nope', toIndex: 0 }),
    ).toThrow();
  });
});
