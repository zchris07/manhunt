import { expect, test, type Page } from '@playwright/test';
import { closePlayers, createLobby, joinLobby, newPlayer, readyUp, state, waitForMatch } from './mp';

test.afterEach(closePlayers);

const dev = (page: Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

interface MapInfo {
  locker: { exitX: number; exitY: number };
  clearing: { x: number; y: number };
}

async function mapInfo(page: Page): Promise<MapInfo> {
  return page.evaluate(() => {
    const m = (window.__manhunt.client as unknown as { match: { map: { hidingSpots: { kind: string; exitX: number; exitY: number }[]; clearings: { x: number; y: number }[] } } }).match.map;
    return { locker: m.hidingSpots.find((h) => h.kind === 'locker')!, clearing: m.clearings[2] };
  });
}

async function self(page: Page): Promise<{ hideState: number; health: number; stunT: number; inv: number[] }> {
  return page.evaluate(() => {
    const s = (window.__manhunt.client as unknown as { self: { hideState: number; health: number; stunT: number; inv: number[] } }).self;
    return { hideState: s.hideState, health: s.health, stunT: s.stunT, inv: [...s.inv] };
  });
}

test('hiding, searching and a thrown bottle work between two browsers', async ({ browser }) => {
  const surv = await newPlayer(browser, '/?dev=1');
  const code = await createLobby(surv, 'Mara');
  const zach = await newPlayer(browser);
  await joinLobby(zach, 'Zach', code);
  await surv.click('[data-pref="survivor"]');
  await zach.click('[data-pref="hunter"]');
  await readyUp(zach);
  await surv.click('#start');
  await waitForMatch(surv);
  await waitForMatch(zach);
  const survId = (await state(surv)).you!;
  const info = await mapInfo(surv);

  // Hide in a locker.
  await dev(surv, 'tp', [info.locker.exitX, info.locker.exitY]);
  await surv.waitForTimeout(700);
  await surv.keyboard.press('KeyE');
  await expect.poll(async () => (await self(surv)).hideState, { timeout: 10000 }).toBe(2);
  await expect(surv.locator('.hud .prompt')).toContainText('hold breath');

  // Zach stands at the locker: the hidden survivor is not in his snapshots.
  await dev(zach, 'tp', [info.locker.exitX, info.locker.exitY]);
  await zach.waitForTimeout(1200);
  expect((await state(zach)).entities).not.toContain(survId);
  await expect(zach.locator('.hud .prompt')).toContainText('search');

  // He searches: she is dragged out wounded.
  await zach.keyboard.press('KeyE');
  await expect.poll(async () => (await self(surv)).health, { timeout: 10000 }).toBe(1);
  expect((await self(surv)).hideState).toBe(0);

  // In the open, a bottle (slot 1, left click) stuns him.
  await dev(surv, 'tp', [info.clearing.x, info.clearing.y]);
  await dev(surv, 'give', [1, 2]);
  await dev(zach, 'tp', [info.clearing.x + 100, info.clearing.y]);
  await surv.waitForTimeout(3500);
  await expect.poll(async () => (await self(surv)).inv[1], { timeout: 10000 }).toBe(2);
  await surv.keyboard.press('Digit1');
  await surv.mouse.move(480 + 150, 300);
  await surv.waitForTimeout(300);
  await surv.mouse.click(480 + 150, 300);
  await expect.poll(async () => (await self(zach)).stunT, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(zach.locator('.hud .center-msg')).toHaveText('STUNNED');
  expect((await self(surv)).inv[1]).toBe(1);
});
