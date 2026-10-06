import { BALANCE, DEG, Health, angleDiff } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { hurtSurvivor } from './combat';

const V = BALANCE.hunter.vape;
const HALF = V.halfAngleDeg * DEG;
const LIFE = V.growTime + V.lingerTime + V.fadeTime;

/** A Penjamin cloud: a cone from (x,y) along `a`, growing out to `range`. */
export interface VapeCloud {
  id: number;
  x: number;
  y: number;
  a: number;
  range: number;
  t0: number;
  by: number;
  /** NPCs it already provoked. */
  provoked: Set<string>;
}

/** How far it reaches right now (it grows out over `growTime`, easing off). */
export function vapeExtent(v: VapeCloud, time: number): number {
  const k = Math.min(1, Math.max(0, (time - v.t0) / V.growTime));
  return v.range * (1 - (1 - k) * (1 - k));
}

function inCloud(v: VapeCloud, extent: number, x: number, y: number): boolean {
  const d = Math.hypot(x - v.x, y - v.y);
  if (d > extent) return false;
  if (d < 1) return true;
  return Math.abs(angleDiff(Math.atan2(y - v.y, x - v.x), v.a)) <= HALF;
}

/** Points spread evenly over a disc (centre, an inner ring and an outer ring), as offsets of radius 1. */
const DISC: [number, number][] = [[0, 0]];
for (let i = 0; i < 6; i++) DISC.push([Math.cos((i * Math.PI) / 3) * 0.5, Math.sin((i * Math.PI) / 3) * 0.5]);
for (let i = 0; i < 12; i++) DISC.push([Math.cos((i * Math.PI) / 6 + 0.26) * 0.85, Math.sin((i * Math.PI) / 6 + 0.26) * 0.85]);

/** The share of a body (circle) inside the cloud. */
export function vapeCoverage(v: VapeCloud, extent: number, x: number, y: number, r: number): number {
  let n = 0;
  for (const [ox, oy] of DISC) if (inCloud(v, extent, x + ox * r, y + oy * r)) n++;
  return n / DISC.length;
}

/** Penjamin (Space): a cone of vape gas toward the cursor, reaching past the edge of his screen. */
export function tryVape(w: World, h: SimPlayer, aim: number): void {
  if (h.vapeCharges <= 0 || h.role !== 'hunter' || h.abilityLockT > 0 || h.knockT > 0) return;
  h.vapeCharges--;
  if (h.vapeCd <= 0) h.vapeCd = V.cooldown;
  spawnVape(w, h, aim);
}

export function spawnVape(w: World, h: SimPlayer, aim: number): void {
  // 50 Nic (from Chacko) is Penjamin with half again the reach; the same falloff over the longer range.
  const range = Math.max(V.minView, Math.min(V.maxView, h.viewReach || V.defaultView)) * V.reachMul * (h.nic ? BALANCE.chacko.nicRangeMul : 1);
  spawnVapeAt(w, h.move.x, h.move.y, aim, range, h.id, h.nic);
}

/** A cloud from any spot (testing mode rolls one at a survivor from afar). */
export function spawnVapeAt(w: World, x: number, y: number, aim: number, range: number, by: number, nic = false): void {
  const v: VapeCloud = { id: w.allocEntityId(), x, y, a: aim, range, t0: w.time, by, provoked: new Set() };
  w.vapes.push(v);
  w.emit(w.near(v.x, v.y, BALANCE.net.maxSensingRadius + range), { k: 'vape', x: Math.round(v.x), y: Math.round(v.y), a: aim, r: Math.round(range), nic });
}

/** Puts a survivor under the vape's effects at a given strength (0 = the far end, 1 = point blank). */
export function vapeSurvivor(p: SimPlayer, near: number): void {
  const k = Math.max(0, Math.min(1, near));
  // The strongest slow it got holds while they're in the gas (and `slowAfter` s after); closer to the source raises it.
  p.vapeSlow = Math.max(p.vapeSlowT > 0 ? p.vapeSlow : 0, V.slowFar + (V.slow - V.slowFar) * k);
  p.vapeSlowT = V.slowAfter;
  p.vapeDps = Math.max(p.vapeT > 0 ? p.vapeDps : 0, V.dpsFar + (V.dps - V.dpsFar) * k);
  p.vapeT = V.afterTime;
  p.darkT = V.darkAfter;
}

export function updateVapes(w: World, dt: number): void {
  for (const p of w.order) {
    if (p.role !== 'hunter') continue;
    // Charges come back one at a time, like the lunge's.
    if (w.testMode) {
      p.vapeCharges = V.charges;
      p.vapeCd = 0;
    } else if (p.vapeCharges < V.charges) {
      p.vapeCd -= dt;
      if (p.vapeCd <= 0) {
        p.vapeCharges++;
        p.vapeCd = p.vapeCharges < V.charges ? p.vapeCd + V.cooldown : 0;
      }
    } else p.vapeCd = 0;
  }
  w.vapes = w.vapes.filter((v) => w.time - v.t0 < LIFE);
  for (const v of w.vapes) {
    const ext = vapeExtent(v, w.time);
    const by = w.players.get(v.by);
    for (const p of w.order) {
      if (p.role !== 'survivor' || p.hideState === 2) continue;
      if (p.health !== Health.Healthy && p.health !== Health.Wounded && p.health !== Health.Downed) continue;
      if (vapeCoverage(v, ext, p.move.x, p.move.y, p.radius) < V.coverage) continue;
      vapeSurvivor(p, 1 - Math.hypot(p.move.x - v.x, p.move.y - v.y) / v.range);
    }
    // NPCs that react to being attacked react to the gas too (it doesn't hurt them).
    if (!by) continue;
    const npcs: [string, { x: number; y: number }, () => void][] = [
      ['sexton', w.sexton, () => w.sexton.hit(by, false)],
      ['chris', w.chris, () => w.chris.hit(by, false)],
      ['marc', w.marc, () => w.marc.hit(by, false)],
      ['plasma', w.plasma, () => w.plasma.provoke(by)],
      ['jaden', w.jaden, () => w.jaden.provoke(by)],
      ['waz', w.waz, () => w.waz.hit(by, false)],
      ['chacko', w.chacko, () => w.chacko.hit(by, false)],
    ];
    for (const [key, n, provoke] of npcs) {
      if (v.provoked.has(key) || !inCloud(v, ext, n.x, n.y)) continue;
      v.provoked.add(key);
      provoke();
    }
  }
  // Lingering effects: slowed and choking while in it and a little after; dark a while longer.
  for (const p of w.order) {
    if (p.role !== 'survivor') continue;
    p.darkT = Math.max(0, p.darkT - dt);
    if (p.vapeSlowT > 0) {
      p.vapeSlowT = Math.max(0, p.vapeSlowT - dt);
      p.move.slowT = Math.max(p.move.slowT, 0.1);
      p.move.slowMul = Math.min(p.move.slowMul, 1 - p.vapeSlow);
    }
    if (p.vapeT <= 0) continue;
    p.vapeT = Math.max(0, p.vapeT - dt);
    hurtSurvivor(w, p, p.vapeDps * dt, null, 'gas');
  }
}
