import { describe, expect, it } from 'vitest';
import { Geometry, type CircleDef, type SegmentDef } from '../src/geometry';
import { VisibilityComputer, clampPolygon, inCone } from '../src/visibility';
import { dist, pointInPolygon } from '../src/math';
import { Rng } from '../src/rng';

function wall(ax: number, ay: number, bx: number, by: number): SegmentDef {
  return { ax, ay, bx, by, vision: true, move: true };
}
function tree(x: number, y: number, r: number): CircleDef {
  return { x, y, r, vision: true, move: true };
}

describe('VisibilityComputer', () => {
  it('produces a full circle of radius = range in an empty world', () => {
    const geo = new Geometry(2000, 2000, [], []);
    const vis = new VisibilityComputer(geo);
    const poly = vis.compute({ x: 1000, y: 1000, dir: 0, halfAngle: Math.PI, range: 300 });
    expect(poly.length).toBeGreaterThan(40);
    for (let i = 0; i < poly.length; i += 2) {
      expect(dist(1000, 1000, poly[i], poly[i + 1])).toBeCloseTo(300, 3);
    }
  });

  it('cuts off at a wall', () => {
    const geo = new Geometry(2000, 2000, [wall(1100, 900, 1100, 1100)], []);
    const vis = new VisibilityComputer(geo);
    const poly = vis.compute({ x: 1000, y: 1000, dir: 0, halfAngle: Math.PI, range: 400 });
    expect(pointInPolygon(1050, 1000, poly)).toBe(true);
    expect(pointInPolygon(1200, 1000, poly)).toBe(false);
    expect(pointInPolygon(900, 1000, poly)).toBe(true);
  });

  it('wraps around corners (sees past the end of a wall, not behind it)', () => {
    // Horizontal wall from x=1050..1300 at y=1000; viewer below-left of its end.
    const geo = new Geometry(2000, 2000, [wall(1050, 1000, 1300, 1000)], []);
    const vis = new VisibilityComputer(geo);
    const poly = vis.compute({ x: 1000, y: 1100, dir: -Math.PI / 2, halfAngle: Math.PI, range: 500 });
    expect(pointInPolygon(1020, 900, poly)).toBe(true); // past the corner, in line of sight
    expect(pointInPolygon(1200, 950, poly)).toBe(false); // behind the wall
  });

  it('respects the cone angle', () => {
    const geo = new Geometry(2000, 2000, [], []);
    const vis = new VisibilityComputer(geo);
    const poly = vis.compute({ x: 1000, y: 1000, dir: 0, halfAngle: Math.PI / 4, range: 400 });
    expect(pointInPolygon(1200, 1010, poly)).toBe(true);
    expect(pointInPolygon(800, 1000, poly)).toBe(false);
    expect(pointInPolygon(1000, 1200, poly)).toBe(false);
  });

  it('circles (trees) cast shadows', () => {
    const geo = new Geometry(2000, 2000, [], [tree(1100, 1000, 20)]);
    const vis = new VisibilityComputer(geo);
    const poly = vis.compute({ x: 1000, y: 1000, dir: 0, halfAngle: Math.PI, range: 400 });
    expect(pointInPolygon(1250, 1000, poly)).toBe(false);
    expect(pointInPolygon(1250, 1100, poly)).toBe(true);
  });

  it('agrees with brute-force line-of-sight on random scenes', () => {
    const rng = new Rng(1234);
    let mismatches = 0;
    let samples = 0;
    for (let scene = 0; scene < 20; scene++) {
      const segs: SegmentDef[] = [];
      const circles: CircleDef[] = [];
      for (let i = 0; i < 25; i++) {
        const x = rng.range(200, 1800);
        const y = rng.range(200, 1800);
        const a = rng.range(0, Math.PI * 2);
        const l = rng.range(40, 250);
        segs.push(wall(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l));
      }
      for (let i = 0; i < 60; i++) circles.push(tree(rng.range(200, 1800), rng.range(200, 1800), rng.range(8, 30)));
      const geo = new Geometry(2000, 2000, segs, circles);
      const vis = new VisibilityComputer(geo);
      const ox = 1000;
      const oy = 1000;
      const q = { x: ox, y: oy, dir: rng.range(-3, 3), halfAngle: rng.chance(0.5) ? Math.PI : 0.9, range: 600 };
      const poly = vis.compute(q);
      for (let i = 0; i < 400; i++) {
        const px = rng.range(400, 1600);
        const py = rng.range(400, 1600);
        if (circles.some((c) => dist(px, py, c.x, c.y) < c.r + 2)) continue;
        // Skip points right at the range boundary where the arc approximation differs.
        const d = dist(ox, oy, px, py);
        if (Math.abs(d - q.range) < 12) continue;
        const expected = inCone(q, px, py) && geo.hasLineOfSight(ox, oy, px, py);
        const got = pointInPolygon(px, py, poly);
        samples++;
        if (expected !== got) mismatches++;
      }
    }
    expect(samples).toBeGreaterThan(5000);
    // Tiny disagreements happen only at shadow edges (sampling precision).
    expect(mismatches / samples).toBeLessThan(0.02);
  });

  it('clampPolygon limits vertex distance', () => {
    const out = clampPolygon([0, 0, 100, 0, 0, 50], 0, 0, 60, []);
    expect(out).toEqual([0, 0, 60, 0, 0, 50]);
  });
});
