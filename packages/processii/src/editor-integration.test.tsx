import { useReducer, useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEngine, type WhiteboardEngine } from './engine.js';
import { BoardCanvas } from './board-canvas.js';
import { SidePanel } from './side-panel.js';

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
