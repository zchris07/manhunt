import { expect, test, type Page } from '@playwright/test';
import { closePlayers, createLobby, joinLobby, newPlayer, readyUp, waitForMatch } from './mp';

test.afterEach(closePlayers);

const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

async function audio(page: Page): Promise<{ state: string; buffers: number; loops: string[]; clips: number; loaded: string[] } | null> {
  return page.evaluate(() => (window.__manhunt as unknown as { audioStats: { state: string; buffers: number; loops: string[]; clips: number; loaded: string[] } | null }).audioStats);
}

test('audio is only the two custom files: the burst snippet (everyone) and Sexton\'s reel', async ({ browser }) => {
  const errors: string[] = [];
  const surv = await newPlayer(browser, '/?dev=1');
  surv.on('pageerror', (e) => errors.push(e.message));
  const code = await createLobby(surv, 'Mara');
  const zach = await newPlayer(browser);
  zach.on('pageerror', (e) => errors.push(e.message));
  await joinLobby(zach, 'Zach', code);
  await surv.click('[data-pref="survivor"]');
  await zach.click('[data-pref="hunter"]');
  await readyUp(zach);
  await surv.click('#start');
  await waitForMatch(surv);
  await waitForMatch(zach);

  // A user gesture unlocks WebAudio; both files load and nothing else plays.
  await surv.mouse.click(400, 300);
  await zach.mouse.click(400, 300);
  await expect.poll(async () => (await audio(surv))?.state, { timeout: 10000 }).toBe('running');
  await expect.poll(async () => ((await audio(surv))?.loaded ?? []).sort(), { timeout: 10000 }).toEqual(['burst', 'sexton.reel']);
  await expect.poll(async () => ((await audio(zach))?.loaded ?? []).length, { timeout: 10000 }).toBe(2);
  expect((await audio(surv))!.loops).toEqual([]);

  // Zach fires a Soundcloud Burst (F): both players hear the GMajor snippet.
  await zach.keyboard.press('KeyF');
  await expect.poll(async () => (await audio(zach))?.clips ?? 0, { timeout: 10000 }).toBe(1);
  await expect.poll(async () => (await audio(surv))?.clips ?? 0, { timeout: 10000 }).toBe(1);

  // Sexton Science's reel plays around him (louder the closer you are).
  await dev(surv, 'sexton', [60, 0]);
  await expect.poll(async () => (await audio(surv))?.loops ?? [], { timeout: 10000 }).toEqual(['sexton']);
  expect(errors).toEqual([]);
});
