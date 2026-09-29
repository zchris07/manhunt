import { expect, test, type Page } from '@playwright/test';
import { createLobby, joinLobby, newPlayer, readyUp, waitForMatch } from './mp';

const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

async function audio(page: Page): Promise<{ state: string; buffers: number; loops: string[] } | null> {
  return page.evaluate(() => (window.__manhunt as unknown as { audioStats: { state: string; buffers: number; loops: string[] } | null }).audioStats);
}

test('horror layer: procedural audio, generator hum, terror radius', async ({ browser }) => {
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

  // A user gesture unlocks WebAudio.
  await surv.mouse.click(400, 300);
  await expect.poll(async () => (await audio(surv))?.state, { timeout: 10000 }).toBe('running');
  await expect.poll(async () => (await audio(surv))?.loops ?? [], { timeout: 10000 }).toContain('amb.outdoor');

  // Restored generators hum (positional loop) when you're near one.
  const gen = await surv.evaluate(() => (window.__manhunt.client as unknown as { match: { map: { generators: { x: number; y: number }[] } } }).match.map.generators[0]);
  await dev(surv, 'gens');
  await dev(surv, 'tp', [gen.x + 90, gen.y]);
  await expect.poll(async () => (await audio(surv))?.loops ?? [], { timeout: 10000 }).toContain('gen0');

  // Terror radius: Zach close -> high terror for the survivor.
  const terror = (): Promise<number> => surv.evaluate(() => (window.__manhunt.client as unknown as { self: { terror: number } }).self.terror);
  expect(await terror()).toBeLessThan(0.2);
  const survId = await surv.evaluate(() => window.__manhunt.client!.you);
  await dev(zach, 'tpTo', [survId, 120, 0]);
  await expect.poll(terror, { timeout: 10000 }).toBeGreaterThan(0.6);
  // Enough sounds were synthesised without errors.
  expect((await audio(surv))!.buffers).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});
