import { Rng } from '@manhunt/shared';

/**
 * Tileable value noise on a size x size grid. `period` lattice cells span the texture,
 * and the lattice wraps, so the result tiles seamlessly.
 */
export function tileValueNoise(size: number, period: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const out = new Float32Array(size * size);
  const scale = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const y0w = y0 % period;
    const y1w = (y0 + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const x0w = x0 % period;
      const x1w = (x0 + 1) % period;
      const a = lattice[y0w * period + x0w];
      const b = lattice[y0w * period + x1w];
      const c = lattice[y1w * period + x0w];
      const d = lattice[y1w * period + x1w];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable fractal noise in [0, 1]. */
export function tileFbm(size: number, basePeriod: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const n = tileValueNoise(size, Math.min(period, size), seed + o * 7919);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
    period *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Non-tiling 2D value noise function for organic silhouettes. */
export function noise1D(seed: number): (t: number) => number {
  const rng = new Rng(seed);
  const vals = Array.from({ length: 64 }, () => rng.next());
  return (t: number) => {
    const i = Math.floor(t);
    const f = smooth(t - i);
    const a = vals[((i % 64) + 64) % 64];
    const b = vals[(((i + 1) % 64) + 64) % 64];
    return a + (b - a) * f;
  };
}
