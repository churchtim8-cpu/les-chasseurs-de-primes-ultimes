import { expect, test } from '@playwright/test';

test('title screen loads, accepts input and shows debug info', async ({ page }) => {
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

  // Starting (keyboard) creates a valid Easy seed code.
  await page.locator('#game canvas').click();
  await page.keyboard.press('Enter');
  const seed = await page.evaluate(() => window.__bellevue?.debug.info.get('seed'));
  expect(seed).toMatch(/^BV-E-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Debug mode toggles off with the backtick key.
  await page.keyboard.press('Backquote');
  expect(await page.evaluate(() => window.__bellevue?.debug.isEnabled)).toBe(false);

  expect(errors).toEqual([]);
});
