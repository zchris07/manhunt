import { BALANCE, Health } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';

const H = BALANCE.hunter;

/** Ids of everyone who should see what hunter `h` sees (h plus spectators following h). */
function hunterAudience(w: World, h: SimPlayer): number[] {
  return w.order.filter((p) => p.id === h.id || ((p.role === 'spectator' || p.health === Health.Eliminated || p.health === Health.Escaped) && p.spectating === h.id)).map((p) => p.id);
}

/**
 * Soundcloud Burst (right click): a ring of sound expands from Zach through every wall. Each
 * survivor it passes is jump-scared: their screen is covered for a few seconds.
 */
export function tryBurst(w: World, h: SimPlayer): void {
  if (h.burstCd > 0) return;
  h.burstCd = H.burst.cooldown;
  w.bursts.push({ x: h.move.x, y: h.move.y, t0: w.time, by: h.id, hit: new Set() });
  w.emit('all', { k: 'burst', x: Math.round(h.move.x), y: Math.round(h.move.y) });
}

/** Hemp Battery (Q): wider view, light through walls and a speed boost for a few seconds. */
export function tryHemp(w: World, h: SimPlayer): void {
  if (h.hemp <= 0) return;
  if (h.hemp === 2 && h.move.hempT > 0) {
    // Testing mode: Q toggles the infinite battery off again.
    h.move.hempT = 0;
    return;
  }
  if (h.move.hempT > 0) return;
  h.move.hempT = H.hemp.duration;
  if (h.hemp === 1) h.hemp = 0;
  w.emit('all', { k: 'hemp', by: h.id });
}

/** JARVIS (Q, survivors with Sexton's tablet): reveals the map and shows Zach for 10 s. */
export function tryJarvis(w: World, p: SimPlayer): void {
  if (p.jarvis !== 1 && p.jarvis !== 3) return;
  if (p.health === Health.Eliminated || p.health === Health.Escaped) return;
  if (p.jarvis === 1) p.jarvis = 2;
  p.jarvisT = BALANCE.sexton.jarvisRadarSec;
  w.emit('all', { k: 'jarvis', by: p.id });
}

/** Scent trail points near a hunter that they haven't been sent yet. */
function sendScent(w: World, h: SimPlayer): void {
  let sent = w.trailSent.get(h.id);
  if (!sent) {
    sent = new Set();
    w.trailSent.set(h.id, sent);
  }
  const pts: number[] = [];
  const r = H.scent.radius;
  for (const t of w.trails) {
    if (sent.has(t.id)) continue;
    if (Math.abs(t.x - h.move.x) > r || Math.abs(t.y - h.move.y) > r) continue;
    sent.add(t.id);
    pts.push(Math.round(t.x), Math.round(t.y), t.kind, Math.round((w.time - t.t) * 10));
    if (pts.length >= 400) break;
  }
  if (pts.length) w.emit(hunterAudience(w, h), { k: 'trail', pts });
}

export function updateAbilities(w: World, dt: number): void {
  const sendNow = Math.floor(w.time / H.scent.sendEvery) !== Math.floor((w.time - dt) / H.scent.sendEvery);
  for (const h of w.order) {
    if (h.role !== 'hunter') continue;
    h.burstCd = Math.max(0, h.burstCd - dt);
    // Testing mode: the battery never runs down while it's on.
    if (h.hemp === 2 && h.move.hempT > 0) h.move.hempT = H.hemp.duration;
    // The scent is always on.
    if (sendNow && h.health !== Health.Eliminated) sendScent(w, h);
  }
  // Forget trail ids that expired.
  if (sendNow) {
    const live = new Set(w.trails.map((t) => t.id));
    for (const sent of w.trailSent.values()) for (const id of sent) if (!live.has(id)) sent.delete(id);
  }

  // Soundcloud Burst rings sweep outward with a fixed width, through everything.
  const B = H.burst;
  const maxR = Math.hypot(w.map.width, w.map.height) + B.width;
  w.bursts = w.bursts.filter((b) => {
    const radius = B.speed * (w.time - b.t0);
    for (const p of w.order) {
      if (p.role !== 'survivor' || b.hit.has(p.id)) continue;
      if (p.health === Health.Escaped || p.health === Health.Eliminated) continue;
      const d = Math.hypot(p.move.x - b.x, p.move.y - b.y);
      if (d > radius + B.width / 2) continue;
      b.hit.add(p.id);
      p.scareT = B.scareTime;
      w.emit([p.id], { k: 'scare' });
    }
    return radius - B.width / 2 < maxR;
  });
}
