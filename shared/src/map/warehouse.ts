import type { Rng } from '../rng';
import type { Rect, WallSeg } from './types';

export interface Spot {
  x: number;
  y: number;
}

export interface OpeningSpot {
  x: number;
  y: number;
  angle: number;
  length: number;
}

export interface WarehouseResult {
  walls: WallSeg[];
  barricadeSpots: OpeningSpot[];
  windows: OpeningSpot[];
  lockers: { x: number; y: number; facing: number; exitX: number; exitY: number }[];
  barrels: Spot[];
  racks: Rect[];
  generatorSpots: Spot[];
  lootSpots: Spot[];
  stakeSpots: Spot[];
  lampSpots: Spot[];
  gate: { x: number; y: number; angle: number; length: number; leverX: number; leverY: number };
  /** Points just outside each exterior entrance, for path generation. */
  entrances: (Spot & { side: 'n' | 's' | 'e' | 'w' })[];
}

const N = 10;
type Edge = 'wall' | 'open' | 'window' | 'gate';

interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Central warehouse: an N x N cell grid. BSP picks rooms, a recursive backtracker carves
 * corridors between every room and cell, then extra walls are removed to create loops and
 * some become vaultable windows. Rooms get free-standing racks (loopable), lockers line
 * corridors, and the exit gate sits in the north wall with a fenced exit yard beyond it.
 */
export function generateWarehouse(rng: Rng, x0: number, y0: number, size: number): WarehouseResult {
  const C = size / N;
  // h[r][c]: horizontal edge on the top of cell (r,c); r in 0..N. v[r][c]: vertical edge left of (r,c); c in 0..N.
  const h: Edge[][] = Array.from({ length: N + 1 }, () => Array<Edge>(N).fill('wall'));
  const v: Edge[][] = Array.from({ length: N }, () => Array<Edge>(N + 1).fill('wall'));
  const room = new Int32Array(N * N).fill(-1);

  // BSP split into leaves of at most 4x4 cells.
  const leaves: RoomRect[] = [];
  const split = (r: RoomRect): void => {
    if (r.w <= 4 && r.h <= 4) {
      leaves.push(r);
      return;
    }
    const vertical = r.w > r.h || (r.w === r.h && rng.chance(0.5));
    if (vertical) {
      const s = rng.int(2, r.w - 2);
      split({ x: r.x, y: r.y, w: s, h: r.h });
      split({ x: r.x + s, y: r.y, w: r.w - s, h: r.h });
    } else {
      const s = rng.int(2, r.h - 2);
      split({ x: r.x, y: r.y, w: r.w, h: s });
      split({ x: r.x, y: r.y + s, w: r.w, h: r.h - s });
    }
  };
  split({ x: 0, y: 0, w: N, h: N });

  // Leaves become rooms; guarantee the two largest leaves are rooms (generator rooms).
  const byArea = [...leaves].sort((a, b) => b.w * b.h - a.w * a.h);
  const rooms: RoomRect[] = [];
  for (const leaf of leaves) {
    const forced = leaf === byArea[0] || leaf === byArea[1];
    if (forced || (leaf.w >= 2 && leaf.h >= 2 && rng.chance(0.5))) {
      // Rooms shrink inside their leaf a little so corridors run around them.
      const rr: RoomRect = { ...leaf };
      if (!forced && rr.w > 2 && rng.chance(0.5)) rr.w -= 1;
      if (!forced && rr.h > 2 && rng.chance(0.5)) rr.h -= 1;
      rooms.push(rr);
    }
  }
  rooms.forEach((rr, i) => {
    for (let y = rr.y; y < rr.y + rr.h; y++) {
      for (let x = rr.x; x < rr.x + rr.w; x++) room[y * N + x] = i;
    }
    for (let y = rr.y; y < rr.y + rr.h; y++) for (let x = rr.x + 1; x < rr.x + rr.w; x++) v[y][x] = 'open';
    for (let y = rr.y + 1; y < rr.y + rr.h; y++) for (let x = rr.x; x < rr.x + rr.w; x++) h[y][x] = 'open';
  });

  const openBetween = (r0: number, c0: number, r1: number, c1: number, e: Edge): void => {
    if (r0 === r1) v[r0][Math.max(c0, c1)] = e;
    else h[Math.max(r0, r1)][c0] = e;
  };
  const edgeBetween = (r0: number, c0: number, r1: number, c1: number): Edge =>
    r0 === r1 ? v[r0][Math.max(c0, c1)] : h[Math.max(r0, r1)][c0];

  // Recursive backtracker (iterative). Entering a room visits all its cells.
  const visited = new Uint8Array(N * N);
  const doorways: [number, number, number, number][] = [];
  const stack: number[] = [];
  const visit = (cell: number): void => {
    const ri = room[cell];
    if (ri >= 0) {
      const rr = rooms[ri];
      for (let y = rr.y; y < rr.y + rr.h; y++) {
        for (let x = rr.x; x < rr.x + rr.w; x++) {
          const k = y * N + x;
          if (!visited[k]) {
            visited[k] = 1;
            stack.push(k);
          }
        }
      }
    } else {
      visited[cell] = 1;
      stack.push(cell);
    }
  };
  visit(rng.int(0, N * N - 1));
  const dirs = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  while (stack.length) {
    const cell = stack[stack.length - 1];
    const r = Math.floor(cell / N);
    const c = cell % N;
    const options: [number, number][] = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
      if (!visited[nr * N + nc]) options.push([nr, nc]);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nr, nc] = rng.pick(options);
    openBetween(r, c, nr, nc, 'open');
    doorways.push([r, c, nr, nc]);
    visit(nr * N + nc);
  }

  // Braid: remove extra walls for loops; turn some into windows.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= N || nc >= N) continue;
        if (edgeBetween(r, c, nr, nc) !== 'wall') continue;
        const roll = rng.next();
        if (roll < 0.13) {
          openBetween(r, c, nr, nc, 'open');
          doorways.push([r, c, nr, nc]);
        } else if (roll < 0.2) openBetween(r, c, nr, nc, 'window');
      }
    }
  }

  // Exterior: gate in the north wall, entrances on every side, a few windows.
  const gateCol = rng.int(3, N - 4);
  h[0][gateCol] = 'gate';
  const entrances: WarehouseResult['entrances'] = [];
  const pickCols = (count: number, avoid: number[]): number[] => {
    const cols: number[] = [];
    let guard = 0;
    while (cols.length < count && guard++ < 100) {
      const k = rng.int(1, N - 2);
      if (avoid.some((a) => Math.abs(a - k) <= 1) || cols.some((a) => Math.abs(a - k) <= 2)) continue;
      cols.push(k);
    }
    return cols;
  };
  const exteriorOpenings: OpeningSpot[] = [];
  for (const k of pickCols(2, [])) {
    h[N][k] = 'open';
    entrances.push({ x: x0 + (k + 0.5) * C, y: y0 + size + 70, side: 's' });
    exteriorOpenings.push({ x: x0 + (k + 0.5) * C, y: y0 + size, angle: 0, length: C - 10 });
  }
  for (const k of pickCols(1, [gateCol])) {
    h[0][k] = 'open';
    entrances.push({ x: x0 + (k + 0.5) * C, y: y0 - 70, side: 'n' });
    exteriorOpenings.push({ x: x0 + (k + 0.5) * C, y: y0, angle: 0, length: C - 10 });
  }
  for (const k of pickCols(rng.int(1, 2), [])) {
    v[k][0] = 'open';
    entrances.push({ x: x0 - 70, y: y0 + (k + 0.5) * C, side: 'w' });
    exteriorOpenings.push({ x: x0, y: y0 + (k + 0.5) * C, angle: Math.PI / 2, length: C - 10 });
  }
  for (const k of pickCols(rng.int(1, 2), [])) {
    v[k][N] = 'open';
    entrances.push({ x: x0 + size + 70, y: y0 + (k + 0.5) * C, side: 'e' });
    exteriorOpenings.push({ x: x0 + size, y: y0 + (k + 0.5) * C, angle: Math.PI / 2, length: C - 10 });
  }
  for (const k of pickCols(2, [])) if (h[N][k] === 'wall') h[N][k] = 'window';
  for (const k of pickCols(1, [gateCol])) if (h[0][k] === 'wall') h[0][k] = 'window';
  for (const k of pickCols(1, [])) if (v[k][0] === 'wall') v[k][0] = 'window';
  for (const k of pickCols(1, [])) if (v[k][N] === 'wall') v[k][N] = 'window';

  // Convert edges into merged wall segments plus window segments.
  const walls: WallSeg[] = [];
  const windows: OpeningSpot[] = [];
  const pushWall = (ax: number, ay: number, bx: number, by: number): void => {
    walls.push({ ax, ay, bx, by, kind: 'warehouse', vision: true, move: true });
  };
  for (let r = 0; r <= N; r++) {
    let runStart = -1;
    for (let c = 0; c <= N; c++) {
      const e = c < N ? h[r][c] : 'open';
      if (e === 'wall') {
        if (runStart < 0) runStart = c;
      } else {
        if (runStart >= 0) pushWall(x0 + runStart * C, y0 + r * C, x0 + c * C, y0 + r * C);
        runStart = -1;
        if (e === 'window') {
          const cx = x0 + (c + 0.5) * C;
          const y = y0 + r * C;
          pushWall(x0 + c * C, y, cx - 35, y);
          pushWall(cx + 35, y, x0 + (c + 1) * C, y);
          walls.push({ ax: cx - 35, ay: y, bx: cx + 35, by: y, kind: 'window', vision: false, move: true });
          windows.push({ x: cx, y, angle: 0, length: 70 });
        }
      }
    }
  }
  for (let c = 0; c <= N; c++) {
    let runStart = -1;
    for (let r = 0; r <= N; r++) {
      const e = r < N ? v[r][c] : 'open';
      if (e === 'wall') {
        if (runStart < 0) runStart = r;
      } else {
        if (runStart >= 0) pushWall(x0 + c * C, y0 + runStart * C, x0 + c * C, y0 + r * C);
        runStart = -1;
        if (e === 'window') {
          const cy = y0 + (r + 0.5) * C;
          const x = x0 + c * C;
          pushWall(x, y0 + r * C, x, cy - 35);
          pushWall(x, cy + 35, x, y0 + (r + 1) * C);
          walls.push({ ax: x, ay: cy - 35, bx: x, by: cy + 35, kind: 'window', vision: false, move: true });
          windows.push({ x, y: cy, angle: Math.PI / 2, length: 70 });
        }
      }
    }
  }

  // Exit yard beyond the gate: chain-link fence (blocks movement, not sight).
  const gx = x0 + (gateCol + 0.5) * C;
  const yardW = 300;
  const yardH = 250;
  const fence = (ax: number, ay: number, bx: number, by: number): void => {
    walls.push({ ax, ay, bx, by, kind: 'yard', vision: false, move: true });
  };
  fence(gx - yardW / 2, y0, gx - yardW / 2, y0 - yardH);
  fence(gx + yardW / 2, y0, gx + yardW / 2, y0 - yardH);
  fence(gx - yardW / 2, y0 - yardH, gx + yardW / 2, y0 - yardH);

  // Barricades in a subset of doorways and exterior entrances.
  const barricadeSpots: OpeningSpot[] = [];
  const cellCenter = (r: number, c: number): Spot => ({ x: x0 + (c + 0.5) * C, y: y0 + (r + 0.5) * C });
  for (const [r0, c0, r1, c1] of rng.shuffle(doorways.slice())) {
    if (barricadeSpots.length >= 7) break;
    if (edgeBetween(r0, c0, r1, c1) !== 'open') continue;
    const mixed = room[r0 * N + c0] !== room[r1 * N + c1];
    if (!mixed && !rng.chance(0.15)) continue;
    if (!rng.chance(0.45)) continue;
    const a = cellCenter(r0, c0);
    const b = cellCenter(r1, c1);
    const spot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: r0 === r1 ? Math.PI / 2 : 0, length: C - 10 };
    if (barricadeSpots.some((s) => Math.hypot(s.x - spot.x, s.y - spot.y) < C * 1.5)) continue;
    barricadeSpots.push(spot);
  }
  for (const o of exteriorOpenings) if (rng.chance(0.5)) barricadeSpots.push(o);

  // Generator rooms: the largest rooms with space for racks around the generator.
  const roomOrder = rooms.map((rr, i) => ({ rr, i })).sort((a, b) => b.rr.w * b.rr.h - a.rr.w * a.rr.h);
  const generatorSpots: Spot[] = [];
  const racks: Rect[] = [];
  const genRooms = new Set<number>();
  for (const { rr, i } of roomOrder) {
    if (generatorSpots.length >= 2) break;
    if (Math.max(rr.w, rr.h) < 3 || Math.min(rr.w, rr.h) < 2) continue;
    const cx = x0 + (rr.x + rr.w / 2) * C;
    const cy = y0 + (rr.y + rr.h / 2) * C;
    generatorSpots.push({ x: cx, y: cy });
    genRooms.add(i);
    if (rr.h >= rr.w) {
      const L = Math.min(150, rr.w * C - 110);
      racks.push({ x: cx - L / 2, y: cy - 128, w: L, h: 36 });
      racks.push({ x: cx - L / 2, y: cy + 92, w: L, h: 36 });
    } else {
      const L = Math.min(150, rr.h * C - 110);
      racks.push({ x: cx - 128, y: cy - L / 2, w: 36, h: L });
      racks.push({ x: cx + 92, y: cy - L / 2, w: 36, h: L });
    }
  }
  const barrels: Spot[] = [];
  const stakeSpots: Spot[] = [];
  rooms.forEach((rr, i) => {
    if (genRooms.has(i)) return;
    const cx = x0 + (rr.x + rr.w / 2) * C;
    const cy = y0 + (rr.y + rr.h / 2) * C;
    if (rng.chance(0.65)) {
      if (rr.w >= rr.h) {
        const L = Math.min(140, rr.w * C - 110);
        racks.push({ x: cx - L / 2, y: cy - 18, w: L, h: 36 });
      } else {
        const L = Math.min(140, rr.h * C - 110);
        racks.push({ x: cx - 18, y: cy - L / 2, w: 36, h: L });
      }
      barrels.push({ x: x0 + rr.x * C + 34, y: y0 + rr.y * C + 34 });
    } else {
      barrels.push({ x: cx, y: cy });
    }
    if (rr.w * rr.h >= 4 && rng.chance(0.4)) stakeSpots.push({ x: x0 + (rr.x + rr.w) * C - 40, y: y0 + (rr.y + rr.h) * C - 40 });
  });
  for (const rk of racks) {
    walls.push({ ax: rk.x, ay: rk.y, bx: rk.x + rk.w, by: rk.y, kind: 'rack', vision: true, move: true });
    walls.push({ ax: rk.x + rk.w, ay: rk.y, bx: rk.x + rk.w, by: rk.y + rk.h, kind: 'rack', vision: true, move: true });
    walls.push({ ax: rk.x + rk.w, ay: rk.y + rk.h, bx: rk.x, by: rk.y + rk.h, kind: 'rack', vision: true, move: true });
    walls.push({ ax: rk.x, ay: rk.y + rk.h, bx: rk.x, by: rk.y, kind: 'rack', vision: true, move: true });
  }

  // Lockers against corridor walls, facing into the corridor.
  const lockers: WarehouseResult['lockers'] = [];
  const corridorCells: number[] = [];
  for (let k = 0; k < N * N; k++) if (room[k] < 0) corridorCells.push(k);
  for (const k of rng.shuffle(corridorCells.slice())) {
    if (lockers.length >= 8) break;
    const r = Math.floor(k / N);
    const c = k % N;
    const sides: [Edge, number, number][] = [
      [h[r][c], 0, -1],
      [h[r + 1][c], 0, 1],
      [v[r][c], -1, 0],
      [v[r][c + 1], 1, 0],
    ];
    const wallSides = sides.filter(([e]) => e === 'wall');
    if (!wallSides.length) continue;
    const [, dx, dy] = rng.pick(wallSides);
    const cc = cellCenter(r, c);
    const x = cc.x + dx * (C / 2 - 20);
    const y = cc.y + dy * (C / 2 - 20);
    if (lockers.some((l) => Math.hypot(l.x - x, l.y - y) < C * 1.5)) continue;
    const facing = Math.atan2(-dy, -dx);
    lockers.push({ x, y, facing, exitX: x - dx * 42, exitY: y - dy * 42 });
  }

  const lootSpots: Spot[] = [];
  const lampSpots: Spot[] = [];
  for (let k = 0; k < N * N; k++) {
    const r = Math.floor(k / N);
    const c = k % N;
    const cc = cellCenter(r, c);
    if (rng.chance(0.2)) lootSpots.push({ x: cc.x + rng.range(-30, 30), y: cc.y + rng.range(-30, 30) });
    if (rng.chance(0.06)) lampSpots.push(cc);
  }
  if (!stakeSpots.length) stakeSpots.push(cellCenter(N - 1, rng.int(0, N - 1)));

  return {
    walls,
    barricadeSpots,
    windows,
    lockers,
    barrels,
    racks,
    generatorSpots,
    lootSpots,
    stakeSpots,
    lampSpots,
    gate: { x: gx, y: y0, angle: 0, length: C, leverX: gx + C / 2 - 24, leverY: y0 + 30 },
    entrances,
  };
}
