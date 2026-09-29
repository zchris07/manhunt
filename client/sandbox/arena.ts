import { Rng, poissonDisc, type CircleDef, type SegmentDef } from '@manhunt/shared';

export interface ArenaTree extends CircleDef {
  kind: 'pine' | 'dead' | 'boulder';
  variant: number;
}

export interface Arena {
  width: number;
  height: number;
  segments: SegmentDef[];
  trees: ArenaTree[];
  lights: { x: number; y: number; radius: number; kind: 'campfire' | 'lamp' }[];
  loot: { x: number; y: number };
  enemyPath: [number, number][];
  spawn: { x: number; y: number };
}

/** A small hand-built test arena: a ruined building with rooms beside a dense forest. */
export function buildArena(seed = 7): Arena {
  const rng = new Rng(seed);
  const W = 2400;
  const H = 2400;
  const segments: SegmentDef[] = [];
  const wall = (ax: number, ay: number, bx: number, by: number): void => {
    segments.push({ ax, ay, bx, by, vision: true, move: true });
  };
  // Outer boundary.
  wall(0, 0, W, 0);
  wall(W, 0, W, H);
  wall(W, H, 0, H);
  wall(0, H, 0, 0);

  // Building: 700x700 at (200,850) with interior rooms and door gaps.
  const bx = 200;
  const by = 850;
  const s = 700;
  wall(bx, by, bx + 300, by);
  wall(bx + 380, by, bx + s, by);
  wall(bx + s, by, bx + s, by + 260);
  wall(bx + s, by + 340, bx + s, by + s);
  wall(bx + s, by + s, bx, by + s);
  wall(bx, by + s, bx, by);
  // Interior partitions.
  wall(bx + 350, by, bx + 350, by + 220);
  wall(bx + 350, by + 300, bx + 350, by + 460);
  wall(bx, by + 460, bx + 240, by + 460);
  wall(bx + 320, by + 460, bx + s, by + 460);
  wall(bx + 500, by + 460, bx + 500, by + 600);
  // L-shaped walls in the yard.
  wall(1100, 400, 1400, 400);
  wall(1400, 400, 1400, 650);
  wall(1000, 1800, 1000, 2100);
  wall(1000, 2100, 1250, 2100);
  // Pillars.
  for (const [px, py] of [
    [1200, 1150],
    [1300, 1350],
  ]) {
    wall(px, py, px + 50, py);
    wall(px + 50, py, px + 50, py + 50);
    wall(px + 50, py + 50, px, py + 50);
    wall(px, py + 50, px, py);
  }

  const inBuilding = (x: number, y: number): boolean => x > bx - 60 && x < bx + s + 60 && y > by - 60 && y < by + s + 60;
  const nearWall = (x: number, y: number): boolean =>
    segments.some((sg) => {
      const dx = sg.bx - sg.ax;
      const dy = sg.by - sg.ay;
      const l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - sg.ax) * dx + (y - sg.ay) * dy) / l2));
      return Math.hypot(x - (sg.ax + dx * t), y - (sg.ay + dy * t)) < 60;
    });

  const spawn = { x: 1000, y: 1250 };
  const trees: ArenaTree[] = [];
  const pts = poissonDisc(rng, 40, 40, W - 40, H - 40, 78, (x, y) => {
    if (inBuilding(x, y) || nearWall(x, y)) return false;
    if (Math.hypot(x - spawn.x, y - spawn.y) < 160) return false;
    // Keep the dense forest mostly on the right, thinner on the left.
    return x > 1300 || rng.chance(0.25);
  });
  for (const [x, y] of pts) {
    const roll = rng.next();
    const kind = roll < 0.55 ? 'pine' : roll < 0.9 ? 'dead' : 'boulder';
    const r = kind === 'boulder' ? rng.range(22, 34) : rng.range(12, 20);
    trees.push({ x, y, r, vision: true, move: true, kind, variant: rng.int(0, 3) });
  }

  const lights: Arena['lights'] = [
    { x: 1700, y: 700, radius: 360, kind: 'campfire' },
    { x: 1900, y: 1500, radius: 360, kind: 'campfire' },
    { x: 1500, y: 2050, radius: 360, kind: 'campfire' },
    { x: 380, y: 1000, radius: 300, kind: 'lamp' },
    { x: 700, y: 1450, radius: 300, kind: 'lamp' },
    { x: 1250, y: 520, radius: 300, kind: 'lamp' },
  ];
  // Clear trees from under the lights.
  const cleared = trees.filter((t) => lights.every((l) => Math.hypot(t.x - l.x, t.y - l.y) > 70));

  return {
    width: W,
    height: H,
    segments,
    trees: cleared,
    lights,
    loot: { x: 1180, y: 1000 },
    enemyPath: [
      [1500, 1000],
      [1700, 1300],
      [1450, 1600],
      [1150, 1450],
      [1250, 900],
    ],
    spawn,
  };
}
