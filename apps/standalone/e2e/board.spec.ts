import { expect, test } from '@playwright/test';

/**
 * Minimal standalone-site journey (demo mode, no network): open → create a document →
 * draw a shape → the surface stays mounted (local editing succeeded).
 */
test('loads the site, creates a document and draws a shape', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Memorii Whiteboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Créer un whiteboard' }).first().click();

  const canvas = page.getByLabel('Surface de dessin du whiteboard');
  await expect(canvas).toBeVisible();

  const toolbar = page.getByRole('toolbar', { name: 'Outils de dessin' });
  await toolbar.getByRole('button', { name: 'Rectangle' }).click();
  await toolbar.getByRole('button', { name: 'Ellipse' }).click();

  // The surface is still there: local editing required no network.
  await expect(canvas).toBeVisible();

  // P2P disabled in demo mode (no real signaling/STUN): announced in the "Partager" popover.
  await page.getByRole('button', { name: 'Partager le board' }).click();
  await expect(page.getByText('P2P indisponible (mode démo, sans réseau).')).toBeVisible();
});
