import { expect, test, type Route } from '@playwright/test';

/**
 * **AI assistant** E2E (#89) — exercises the WHOLE UI chain: React panel → agent loop →
 * tools → shared engine → canvas re-render. The Mistral API is **intercepted** (scripted
 * replies), so no network nor real key. Two things are verified:
 *  1. the **action traces** appear in the panel (the tools do run through the UI);
 *  2. the board's **actual geometry** changes as expected — read via `window.__wbEngine`,
 *     exposed in demo mode because the board is rendered on a pixel `<canvas>` (not DOM-inspectable).
 *
 * Covers both #89 bugs: a card outside its lane is **actually** tidied into it
 * (`moveStepToLane`), and a lane is **actually** enlarged (`updateSwimlane height`).
 */

// — Scripted Mistral replies (chat/completions format). One turn = either tool_calls, or text. —
type ToolCallSpec = { name: string; args: Record<string, unknown> };

function toolCallsMessage(calls: ToolCallSpec[]) {
  return {
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
  };
}

function textMessage(text: string) {
  return {
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
  };
}

/** MINIMAL engine surface read in the browser (avoids `any` while staying local to the test). */
interface E2EEngine {
  board: {
    getElement(
      id: string,
    ): { x: number; y: number; width: number; height: number; swimlaneId?: string } | undefined;
  };
  listSwimlanes(): Array<{ id: string; height: number }>;
  laneAtPoint(p: { x: number; y: number }): string | undefined;
  laneTop(id: string): number;
}

// Reads the actual geometry from the engine exposed in demo mode.
async function readGeom(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const e = (globalThis as { __wbEngine?: E2EEngine }).__wbEngine;
    const el = e?.board.getElement('signe');
    const rh = e?.listSwimlanes().find((l) => l.id === 'rh');
    // UNIFORM shape (same fields in all cases) for simple typing on the test side.
    if (!e || !el) {
      return {
        exists: false,
        y: null as number | null,
        swimlaneId: null as string | null,
        laneAtCenter: null as string | null,
        rhHeight: rh?.height ?? null,
        rhTop: null as number | null,
      };
    }
    const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    return {
      exists: true,
      y: el.y as number | null,
      swimlaneId: (el.swimlaneId ?? null) as string | null,
      laneAtCenter: (e.laneAtPoint(center) ?? null) as string | null,
      rhHeight: rh?.height ?? null,
      rhTop: (rh ? e.laneTop('rh') : null) as number | null,
    };
  });
}

test('AI assistant — tidies a card into its lane and enlarges the lane (full UI chain)', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000); // 3 mocked turns + canvas build: comfortable margin
  // Pre-injected Mistral key (passes the onboarding gate without network).
  await page.addInitScript(() => {
    window.localStorage.setItem('memorii.whiteboard.mistral-key', 'sk-e2e-mock');
  });

  // Scripted reply queue, consumed on each call to /v1/chat/completions.
  const responses: object[] = [
    // Turn 1 — message A: prepares 2 lanes + 1 MISPLACED RH step (y outside the lanes).
    toolCallsMessage([
      { name: 'addSwimlane', args: { id: 'rh', name: 'RH', laneType: 'user' } },
      { name: 'addSwimlane', args: { id: 'manager', name: 'Manager', laneType: 'user' } },
      {
        name: 'addStep',
        args: { id: 'signe', name: 'J’ai signé', swimlaneId: 'rh', x: 300, y: 600 },
      },
    ]),
    textMessage('Board de test préparé.'),
    // Turn 2 — message B: ACTUALLY tidies the step into RH.
    toolCallsMessage([{ name: 'moveStepToLane', args: { stepId: 'signe', laneId: 'rh' } }]),
    textMessage('Étape rangée dans la bande RH.'),
    // Turn 3 — message C: enlarges the RH lane.
    toolCallsMessage([{ name: 'updateSwimlane', args: { id: 'rh', height: 320 } }]),
    textMessage('Bande RH agrandie.'),
  ];
  await page.route('**/v1/chat/completions', async (route: Route) => {
    const body = responses.shift() ?? textMessage('(fin)');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  // — Startup: create a board, open the assistant —
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un whiteboard' }).first().click();
  await expect(page.getByLabel('Surface de dessin du whiteboard')).toBeVisible();
  await page.getByRole('button', { name: /Ouvrir l.assistant IA/ }).click();

  const composer = page.getByLabel(/Message à l.assistant/);
  await expect(composer).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!(globalThis as { __wbEngine?: unknown }).__wbEngine))
    .toBe(true);

  // === Message A: prepare a board with a card outside its lane ===
  await composer.fill('Prépare un board de test (RH, Manager) avec une étape RH mal placée.');
  await composer.press('Enter');
  await expect(page.getByText('Board de test préparé.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Étape « J’ai signé » ajoutée/)).toBeVisible();

  const before = await readGeom(page);
  expect(before?.exists).toBe(true);
  expect(before?.swimlaneId).toBe('rh'); // assigned to RH…
  expect(before?.laneAtCenter).not.toBe('rh'); // …but NOT geometrically inside RH (the bug)
  await page.screenshot({ path: testInfo.outputPath('01-misplaced.png'), fullPage: false });

  // === Message B: actually tidy the card into RH ===
  await composer.fill('Range l’étape dans sa bande.');
  await composer.press('Enter');
  await expect(page.getByText(/placée dans la bande/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Étape rangée dans la bande RH.')).toBeVisible();

  const afterMove = await readGeom(page);
  expect(afterMove?.laneAtCenter).toBe('rh'); // the card NOW falls inside RH
  expect(afterMove?.y).toBeGreaterThanOrEqual(afterMove?.rhTop ?? 0);
  await page.screenshot({ path: testInfo.outputPath('02-placed.png'), fullPage: false });

  // === Message C: enlarge the RH lane ===
  await composer.fill('Agrandis la bande RH.');
  await composer.press('Enter');
  await expect(page.getByText(/Bande mise à jour \(hauteur 320\)/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Bande RH agrandie.')).toBeVisible();

  const afterResize = await readGeom(page);
  expect(afterResize?.rhHeight).toBe(320); // the lane actually grew (160 → 320)
  await page.screenshot({ path: testInfo.outputPath('03-resized.png'), fullPage: false });

  // The canvas stays mounted and healthy after all the mutations.
  await expect(page.getByLabel('Surface de dessin du whiteboard')).toBeVisible();
});
