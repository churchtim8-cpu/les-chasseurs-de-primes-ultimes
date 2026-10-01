import { expect, test, type Page } from '@playwright/test';

// Headless Chromium renders in software at a low frame rate, so game time runs slowly here.
test.setTimeout(120_000);
const SLOW = { timeout: 30_000 };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const activeScenes = (page: Page) =>
  page.evaluate(() => window.__bellevue?.game.scene.getScenes(true).map((s) => s.scene.key) ?? []);
const info = (page: Page, key: string) => page.evaluate((k) => window.__bellevue?.debug.info.get(k), key);

test('title screen starts a chase; drive, get out and debug toggle work', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_CAR');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => activeScenes(page)).toEqual(expect.arrayContaining(['Title', 'DebugOverlay']));

  // Starting creates a valid Easy seed code and opens the chase.
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).toEqual(expect.arrayContaining(['Chase', 'DebugOverlay']));
  expect(await info(page, 'seed')).toMatch(/^BV-E-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // After the countdown the police car drives off on its own.
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  expect(await info(page, 'mode')).toBe('CAR');
  expect(await info(page, 'phase')).toBe('PURSUIT');

  // The scanner gives the first French instruction as the chase starts.
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);

  // Getting out switches to foot mode, and the camera zooms in.
  const carZoom = Number(await info(page, 'zoom'));
  await page.keyboard.press('e');
  await expect.poll(() => info(page, 'mode')).toBe('FOOT');
  await expect.poll(async () => Number(await info(page, 'zoom')), SLOW).toBeGreaterThan(carZoom * 1.5);

  // Debug mode toggles off with the backtick key.
  await page.keyboard.press('Backquote');
  expect(await page.evaluate(() => window.__bellevue?.debug.isEnabled)).toBe(false);

  expect(errors).toEqual([]);
});

test('a seed in the address replays that exact chase, and debug capture ends it', async ({ page }) => {
  const errors = watchErrors(page);
  const seed = 'BV-I-NW3A-HRZZ';
  await page.goto(`./?debug=1&type=CAR_CAR&seed=${seed}`);
  await expect.poll(() => activeScenes(page)).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).toEqual(expect.arrayContaining(['Chase']));
  expect(await info(page, 'seed')).toBe(seed);
  expect(await info(page, 'difficulty')).toBe('INTERMEDIATE');
  const route = await info(page, 'route');

  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);

  // Intermediate allows three repeats per chase; a fourth is refused.
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);
  for (let i = 0; i < 4; i++) await page.keyboard.press('r');
  await expect.poll(() => info(page, 'repeats'), SLOW).toBe('3 used, 0 left');

  // Debug C puts the player on the suspect: the capture rules end the chase.
  await page.keyboard.press('c');
  await expect.poll(() => info(page, 'phase'), SLOW).toBe('CAPTURED');

  // R replays the same chase.
  await page.keyboard.press('r');
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  expect(await info(page, 'phase')).toBe('PURSUIT');
  expect(await info(page, 'seed')).toBe(seed);
  expect(await info(page, 'route')).toBe(route);

  expect(errors).toEqual([]);
});

test('the suspect gets out and runs: the scanner orders the player out, and the chase goes on on foot', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_FOOT&seed=BV-I-NW3A-HRZZ');
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).toEqual(expect.arrayContaining(['Chase']));
  expect(await info(page, 'chase')).toBe('CAR_FOOT');
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);

  // Drive the suspect's route (the French is tested elsewhere), keeping back so the suspect gets out first.
  await page.evaluate(() => {
    const scene = window.__bellevue!.game.scene.getScene('Chase') as unknown as {
      chase: { player: { followPlan(n: string[]): void; speedFactor: number }; scenario: { route: string[] } };
    };
    scene.chase.player.followPlan(scene.chase.scenario.route.slice(1));
    scene.chase.player.speedFactor = 0.6;
  });
  await expect.poll(() => info(page, 'scanner'), { timeout: 90_000 }).toBe('EVENT: event.get_out');
  expect(await info(page, 'stage')).toBe('suspect 2, player 1');

  await page.keyboard.press('e');
  await expect.poll(() => info(page, 'mode')).toBe('FOOT');
  // On foot the player follows the suspect's tracks to where it got out, then directions start again.
  await expect.poll(() => info(page, 'stage'), { timeout: 60_000 }).toBe('suspect 2, player 2');
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);

  expect(errors).toEqual([]);
});
