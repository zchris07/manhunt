import { expect, test } from '@playwright/test';
import { samplePixels } from './helpers';

test.use({ viewport: { width: 1280, height: 720 } });

declare global {
  interface Window {
    __sandbox: {
      fps: number;
      cpuMs: number;
      visionMs: number;
      setPlayer(x: number, y: number, facing: number): void;
      setEnemy(x: number, y: number): void;
      freezeEffects: boolean;
    };
  }
}

test('vision sandbox: entities are visible in the cone and culled outside it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/sandbox/?arena=1');
  await page.waitForFunction(() => !!window.__sandbox);
  await page.evaluate(() => {
    window.__sandbox.freezeEffects = true;
    // Player at screen centre (640,360) facing right; enemy 140 units ahead (screen 780,360).
    window.__sandbox.setPlayer(1500, 1200, 0);
    window.__sandbox.setEnemy(1640, 1200);
  });
  await page.waitForTimeout(600);
  // Sample a small patch around the enemy: the white hockey mask shows inside the cone.
  const patch: [number, number][] = [];
  for (let dx = -12; dx <= 12; dx += 4) for (let dy = -12; dy <= 12; dy += 4) patch.push([780 + dx, 360 + dy]);
  const inCone = await samplePixels(page, patch);
  expect(Math.max(...inCone.map((c) => Math.min(...c)))).toBeGreaterThan(95);

  await page.evaluate(() => window.__sandbox.setPlayer(1500, 1200, Math.PI));
  await page.waitForTimeout(600);
  const behind = await samplePixels(page, patch);
  // Physically close but outside the vision mask: fully culled, only darkness remains.
  expect(Math.max(...behind.map((c) => Math.max(...c)))).toBeLessThan(70);

  expect(errors).toEqual([]);
  // The per-frame visibility work (cone, proximity, 360-degree line of sight, lights) must
  // leave plenty of a 16.7 ms frame for rendering. (Whole-frame time isn't meaningful here:
  // headless Chromium renders WebGL in software.)
  const visionMs = await page.evaluate(() => window.__sandbox.visionMs);
  expect(visionMs).toBeLessThan(4);
});

test('game page serves a canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('sandbox renders a generated map without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/sandbox/?seed=42');
  await page.waitForFunction(() => !!window.__sandbox);
  await page.waitForTimeout(1500);
  await expect(page.locator('#hud')).toContainText('map seed 42');
  expect(errors).toEqual([]);
});
