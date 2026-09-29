import type { Geometry } from './geometry';
import { TAU, angleDiff, dist2, normAngle, normAnglePositive, rayCircle, raySegment } from './math';

/** A vision source: a cone (halfAngle < PI) or a full circle (halfAngle >= PI). */
export interface ViewCone {
  x: number;
  y: number;
  dir: number;
  halfAngle: number;
  range: number;
}

const BINS = 256;
const EPS = 1e-4;
/** Angular spacing of the rays that trace the outer arc of the range circle. */
const ARC_STEP = (4 * Math.PI) / 180;
const PAD = 0.003;

/**
 * Computes 2D visibility polygons by raycasting toward occluder features (angular sweep).
 *
 * Rays are cast at +/- EPS around every segment endpoint and at the two silhouette
 * tangents of every circle (trees/props), plus evenly spaced arc rays. Each ray is only
 * tested against the occluders whose angular interval covers it (256 angular bins), so a
 * polygon costs roughly O(rays * occluders-per-bin) instead of O(rays * occluders).
 *
 * The output polygon is a flat [x,y,...] array. For cones it starts with the origin; for
 * full circles it is the ring of hit points around the origin.
 */
export class VisibilityComputer {
  private readonly segIds: number[] = [];
  private readonly circleIds: number[] = [];
  private readonly bins: number[][] = Array.from({ length: BINS }, () => []);
  private angles = new Float64Array(4096);
  private angleCount = 0;
  /** Diagnostics: rays cast in the last call. */
  lastRayCount = 0;

  constructor(private readonly geo: Geometry) {}

  compute(q: ViewCone, out: number[] = []): number[] {
    out.length = 0;
    const { x: ox, y: oy, range } = q;
    const full = q.halfAngle >= Math.PI - 1e-6;
    const start = full ? q.dir - Math.PI : q.dir - q.halfAngle;
    const span = full ? TAU : 2 * q.halfAngle;
    const range2 = range * range;
    const geo = this.geo;

    for (let b = 0; b < BINS; b++) this.bins[b].length = 0;
    this.angleCount = 0;

    const segs = geo.visSegGrid.query(ox - range, oy - range, ox + range, oy + range, this.segIds);
    const vs = geo.visSeg;
    for (let i = 0; i < segs.length; i++) {
      const o = segs[i] * 4;
      const ax = vs[o];
      const ay = vs[o + 1];
      const bx = vs[o + 2];
      const by = vs[o + 3];
      const aa = Math.atan2(ay - oy, ax - ox);
      const ab = Math.atan2(by - oy, bx - ox);
      const d = angleDiff(ab, aa);
      const lo = d >= 0 ? aa : ab;
      const width = Math.abs(d);
      this.insertInterval(segs[i], normAnglePositive(lo - start), width >= Math.PI - 0.01 ? TAU : width);
      if (dist2(ox, oy, ax, ay) <= range2) {
        this.pushAngle(aa - EPS, start, span);
        this.pushAngle(aa + EPS, start, span);
      }
      if (dist2(ox, oy, bx, by) <= range2) {
        this.pushAngle(ab - EPS, start, span);
        this.pushAngle(ab + EPS, start, span);
      }
    }

    const circles = geo.visCircleGrid.query(ox - range, oy - range, ox + range, oy + range, this.circleIds);
    const vc = geo.visCircle;
    for (let i = 0; i < circles.length; i++) {
      const o = circles[i] * 3;
      const cx = vc[o];
      const cy = vc[o + 1];
      const r = vc[o + 2];
      const d2 = dist2(ox, oy, cx, cy);
      if (d2 <= r * r) continue;
      const d = Math.sqrt(d2);
      if (d - r > range) continue;
      const c = Math.atan2(cy - oy, cx - ox);
      const w = Math.asin(r / d);
      this.insertInterval(-(circles[i] + 1), normAnglePositive(c - w - start), 2 * w);
      this.pushAngle(c - w - EPS, start, span);
      this.pushAngle(c - w + EPS, start, span);
      this.pushAngle(c + w - EPS, start, span);
      this.pushAngle(c + w + EPS, start, span);
    }

    const arcN = Math.max(2, Math.ceil(span / ARC_STEP));
    for (let i = 0; i <= arcN; i++) this.pushRel((span * i) / arcN, span);

    const angles = this.angles.subarray(0, this.angleCount).sort();
    if (!full) out.push(ox, oy);
    let prev = -1;
    let rays = 0;
    for (let i = 0; i < angles.length; i++) {
      const rel = angles[i];
      if (rel - prev < 1e-7) continue;
      prev = rel;
      rays++;
      const ang = start + rel;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      let t = range;
      let bin = Math.floor((rel / TAU) * BINS);
      if (bin >= BINS) bin = BINS - 1;
      const list = this.bins[bin];
      for (let k = 0; k < list.length; k++) {
        const id = list[k];
        let h: number;
        if (id >= 0) {
          const o = id * 4;
          h = raySegment(ox, oy, dx, dy, vs[o], vs[o + 1], vs[o + 2], vs[o + 3]);
        } else {
          const o = (-id - 1) * 3;
          h = rayCircle(ox, oy, dx, dy, vc[o], vc[o + 1], vc[o + 2]);
        }
        if (h < t) t = h;
      }
      out.push(ox + dx * t, oy + dy * t);
    }
    this.lastRayCount = rays;
    return out;
  }

  private insertInterval(id: number, relStart: number, width: number): void {
    if (width >= TAU - 1e-6) {
      for (let b = 0; b < BINS; b++) this.bins[b].push(id);
      return;
    }
    const s = relStart - PAD;
    const e = relStart + width + PAD;
    const b0 = Math.floor((s / TAU) * BINS);
    const b1 = Math.floor((e / TAU) * BINS);
    const count = Math.min(BINS, b1 - b0 + 1);
    for (let k = 0; k < count; k++) {
      const b = (((b0 + k) % BINS) + BINS) % BINS;
      this.bins[b].push(id);
    }
  }

  private pushAngle(a: number, start: number, span: number): void {
    this.pushRel(normAnglePositive(a - start), span);
  }

  private pushRel(rel: number, span: number): void {
    if (rel > span) return;
    if (this.angleCount >= this.angles.length) {
      const next = new Float64Array(this.angles.length * 2);
      next.set(this.angles);
      this.angles = next;
    }
    this.angles[this.angleCount++] = rel;
  }
}

/** True if (tx,ty) lies inside the cone's range and angle (ignores occlusion). */
export function inCone(q: ViewCone, tx: number, ty: number, pad = 0): boolean {
  const r = q.range + pad;
  if (dist2(q.x, q.y, tx, ty) > r * r) return false;
  if (q.halfAngle >= Math.PI) return true;
  const a = Math.atan2(ty - q.y, tx - q.x);
  return Math.abs(normAngle(a - q.dir)) <= q.halfAngle;
}

/**
 * Scales every vertex of a star-shaped polygon toward the origin so that no vertex is
 * farther than maxDist. Used to draw stepped distance falloff inside a visibility polygon.
 */
export function clampPolygon(poly: readonly number[], ox: number, oy: number, maxDist: number, out: number[]): number[] {
  out.length = 0;
  const max2 = maxDist * maxDist;
  for (let i = 0; i < poly.length; i += 2) {
    const dx = poly[i] - ox;
    const dy = poly[i + 1] - oy;
    const d2 = dx * dx + dy * dy;
    if (d2 > max2) {
      const s = maxDist / Math.sqrt(d2);
      out.push(ox + dx * s, oy + dy * s);
    } else {
      out.push(poly[i], poly[i + 1]);
    }
  }
  return out;
}
