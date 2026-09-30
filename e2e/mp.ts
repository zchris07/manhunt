import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface ClientState {
  state: string;
  role?: string;
  you?: number;
  self?: { x: number; y: number; health: number; spectating: number } | null;
  corrections?: number;
  entities?: number[];
}

declare global {
  interface Window {
    __manhunt: {
      state: string;
      client: {
        you: number;
        room: string;
        match: { role: string } | null;
        self: { x: number; y: number; health: number; spectating: number } | null;
        corrections: number;
        latest: { entities: Map<number, unknown> } | null;
        send(msg: unknown): void;
      } | null;
    };
  }
}

export async function state(p: Page): Promise<ClientState> {
  return p.evaluate(() => {
    const m = window.__manhunt;
    const c = m?.client;
    return {
      state: m?.state ?? 'none',
      role: c?.match?.role,
      you: c?.you,
      self: c?.self ? { x: c.self.x, y: c.self.y, health: c.self.health, spectating: c.self.spectating } : null,
      corrections: c?.corrections,
      entities: c?.latest ? [...c.latest.entities.keys()] : [],
    };
  });
}

const open: BrowserContext[] = [];

/** Closes every player context opened by the current test (call from test.afterEach). */
export async function closePlayers(): Promise<void> {
  await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
}

export async function newPlayer(browser: Browser, path = '/', viewport = { width: 960, height: 600 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  open.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(path);
  return page;
}

export async function createLobby(page: Page, name: string): Promise<string> {
  await page.fill('#name', name);
  await page.click('#create');
  await page.waitForSelector('#code', { timeout: 30000 });
  return (await page.textContent('#code'))!.trim();
}

export async function joinLobby(page: Page, name: string, code?: string): Promise<void> {
  await page.fill('#name', name);
  if (code) await page.fill('#room', code);
  await page.click('#join');
  await page.waitForSelector('#code', { timeout: 30000 });
}

export async function readyUp(page: Page): Promise<void> {
  await page.click('#ready');
  await expect(page.locator('#ready')).toHaveClass(/active/);
}

export async function waitForMatch(page: Page): Promise<void> {
  await expect.poll(async () => (await state(page)).state, { timeout: 60000 }).toBe('match');
  await expect.poll(async () => (await state(page)).self !== null, { timeout: 30000 }).toBe(true);
}

/** Holds a movement key for `ms` and returns how far the player moved. */
export async function walk(page: Page, key: string, ms: number): Promise<number> {
  const before = (await state(page)).self!;
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
  const after = (await state(page)).self!;
  return Math.hypot(after.x - before.x, after.y - before.y);
}
