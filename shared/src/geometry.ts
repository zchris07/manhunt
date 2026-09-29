import { GridIndex } from './spatialHash';
import { rayCircle, raySegment, segmentCircle, segmentsIntersect } from './math';

export interface SegmentDef {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Blocks line of sight (walls). */
  vision: boolean;
  /** Blocks movement (walls, fences, windows, shoreline). */
  move: boolean;
}

export interface CircleDef {
  x: number;
  y: number;
  r: number;
  vision: boolean;
  move: boolean;
}

/** A movement-only segment that can be switched on and off (barricades, gate, broken windows). */
export interface DynamicSegmentDef {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  active: boolean;
}

const CELL = 128;

/**
 * Static world geometry with separate broad-phase grids for vision occluders and movement
 * colliders. Circles are analytic (trees, boulders). Dynamic segments only affect movement.
 */
export class Geometry {
  readonly visSeg: Float64Array;
  readonly visCircle: Float64Array;
  readonly moveSeg: Float64Array;
  readonly moveCircle: Float64Array;
  readonly moveSegActive: Uint8Array;
  readonly visSegGrid: GridIndex;
  readonly visCircleGrid: GridIndex;
  readonly moveSegGrid: GridIndex;
  readonly moveCircleGrid: GridIndex;
  /** Index of the first dynamic segment in moveSeg. */
  readonly dynamicBase: number;
  private readonly tmpA: number[] = [];
  private readonly tmpB: number[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    segments: readonly SegmentDef[],
    circles: readonly CircleDef[],
    dynamic: readonly DynamicSegmentDef[] = [],
  ) {
    const vs = segments.filter((s) => s.vision);
    const ms = segments.filter((s) => s.move);
    const vc = circles.filter((c) => c.vision);
    const mc = circles.filter((c) => c.move);

    this.visSeg = new Float64Array(vs.length * 4);
    this.visSegGrid = new GridIndex(width, height, CELL);
    vs.forEach((s, i) => {
      this.visSeg.set([s.ax, s.ay, s.bx, s.by], i * 4);
      this.visSegGrid.insert(i, Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by));
    });

    this.visCircle = new Float64Array(vc.length * 3);
    this.visCircleGrid = new GridIndex(width, height, CELL);
    vc.forEach((c, i) => {
      this.visCircle.set([c.x, c.y, c.r], i * 3);
      this.visCircleGrid.insert(i, c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    });

    this.dynamicBase = ms.length;
    const allMove = [...ms, ...dynamic];
    this.moveSeg = new Float64Array(allMove.length * 4);
    this.moveSegActive = new Uint8Array(allMove.length);
    this.moveSegGrid = new GridIndex(width, height, CELL);
    allMove.forEach((s, i) => {
      this.moveSeg.set([s.ax, s.ay, s.bx, s.by], i * 4);
      this.moveSegActive[i] = i < ms.length ? 1 : (s as DynamicSegmentDef).active ? 1 : 0;
      this.moveSegGrid.insert(i, Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by));
    });

    this.moveCircle = new Float64Array(mc.length * 3);
    this.moveCircleGrid = new GridIndex(width, height, CELL);
    mc.forEach((c, i) => {
      this.moveCircle.set([c.x, c.y, c.r], i * 3);
      this.moveCircleGrid.insert(i, c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    });
  }

  /** Enables or disables dynamic movement segment `index` (0-based among dynamic segments). */
  setDynamicActive(index: number, active: boolean): void {
    this.moveSegActive[this.dynamicBase + index] = active ? 1 : 0;
  }

  isDynamicActive(index: number): boolean {
    return this.moveSegActive[this.dynamicBase + index] === 1;
  }

  /** True if nothing that blocks vision lies between a and b. */
  hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const minX = Math.min(ax, bx);
    const minY = Math.min(ay, by);
    const maxX = Math.max(ax, bx);
    const maxY = Math.max(ay, by);
    const segs = this.visSegGrid.query(minX, minY, maxX, maxY, this.tmpA);
    const vs = this.visSeg;
    for (let i = 0; i < segs.length; i++) {
      const o = segs[i] * 4;
      if (segmentsIntersect(ax, ay, bx, by, vs[o], vs[o + 1], vs[o + 2], vs[o + 3])) return false;
    }
    const circles = this.visCircleGrid.query(minX, minY, maxX, maxY, this.tmpB);
    const vc = this.visCircle;
    for (let i = 0; i < circles.length; i++) {
      const o = circles[i] * 3;
      if (segmentCircle(ax, ay, bx, by, vc[o], vc[o + 1], vc[o + 2] * 0.9)) return false;
    }
    return true;
  }

  /** Distance along a ray until it hits a vision occluder, capped at maxDist. */
  raycastVision(ox: number, oy: number, angle: number, maxDist: number): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    let best = maxDist;
    const segs = this.visSegGrid.query(Math.min(ox, ex), Math.min(oy, ey), Math.max(ox, ex), Math.max(oy, ey), this.tmpA);
    const vs = this.visSeg;
    for (let i = 0; i < segs.length; i++) {
      const o = segs[i] * 4;
      const t = raySegment(ox, oy, dx, dy, vs[o], vs[o + 1], vs[o + 2], vs[o + 3]);
      if (t < best) best = t;
    }
    const circles = this.visCircleGrid.query(Math.min(ox, ex), Math.min(oy, ey), Math.max(ox, ex), Math.max(oy, ey), this.tmpB);
    const vc = this.visCircle;
    for (let i = 0; i < circles.length; i++) {
      const o = circles[i] * 3;
      const t = rayCircle(ox, oy, dx, dy, vc[o], vc[o + 1], vc[o + 2]);
      if (t < best) best = t;
    }
    return best;
  }
}
