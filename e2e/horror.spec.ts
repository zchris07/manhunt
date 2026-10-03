import { expect, test, type Page } from '@playwright/test';
import { closePlayers, createLobby, joinLobby, newPlayer, readyUp, waitForMatch } from './mp';

test.afterEach(closePlayers);

const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

async function audio(page: Page): Promise<{ state: string; buffers: number; loops: string[]; clips: number; loaded: string[] } | null> {
  return page.evaluate(() => (window.__manhunt as unknown as { audioStats: { state: string; buffers: number; loops: string[]; clips: number; loaded: string[] } | null }).audioStats);
}

test('audio: the burst snippet only Zach hears, and Sexton\'s reel', async ({ browser }) => {
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
  await expect.poll(async () => ((await audio(surv))?.loaded ?? []).sort(), { timeout: 10000 }).toEqual(['boom', 'burst', 'sexton.reel']);
  await expect.poll(async () => ((await audio(zach))?.loaded ?? []).length, { timeout: 10000 }).toBe(3);
  expect((await audio(surv))!.loops).toEqual([]);

  // Zach fires a Soundcloud Burst (F): he hears a GMajor snippet; survivors hear nothing.
  await zach.keyboard.press('KeyF');
  await expect.poll(async () => (await audio(zach))?.clips ?? 0, { timeout: 10000 }).toBe(1);
  await surv.waitForTimeout(1500);
  expect((await audio(surv))!.clips).toBe(0);

  // Sexton Science's reel plays around him (louder the closer you are).
  await dev(surv, 'sexton', [60, 0]);
  await expect.poll(async () => (await audio(surv))?.loops ?? [], { timeout: 10000 }).toEqual(['sexton']);

  // Shane Jeans, alerted, pitter-patters after you (a synthesized loop) until he gives up.
  // His alert meter takes a few seconds to fill: keep him right beside the survivor meanwhile.
  await expect
    .poll(
      async () => {
        await dev(surv, 'shane', [40, 0]);
        return ((await audio(surv))?.loops ?? []).sort();
      },
      { timeout: 20000, intervals: [500] },
    )
    .toEqual(['sexton', 'shane']);
  expect((await audio(surv))!.loaded).toContain('shane.steps');
  expect(errors).toEqual([]);
});

test('Chris Zelley: talk to him and he promises to come when needed', async ({ browser }) => {
  const errors: string[] = [];
  const surv = await newPlayer(browser, '/?dev=1');
  surv.on('pageerror', (e) => errors.push(e.message));
  const code = await createLobby(surv, 'Mara');
  const zach = await newPlayer(browser);
  await joinLobby(zach, 'Zach', code);
  await surv.click('[data-pref="survivor"]');
  await zach.click('[data-pref="hunter"]');
  await readyUp(zach);
  await surv.click('#start');
  await waitForMatch(surv);

  const chrisState = (): Promise<number | null> =>
    surv.evaluate(() => {
      const ents = window.__manhunt.client?.latest?.entities as Map<number, { kind: number; state: number }> | undefined;
      const c = ents ? [...ents.values()].find((e) => e.kind === 7) : undefined;
      return c ? c.state : null;
    });
  await dev(surv, 'chris', [45, 0]);
  await expect.poll(chrisState, { timeout: 10000 }).not.toBeNull();
  expect((await chrisState())! & 4).toBe(0);
  await surv.keyboard.press('KeyE');
  await expect.poll(async () => ((await chrisState()) ?? 0) & 4, { timeout: 10000 }).toBe(4);
  await surv.waitForTimeout(500);
  expect(errors).toEqual([]);
});
