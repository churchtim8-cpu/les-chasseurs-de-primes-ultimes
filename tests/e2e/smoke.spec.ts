import { expect, test, type Page } from '@playwright/test';

// Headless Chromium renders in software at a low frame rate, so game time runs slowly here
// (menu buttons also show their press briefly, in game time, before the next screen opens).
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
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title', 'DebugOverlay']));

  // Practice: starting creates a valid Easy seed code and opens the chase.
  await page.keyboard.press('p');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Practice']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase', 'DebugOverlay']));
  expect(await info(page, 'seed')).toMatch(/^BV-E-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // After the countdown the police car drives off on its own.
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  expect(await info(page, 'mode')).toBe('CAR');
  expect(await info(page, 'phase')).toBe('PURSUIT');

  // The scanner gives the first French instruction as the chase starts.
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);

  // ÉCHAP pauses: the clock stops under the pause menu; the controls open from it; ÉCHAP carries on.
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Pause']));
  const clock = () => page.evaluate(() => (window.__bellevue?.game.scene.getScene('Chase') as unknown as { chase: { status: { timeLeft: number } } }).chase.status.timeLeft);
  const frozen = await clock();
  await page.waitForTimeout(800);
  expect(await clock()).toBe(frozen);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Commands']));
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page), SLOW).not.toContain('Commands');
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page), SLOW).not.toContain('Pause');
  await expect.poll(clock, SLOW).toBeLessThan(frozen);

  // Phones and tablets have no ÉCHAP key: the PAUSE button pauses too.
  const pausePoint = await page.evaluate(() => {
    const scene = window.__bellevue?.game.scene.getScene('Chase') as unknown as {
      hud: { pauseButton: { hit: { x: number; y: number; width: number; height: number } } };
      scale: { width: number };
      game: { canvas: HTMLCanvasElement };
    };
    const hit = scene.hud.pauseButton.hit;
    const box = scene.game.canvas.getBoundingClientRect();
    const k = box.width / scene.scale.width;
    return { x: box.left + (hit.x + hit.width / 2) * k, y: box.top + (hit.y + hit.height / 2) * k };
  });
  await page.mouse.click(pausePoint.x, pausePoint.y);
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Pause']));
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page), SLOW).not.toContain('Pause');

  // Getting out (ESPACE) switches to foot mode, and the camera zooms in.
  const carZoom = Number(await info(page, 'zoom'));
  await page.keyboard.press('Space');
  await expect.poll(() => info(page, 'mode')).toBe('FOOT');
  await expect.poll(async () => Number(await info(page, 'zoom')), SLOW).toBeGreaterThan(carZoom * 1.5);
  // On foot the map turns so the officer faces up the screen (a screen angle of -90°).
  const facingUp = () =>
    page.evaluate(() => {
      const scene = window.__bellevue?.game.scene.getScene('Chase') as unknown as {
        cameras: { main: { rotation: number } };
        chase: { player: { snapshot: () => { heading: number } } };
      };
      const off = scene.cameras.main.rotation + Math.PI / 2 + scene.chase.player.snapshot().heading;
      return Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
    });
  await expect.poll(facingUp, SLOW).toBeLessThan(0.15);

  // Debug mode toggles off with the backtick key.
  await page.keyboard.press('Backquote');
  expect(await page.evaluate(() => window.__bellevue?.debug.isEnabled)).toBe(false);

  expect(errors).toEqual([]);
});

test('a seed in the address replays that exact chase, and debug capture ends it', async ({ page }) => {
  const errors = watchErrors(page);
  const seed = 'BV-I-NW3A-HRZZ';
  await page.goto(`./?debug=1&type=CAR_CAR&turnoff=0&seed=${seed}`);
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
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

  // The results screen follows; R replays the same chase.
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Results']));
  expect(Number(await info(page, 'score'))).toBeGreaterThan(0);
  await page.keyboard.press('r');
  // Wait for the new chase itself: the old chase's readings linger until it starts.
  await expect.poll(() => info(page, 'phase'), SLOW).toBe('PURSUIT');
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  expect(await info(page, 'seed')).toBe(seed);
  expect(await info(page, 'route')).toBe(route);

  expect(errors).toEqual([]);
});

test('the suspect gets out and runs: the scanner orders the player out, and the chase goes on on foot', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_FOOT&turnoff=0&sightings=0&seed=BV-I-NW3A-HRZZ');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
  expect(await info(page, 'chase')).toBe('CAR_FOOT');
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);

  // Drive the suspect's route (the French is tested elsewhere), a little slower than the suspect (which keeps
  // pace until its last stage) so it gets out first without pulling out of range.
  await page.evaluate(() => {
    const scene = window.__bellevue!.game.scene.getScene('Chase') as unknown as {
      chase: { player: { followPlan(n: string[]): void; speedFactor: number }; scenario: { route: string[] } };
    };
    scene.chase.player.followPlan(scene.chase.scenario.route.slice(1));
    scene.chase.player.speedFactor = 0.9;
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

test('the suspect changes direction: the scanner says so and corrects the directions', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_CAR&turnoff=1&sightings=0&seed=BV-H-K7EP-VHKY');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  await page.evaluate(() => {
    const scene = window.__bellevue!.game.scene.getScene('Chase') as unknown as {
      chase: { player: { followPlan(n: string[]): void }; scenario: { route: string[] } };
    };
    scene.chase.player.followPlan(scene.chase.scenario.route.slice(1));
  });
  await expect
    .poll(() => info(page, 'scanner'), { timeout: 60_000 })
    .toMatch(/^(DIRECTION|FILLER|CORRECTION): event\.attention \+ event\.changed_direction \+ /);
  expect(errors).toEqual([]);
});

test('a sighting pauses the chase until the player picks the suspect', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_CAR&turnoff=0&sightings=1&seed=BV-H-YMQE-YSS0');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
  // "La voiture … est près du …": the debug panel shows which card is right.
  await expect.poll(() => info(page, 'scanner'), { timeout: 60_000 }).toMatch(/^EVENT: event\.sighting\./);
  const answer = String(await info(page, 'sighting')).replace('answer ', '');
  expect(answer).toMatch(/^[1-3]$/);
  await page.keyboard.press(answer);
  await expect.poll(() => info(page, 'sightings')).toBe('1 / 1');
  expect(errors).toEqual([]);
});

test('campaign: case folder, briefing, mission, results, and on to the next suspect', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_CAR&turnoff=0&sightings=0');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('c');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Campaign']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Briefing']));
  expect(await info(page, 'mission')).toBe('1 / 8');
  const seed = await info(page, 'seed');
  expect(seed).toMatch(/^BV-E-/);

  // The briefing describes the chase that follows.
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
  expect(await info(page, 'seed')).toBe(seed);
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);

  // Debug K skips the mission as a capture: results, then the progress is saved.
  await page.keyboard.press('k');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Results']));
  expect(await info(page, 'medal')).not.toBe('-');
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chasseurs.campaign') ?? '{}'));
  expect(saved.current).toBe(1);
  expect(saved.missions[0].captured).toBe(true);

  // Next mission: the second suspect's briefing.
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Briefing']));
  expect(await info(page, 'mission')).toBe('2 / 8');

  expect(errors).toEqual([]);
});

test('the police station shows the rank, badges and case files, and the Boss opens with ?boss=1', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&boss=1');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('o');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Commissariat']));
  // The Boss briefing, from the station.
  await page.evaluate(() => window.__bellevue?.game.scene.getScene('Commissariat').scene.start('Briefing', { boss: 'boss' }));
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Briefing']));
  expect(await info(page, 'mission')).toBe('BOSS');
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Commissariat']));
  expect(errors).toEqual([]);
});

test('escape mode: the player is the fugitive, guided to the hideout, and reaching it wins', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&type=CAR_CAR&turnoff=0&sightings=0');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('e');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Officers']));
  await page.keyboard.press('p');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Practice']));
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Escape', 'DebugOverlay']));
  expect(await info(page, 'seed')).toMatch(/^BV-E-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(await info(page, 'mission')).toBe('ESCAPE');
  // The partner's opening call, then the getaway car drives off on its own.
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  expect(await info(page, 'phase')).toBe('PURSUIT');
  // Debug: safe at the hideout now; the results screen follows.
  await page.keyboard.press('x');
  await expect.poll(() => info(page, 'phase'), SLOW).toBe('ESCAPED');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Results']));
  expect(errors).toEqual([]);
});

test('le défi du jour: names, the same chase for everybody, first try counts; rain and Christmas draw without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&weather=rain&fete=christmas');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('d');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Daily']));
  const code = await info(page, 'daily');
  expect(code).toMatch(/^BV-[EIHX]-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // PLAY asks for a nickname and class first, then opens today's chase.
  await page.keyboard.press('Enter');
  await expect(page.locator('input').first()).toBeVisible(SLOW);
  await page.locator('input').nth(0).fill('Ti Jean');
  await page.locator('input').nth(1).fill('4b');
  await page.locator('input').nth(1).press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Chase']));
  expect(await info(page, 'seed')).toBe(code);
  const board = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chasseurs.daily') ?? '{}'));
  expect(board.nickname).toBe('TI JEAN');
  expect(board.classCode).toBe('4B');
  expect(board.played).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('online class board: waiting first tries are sent, the whole class shows, the teacher can remove a name', async ({ page }) => {
  const errors = watchErrors(page);
  const posted: unknown[] = [];
  const removed: unknown[] = [];
  await page.route('https://board.test/rest/v1/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/rpc/remove_daily_score')) {
      removed.push(req.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
    }
    if (req.method() === 'POST') {
      posted.push(req.postDataJSON());
      return route.fulfill({ status: 201, body: '' });
    }
    expect(req.headers().apikey).toBe('test');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ nickname: 'BEN', score: 1400, stars: 3 }, { nickname: 'ANA', score: 800, stars: 1 }]) });
  });
  await page.addInitScript(() => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    window.localStorage.setItem('chasseurs.daily', JSON.stringify({ version: 1, nickname: 'TI JEAN', classCode: '4B', entries: [], played: [day] }));
    window.localStorage.setItem('chasseurs.daily.unsent', JSON.stringify([{ date: day, nickname: 'TI JEAN', classCode: '4B', score: 1000, stars: 2 }]));
  });
  await page.goto('./?debug=1&online=https://board.test');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('d');
  await expect.poll(() => info(page, 'dailyOnline'), SLOW).toBe('2');
  expect(posted).toEqual([expect.objectContaining({ class_code: '4B', nickname: 'TI JEAN', score: 1000, stars: 2 })]);
  expect(await page.evaluate(() => window.localStorage.getItem('chasseurs.daily.unsent'))).toBeNull();

  await page.keyboard.press('x');
  await expect(page.locator('input').first()).toBeVisible(SLOW);
  await page.locator('input').nth(0).fill('ana');
  await page.locator('input').nth(2).fill('1234');
  await page.locator('input').nth(2).press('Enter');
  await expect.poll(() => removed.length, SLOW).toBe(1);
  expect(removed[0]).toEqual(expect.objectContaining({ p_class: '4B', p_nickname: 'ANA', p_pin: '1234' }));
  expect(errors).toEqual([]);
});

test('escape campaign: the officers wall, a dossier, an escape from Agent Escargot, and the next officer opens', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1&turnoff=0&sightings=0');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Title']));
  await page.keyboard.press('e');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Officers']));
  // NEXT: AGENT ESCARGOT opens the dossier; ESCAPE starts.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Escape']));
  expect(await info(page, 'mission')).toBe('ESCAPE escargot');
  expect(await info(page, 'difficulty')).toBe('EASY');
  await expect.poll(() => info(page, 'scanner'), SLOW).toMatch(/^(DIRECTION|FILLER|FINAL): /);
  await expect.poll(async () => Number(await info(page, 'speed')), SLOW).toBeGreaterThan(10);
  await page.keyboard.press('x');
  await expect.poll(() => activeScenes(page), SLOW).toEqual(expect.arrayContaining(['Results']));
  const progress = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chasseurs.escape') ?? '{}'));
  expect(progress.records.escargot).toEqual(expect.objectContaining({ escaped: true, attempts: 1 }));
  expect(errors).toEqual([]);
});
