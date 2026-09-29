import { expect, test } from '@playwright/test';
import { createLobby, joinLobby, newPlayer, readyUp, state, waitForMatch } from './mp';

const dev = (page: import('@playwright/test').Page, cmd: string, args: number[] = []): Promise<void> =>
  page.evaluate(([cmd, args]) => window.__manhunt.client!.send({ t: 'dev', cmd, args }), [cmd, args] as const);

test('a full match plays to a result, then everyone returns to the lobby for a rematch', async ({ browser }) => {
  // Dev mode lets the test fast-forward objectives; the rules are covered by unit tests.
  const host = await newPlayer(browser, '/?dev=1');
  const code = await createLobby(host, 'Mara');
  const guest = await newPlayer(browser);
  await joinLobby(guest, 'Zach', code);
  await host.click('[data-pref="survivor"]');
  await guest.click('[data-pref="hunter"]');
  await readyUp(guest);
  await host.click('#start');
  await waitForMatch(host);
  await waitForMatch(guest);
  expect((await state(host)).role).toBe('survivor');
  expect((await state(guest)).role).toBe('hunter');

  // Survivors: restore the generators, open the gate, walk out.
  await dev(host, 'gens');
  await expect(host.locator('.hud .objective')).toContainText('POWERED', { timeout: 15000 });
  await dev(host, 'gate');
  await dev(host, 'exit');
  await expect(host.locator('.banner')).toHaveText('SURVIVORS ESCAPED', { timeout: 20000 });
  await expect(guest.locator('.banner')).toHaveText('SURVIVORS ESCAPED', { timeout: 20000 });
  await expect(host.locator('table.stats')).toContainText('Escaped');

  // Rematch: back to the lobby, then Zach wins on time.
  await host.click('#rematch');
  await expect(host.locator('#code')).toBeVisible({ timeout: 15000 });
  await expect(guest.locator('#code')).toBeVisible({ timeout: 15000 });
  await readyUp(guest);
  await host.click('#start');
  await waitForMatch(host);
  await dev(host, 'time', [2]);
  await expect(guest.locator('.banner')).toHaveText('ZACH WINS', { timeout: 20000 });
  await expect(host.locator('.banner')).toHaveText('ZACH WINS', { timeout: 20000 });
});
