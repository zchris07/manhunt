import { describe, expect, it } from 'vitest';
import { generateMap, mapParamsFor } from '../src/map/generate';
import { mapHash } from '../src/map/hash';
import { MapWorld } from '../src/map/world';
import { BALANCE, resolveBalance } from '../src/balance';
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

  it('places every generator, the fixed item counts, doors and barricades (no windows)', () => {
    const d = generateMap(mapParamsFor(7, rb));
    expect(d.generators.length).toBe(rb.totalGenerators);
    expect(rb.totalGenerators).toBe(rb.requiredGenerators);
    expect(d.generators.some((g) => g.area === 'warehouse')).toBe(true);
    expect(d.generators.some((g) => g.area === 'woods')).toBe(true);
    const counts: Record<string, number> = {};
    for (const l of d.loot) counts[l.item] = (counts[l.item] ?? 0) + 1;
    expect(counts).toEqual(BALANCE.items.counts);
    expect(d.stakes.length).toBeGreaterThanOrEqual(6);
    expect(d.hidingSpots.map((h) => h.kind)).toEqual(expect.arrayContaining(['locker', 'wardrobe', 'bed', 'grass', 'barrel']));
    expect(d.doors.length).toBeGreaterThan(5);
    expect(d.barricades.length).toBeGreaterThan(3);
    expect((d as unknown as { windows?: unknown }).windows).toBeUndefined();
    expect(d.walls.some((w) => (w.kind as string) === 'window')).toBe(false);
    expect(d.trees.some((t) => t.kind === 'oak')).toBe(true);
    expect(d.width).toBe(6000);
  });

  it('closed doors block movement and sight; open doors do not', () => {
    const d = generateMap(mapParamsFor(11, rb));
    const world = new MapWorld(d);
    const door = d.doors[0];
    const mx = door.hx + Math.cos(door.angle) * door.length * 0.5;
    const my = door.hy + Math.sin(door.angle) * door.length * 0.5;
    const nx = -Math.sin(door.angle) * 40;
    const ny = Math.cos(door.angle) * 40;
    world.geo.setDynamicActive(door.dyn, true);
    expect(world.geo.hasLineOfSight(mx - nx, my - ny, mx + nx, my + ny)).toBe(false);
    const p = { x: mx - nx, y: my - ny };
    moveCircle(world.geo, p, 15, nx * 2, ny * 2);
    expect(Math.hypot(p.x - (mx + nx), p.y - (my + ny))).toBeGreaterThan(30);
    world.geo.setDynamicActive(door.dyn, false);
    expect(world.geo.hasLineOfSight(mx - nx, my - ny, mx + nx, my + ny)).toBe(true);
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
