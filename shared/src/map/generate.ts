import { BALANCE, type ResolvedBalance } from '../balance';
import { hash32, Rng } from '../rng';
import { pointInPolygon, pointSegDist2 } from '../math';
import { overlapsCollider } from '../collision';
import { poissonDisc } from './poisson';
import { generateWarehouse, type DoorSpot, type OpeningSpot } from './warehouse';
import { NavGrid } from './navgrid';
import { MapWorld, inRect } from './world';
import {
  LOOT_KINDS,
  SURFACES,
  type AmbulanceDef,
  type BarricadeDef,
  type DoorDef,
  type GeneratorDef,
  type HidingSpotDef,
  type LightDef,
  type LootKind,
  type LootSpawnDef,
  type MapData,
  type MapParams,
  type Rect,
  type RockDef,
  type StakeDef,
  type Surface,
  type TreeDef,
  type WallSeg,
} from './types';

const W = BALANCE.world.size;
const WH = BALANCE.world.warehouseSize;
const WH_X = (W - WH) / 2;
const WH_Y = (W - WH) / 2;
const RASTER = 20;

/** Map parameters for a match, derived from the resolved balance. Item counts are fixed. */
export function mapParamsFor(seed: number, rb: ResolvedBalance): MapParams {
  const S = rb.survivors;
  return {
    seed: seed >>> 0,
    generators: rb.totalGenerators,
    loot: { ...BALANCE.items.counts },
    stakes: Math.max(6, Math.min(12, S + 4)),
  };
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Raster of cells where trees and props may not be placed. */
class KeepOut {
  readonly cols = Math.ceil(W / RASTER);
  readonly cells = new Uint8Array(this.cols * this.cols);

  circle(x: number, y: number, r: number): void {
    const x0 = Math.max(0, Math.floor((x - r) / RASTER));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / RASTER));
    const y0 = Math.max(0, Math.floor((y - r) / RASTER));
    const y1 = Math.min(this.cols - 1, Math.floor((y + r) / RASTER));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const px = (cx + 0.5) * RASTER;
        const py = (cy + 0.5) * RASTER;
        if ((px - x) ** 2 + (py - y) ** 2 <= r * r) this.cells[cy * this.cols + cx] = 1;
      }
    }
  }

  rect(r: Rect, pad: number): void {
    const x0 = Math.max(0, Math.floor((r.x - pad) / RASTER));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w + pad) / RASTER));
    const y0 = Math.max(0, Math.floor((r.y - pad) / RASTER));
    const y1 = Math.min(this.cols - 1, Math.floor((r.y + r.h + pad) / RASTER));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.cells[cy * this.cols + cx] = 1;
  }

  segment(ax: number, ay: number, bx: number, by: number, r: number): void {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (RASTER * 0.5)));
    for (let i = 0; i <= steps; i++) this.circle(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, r);
  }

  polyline(pts: number[], r: number): void {
    for (let i = 0; i + 3 < pts.length; i += 2) this.segment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r);
  }

  blocked(x: number, y: number): boolean {
    const cx = Math.floor(x / RASTER);
    const cy = Math.floor(y / RASTER);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.cols) return true;
    return this.cells[cy * this.cols + cx] === 1;
  }
}

interface Kit {
  walls: WallSeg[];
  rocks: RockDef[];
  doors: DoorSpot[];
  barricades: OpeningSpot[];
  wrecks: Rect[];
  radius: number;
}

/** Hiding spots and stakes keep at least this far from a doorway's centre. */
const ENTRANCE_CLEAR = 90;
/** Generators (bigger) keep this far. */
const GEN_ENTRANCE_CLEAR = 135;

/** Slides a generator straight away from any doorway it would block. */
function clearOfEntrances<T extends { x: number; y: number }>(g: T, entrances: { x: number; y: number }[]): T {
  const out = { ...g };
  for (const e of entrances) {
    const dx = out.x - e.x;
    const dy = out.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d >= GEN_ENTRANCE_CLEAR) continue;
    const k = d > 1e-3 ? GEN_ENTRANCE_CLEAR / d : 0;
    out.x = e.x + (d > 1e-3 ? dx * k : GEN_ENTRANCE_CLEAR);
    out.y = e.y + (d > 1e-3 ? dy * k : 0);
  }
  return out;
}

function rot(x: number, y: number, k: number): [number, number] {
  switch (k & 3) {
    case 0:
      return [x, y];
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    default:
      return [y, -x];
  }
}

/** Loop structures placed around woods generators (DBD-style "jungle gyms"). */
function buildKit(type: number, cx: number, cy: number, k: number, rng: Rng): Kit {
  const kit: Kit = { walls: [], rocks: [], doors: [], barricades: [], wrecks: [], radius: 150 };
  const seg = (ax: number, ay: number, bx: number, by: number, kind: WallSeg['kind'], vision = true): void => {
    const [x0, y0] = rot(ax, ay, k);
    const [x1, y1] = rot(bx, by, k);
    kit.walls.push({ ax: cx + x0, ay: cy + y0, bx: cx + x1, by: cy + y1, kind, vision, move: true });
  };
  const opening = (x: number, y: number, horizontal: boolean, length: number): OpeningSpot => {
    const [px, py] = rot(x, y, k);
    const angle = (horizontal ? 0 : Math.PI / 2) + (k & 1 ? Math.PI / 2 : 0);
    return { x: cx + px, y: cy + py, angle: angle % Math.PI, length };
  };
  if (type === 0) {
    // L-wall with a gap to cut through.
    seg(-130, -60, -35, -60, 'shack');
    seg(35, -60, 130, -60, 'shack');
    seg(130, -60, 130, 95, 'shack');
    kit.radius = 160;
  } else if (type === 1) {
    // Shack: a door on one side, an open gap opposite (run in, run through).
    seg(-95, -65, -35, -65, 'shack');
    seg(35, -65, 95, -65, 'shack');
    seg(95, -65, 95, -30, 'shack');
    seg(95, -30, 95, 30, 'window', false);
    seg(95, 30, 95, 65, 'shack');
    seg(95, 65, 40, 65, 'shack');
    seg(-40, 65, -95, 65, 'shack');
    seg(-95, 65, -95, -65, 'shack');
    const [hx, hy] = rot(40, 65, k);
    const [ex, ey] = rot(-40, 65, k);
    kit.doors.push({ hx: cx + hx, hy: cy + hy, angle: Math.atan2(ey - hy, ex - hx), length: 80, swing: 1, open: rng.chance(0.5) });
    kit.radius = 140;
  } else {
    // Car wreck and boulders with a barricade in the gap between them.
    const corners: [number, number][] = [
      [-160, -36],
      [-15, -36],
      [-15, 36],
      [-160, 36],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      seg(a[0], a[1], b[0], b[1], 'wreck');
    }
    const r0 = rot(-160, -36, k);
    const r1 = rot(-15, 36, k);
    kit.wrecks.push({ x: cx + Math.min(r0[0], r1[0]), y: cy + Math.min(r0[1], r1[1]), w: Math.abs(r1[0] - r0[0]), h: Math.abs(r1[1] - r0[1]) });
    const [bx0, by0] = rot(115, 0, k);
    const [bx1, by1] = rot(150, 30, k);
    kit.rocks.push({ x: cx + bx0, y: cy + by0, r: 38, variant: rng.int(0, 2) });
    kit.rocks.push({ x: cx + bx1, y: cy + by1, r: 26, variant: rng.int(0, 2) });
    kit.barricades.push(opening(36, 0, true, 110));
    kit.radius = 190;
  }
  return kit;
}

function wobblyPath(rng: Rng, ax: number, ay: number, bx: number, by: number): number[] {
  let pts: [number, number][] = [
    [ax, ay],
    [bx, by],
  ];
  for (let level = 0; level < 4; level++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = -(y1 - y0) / (len || 1);
      const ny = (x1 - x0) / (len || 1);
      const off = rng.range(-0.22, 0.22) * len;
      next.push([(x0 + x1) / 2 + nx * off, (y0 + y1) / 2 + ny * off], pts[i + 1]);
    }
    pts = next;
  }
  return pts.flat();
}

function distToPolyline(x: number, y: number, pts: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, pointSegDist2(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
  return Math.sqrt(best);
}

function segIntersectsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 20);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inRect(r, ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
  }
  return false;
}

/**
 * Generates the full map from a seed. The same params produce the identical map on every
 * client and the host. Each attempt is validated (reachability, loops, items placed); a
 * failed attempt deterministically re-rolls with a derived seed.
 */
export function generateMap(params: MapParams): MapData {
  let last: MapData | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const data = generateAttempt(params, attempt);
    last = data;
    if (validateMap(data).ok) return data;
  }
  return last!;
}

function generateAttempt(params: MapParams, attempt: number): MapData {
  const rng = new Rng(hash32(params.seed ^ Math.imul(attempt + 1, 0x9e3779b1)));
  const walls: WallSeg[] = [];
  const dynamicSegments: MapData['dynamicSegments'] = [];
  const keep = new KeepOut();

  // Map boundary.
  walls.push(
    { ax: 0, ay: 0, bx: W, by: 0, kind: 'boundary', vision: true, move: true },
    { ax: W, ay: 0, bx: W, by: W, kind: 'boundary', vision: true, move: true },
    { ax: W, ay: W, bx: 0, by: W, kind: 'boundary', vision: true, move: true },
    { ax: 0, ay: W, bx: 0, by: 0, kind: 'boundary', vision: true, move: true },
  );

  // Warehouse.
  const warehouse: Rect = { x: WH_X, y: WH_Y, w: WH, h: WH };
  const wh = generateWarehouse(rng.fork(1), WH_X, WH_Y, WH);
  walls.push(...wh.walls);
  keep.rect(warehouse, 150);
  const yard: Rect = { x: wh.gate.x - 150, y: WH_Y - 250, w: 300, h: 250 };
  keep.rect(yard, 110);
  const exitZone: Rect = { x: yard.x + 10, y: yard.y + 10, w: yard.w - 20, h: yard.h - 80 };
  const gateDyn = dynamicSegments.push({ ax: wh.gate.x - wh.gate.length / 2, ay: WH_Y, bx: wh.gate.x + wh.gate.length / 2, by: WH_Y, active: true }) - 1;

  // Lake with a dock, in one corner.
  const corner = rng.int(0, 3);
  const lcx = (corner % 2 === 0 ? 1050 : W - 1050) + rng.range(-150, 150);
  const lcy = (corner < 2 ? 1050 : W - 1050) + rng.range(-150, 150);
  const lakeR = rng.range(480, 580);
  const lakeN = 28;
  const lakeVerts: [number, number][] = [];
  const lr = rng.fork(2);
  for (let i = 0; i < lakeN; i++) {
    const a = (i / lakeN) * Math.PI * 2;
    const r = lakeR * (0.8 + lr.next() * 0.28);
    lakeVerts.push([lcx + Math.cos(a) * r, lcy + Math.sin(a) * r]);
  }
  let dockIdx = 0;
  let bestDot = -Infinity;
  const toCx = W / 2 - lcx;
  const toCy = W / 2 - lcy;
  lakeVerts.forEach(([x, y], i) => {
    const d = (x - lcx) * toCx + (y - lcy) * toCy;
    if (d > bestDot) {
      bestDot = d;
      dockIdx = i;
    }
  });
  const [px, py] = lakeVerts[dockIdx];
  const dl = Math.hypot(lcx - px, lcy - py);
  const dx = (lcx - px) / dl;
  const dy = (lcy - py) / dl;
  const perpX = -dy;
  const perpY = dx;
  const dockA: [number, number] = [px + perpX * 38, py + perpY * 38];
  const dockB: [number, number] = [px - perpX * 38, py - perpY * 38];
  const ring: [number, number][] = [...lakeVerts.slice(0, dockIdx), dockA, dockB, ...lakeVerts.slice(dockIdx + 1)];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === dockA && b === dockB) continue;
    walls.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], kind: 'shore', vision: false, move: true });
  }
  const dockLen = 280;
  const dockA2: [number, number] = [dockA[0] + dx * dockLen, dockA[1] + dy * dockLen];
  const dockB2: [number, number] = [dockB[0] + dx * dockLen, dockB[1] + dy * dockLen];
  walls.push(
    { ax: dockA[0], ay: dockA[1], bx: dockA2[0], by: dockA2[1], kind: 'dock', vision: false, move: true },
    { ax: dockB[0], ay: dockB[1], bx: dockB2[0], by: dockB2[1], kind: 'dock', vision: false, move: true },
    { ax: dockA2[0], ay: dockA2[1], bx: dockB2[0], by: dockB2[1], kind: 'dock', vision: false, move: true },
  );
  const lake = ring.flat();
  const dock = [...dockA, ...dockA2, ...dockB2, ...dockB];
  for (let i = 0; i < ring.length; i++) keep.circle(ring[i][0], ring[i][1], 70);
  keep.circle(lcx, lcy, lakeR * 1.05);
  const lights: LightDef[] = [{ x: (dockA2[0] + dockB2[0]) / 2, y: (dockA2[1] + dockB2[1]) / 2, radius: BALANCE.lights.lampRadius, kind: 'lantern' }];
  const lakeClear = (x: number, y: number, pad: number): boolean => Math.hypot(x - lcx, y - lcy) > lakeR * 1.1 + pad;

  // Survivor spawn (south) and clearings.
  let spawn = { x: W / 2, y: W - 450 };
  for (let i = 0; i < 50; i++) {
    const s = { x: rng.range(1400, W - 1400), y: rng.range(W - 650, W - 420) };
    if (lakeClear(s.x, s.y, 350)) {
      spawn = s;
      break;
    }
  }
  const clearings: Circle[] = [{ x: spawn.x, y: spawn.y, r: 230 }];
  const wantClearings = Math.max(10, params.generators + 5);
  for (let tries = 0; tries < 4000 && clearings.length < wantClearings + 1; tries++) {
    const r = rng.range(220, 300);
    const x = rng.range(420, W - 420);
    const y = rng.range(420, W - 420);
    const dRect = Math.max(Math.abs(x - W / 2) - WH / 2, Math.abs(y - W / 2) - WH / 2);
    if (dRect < r + 300) continue;
    if (inRect(yard, x, y, r + 200)) continue;
    if (!lakeClear(x, y, r + 150)) continue;
    const minD = tries < 2500 ? 820 : 650;
    if (clearings.some((c) => Math.hypot(c.x - x, c.y - y) < minD)) continue;
    clearings.push({ x, y, r });
  }
  for (const c of clearings) keep.circle(c.x, c.y, c.r * 0.85);
  // Hunter spawns in the clearing farthest from the survivors.
  let hunterClearing = clearings[1];
  for (const c of clearings.slice(1)) {
    if (Math.hypot(c.x - spawn.x, c.y - spawn.y) > Math.hypot(hunterClearing.x - spawn.x, hunterClearing.y - spawn.y)) hunterClearing = c;
  }

  // Cabins in three clearings.
  const cabins: Rect[] = [];
  const hidingSpots: Omit<HidingSpotDef, 'id'>[] = [];
  const lootCandidates: { x: number; y: number }[] = [...wh.lootSpots];
  const doorSpots: DoorSpot[] = [...wh.doors];
  const barricadeSpots: OpeningSpot[] = [...wh.barricadeSpots];
  const cabinClearings = new Set<Circle>();
  const cabinDoorSide = new Map<Rect, number>();
  for (const c of rng.shuffle(clearings.slice(1))) {
    if (cabins.length >= 3) break;
    if (c === hunterClearing) continue;
    c.r = Math.max(c.r, 300);
    keep.circle(c.x, c.y, c.r * 0.85);
    const cw = 280;
    const ch = 200;
    const rect = { x: c.x - cw / 2, y: c.y - ch / 2 - 40, w: cw, h: ch };
    cabins.push(rect);
    cabinClearings.add(c);
    const doorSide = rng.int(0, 3);
    cabinDoorSide.set(rect, doorSide);
    const sides: [number, number, number, number][] = [
      [rect.x, rect.y, rect.x + cw, rect.y],
      [rect.x + cw, rect.y, rect.x + cw, rect.y + ch],
      [rect.x + cw, rect.y + ch, rect.x, rect.y + ch],
      [rect.x, rect.y + ch, rect.x, rect.y],
    ];
    sides.forEach(([ax, ay, bx, by], side) => {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const ux = (bx - ax) / Math.hypot(bx - ax, by - ay);
      const uy = (by - ay) / Math.hypot(bx - ax, by - ay);
      if (side === doorSide) {
        walls.push({ ax, ay, bx: mx - ux * 38, by: my - uy * 38, kind: 'cabin', vision: true, move: true });
        walls.push({ ax: mx + ux * 38, ay: my + uy * 38, bx, by, kind: 'cabin', vision: true, move: true });
        // Doors swing outward (to the right of a clockwise side is outside).
        doorSpots.push({ hx: mx - ux * 38, hy: my - uy * 38, angle: Math.atan2(uy, ux), length: 76, swing: -1, open: false });
      } else {
        // A window in the middle of every other side: look in, light spills out.
        walls.push({ ax, ay, bx: mx - ux * 34, by: my - uy * 34, kind: 'cabin', vision: true, move: true });
        walls.push({ ax: mx - ux * 34, ay: my - uy * 34, bx: mx + ux * 34, by: my + uy * 34, kind: 'window', vision: false, move: true });
        walls.push({ ax: mx + ux * 34, ay: my + uy * 34, bx, by, kind: 'cabin', vision: true, move: true });
      }
    });
    // Interior: wardrobe against the side facing the door, bed in a corner, a lamp.
    const inward: [number, number][] = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ];
    const opp = sides[(doorSide + 2) % 4];
    const [ix, iy] = inward[(doorSide + 2) % 4];
    const wmx = (opp[0] + opp[2]) / 2 + ix * 24 + (iy !== 0 ? 60 : 0);
    const wmy = (opp[1] + opp[3]) / 2 + iy * 24 + (ix !== 0 ? 50 : 0);
    hidingSpots.push({ x: wmx, y: wmy, kind: 'wardrobe', facing: Math.atan2(iy, ix), exitX: wmx + ix * 44, exitY: wmy + iy * 44 });
    const bedX = rect.x + (doorSide === 3 ? cw - 70 : 70);
    const bedY = rect.y + (doorSide === 0 ? ch - 50 : 50);
    hidingSpots.push({ x: bedX, y: bedY, kind: 'bed', facing: 0, exitX: bedX + (bedX < c.x ? 60 : -60), exitY: bedY + (bedY < c.y + 0 ? 40 : -40) });
    lights.push({ x: rect.x + cw / 2, y: rect.y + ch / 2, radius: BALANCE.lights.lampRadius, kind: 'lamp' });
    lootCandidates.push({ x: rect.x + cw / 2 + rng.range(-50, 50), y: rect.y + ch / 2 + 30 }, { x: rect.x + 40, y: rect.y + ch - 40 });
    keep.rect(rect, 70);
  }

  // Generators: some in the warehouse, the rest in woods clearings with two loop kits each.
  const generators: Omit<GeneratorDef, 'id'>[] = [];
  const whGens = Math.min(wh.generatorSpots.length, params.generators >= 5 ? 2 : 1);
  for (let i = 0; i < whGens; i++) {
    generators.push({ x: wh.generatorSpots[i].x, y: wh.generatorSpots[i].y, angle: rng.int(0, 3) * (Math.PI / 2), area: 'warehouse' });
  }
  const wreckRects: Rect[] = [];
  const rocks: RockDef[] = [];
  const kitCircles: Circle[] = [];
  const genClearings = clearings
    .slice(1)
    .filter((c) => c !== hunterClearing)
    .sort((a, b) => (cabinClearings.has(a) ? 1 : 0) - (cabinClearings.has(b) ? 1 : 0));
  const chosen: Circle[] = [];
  // Farthest-point selection spreads the woods generators out.
  while (chosen.length < params.generators - whGens && chosen.length < genClearings.length) {
    let best: Circle | null = null;
    let bestScore = -Infinity;
    for (const c of genClearings) {
      if (chosen.includes(c)) continue;
      const others = [...chosen, ...generators.map((g) => ({ x: g.x, y: g.y, r: 0 }))];
      const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - c.x, o.y - c.y))) : rng.next() * 1000;
      const score = d - (cabinClearings.has(c) ? 400 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  for (const c of chosen) {
    const a = rng.range(0, Math.PI * 2);
    let gx = c.x + Math.cos(a) * c.r * 0.3;
    let gy = c.y + Math.sin(a) * c.r * 0.3;
    const cabin = cabins.find((r) => inRect(r, c.x, c.y, 60));
    if (cabin) {
      // Behind the cabin, never in front of its door.
      gx = c.x;
      gy = cabinDoorSide.get(cabin) === 2 ? cabin.y - 110 : cabin.y + cabin.h + 110;
    }
    generators.push({ x: gx, y: gy, angle: rng.int(0, 3) * (Math.PI / 2), area: 'woods' });
    keep.circle(gx, gy, 120);
    let placed = 0;
    const types = rng.shuffle([0, 1, 2]);
    for (let tries = 0; tries < 60 && placed < 2; tries++) {
      const type = types[(placed + Math.floor(tries / 20)) % 3];
      const probe = buildKit(type, 0, 0, 0, rng);
      const ang = a + Math.PI + (placed === 0 ? -1 : 1) * rng.range(0.6, 1.6) + (tries > 20 ? rng.range(-2, 2) : 0);
      const dist = probe.radius + 95 + rng.range(0, 40);
      const kx = gx + Math.cos(ang) * dist;
      const ky = gy + Math.sin(ang) * dist;
      if (kx < probe.radius + 60 || ky < probe.radius + 60 || kx > W - probe.radius - 60 || ky > W - probe.radius - 60) continue;
      const dRect = Math.max(Math.abs(kx - W / 2) - WH / 2, Math.abs(ky - W / 2) - WH / 2);
      if (dRect < probe.radius + 160) continue;
      if (!lakeClear(kx, ky, probe.radius + 80)) continue;
      if (inRect(yard, kx, ky, probe.radius + 120)) continue;
      if (cabins.some((r) => inRect(r, kx, ky, probe.radius + 90))) continue;
      if (kitCircles.some((k) => Math.hypot(k.x - kx, k.y - ky) < k.r + probe.radius + 90)) continue;
      if (generators.some((g) => Math.hypot(g.x - kx, g.y - ky) < probe.radius + 80)) continue;
      if (Math.hypot(spawn.x - kx, spawn.y - ky) < probe.radius + 260) continue;
      const kit = buildKit(type, kx, ky, rng.int(0, 3), rng);
      walls.push(...kit.walls);
      rocks.push(...kit.rocks);
      doorSpots.push(...kit.doors);
      barricadeSpots.push(...kit.barricades);
      wreckRects.push(...kit.wrecks);
      kitCircles.push({ x: kx, y: ky, r: kit.radius });
      keep.circle(kx, ky, kit.radius + 70);
      placed++;
    }
  }

  // Paths: MST over spawn, clearings and warehouse entrances, plus a few extra links.
  const nodes: { x: number; y: number; entrance: boolean }[] = [
    ...clearings.map((c) => ({ x: c.x, y: c.y, entrance: false })),
    ...wh.entrances.map((e) => ({ x: e.x, y: e.y, entrance: true })),
  ];
  const edges: [number, number, number][] = [];
  const whPad: Rect = { x: warehouse.x - 60, y: warehouse.y - 60, w: warehouse.w + 120, h: warehouse.h + 120 };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.entrance && b.entrance) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 2600) continue;
      if (segIntersectsRect(a.x, a.y, b.x, b.y, whPad) || segIntersectsRect(a.x, a.y, b.x, b.y, yard)) continue;
      let crossesLake = false;
      for (let t = 0; t <= 1; t += 0.05) {
        if (!lakeClear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 40)) crossesLake = true;
      }
      if (crossesLake) continue;
      edges.push([d, i, j]);
    }
  }
  edges.sort((p, q) => p[0] - q[0]);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const paths: MapData['paths'] = [];
  let extras = 0;
  const pr = rng.fork(3);
  for (const [, i, j] of edges) {
    const ri = find(i);
    const rj = find(j);
    const isTree = ri !== rj;
    if (!isTree && (extras >= 3 || pr.next() > 0.08)) continue;
    if (isTree) parent[ri] = rj;
    else extras++;
    const pts = wobblyPath(pr, nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y);
    paths.push({ points: pts, width: 70 });
    keep.polyline(pts, 58);
  }

  // Tall grass patches (each hides one survivor).
  const grassPatches: Circle[] = [];
  for (let tries = 0; tries < 800 && grassPatches.length < 12; tries++) {
    const x = rng.range(300, W - 300);
    const y = rng.range(300, W - 300);
    const r = rng.range(80, 125);
    if (keep.blocked(x, y) || !lakeClear(x, y, r + 60)) continue;
    if (grassPatches.some((g) => Math.hypot(g.x - x, g.y - y) < 600)) continue;
    if (Math.hypot(spawn.x - x, spawn.y - y) < 500) continue;
    grassPatches.push({ x, y, r });
    hidingSpots.push({ x, y, kind: 'grass', facing: rng.range(-Math.PI, Math.PI), exitX: x, exitY: y });
    keep.circle(x, y, 55);
  }

  // Warehouse hiding spots.
  for (const l of wh.lockers) hidingSpots.push({ x: l.x, y: l.y, kind: 'locker', facing: l.facing, exitX: l.exitX, exitY: l.exitY });
  for (const b of wh.barrels) {
    const toCx = warehouse.x + warehouse.w / 2 - b.x;
    const toCy = warehouse.y + warehouse.h / 2 - b.y;
    const l = Math.hypot(toCx, toCy) || 1;
    hidingSpots.push({ x: b.x, y: b.y, kind: 'barrel', facing: Math.atan2(toCy, toCx), exitX: b.x + (toCx / l) * 40, exitY: b.y + (toCy / l) * 40 });
  }

  // Fences with gaps.
  const fr = rng.fork(4);
  let fences = 0;
  for (let tries = 0; tries < 300 && fences < 7; tries++) {
    const x = fr.range(400, W - 400);
    const y = fr.range(400, W - 400);
    const a = fr.range(0, Math.PI);
    const len = fr.range(260, 440);
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    let ok = true;
    for (let t = 0; t <= 1; t += 0.1) {
      const px = x + (ex - x) * t;
      const py = y + (ey - y) * t;
      if (keep.blocked(px, py) || !lakeClear(px, py, 60)) ok = false;
    }
    if (!ok) continue;
    const g0 = fr.range(0.35, 0.55);
    const g1 = g0 + 90 / len;
    walls.push({ ax: x, ay: y, bx: x + (ex - x) * g0, by: y + (ey - y) * g0, kind: 'fence', vision: false, move: true });
    walls.push({ ax: x + (ex - x) * g1, ay: y + (ey - y) * g1, bx: ex, by: ey, kind: 'fence', vision: false, move: true });
    keep.segment(x, y, ex, ey, 40);
    fences++;
  }

  // Logs as low props in clearings (block movement, not sight).
  const logs: MapData['logs'] = [];
  for (const c of clearings.slice(1)) {
    if (!rng.chance(0.55) || cabinClearings.has(c)) continue;
    const a = rng.range(0, Math.PI * 2);
    const x = c.x + Math.cos(a) * c.r * 0.62;
    const y = c.y + Math.sin(a) * c.r * 0.62;
    if (generators.some((g) => Math.hypot(g.x - x, g.y - y) < 150)) continue;
    const ang = rng.range(0, Math.PI);
    const len = 140;
    logs.push({ x, y, angle: ang, length: len });
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const nx = -uy * 12;
    const ny = ux * 12;
    const x0 = x - (ux * len) / 2;
    const y0 = y - (uy * len) / 2;
    const x1 = x + (ux * len) / 2;
    const y1 = y + (uy * len) / 2;
    walls.push(
      { ax: x0 + nx, ay: y0 + ny, bx: x1 + nx, by: y1 + ny, kind: 'log', vision: false, move: true },
      { ax: x1 + nx, ay: y1 + ny, bx: x1 - nx, by: y1 - ny, kind: 'log', vision: false, move: true },
      { ax: x1 - nx, ay: y1 - ny, bx: x0 - nx, by: y0 - ny, kind: 'log', vision: false, move: true },
      { ax: x0 - nx, ay: y0 - ny, bx: x0 + nx, by: y0 + ny, kind: 'log', vision: false, move: true },
    );
  }

  // Campfires in a few clearings, away from generators.
  for (const c of rng.shuffle(clearings.slice(1)).slice(0, 4)) {
    if (cabinClearings.has(c)) continue;
    let best: { x: number; y: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = { x: c.x + Math.cos(a) * c.r * 0.45, y: c.y + Math.sin(a) * c.r * 0.45 };
      if (generators.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < 170)) continue;
      if (logs.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < 110)) continue;
      best = p;
      break;
    }
    if (best) lights.push({ x: best.x, y: best.y, radius: BALANCE.lights.campfireRadius, kind: 'campfire' });
  }
  for (const s of wh.lampSpots) lights.push({ x: s.x, y: s.y, radius: BALANCE.lights.lampRadius, kind: 'lamp' });

  // Chris Zelley's ambulance: parked somewhere in the woods, off the paths, with a clear ring
  // around it for him to pace.
  const A = BALANCE.chris.ambulance;
  const ar = rng.fork(9);
  const ambHalfDiag = Math.hypot(A.length, A.width) / 2;
  const ambClear = ambHalfDiag + BALANCE.chris.pace + 40;
  const fenceWalls = walls.filter((w) => w.kind === 'fence');
  let ambulance: AmbulanceDef | null = null;
  for (let tries = 0; tries < 4000 && !ambulance; tries++) {
    const x = ar.range(450, W - 450);
    const y = ar.range(450, W - 450);
    const dRect = Math.max(Math.abs(x - W / 2) - WH / 2, Math.abs(y - W / 2) - WH / 2);
    if (dRect < ambClear + 200 || inRect(yard, x, y, ambClear + 100) || !lakeClear(x, y, ambClear + 60)) continue;
    if (Math.hypot(spawn.x - x, spawn.y - y) < 700 || Math.hypot(hunterClearing.x - x, hunterClearing.y - y) < 700) continue;
    if (cabins.some((r) => inRect(r, x, y, ambClear + 80))) continue;
    if (kitCircles.some((k) => Math.hypot(k.x - x, k.y - y) < k.r + ambClear + 60)) continue;
    if (generators.some((g) => Math.hypot(g.x - x, g.y - y) < ambClear + 140)) continue;
    if (grassPatches.some((g) => Math.hypot(g.x - x, g.y - y) < g.r + ambClear + 40)) continue;
    if (logs.some((l) => Math.hypot(l.x - x, l.y - y) < ambClear + 90)) continue;
    if (lights.some((l) => Math.hypot(l.x - x, l.y - y) < ambClear + 80)) continue;
    if (fenceWalls.some((f) => pointSegDist2(x, y, f.ax, f.ay, f.bx, f.by) < (ambClear + 40) ** 2)) continue;
    const pathClear = tries < 2500 ? ambClear + 20 : ambHalfDiag + 10;
    if (paths.some((p) => distToPolyline(x, y, p.points) < pathClear)) continue;
    ambulance = { x, y, angle: ar.range(0, Math.PI), length: A.length, width: A.width };
  }
  ambulance ??= { x: spawn.x, y: spawn.y - 900, angle: 0, length: A.length, width: A.width };
  {
    const { x, y, angle } = ambulance;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const hl = A.length / 2;
    const hw = A.width / 2;
    const c = [
      [x + ux * hl - uy * hw, y + uy * hl + ux * hw],
      [x + ux * hl + uy * hw, y + uy * hl - ux * hw],
      [x - ux * hl + uy * hw, y - uy * hl - ux * hw],
      [x - ux * hl - uy * hw, y - uy * hl + ux * hw],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i];
      const [bx, by] = c[(i + 1) % 4];
      walls.push({ ax, ay, bx, by, kind: 'ambulance', vision: true, move: true });
    }
    keep.circle(x, y, ambClear);
    kitCircles.push({ x, y, r: ambHalfDiag + 30 });
  }

  // Scarecrow stakes, spread out.
  const stakeCandidates: { x: number; y: number }[] = [...wh.stakeSpots];
  for (const c of clearings.slice(1)) {
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      stakeCandidates.push({ x: c.x + Math.cos(a) * c.r * 0.55, y: c.y + Math.sin(a) * c.r * 0.55 });
    }
  }
  // Nothing may stand in a doorway or a barricade gap.
  const entrancePts = (): { x: number; y: number }[] => [
    ...doorSpots.map((d) => ({ x: d.hx + (Math.cos(d.angle) * d.length) / 2, y: d.hy + (Math.sin(d.angle) * d.length) / 2 })),
    ...barricadeSpots.map((b) => ({ x: b.x, y: b.y })),
  ];
  const nearEntrance = (x: number, y: number, r: number): boolean => entrancePts().some((e) => Math.hypot(e.x - x, e.y - y) < r);
  const okStake = (p: { x: number; y: number }): boolean =>
    !nearEntrance(p.x, p.y, ENTRANCE_CLEAR) &&
    !generators.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < 130) &&
    !cabins.some((r) => inRect(r, p.x, p.y, 40)) &&
    !lights.some((l) => l.kind === 'campfire' && Math.hypot(l.x - p.x, l.y - p.y) < 90) &&
    !logs.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < 100) &&
    !kitCircles.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < k.r + 30) &&
    Math.hypot(spawn.x - p.x, spawn.y - p.y) > 500;
  const stakes: Omit<StakeDef, 'id'>[] = [];
  const stakePool = stakeCandidates.filter(okStake);
  while (stakes.length < params.stakes && stakePool.length) {
    let bi = 0;
    let bd = -1;
    stakePool.forEach((p, i) => {
      const d = stakes.length ? Math.min(...stakes.map((s) => Math.hypot(s.x - p.x, s.y - p.y))) : rng.next();
      if (d > bd) {
        bd = d;
        bi = i;
      }
    });
    stakes.push(stakePool.splice(bi, 1)[0]);
  }
  for (const s of stakes) keep.circle(s.x, s.y, 70);

  // Trees and boulders fill the woods.
  const trees: TreeDef[] = [];
  const tr = rng.fork(5);
  const pts = poissonDisc(tr, 45, 45, W - 45, W - 45, 88, (x, y) => !keep.blocked(x, y));
  for (const [x, y] of pts) {
    // A quarter of the woods is thinned out.
    if (tr.next() >= BALANCE.world.treeKeep) continue;
    const roll = tr.next();
    if (roll < 0.08) rocks.push({ x, y, r: tr.range(24, 36), variant: tr.int(0, 2) });
    else if (roll < 0.55) trees.push({ x, y, r: tr.range(14, 21), kind: 'pine', variant: tr.int(0, 3) });
    else if (roll < 0.85) trees.push({ x, y, r: tr.range(15, 22), kind: 'oak', variant: tr.int(0, 3) });
    else trees.push({ x, y, r: tr.range(12, 17), kind: 'dead', variant: tr.int(0, 3) });
  }
  const bushes: MapData['bushes'] = [];
  for (let i = 0; i < 420; i++) {
    const x = tr.range(60, W - 60);
    const y = tr.range(60, W - 60);
    if (inRect(warehouse, x, y, 20) || !lakeClear(x, y, 20) || inRect(yard, x, y, 20)) continue;
    if (cabins.some((r) => inRect(r, x, y, 10))) continue;
    if (Math.hypot(x - ambulance.x, y - ambulance.y) < ambHalfDiag + 20) continue;
    bushes.push({ x, y, r: tr.range(18, 30), variant: tr.int(0, 2) });
  }

  // Survivor and hunter spawn points.
  const survivorSpawns = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return { x: spawn.x + Math.cos(a) * 110, y: spawn.y + Math.sin(a) * 90 };
  });
  const hunterSpawns = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2;
    return { x: hunterClearing.x + Math.cos(a) * 70, y: hunterClearing.y + Math.sin(a) * 70 };
  });

  // Barricades and doors get ids and dynamic segments (barricades inactive while standing,
  // doors active while closed; doors also block sight).
  const barricades: BarricadeDef[] = barricadeSpots.map((b, id) => {
    const ux = Math.cos(b.angle) * (b.length / 2);
    const uy = Math.sin(b.angle) * (b.length / 2);
    const dyn = dynamicSegments.push({ ax: b.x - ux, ay: b.y - uy, bx: b.x + ux, by: b.y + uy, active: false }) - 1;
    return { id, x: b.x, y: b.y, angle: b.angle, length: b.length, dyn };
  });
  const doors: DoorDef[] = doorSpots.map((d, id) => {
    const bx = d.hx + Math.cos(d.angle) * d.length;
    const by = d.hy + Math.sin(d.angle) * d.length;
    const dyn = dynamicSegments.push({ ax: d.hx, ay: d.hy, bx, by, active: !d.open, vision: true }) - 1;
    return { id, hx: d.hx, hy: d.hy, angle: d.angle, length: d.length, swing: d.swing, dyn };
  });

  const partial: MapData = {
    params,
    width: W,
    height: W,
    walls,
    dynamicSegments,
    trees,
    rocks,
    logs,
    bushes,
    paths,
    clearings,
    grassPatches,
    lake,
    dock,
    warehouse,
    cabins,
    racks: wh.racks,
    wrecks: wreckRects,
    ambulance,
    exitZone,
    generators: generators.map((g, id) => ({ id, ...clearOfEntrances(g, entrancePts()) })),
    hidingSpots: hidingSpots.filter((h) => h.kind === 'grass' || !nearEntrance(h.x, h.y, ENTRANCE_CLEAR)).map((h, id) => ({ id, ...h })),
    loot: [],
    stakes: stakes.map((s, id) => ({ id, ...s })),
    barricades,
    doors,
    gate: { ...wh.gate, dyn: gateDyn },
    lights,
    survivorSpawns,
    hunterSpawns,
    surfaceCell: 25,
    surface: new Uint8Array(0),
  };

  // Loot: candidate spots must be clear of colliders; parts first, spread apart.
  const world = new MapWorld(partial);
  for (const c of clearings.slice(1)) {
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      lootCandidates.push({ x: c.x + Math.cos(a) * c.r * rng.range(0.3, 0.7), y: c.y + Math.sin(a) * c.r * rng.range(0.3, 0.7) });
    }
  }
  for (const p of paths) {
    for (let i = 0; i < 3; i++) {
      const k = rng.int(1, p.points.length / 2 - 2) * 2;
      const ax = p.points[k];
      const ay = p.points[k + 1];
      const bx = p.points[k + 2];
      const by = p.points[k + 3];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      lootCandidates.push({ x: ax - ((by - ay) / l) * 42 * side, y: ay + ((bx - ax) / l) * 42 * side });
    }
  }
  const pool = rng.shuffle(lootCandidates.filter((p) => p.x > 60 && p.y > 60 && p.x < W - 60 && p.y < W - 60));
  const clear = pool.filter((p) => !overlapsCollider(world.geo, p.x, p.y, 24) && !inRect(yard, p.x, p.y, 20) && lakeClear(p.x, p.y, 30));
  const loot: LootSpawnDef[] = [];
  const order: LootKind[] = [];
  for (const kind of LOOT_KINDS) for (let i = 0; i < params.loot[kind]; i++) order.push(kind);
  for (const kind of order) {
    let idx = clear.findIndex((p) => loot.every((l) => Math.hypot(l.x - p.x, l.y - p.y) > 160));
    if (idx < 0) idx = clear.findIndex((p) => loot.every((l) => Math.hypot(l.x - p.x, l.y - p.y) > 60));
    if (idx < 0) break;
    const p = clear.splice(idx, 1)[0];
    loot.push({ id: loot.length, x: p.x, y: p.y, item: kind });
  }
  partial.loot = loot;
  partial.surface = buildSurface(partial);
  return partial;
}

function buildSurface(d: MapData): Uint8Array {
  const cell = d.surfaceCell;
  const cols = Math.ceil(d.width / cell);
  const out = new Uint8Array(cols * cols);
  const code = (s: Surface): number => SURFACES.indexOf(s);
  for (let cy = 0; cy < cols; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * cell;
      const y = (cy + 0.5) * cell;
      let s: Surface = 'forest';
      if (pointInPolygon(x, y, d.dock)) s = 'wood';
      else if (pointInPolygon(x, y, d.lake)) s = 'water';
      else if (d.cabins.some((r) => inRect(r, x, y))) s = 'wood';
      else if (inRect(d.warehouse, x, y) || inRect({ x: d.exitZone.x - 10, y: d.exitZone.y - 10, w: d.exitZone.w + 20, h: d.exitZone.h + 80 }, x, y)) s = 'concrete';
      else if (d.grassPatches.some((g) => Math.hypot(g.x - x, g.y - y) < g.r)) s = 'grass';
      else if (d.clearings.some((c) => Math.hypot(c.x - x, c.y - y) < c.r * 0.75) || d.paths.some((p) => distToPolyline(x, y, p.points) < p.width / 2)) s = 'dirt';
      out[cy * cols + cx] = code(s);
    }
  }
  return out;
}

export interface MapValidation {
  ok: boolean;
  problems: string[];
  loopsPerGenerator: number[];
}

/** Minimum navgrid cells for a blocked component to count as a loop structure. */
const LOOP_MIN_CELLS = 18;

/**
 * Checks that everything important is reachable from the survivor spawn (with the gate and
 * doors open and barricades standing), that every item was placed, and that every generator
 * has at least two loopable structures nearby.
 */
export function validateMap(d: MapData, nav?: NavGrid): MapValidation {
  const problems: string[] = [];
  const world = new MapWorld(d);
  world.geo.setDynamicActive(d.gate.dyn, false);
  for (const door of d.doors) world.geo.setDynamicActive(door.dyn, false);
  const grid = nav ?? new NavGrid(world.geo, 20, 15);
  const start = grid.nearestWalkable(d.survivorSpawns[0].x, d.survivorSpawns[0].y, 6);
  if (start < 0) return { ok: false, problems: ['spawn blocked'], loopsPerGenerator: [] };
  const reach = grid.flood(start);
  const reachable = (x: number, y: number, radius = 3): boolean => {
    const i = grid.nearestWalkable(x, y, radius);
    return i >= 0 && reach[i] === 1;
  };
  const near = (x: number, y: number, r: number): boolean => {
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * r;
      const py = y + Math.sin((a / 8) * Math.PI * 2) * r;
      if (reachable(px, py, 1)) return true;
    }
    return false;
  };
  for (const g of d.generators) if (!near(g.x, g.y, 50)) problems.push(`generator ${g.id} unreachable`);
  for (const l of d.loot) if (!reachable(l.x, l.y)) problems.push(`loot ${l.id} unreachable`);
  for (const h of d.hidingSpots) if (!reachable(h.exitX, h.exitY)) problems.push(`hiding ${h.id} unreachable`);
  for (const s of d.stakes) if (!near(s.x, s.y, 30)) problems.push(`stake ${s.id} unreachable`);
  if (!reachable(d.gate.leverX, d.gate.leverY)) problems.push('gate lever unreachable');
  if (!reachable(d.exitZone.x + d.exitZone.w / 2, d.exitZone.y + d.exitZone.h / 2, 4)) problems.push('exit unreachable');
  for (const h of d.hunterSpawns) if (!reachable(h.x, h.y, 4)) problems.push('hunter spawn unreachable');
  const items = d.loot.length;
  const wanted = Object.values(d.params.loot).reduce((a, b) => a + b, 0);
  if (items < wanted) problems.push(`only ${items} of ${wanted} items placed`);
  if (d.generators.length < d.params.generators) problems.push('not enough generators');

  const loopsPerGenerator = d.generators.map((g) => countLoops(grid, reach, g.x, g.y, 480));
  loopsPerGenerator.forEach((n, i) => {
    if (n < 2) problems.push(`generator ${i} has ${n} loops`);
  });
  return { ok: problems.length === 0, problems, loopsPerGenerator };
}

/**
 * Counts free-standing obstacles near (x,y) that can be run around: blocked components of
 * at least LOOP_MIN_CELLS cells whose surrounding ring of walkable cells is reachable and
 * connected. The generator's own footprint is excluded.
 */
export function countLoops(grid: NavGrid, reach: Uint8Array, x: number, y: number, radius: number): number {
  const { cols, rows, blocked } = grid;
  const label = new Int32Array(cols * rows).fill(-1);
  const x0 = Math.max(0, Math.floor((x - radius) / grid.cell));
  const x1 = Math.min(cols - 1, Math.floor((x + radius) / grid.cell));
  const y0 = Math.max(0, Math.floor((y - radius) / grid.cell));
  const y1 = Math.min(rows - 1, Math.floor((y + radius) / grid.cell));
  const genCell = grid.index(x, y);
  let loops = 0;
  let next = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const s = cy * cols + cx;
      if (!blocked[s] || label[s] >= 0) continue;
      // Flood the whole component (it may extend outside the window).
      const id = next++;
      const comp: number[] = [s];
      label[s] = id;
      let touchesEdge = false;
      let hasGen = false;
      for (let k = 0; k < comp.length && comp.length < 4000; k++) {
        const i = comp[k];
        if (i === genCell) hasGen = true;
        const ix = i % cols;
        const iy = (i - ix) / cols;
        if (ix === 0 || iy === 0 || ix === cols - 1 || iy === rows - 1) touchesEdge = true;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (blocked[j] && label[j] < 0) {
            label[j] = id;
            comp.push(j);
          }
        }
      }
      if (hasGen || touchesEdge || comp.length < LOOP_MIN_CELLS || comp.length >= 4000) continue;
      // Ring: walkable cells 8-adjacent to the component.
      const ring = new Set<number>();
      for (const i of comp) {
        const ix = i % cols;
        const iy = (i - ix) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx;
            const ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (!blocked[j]) ring.add(j);
          }
        }
      }
      let allReachable = true;
      for (const j of ring) if (!reach[j]) allReachable = false;
      if (!allReachable || ring.size === 0) continue;
      // Ring connectivity (8-connected within the ring set).
      const startCell = ring.values().next().value as number;
      const seen = new Set<number>([startCell]);
      const q = [startCell];
      while (q.length) {
        const i = q.pop()!;
        const ix = i % cols;
        const iy = (i - ix) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = (iy + dy) * cols + (ix + dx);
            if (ring.has(j) && !seen.has(j)) {
              seen.add(j);
              q.push(j);
            }
          }
        }
      }
      if (seen.size === ring.size) loops++;
    }
  }
  return loops;
}
