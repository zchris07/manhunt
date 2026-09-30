import type { Rng } from '../rng';

/**
 * Bridson Poisson-disc sampling over [x0,x1] x [y0,y1] with minimum spacing `r`.
 * `accept` can veto points (paths, clearings, buildings). Deterministic for a given Rng.
 */
export function poissonDisc(
  rng: Rng,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  accept: (x: number, y: number) => boolean,
  k = 20,
): [number, number][] {
  const cell = r / Math.SQRT2;
  const cols = Math.ceil((x1 - x0) / cell);
  const rows = Math.ceil((y1 - y0) / cell);
  const grid = new Int32Array(cols * rows).fill(-1);
  const points: [number, number][] = [];
  const active: number[] = [];
  const r2 = r * r;

  const fits = (x: number, y: number): boolean => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    const gx = Math.floor((x - x0) / cell);
    const gy = Math.floor((y - y0) / cell);
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(rows - 1, gy + 2); yy++) {
      for (let xx = Math.max(0, gx - 2); xx <= Math.min(cols - 1, gx + 2); xx++) {
        const idx = grid[yy * cols + xx];
        if (idx < 0) continue;
        const p = points[idx];
        const dx = p[0] - x;
        const dy = p[1] - y;
        if (dx * dx + dy * dy < r2) return false;
      }
    }
    return true;
  };

  const add = (x: number, y: number): void => {
    const idx = points.length;
    points.push([x, y]);
    active.push(idx);
    grid[Math.floor((y - y0) / cell) * cols + Math.floor((x - x0) / cell)] = idx;
  };

  // Seed several starting points so vetoed regions don't starve the sampler.
  for (let s = 0; s < 40; s++) {
    const x = rng.range(x0, x1);
    const y = rng.range(y0, y1);
    if (fits(x, y) && accept(x, y)) add(x, y);
  }

  while (active.length > 0) {
    const ai = Math.floor(rng.next() * active.length);
    const p = points[active[ai]];
    let found = false;
    for (let i = 0; i < k; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = r * (1 + rng.next());
      const x = p[0] + Math.cos(a) * d;
      const y = p[1] + Math.sin(a) * d;
      if (fits(x, y)) {
        if (accept(x, y)) {
          add(x, y);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }
  return points;
}
