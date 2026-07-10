import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import { LEGACY_CLUSTER_ID } from './scene.js';
import {
  useWhiteboardTools,
  type UseWhiteboardToolsOptions,
  type WhiteboardTool,
} from './use-whiteboard-tools.js';

/**
 * Test harness: renders the headless hook and exposes the latest descriptors through a ref, so a
 * test can assert on the list and call `run()` outside React's render (like a host would from a
 * click handler).
 */
function renderTools(
  engine: Parameters<typeof useWhiteboardTools>[0],
  opts?: UseWhiteboardToolsOptions,
): { current: () => WhiteboardTool[]; rerender: (opts?: UseWhiteboardToolsOptions) => void } {
  let latest: WhiteboardTool[] = [];
  function Harness({ options }: { options?: UseWhiteboardToolsOptions }) {
    latest = useWhiteboardTools(engine, options);
    return null;
  }
  const { rerender } = render(<Harness options={opts} />);
  return {
    current: () => latest,
    rerender: (o) => rerender(<Harness options={o} />),
  };
}

const ids = (tools: WhiteboardTool[]): string[] => tools.map((t) => t.id);
const byId = (tools: WhiteboardTool[], id: WhiteboardTool['id']): WhiteboardTool | undefined =>
  tools.find((t) => t.id === id);

describe('useWhiteboardTools — board-type gating', () => {
  it('exposes only the generic drawing tools on a non-process board (default ideation)', () => {
    const engine = createEngine({ clientId: 1 });
    const { current } = renderTools(engine, { onCreateSubprocess: () => Promise.resolve('c') });
    // Process-modelling tools are absent; the drawing tools stay.
    expect(ids(current())).toEqual(['rectangle', 'ellipse', 'text', 'sticky', 'connector']);
    for (const t of current()) expect(t.group).toBe('draw');
  });

  it('adds the process-modelling tools on a process board', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const { current } = renderTools(engine);
    // No onCreateSubprocess → no `subprocess` tool.
    expect(ids(current())).toEqual([
      'rectangle',
      'ellipse',
      'text',
      'sticky',
      'connector',
      'step',
      'swimlane',
      'group',
    ]);
    for (const id of ['step', 'swimlane', 'group'] as const) {
      expect(byId(current(), id)?.group).toBe('process');
    }
  });

  it('reacts to a board-type change via engine.board.observe (no rerender needed)', () => {
    const engine = createEngine({ clientId: 1 });
    const { current } = renderTools(engine);
    expect(ids(current())).not.toContain('swimlane');
    act(() => engine.setBoardType('process'));
    expect(ids(current())).toContain('swimlane');
  });

  it('includes `subprocess` only when onCreateSubprocess is supplied (process board)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const without = renderTools(engine);
    expect(ids(without.current())).not.toContain('subprocess');

    const withCb = renderTools(engine, { onCreateSubprocess: () => Promise.resolve('c') });
    expect(ids(withCb.current())).toContain('subprocess');
    // It sits in the process group, right after `step`.
    expect(byId(withCb.current(), 'subprocess')?.group).toBe('process');
  });
});

describe('useWhiteboardTools — disabled states', () => {
  it('disables `connector` unless exactly 2 elements are selected', () => {
    const engine = createEngine({ clientId: 1 });
    expect(byId(renderTools(engine, { selectionCount: 0 }).current(), 'connector')?.disabled).toBe(
      true,
    );
    expect(byId(renderTools(engine, { selectionCount: 1 }).current(), 'connector')?.disabled).toBe(
      true,
    );
    expect(byId(renderTools(engine, { selectionCount: 2 }).current(), 'connector')?.disabled).toBe(
      false,
    );
    expect(byId(renderTools(engine, { selectionCount: 3 }).current(), 'connector')?.disabled).toBe(
      true,
    );
  });

  it('disables `group` when the selection is empty, enables it otherwise', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    expect(byId(renderTools(engine, { selectionCount: 0 }).current(), 'group')?.disabled).toBe(
      true,
    );
    expect(byId(renderTools(engine, { selectionCount: 1 }).current(), 'group')?.disabled).toBe(
      false,
    );
  });
});

describe('useWhiteboardTools — run()', () => {
  it('rectangle.run() adds a rectangle and calls onChange', () => {
    const engine = createEngine({ clientId: 1 });
    const onChange = vi.fn();
    const { current } = renderTools(engine, { onChange });
    act(() => byId(current(), 'rectangle')?.run());
    expect(engine.listElements().some((e) => e.kind === 'rectangle')).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('drops a new shape centered on getSpawnCenter, rounding to integer world coords', () => {
    const engine = createEngine({ clientId: 1 });
    const { current } = renderTools(engine, { getSpawnCenter: () => ({ x: 1000, y: 500 }) });
    act(() => byId(current(), 'rectangle')?.run());
    // 120×80 rectangle centered on (1000, 500) → top-left = (940, 460).
    expect(engine.listElements().find((e) => e.kind === 'rectangle')).toMatchObject({
      x: 940,
      y: 460,
      width: 120,
      height: 80,
    });
  });

  it('falls back to the fixed position when getSpawnCenter is absent', () => {
    const engine = createEngine({ clientId: 1 });
    const { current } = renderTools(engine);
    act(() => byId(current(), 'rectangle')?.run());
    expect(engine.listElements().find((e) => e.kind === 'rectangle')).toMatchObject({
      x: 40,
      y: 40,
    });
  });

  it('connector.run() creates a bound arrow between the 2 selected elements', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 },
      {
        select: false,
      },
    );
    engine.addElement(
      { kind: 'rectangle', id: 'b', x: 200, y: 0, width: 50, height: 50 },
      {
        select: false,
      },
    );
    engine.select(['a', 'b']);
    const { current } = renderTools(engine, { selectionCount: 2 });
    act(() => byId(current(), 'connector')?.run());
    expect(engine.listElements().find((e) => e.kind === 'arrow')).toMatchObject({
      start: 'a',
      end: 'b',
    });
  });

  it('step.run() adds a step (process board)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const { current } = renderTools(engine);
    act(() => byId(current(), 'step')?.run());
    expect(engine.listElements().some((e) => e.kind === 'step')).toBe(true);
  });

  it('swimlane.run() adds a swimlane and recentres the view when a view rect is known', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const onCenterView = vi.fn();
    const { current } = renderTools(engine, {
      getViewRect: () => ({ x: 1000, y: 500, width: 800, height: 600 }),
      onCenterView,
    });
    act(() => byId(current(), 'swimlane')?.run());
    const lane = engine.listSwimlanes()[0];
    expect(lane?.clusterId).not.toBe(LEGACY_CLUSTER_ID); // a fresh block centered on the view
    expect(onCenterView).toHaveBeenCalledWith({ x: 1400, y: expect.any(Number) });
  });

  it('swimlane.run() falls back to the legacy block without a view rect', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const { current } = renderTools(engine);
    act(() => byId(current(), 'swimlane')?.run());
    expect(engine.listSwimlanes()[0]?.clusterId).toBe(LEGACY_CLUSTER_ID);
  });

  it('group.run() groups the current selection', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    engine.addElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 100, height: 60 });
    const { current } = renderTools(engine, { selectionCount: 1 });
    act(() => byId(current(), 'group')?.run());
    expect(engine.listAgentGroups()).toHaveLength(1);
    expect(engine.listAgentGroups()[0]?.stepIds).toEqual(['s1']);
  });

  it('subprocess.run() creates a child (callback) then adds a linked step', async () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const onCreateSubprocess = vi.fn().mockResolvedValue('child-1');
    const { current } = renderTools(engine, { onCreateSubprocess });
    await act(async () => {
      byId(current(), 'subprocess')?.run();
      await Promise.resolve();
    });
    expect(onCreateSubprocess).toHaveBeenCalledOnce();
    const steps = engine.listElements().filter((e) => e.kind === 'step');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ subprocessRef: 'child-1' });
  });

  it('subprocess.run() adds nothing when the callback resolves null', async () => {
    const engine = createEngine({ clientId: 1 });
    engine.setBoardType('process');
    const { current } = renderTools(engine, { onCreateSubprocess: () => Promise.resolve(null) });
    await act(async () => {
      byId(current(), 'subprocess')?.run();
      await Promise.resolve();
    });
    expect(engine.listElements().filter((e) => e.kind === 'step')).toHaveLength(0);
  });
});
