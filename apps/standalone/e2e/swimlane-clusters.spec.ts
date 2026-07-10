import { expect, test } from '@playwright/test';

/**
 * Swimlane clusters (v2) drag journey — smoke coverage in a real browser: create two lanes, then
 * drag one lane header far away (the detach gesture) and drag on the block's left grip (the
 * move gesture). We assert the surface stays mounted and nothing throws; the exact reorder /
 * attach / detach state transitions are asserted deterministically in the package's
 * `board-canvas.test.tsx` component tests (which drive the same pointer handlers).
 */
test('create lanes, then detach / move a swimlane block without crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un whiteboard' }).first().click();

  const canvas = page.getByLabel('Surface de dessin du whiteboard');
  await expect(canvas).toBeVisible();

  // Swimlanes (and the other process-modelling tools) are exposed only on the **process** board
  // type; a fresh board defaults to idéation. Switch it via the board-type picker first.
  await page.getByRole('button', { name: /^Type de board/ }).click();
  await page.getByRole('button', { name: 'Process', exact: true }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Outils de dessin' });
  await toolbar.getByRole('button', { name: 'Swimlane' }).click();
  await toolbar.getByRole('button', { name: 'Swimlane' }).click();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });

  // Drag the second lane's header down-right, far from the block → detach gesture.
  const from = at(60, box.height / 2 + 220);
  const to = at(box.width - 80, box.height - 60);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  // Drag on the block's left grip (very left edge) → move the whole cluster.
  const grip = at(4, 120);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 120, grip.y + 40, { steps: 6 });
  await page.mouse.up();

  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});
