import { expect, test } from '@playwright/test';

test('title screen opens Bellevue City; drive, get out and debug toggle work', async ({ page }) => {
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

  // The police car drives off on its own along the road.
  const info = (key: string) => page.evaluate((k) => window.__bellevue?.debug.info.get(k), key);
  await expect.poll(async () => Number(await info('speed'))).toBeGreaterThan(10);
  expect(await info('mode')).toBe('CAR');

  // Getting out switches to foot mode, and the camera zooms in.
  const carZoom = Number(await info('zoom'));
  await page.keyboard.press('e');
  await expect.poll(() => info('mode')).toBe('FOOT');
  await expect.poll(async () => Number(await info('zoom'))).toBeGreaterThan(carZoom * 1.5);

  // Debug mode toggles off with the backtick key.
  await page.keyboard.press('Backquote');
  expect(await page.evaluate(() => window.__bellevue?.debug.isEnabled)).toBe(false);

  expect(errors).toEqual([]);
});
