import { expect, test } from '@playwright/test';
import { samplePixels } from './helpers';

test.use({ viewport: { width: 1280, height: 720 } });

declare global {
  interface Window {
    __sandbox: {
      fps: number;
      cpuMs: number;
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
  await page.goto('/sandbox/');
  await page.waitForFunction(() => !!window.__sandbox);
  await page.evaluate(() => {
    window.__sandbox.freezeEffects = true;
    // Player at screen centre (640,360) facing right; enemy 140 units ahead (screen 780,360).
    window.__sandbox.setPlayer(1500, 1200, 0);
    window.__sandbox.setEnemy(1640, 1200);
  });
  await page.waitForTimeout(600);
  const [inCone] = await samplePixels(page, [[782, 360]]);
  // The hockey mask is near-white inside the cone.
  expect(Math.min(...inCone)).toBeGreaterThan(120);

  await page.evaluate(() => window.__sandbox.setPlayer(1500, 1200, Math.PI));
  await page.waitForTimeout(600);
  const [behind] = await samplePixels(page, [[782, 360]]);
  // Physically close but outside the vision mask: fully culled, only dark terrain remains.
  expect(Math.max(...behind)).toBeLessThan(70);

  expect(errors).toEqual([]);
  const cpu = await page.evaluate(() => window.__sandbox.cpuMs);
  // CPU budget per frame (vision + scene updates) must leave room for 60 fps.
  expect(cpu).toBeLessThan(12);
});

test('game page serves a canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
});
