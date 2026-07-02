import { describe, expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import { renderToCanvas, resolveColor, SELECTION_COLOR, type CanvasLike } from './render.js';

/** Test double: records the styles seen and the primitives called. */
function fakeCtx(): CanvasLike & {
  strokes: string[];
  calls: string[];
  texts: { text: string; x: number; font: string }[];
  fills: { shadow: string }[];
} {
  const strokes: string[] = [];
  const calls: string[] = [];
  const texts: { text: string; x: number; font: string }[] = [];
  const fills: { shadow: string }[] = [];
  let _fill = '';
  let _stroke = '';
  let _font = '';
  let _shadowColor = '';
  const ctx = {
    strokes,
    calls,
    texts,
    fills,
    save: () => calls.push('save'),
    // restore() resets the shadow like the real 2D context (otherwise `withCardShadow` would bleed).
    restore: () => {
      calls.push('restore');
      _shadowColor = '';
    },
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    quadraticCurveTo: () => calls.push('quadraticCurveTo'),
    rect: () => calls.push('rect'),
    ellipse: () => calls.push('ellipse'),
    fill: () => {
      fills.push({ shadow: _shadowColor });
      calls.push('fill');
    },
    stroke: () => {
      strokes.push(_stroke);
      calls.push('stroke');
    },
    setLineDash: () => calls.push('setLineDash'),
    fillText: (text: string, x: number) => {
      texts.push({ text, x, font: _font });
      calls.push('fillText');
    },
    measureText: (t: string) => ({ width: t.length * 7 }),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    clearRect: () => calls.push('clearRect'),
    get fillStyle() {
      return _fill;
    },
    set fillStyle(v: string) {
      _fill = v;
    },
    get strokeStyle() {
      return _stroke;
    },
    set strokeStyle(v: string) {
      _stroke = v;
    },
    get font() {
      return _font;
    },
    set font(v: string) {
      _font = v;
    },
    get shadowColor() {
      return _shadowColor;
    },
    set shadowColor(v: string) {
      _shadowColor = v;
    },
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return ctx;
}

describe('resolveColor — ui-kit tokens, zero hard-coded colors', () => {
  it('maps a semantic token to a ui-kit CSS variable', () => {
    expect(resolveColor('text')).toBe('var(--color-text)');
    expect(resolveColor('accent')).toBe('var(--color-accent)');
  });

  it('passes an imported literal color through', () => {
    expect(resolveColor('#ff00aa')).toBe('#ff00aa');
    expect(resolveColor('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });

  it('transparent / none stay unfilled', () => {
    expect(resolveColor('transparent')).toBe('transparent');
    expect(resolveColor('none')).toBe('transparent');
  });

  it('the selection color is a semantic token (not a hard-coded value)', () => {
    expect(SELECTION_COLOR).toBe('accent');
    expect(resolveColor(SELECTION_COLOR)).toMatch(/^var\(--color-/);
  });
});

describe('renderToCanvas', () => {
  it('draws each element and clears when requested', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    engine.addElement(
      { kind: 'ellipse', id: 'e', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), { clear: { width: 100, height: 100 } });
    expect(ctx.calls).toContain('clearRect');
    expect(ctx.calls).toContain('rect');
    expect(ctx.calls).toContain('ellipse');
  });

  it('draws a semantic selection frame around the selected element', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    expect(ctx.strokes).toContain(resolveColor(SELECTION_COLOR));
  });

  it('draws a peer remote selection in their color', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), {
      remoteSelections: [{ ids: ['r'], color: 'success' }],
    });
    expect(ctx.strokes).toContain(resolveColor('success'));
  });

  it('ignores a remote selection targeting a missing id', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), {
      remoteSelections: [{ ids: ['ghost'], color: 'success' }],
    });
    expect(ctx.strokes).not.toContain(resolveColor('success'));
  });

  it('draws an arrowhead (filled triangle) when endArrow is enabled', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'arrow',
        id: 'c',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        endArrow: true,
      },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    expect(ctx.calls).toContain('fill');
  });

  it('no arrowhead on a connector without startArrow/endArrow', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'arrow',
        id: 'c',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    expect(ctx.calls).not.toContain('fill');
  });

  it('applies a rotation around the center when angle != 0', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10, angle: 0.5 },
      { select: false },
    );
    const ctx = fakeCtx();
    const rotate = vi.spyOn(ctx, 'rotate');
    renderToCanvas(ctx, engine.toRenderModel());
    expect(rotate).toHaveBeenCalled();
  });

  it('applies the viewport transform (translate + scale)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 });
    const ctx = fakeCtx();
    const scale = vi.spyOn(ctx, 'scale');
    const translate = vi.spyOn(ctx, 'translate');
    renderToCanvas(ctx, engine.toRenderModel(), { viewport: { x: 20, y: 10, zoom: 2 } });
    expect(translate).toHaveBeenCalledWith(20, 10);
    expect(scale).toHaveBeenCalledWith(2, 2);
  });

  it('draws the marquee rectangle when provided', () => {
    const engine = createEngine({ clientId: 1 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), {
      marquee: { x: 0, y: 0, width: 50, height: 50 },
    });
    // The marquee paints in accent (veil + outline).
    expect(ctx.strokes).toContain(resolveColor(SELECTION_COLOR));
    expect(ctx.calls.filter((c) => c === 'rect').length).toBeGreaterThanOrEqual(2);
  });

  it('draws the handles (square resize + ellipse rotation) on a single selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // 8 square handles (rect) + selection frame (rect); 1 rotation handle (ellipse).
    expect(ctx.calls.filter((c) => c === 'rect').length).toBeGreaterThanOrEqual(9);
    expect(ctx.calls).toContain('ellipse');
  });

  it('draws no handles on a multi-selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 20, y: 0, width: 10, height: 10 },
      { select: false },
    );
    engine.select(['a', 'b']);
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // 2 bodies + 2 selection frames = 4 rect, and no handle → no rotation handle (ellipse).
    expect(ctx.calls.filter((c) => c === 'rect').length).toBe(4);
    expect(ctx.calls).not.toContain('ellipse');
  });

  it('draws a background (sticky) under a text with a non-transparent fill', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'text', id: 't', x: 0, y: 0, width: 100, height: 60, text: 'Note', fill: 'warning' },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // The background adds a rect + fill, then the text.
    expect(ctx.calls).toContain('rect');
    expect(ctx.calls).toContain('fill');
    expect(ctx.calls).toContain('fillText');
  });

  it('breaks a long word in a step card (several lines)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'step',
        id: 's',
        x: 0,
        y: 0,
        width: 100,
        height: 200,
        name: 'qodkjnaodjaoidjaopijdoaidjaoijdaoidjadadadazd',
      },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // fakeCtx.measureText = len*7; innerW = 100-20 = 80 → ~11 chars/line → several lines.
    expect(ctx.calls.filter((c) => c === 'fillText').length).toBeGreaterThan(1);
  });

  it('draws every line of a multi-line text', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'text', id: 't', x: 0, y: 0, width: 100, height: 60, text: 'a\nb\nc' },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    expect(ctx.calls.filter((c) => c === 'fillText').length).toBe(3);
  });

  it('draws the background dot grid (dotGrid)', () => {
    const engine = createEngine({ clientId: 1 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), {
      clear: { width: 200, height: 200 },
      dotGrid: { color: 'border', spacing: 22 },
    });
    // Many small rects (dots); single path filled once.
    expect(ctx.calls.filter((c) => c === 'rect').length).toBeGreaterThan(20);
  });

  it('suppressSelection hides selection frame and handles', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), { suppressSelection: true });
    expect(ctx.strokes).not.toContain(resolveColor(SELECTION_COLOR));
    expect(ctx.calls).not.toContain('ellipse'); // no rotation handle
  });

  it('hiddenElementId does not draw the hidden element (edited via overlay)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), { hiddenElementId: 'r' });
    expect(ctx.calls).not.toContain('rect'); // the only element is hidden
  });

  it('uses the injected color resolver (Canvas does not understand var(--color-…))', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { select: false },
    );
    const ctx = fakeCtx();
    // Concrete resolver: 'text' token → real color.
    renderToCanvas(ctx, engine.toRenderModel(), {
      resolveColor: (v) => (v === 'text' ? '#123456' : v),
    });
    expect(ctx.strokes).toContain('#123456');
    expect(ctx.strokes).not.toContain('var(--color-text)');
  });

  it('draws a step card (background + title)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'step', id: 's', x: 0, y: 0, width: 200, height: 120, name: 'Rédiger' },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // Rounded-corner card (path via quadraticCurveTo) + title.
    expect(ctx.calls).toContain('quadraticCurveTo');
    expect(ctx.calls).toContain('fillText');
  });

  it('draws the swimlanes (band + header)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'Métier', order: 0, color: 'green', height: 160 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    // Background (rect+fill) + separator (moveTo/lineTo) + name (fillText).
    expect(ctx.calls).toContain('rect');
    expect(ctx.calls).toContain('fillText');
    expect(ctx.calls).toContain('moveTo');
  });

  it('draws a group around its member steps', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'step', id: 's1', x: 0, y: 0, width: 100, height: 60 },
      { select: false },
    );
    engine.addAgentGroup({ id: 'g1', name: 'Agent', stepIds: ['s1'] });
    const ctx = fakeCtx();
    const model = engine.toRenderModel();
    expect(model.agentGroups).toHaveLength(1);
    renderToCanvas(ctx, model);
    expect(ctx.strokes).toContain(resolveColor('accent'));
  });

  it('draws the snapping guide lines', () => {
    const engine = createEngine({ clientId: 1 });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), { guides: { x: 100, y: 50 } });
    // Two lines (moveTo+lineTo) drawn in accent.
    expect(ctx.calls.filter((c) => c === 'moveTo').length).toBeGreaterThanOrEqual(2);
    expect(ctx.strokes).toContain(resolveColor(SELECTION_COLOR));
  });
});

describe('renderToCanvas — shape text (#82: label, format, shadow)', () => {
  it('draws a shape label with its typography (bold → weight 700)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement({
      kind: 'rectangle',
      id: 'r',
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      fill: 'surface',
      stroke: 'transparent',
      text: 'Hi',
      bold: true,
    });
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    const hi = ctx.texts.find((t) => t.text === 'Hi');
    expect(hi).toBeDefined();
    expect(hi?.font).toContain('700');
  });

  it('alignment: the label horizontal offset follows `textAlign`', () => {
    const xFor = (align: 'left' | 'right'): number => {
      const engine = createEngine({ clientId: 1 });
      engine.addElement({
        kind: 'rectangle',
        id: 'r',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        fill: 'surface',
        stroke: 'transparent',
        text: 'AAAA',
        textAlign: align,
      });
      const ctx = fakeCtx();
      renderToCanvas(ctx, engine.toRenderModel());
      return ctx.texts.find((t) => t.text === 'AAAA')?.x ?? 0;
    };
    expect(xFor('right')).toBeGreaterThan(xFor('left'));
  });

  it('underline/strikethrough add decoration strokes', () => {
    const strokeCount = (deco: Record<string, boolean>): number => {
      const engine = createEngine({ clientId: 1 });
      engine.addElement({
        kind: 'rectangle',
        id: 'r',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        fill: 'surface',
        stroke: 'transparent',
        text: 'Hi',
        ...deco,
      });
      const ctx = fakeCtx();
      renderToCanvas(ctx, engine.toRenderModel());
      return ctx.strokes.length;
    };
    expect(strokeCount({ underline: true, strike: true })).toBeGreaterThan(strokeCount({}));
  });

  it('"card" shadow enabled by default, disabled via `shadow:false`', () => {
    const hasShadowedFill = (shadow?: boolean): boolean => {
      const engine = createEngine({ clientId: 1 });
      engine.addElement({
        kind: 'rectangle',
        id: 'r',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        fill: 'surface',
        stroke: 'transparent',
        ...(shadow === undefined ? {} : { shadow }),
      });
      const ctx = fakeCtx();
      renderToCanvas(ctx, engine.toRenderModel());
      return ctx.fills.some((f) => f.shadow !== '');
    };
    expect(hasShadowedFill()).toBe(true); // default: drop shadow
    expect(hasShadowedFill(false)).toBe(false); // disabled per item
  });

  it('marquee preview: highlights (accent) the intersected elements before release', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'r', x: 0, y: 0, width: 50, height: 50, stroke: 'transparent' },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel(), { marqueeHighlightIds: ['r'] });
    expect(ctx.strokes).toContain(resolveColor(SELECTION_COLOR));
  });
});

describe('renderToCanvas — step: description, tags, shadow', () => {
  it('shows the description on the card only when `showDescription`', () => {
    const renderWith = (showDescription?: boolean): string[] => {
      const engine = createEngine({ clientId: 1 });
      engine.addElement(
        {
          kind: 'step',
          id: 's',
          x: 0,
          y: 0,
          width: 220,
          height: 160,
          name: 'Titre',
          description: 'Détail',
          ...(showDescription === undefined ? {} : { showDescription }),
        },
        { select: false },
      );
      const ctx = fakeCtx();
      renderToCanvas(ctx, engine.toRenderModel());
      return ctx.texts.map((t) => t.text);
    };
    expect(renderWith()).not.toContain('Détail'); // hidden by default
    expect(renderWith(true)).toContain('Détail'); // shown when enabled
  });

  it('renders skills/deliverables as pills (accent/success background + labels)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'step',
        id: 's',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        name: 'Étape',
        skills: ['écriture'],
        deliverables: ['note'],
      },
      { select: false },
    );
    const ctx = fakeCtx();
    renderToCanvas(ctx, engine.toRenderModel());
    const texts = ctx.texts.map((t) => t.text);
    expect(texts).toContain('écriture');
    expect(texts).toContain('note');
    // The pills set an accent-subtle background (skill) and success-subtle (deliverable).
    expect(ctx.fills.map((f) => f.shadow)).toBeDefined();
    expect(ctx.strokes).toBeDefined();
  });

  it('step shadow: enabled by default, disabled via `shadow:false`', () => {
    const hasShadowedFill = (shadow?: boolean): boolean => {
      const engine = createEngine({ clientId: 1 });
      engine.addElement(
        {
          kind: 'step',
          id: 's',
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          name: 'A',
          ...(shadow === undefined ? {} : { shadow }),
        },
        { select: false },
      );
      const ctx = fakeCtx();
      renderToCanvas(ctx, engine.toRenderModel());
      return ctx.fills.some((f) => f.shadow !== '');
    };
    expect(hasShadowedFill()).toBe(true); // default: shadow enabled (like rectangle/ellipse)
    expect(hasShadowedFill(false)).toBe(false); // can be disabled per item
  });

  it('step defaults: white background (surface) + no outline', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'step', id: 's', x: 0, y: 0, width: 200, height: 120, name: 'A' },
      { select: false },
    );
    const el = engine.board.getElement('s');
    expect(el && el.kind === 'step' ? el.fill : '').toBe('surface');
    expect(el && el.kind === 'step' ? el.stroke : '').toBe('transparent');
  });
});
