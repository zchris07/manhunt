import { expect, test, type Page } from '@playwright/test';
import { closePlayers, newPlayer, state } from './mp';

test.afterEach(closePlayers);

test.setTimeout(420_000);

const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

// Definition of done: 10 players join by link and finish a match with hunters and survivors
// set by the lobby owner.
test('10 players join by invite link and finish a 2-hunter match set up by the owner', async ({ browser }) => {
  const open = (path: string): Promise<Page> => newPlayer(browser, path, { width: 480, height: 320 });

  const owner = await open('/?dev=1');
  await owner.fill('#name', 'Owner');
  await owner.click('#create');
  await owner.waitForSelector('#code', { timeout: 30000 });
  const link = new URL((await owner.textContent('#link'))!.trim());
  const invite = `${link.pathname}${link.search}`;

  const guests: Page[] = [];
  for (let i = 1; i <= 9; i++) {
    const g = await open(invite);
    await g.fill('#name', `Player${i}`);
    await g.click('#join');
    await g.waitForSelector('#code', { timeout: 30000 });
    guests.push(g);
  }
  await expect(owner.locator('#players li')).toHaveCount(10, { timeout: 30000 });

  // The owner sets 2 hunters and hand-picks Player3 as one of them.
  await owner.locator('[data-step="hunters"][data-d="1"]').click();
  await expect(owner.locator('.preview')).toContainText('2 Zach', { timeout: 10000 });
  const p3 = await guests[2].evaluate(() => window.__manhunt.client!.you);
  await owner.selectOption(`[data-assign="${p3}"]`, 'hunter');

  for (const g of guests) await g.click('#ready');
  await expect(owner.locator('#start')).toBeEnabled({ timeout: 30000 });
  await owner.click('#start');

  const all = [owner, ...guests];
  for (const p of all) await expect.poll(async () => (await state(p)).state, { timeout: 90000 }).toBe('match');
  const roles = await Promise.all(all.map(async (p) => (await state(p)).role));
  expect(roles.filter((r) => r === 'hunter').length).toBe(2);
  expect(roles.filter((r) => r === 'survivor').length).toBe(8);
  expect(roles[3]).toBe('hunter');

  // Fast-forward the objectives, then 4 of 8 survivors (50%) walk out of the gate. The night
  // goes on until the other 4 are down too; half escaped, so the survivors win.
  await dev(owner, 'gens');
  await dev(owner, 'gate');
  const survivors = all.filter((_p, i) => roles[i] === 'survivor');
  for (const s of survivors.slice(0, 4)) await dev(s, 'exit');
  await owner.waitForTimeout(1500);
  expect(await owner.locator('.banner').count()).toBe(0);
  for (const s of survivors.slice(4)) await dev(s, 'health', [2]);

  for (const p of all) await expect(p.locator('.banner')).toHaveText('SURVIVORS ESCAPED', { timeout: 60000 });
  await expect(owner.locator('table.stats tr')).toHaveCount(11);
});
