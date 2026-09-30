import { expect, test } from '@playwright/test';

test('title screen opens Bellevue City, debug info works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('./?debug=1');
  await expect(page.locator('#game canvas')).toBeVisible();

  const activeScenes = () =>
    page.evaluate(() => window.__bellevue?.game.scene.getScenes(true).map((s) => s.scene.key) ?? []);
  await expect.poll(activeScenes).toEqual(expect.arrayContaining(['Title', 'DebugOverlay']));

  // Starting creates a valid Easy seed code and opens the town.
  await page.keyboard.press('Enter');
  await expect.poll(activeScenes).toEqual(expect.arrayContaining(['Town', 'DebugOverlay']));
  const seed = await page.evaluate(() => window.__bellevue?.debug.info.get('seed'));
  expect(seed).toMatch(/^BV-E-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Zooming in changes the camera zoom.
  const zoom = () => page.evaluate(() => Number(window.__bellevue?.debug.info.get('zoom')));
  const before = await zoom();
  await page.keyboard.press('Equal');
  await expect.poll(zoom).toBeGreaterThan(before);

  // Debug mode toggles off with the backtick key.
  await page.keyboard.press('Backquote');
  expect(await page.evaluate(() => window.__bellevue?.debug.isEnabled)).toBe(false);

  expect(errors).toEqual([]);
});
