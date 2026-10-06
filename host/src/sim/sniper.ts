import { BALANCE, BarricadeState, Health, ItemKind, pointSegDist2, rayCircle, raySegment } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { hurtHunter, hurtSurvivor } from './combat';
import { canAct } from './player';
import { selected } from './inventory';

const S = BALANCE.items.sniper;

/** Something along the bullet's path it breaks when it gets there: `t` units along. */
interface PathEvent {
  t: number;
  kind: 'window' | 'door' | 'barricade' | 'gen';
  i: number;
}

/** A 0.50 cal round in flight: it pierces everything and never stops. */
export interface Bullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  front: number;
  by: number;
  hit: Set<unknown>;
  path: PathEvent[];
}

/** Fires the 0.50 cal: a round that flies at `speed` through all material, no range limit. */
export function fireSniper(w: World, p: SimPlayer, aim: number): void {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const x = p.move.x + dx * (p.radius + 2);
  const y = p.move.y + dy * (p.radius + 2);
  const path: PathEvent[] = [];
  const ms = w.geo.moveSeg;
  w.geo.windowSegs.forEach((m, i) => {
    if (w.windowsBroken[i]) return;
    const o = m * 4;
    const t = raySegment(x, y, dx, dy, ms[o], ms[o + 1], ms[o + 2], ms[o + 3]);
    if (t < Infinity) path.push({ t, kind: 'window', i });
  });
  w.map.doors.forEach((d, i) => {
    if (w.doors[i] || w.doorBroken[i]) return;
    const t = raySegment(x, y, dx, dy, d.hx, d.hy, d.hx + Math.cos(d.angle) * d.length, d.hy + Math.sin(d.angle) * d.length);
    if (t < Infinity) path.push({ t, kind: 'door', i });
  });
  w.map.barricades.forEach((b, i) => {
    if (w.barricades[i] !== BarricadeState.Down) return;
    const ux = Math.cos(b.angle) * (b.length / 2);
    const uy = Math.sin(b.angle) * (b.length / 2);
    const t = raySegment(x, y, dx, dy, b.x - ux, b.y - uy, b.x + ux, b.y + uy);
    if (t < Infinity) path.push({ t, kind: 'barricade', i });
  });
  w.map.generators.forEach((g, i) => {
    if (w.gens[i].repaired) return;
    const t = rayCircle(x, y, dx, dy, g.x, g.y, 36);
    if (t < Infinity) path.push({ t, kind: 'gen', i });
  });
  path.sort((a, b) => a.t - b.t);
  w.snipes.push({ x, y, dx, dy, front: 0, by: p.id, hit: new Set(), path });
  w.emit('all', { k: 'snipe', x: Math.round(x), y: Math.round(y), a: aim });
  w.noise(p.move.x, p.move.y, 2400, 'shot');
}

export function updateSnipes(w: World, dt: number): void {
  for (const p of w.order) if (!p.laserId && laserHolder(p)) p.laserId = w.allocEntityId();
  const maxD = Math.hypot(w.map.width, w.map.height) + 100;
  w.snipes = w.snipes.filter((b) => {
    const prev = b.front;
    b.front += S.speed * dt;
    const ax = b.x + b.dx * prev;
    const ay = b.y + b.dy * prev;
    const bx = b.x + b.dx * b.front;
    const by = b.y + b.dy * b.front;
    const shooter = w.players.get(b.by);
    // Everything it passes through on the way: glass, doors, barricades and generators.
    for (const e of b.path) {
      if (e.t <= prev || e.t > b.front) continue;
      const px = b.x + b.dx * e.t;
      const py = b.y + b.dy * e.t;
      if (e.kind === 'window') {
        if (!w.windowsBroken[e.i]) {
          w.breakWindow(e.i);
          w.noise(px, py, 800, 'glass');
        }
      } else if (e.kind === 'door') {
        if (!w.doorBroken[e.i]) {
          w.setDoor(e.i, true);
          w.doorBroken[e.i] = true;
          w.noise(px, py, 900, 'door_smash');
        }
      } else if (e.kind === 'barricade') {
        if (w.barricades[e.i] === BarricadeState.Down) {
          w.setBarricade(e.i, BarricadeState.Broken);
          w.noise(px, py, 700, 'smash');
        }
      } else {
        const g = w.gens[e.i];
        if (!g.repaired) {
          g.progress = Math.max(0, g.progress - S.genDamage);
          w.noise(px, py, 900, 'gen_explode');
        }
      }
    }
    // People and NPCs it passes through, once each.
    for (const q of w.order) {
      if (q.id === b.by || b.hit.has(`p${q.id}`)) continue;
      const r = q.radius + S.hitRadius;
      if (pointSegDist2(q.move.x, q.move.y, ax, ay, bx, by) > r * r) continue;
      if (q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2) {
        b.hit.add(`p${q.id}`);
        // One shot downs a survivor outright.
        hurtSurvivor(w, q, 10, shooter ?? null, 'bullet');
      } else if (q.role === 'hunter' && q.health !== Health.Eliminated) {
        b.hit.add(`p${q.id}`);
        hurtHunter(w, q, S.zachHp, shooter ?? null, 'bullet');
        // Shoved back hard, his sprint gone for a few seconds.
        q.move.kbT = S.kbDuration;
        q.move.kbDur = S.kbDuration;
        q.move.kbPeak = S.kbPeak;
        q.move.kbAng = Math.atan2(b.dy, b.dx);
        q.move.lungeT = 0;
        q.move.staminaLock = Math.max(q.move.staminaLock, S.sprintLock);
        q.move.sprintBlocked = 1;
        w.feed(`${shooter?.name ?? 'Someone'} hit ${q.name} with a 0.50 cal`);
      }
    }
    if (shooter) {
      for (const n of w.npcTargets()) {
        if (b.hit.has(n)) continue;
        const r = n.hitRadius + S.hitRadius;
        if (pointSegDist2(n.x, n.y, ax, ay, bx, by) > r * r) continue;
        b.hit.add(n);
        if (n === w.jaden) w.jaden.snipe(shooter);
        else if (n === w.plasma) w.plasma.snipe(shooter);
        else n.itemHit(shooter, 'shot');
      }
    }
    return b.front < maxD;
  });
}

/** A survivor holding the 0.50 cal with it up: its laser shows to everyone. */
export function laserHolder(p: SimPlayer): boolean {
  if (p.role !== 'survivor' || !canAct(p) || p.hideState !== 0) return false;
  return selected(p)?.kind === ItemKind.Sniper;
}
