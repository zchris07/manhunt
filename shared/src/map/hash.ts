import type { MapData } from './types';

/**
 * Checksum of a generated map. The host sends it with the match start so a guest can detect
 * (vanishingly rare) floating-point divergence between JS engines and fall back to receiving
 * the host's map data instead of its own.
 */
export function mapHash(d: MapData): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    const q = Math.round(v * 4) | 0;
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  mix(d.walls.length);
  for (const w of d.walls) {
    mix(w.ax);
    mix(w.ay);
    mix(w.bx);
    mix(w.by);
  }
  mix(d.trees.length);
  for (const t of d.trees) {
    mix(t.x);
    mix(t.y);
    mix(t.r);
  }
  for (const r of d.rocks) {
    mix(r.x);
    mix(r.y);
  }
  for (const g of d.generators) {
    mix(g.x);
    mix(g.y);
  }
  for (const l of d.loot) {
    mix(l.x);
    mix(l.y);
  }
  for (const s of d.hidingSpots) {
    mix(s.x);
    mix(s.y);
  }
  for (const s of d.stakes) {
    mix(s.x);
    mix(s.y);
  }
  mix(d.gate.x);
  mix(d.gate.y);
  return h >>> 0;
}
