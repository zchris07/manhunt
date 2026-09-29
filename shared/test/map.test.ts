import { describe, expect, it } from 'vitest';
import { generateMap, mapParamsFor } from '../src/map/generate';
import { mapHash } from '../src/map/hash';
import { MapWorld } from '../src/map/world';
import { resolveBalance } from '../src/balance';
import { moveCircle } from '../src/collision';

const rb = resolveBalance({ hunters: 1, survivors: 4, difficulty: 1 });

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateMap(mapParamsFor(42, rb));
    const b = generateMap(mapParamsFor(42, rb));
    expect(mapHash(a)).toBe(mapHash(b));
    expect(a.trees.length).toBeGreaterThan(1000);
    const c = generateMap(mapParamsFor(43, rb));
    expect(mapHash(c)).not.toBe(mapHash(a));
  });

  it('places the requested objectives', () => {
    const d = generateMap(mapParamsFor(7, rb));
    expect(d.generators.length).toBe(rb.totalGenerators);
    expect(d.generators.some((g) => g.area === 'warehouse')).toBe(true);
    expect(d.generators.some((g) => g.area === 'woods')).toBe(true);
    expect(d.loot.filter((l) => l.item === 'fuel').length).toBeGreaterThanOrEqual(rb.requiredGenerators);
    expect(d.loot.filter((l) => l.item === 'wire').length).toBeGreaterThanOrEqual(rb.requiredGenerators);
    expect(d.stakes.length).toBeGreaterThanOrEqual(6);
    expect(d.hidingSpots.map((h) => h.kind)).toEqual(expect.arrayContaining(['locker', 'wardrobe', 'bed', 'grass', 'barrel']));
    expect(d.windows.length).toBeGreaterThan(4);
    expect(d.barricades.length).toBeGreaterThan(3);
    expect(d.width).toBe(6000);
  });

  it('collision keeps characters out of walls and trees', () => {
    const d = generateMap(mapParamsFor(9, rb));
    const world = new MapWorld(d);
    const pos = { x: d.survivorSpawns[0].x, y: d.survivorSpawns[0].y };
    // Walk north for a long time: we must never end up inside a tree.
    for (let i = 0; i < 2000; i++) {
      moveCircle(world.geo, pos, 15, Math.sin(i * 0.01) * 3, -4);
      for (const t of d.trees) {
        const dd = Math.hypot(t.x - pos.x, t.y - pos.y);
        if (dd < t.r + 15 - 0.5) throw new Error(`inside tree at step ${i}`);
      }
    }
    expect(pos.y).toBeLessThan(d.survivorSpawns[0].y);
  });

});
