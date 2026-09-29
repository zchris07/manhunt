import { expect, test } from '@playwright/test';
import { closePlayers, createLobby, joinLobby, newPlayer, readyUp, state, waitForMatch, walk } from './mp';

test.afterEach(closePlayers);

test('two browsers join a room by code and move in a shared match', async ({ browser }) => {
  const host = await newPlayer(browser);
  const code = await createLobby(host, 'Hosty');
  expect(code).toMatch(/^[A-Z]{4}$/);

  const guest = await newPlayer(browser);
  await joinLobby(guest, 'Guesty', code);
  await expect(host.locator('#players li')).toHaveCount(2);
  await expect(guest.locator('#players')).toContainText('Hosty');

  await readyUp(guest);
  await expect(host.locator('#start')).toBeEnabled({ timeout: 10000 });
  await host.click('#start');
  await waitForMatch(host);
  await waitForMatch(guest);

  const roles = [(await state(host)).role, (await state(guest)).role].sort();
  expect(roles).toEqual(['hunter', 'survivor']);
  // Both players can move; the host simulates both.
  expect(await walk(host, 'KeyS', 1500)).toBeGreaterThan(40);
  expect(await walk(guest, 'KeyS', 1500)).toBeGreaterThan(40);
  await expect(host.locator('.hud .objective')).toContainText('Generators');
});

test('a guest with 100 ms simulated latency plays smoothly', async ({ browser }) => {
  const host = await newPlayer(browser);
  const code = await createLobby(host, 'Hosty');
  const guest = await newPlayer(browser, `/?room=${code}&lag=100`);
  await joinLobby(guest, 'Laggy');
  await readyUp(guest);
  await host.click('#start');
  await waitForMatch(guest);
  const before = (await state(guest)).corrections ?? 0;
  const moved = await walk(guest, 'KeyW', 2000);
  expect(moved).toBeGreaterThan(80);
  // Prediction means the laggy guest barely ever needs a visible correction.
  const corrections = ((await state(guest)).corrections ?? 0) - before;
  expect(corrections).toBeLessThan(15);
});
