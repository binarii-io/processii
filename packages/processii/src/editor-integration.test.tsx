import { useReducer, useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEngine, type WhiteboardEngine } from './engine.js';
import { BoardCanvas } from './board-canvas.js';
import { SidePanel } from './side-panel.js';
import { WhiteboardEditor } from './editor.js';

/**
 * BoardCanvas + SidePanel integration (mimics the app wiring): clicking a step must display
 * that step's editing panel.
 */
function Harness({ engine }: { engine: WhiteboardEngine }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [lane, setLane] = useState<string | null>(null);
  return (
    <div>
      <BoardCanvas
        engine={engine}
        width={400}
        height={300}
        onChange={force}
        selectedLaneId={lane}
        onSelectLane={setLane}
      />
      <SidePanel engine={engine} selectedLaneId={lane} onChange={force} onSelectLane={setLane} />
    </div>
  );
}

describe('integration — clicking a step opens the panel', () => {
  it('shows the step editor after a click', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120, name: 'A' },
      { select: false },
    );
    const { getByLabelText, queryByLabelText } = render(<Harness engine={engine} />);
    // Before the click: no step editor (hint displayed).
    expect(queryByLabelText('Nom')).toBeNull();
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 60, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 60, button: 0, pointerId: 1 });
    // After the click: the step panel appears.
    expect(getByLabelText('Nom')).toBeInTheDocument();
  });
});

describe('integration — new items land at the viewport center (issue #13)', () => {
  it('a toolbar shape is created centered on the visible canvas, not at a fixed corner', () => {
    const engine = createEngine({ clientId: 1 });
    // Full editor wires BoardCanvas → onViewportChange → getSpawnCenter → Toolbar. The unmeasured
    // canvas defaults to 800×600 at the identity viewport, so its center is world (400, 300).
    const { getByRole } = render(<WhiteboardEditor engine={engine} />);

    fireEvent.click(getByRole('button', { name: 'Rectangle' }));
    const rect = engine.listElements().find((e) => e.kind === 'rectangle');
    // 120×80 rectangle centered on (400, 300) → top-left (340, 260), NOT the legacy fixed (40, 40).
    expect(rect).toMatchObject({ x: 340, y: 260, width: 120, height: 80 });
  });
});
