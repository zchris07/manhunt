import type { Page } from '@playwright/test';

/** Reads RGB pixels from a screenshot at the given points (decoded in the page). */
export async function samplePixels(page: Page, points: [number, number][]): Promise<[number, number, number][]> {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => {
        const d = ctx.getImageData(x - 3, y - 3, 7, 7).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r = Math.max(r, d[i]);
          g = Math.max(g, d[i + 1]);
          b = Math.max(b, d[i + 2]);
        }
        return [r, g, b] as [number, number, number];
      });
    },
    { b64, points },
  );
}
