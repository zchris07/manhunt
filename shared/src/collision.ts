import type { Geometry } from './geometry';
import type { Vec2 } from './math';

const tmp: number[] = [];
const MAX_ITER = 3;

/**
 * Moves a circle by (dx, dy) through the world, sliding along walls and trees.
 * Deterministic: the client runs the same function for prediction as the host.
 */
export function moveCircle(geo: Geometry, pos: Vec2, radius: number, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (radius * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    pos.x += sx;
    pos.y += sy;
    resolveOverlaps(geo, pos, radius);
  }
}

/** Pushes a circle out of every movement collider it overlaps. */
export function resolveOverlaps(geo: Geometry, pos: Vec2, radius: number): void {
  const r2 = radius * radius;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let pushed = false;
    const segs = geo.moveSegGrid.query(pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius, tmp);
    const ms = geo.moveSeg;
    for (let k = 0; k < segs.length; k++) {
      const id = segs[k];
      if (!geo.moveSegActive[id]) continue;
      const o = id * 4;
      const ax = ms[o];
      const ay = ms[o + 1];
      const bx = ms[o + 2];
      const by = ms[o + 3];
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let t = len2 > 0 ? ((pos.x - ax) * abx + (pos.y - ay) * aby) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      let nx = pos.x - cx;
      let ny = pos.y - cy;
      const d2 = nx * nx + ny * ny;
      if (d2 >= r2) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        // Exactly on the segment: push along its normal.
        const l = Math.sqrt(len2) || 1;
        nx = -aby / l;
        ny = abx / l;
        d = 0;
      } else {
        nx /= d;
        ny /= d;
      }
      pos.x = cx + nx * radius;
      pos.y = cy + ny * radius;
      pushed = true;
    }
    const circles = geo.moveCircleGrid.query(pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius, tmp);
    const mc = geo.moveCircle;
    for (let k = 0; k < circles.length; k++) {
      const o = circles[k] * 3;
      const cx = mc[o];
      const cy = mc[o + 1];
      const rr = mc[o + 2] + radius;
      const nx = pos.x - cx;
      const ny = pos.y - cy;
      const d2 = nx * nx + ny * ny;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        pos.x = cx + rr;
      } else {
        pos.x = cx + (nx / d) * rr;
        pos.y = cy + (ny / d) * rr;
      }
      pushed = true;
    }
    if (pos.x < radius) pos.x = radius;
    if (pos.y < radius) pos.y = radius;
    if (pos.x > geo.width - radius) pos.x = geo.width - radius;
    if (pos.y > geo.height - radius) pos.y = geo.height - radius;
    if (!pushed) return;
  }
}

/** True if a circle at (x,y) overlaps any active movement collider. */
export function overlapsCollider(geo: Geometry, x: number, y: number, radius: number): boolean {
  const r2 = radius * radius;
  const segs = geo.moveSegGrid.query(x - radius, y - radius, x + radius, y + radius, tmp);
  const ms = geo.moveSeg;
  for (let k = 0; k < segs.length; k++) {
    const id = segs[k];
    if (!geo.moveSegActive[id]) continue;
    const o = id * 4;
    const ax = ms[o];
    const ay = ms[o + 1];
    const abx = ms[o + 2] - ax;
    const aby = ms[o + 3] - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((x - ax) * abx + (y - ay) * aby) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + abx * t);
    const dy = y - (ay + aby * t);
    if (dx * dx + dy * dy < r2) return true;
  }
  const circles = geo.moveCircleGrid.query(x - radius, y - radius, x + radius, y + radius, tmp);
  const mc = geo.moveCircle;
  for (let k = 0; k < circles.length; k++) {
    const o = circles[k] * 3;
    const rr = mc[o + 2] + radius;
    const dx = x - mc[o];
    const dy = y - mc[o + 1];
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return x < radius || y < radius || x > geo.width - radius || y > geo.height - radius;
}
