import { expect, test, type Page } from '@playwright/test';
import { closePlayers, newPlayer, state } from './mp';

test.afterEach(closePlayers);

const OUT = process.env.SHOT_DIR;
const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

test('testing mode opens a room anyone can join, straight into the match as a survivor', async ({ browser }) => {
  const host = await newPlayer(browser, '/?dev=1');
  await host.fill('#name', 'Tess');
  await host.click('#test');
  await expect.poll(async () => (await state(host)).self !== null, { timeout: 60000 }).toBe(true);
  const code = await host.evaluate(() => window.__manhunt.client!.room);
  expect(code).toMatch(/^[A-Z]{4}$/);
  await expect.poll(() => host.evaluate(() => document.body.textContent ?? ''), { timeout: 30000 }).toContain(`TESTING MODE · ${code}`);

  const guest = await newPlayer(browser);
  await guest.fill('#name', 'Gus');
  await guest.fill('#room', code);
  await guest.click('#join');
  await expect.poll(async () => (await state(guest)).self !== null, { timeout: 60000 }).toBe(true);
  expect((await state(guest)).role).toBe('survivor');
  // Everyone has the host's permissions in a testing room.
  expect(await guest.evaluate(() => (window.__manhunt.client as unknown as { isOwner: boolean }).isOwner)).toBe(true);

  if (!OUT) return;
  // Screenshots for a look: Jaden Nguyen alerted, someone wading in the lake.
  await dev(guest, 'jaden', [70, 0]);
  await guest.mouse.move(700, 300);
  await guest.waitForTimeout(1800);
  await guest.screenshot({ path: `${OUT}/jaden.png` });
  const lake = await guest.evaluate(() => {
    const l = (window.__manhunt.client as unknown as { match: { map: { lake: number[] } } }).match.map.lake;
    let x = 0;
    let y = 0;
    for (let i = 0; i < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
    }
    return { x: x / (l.length / 2), y: y / (l.length / 2) };
  });
  await dev(guest, 'tp', [lake.x, lake.y]);
  await guest.waitForTimeout(500);
  await guest.keyboard.down('KeyD');
  await guest.waitForTimeout(900);
  await guest.screenshot({ path: `${OUT}/wade.png` });
  await guest.keyboard.up('KeyD');
  // Your own scent (testing mode): sprint away, then shine the light back over it.
  await dev(guest, 'tp', [lake.x + 900, lake.y]);
  await guest.waitForTimeout(400);
  await guest.mouse.move(900, 300);
  await guest.keyboard.down('ShiftLeft');
  await guest.keyboard.down('KeyD');
  await guest.waitForTimeout(1500);
  await guest.keyboard.up('KeyD');
  await guest.keyboard.up('ShiftLeft');
  await guest.mouse.move(100, 300);
  await guest.waitForTimeout(500);
  await guest.screenshot({ path: `${OUT}/scent.png` });
});
