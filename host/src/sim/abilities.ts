import { BALANCE, Health, burstSag } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';

const H = BALANCE.hunter;

/** Ids of everyone who should see what hunter `h` sees (h plus spectators following h). */
function hunterAudience(w: World, h: SimPlayer): number[] {
  return w.order.filter((p) => p.id === h.id || ((p.role === 'spectator' || p.health === Health.Eliminated || p.health === Health.Escaped) && p.spectating === h.id)).map((p) => p.id);
}

/**
 * Soundcloud Burst (F): Zach fires an aimed wave of sound, a slightly concave lens of fixed
 * width that flies across the whole map through every wall. Each survivor it passes is
 * jump-scared: their screen is covered for a few seconds.
 */
export function tryBurst(w: World, h: SimPlayer, aim: number): void {
  if (h.burstCd > 0 || !abilitiesOn(h)) return;
  h.burstCd = H.burst.cooldown;
  w.bursts.push({ x: h.move.x, y: h.move.y, dx: Math.cos(aim), dy: Math.sin(aim), t0: w.time, by: h.id, hit: new Set() });
  w.emit('all', { k: 'burst', x: Math.round(h.move.x), y: Math.round(h.move.y), a: aim });
}

/** Zach's abilities are all switched off while the Grapes of Wrath has him (and with him knocked out). */
export function abilitiesOn(h: SimPlayer): boolean {
  return h.role === 'hunter' && h.abilityLockT <= 0 && h.health !== Health.Eliminated && h.knockT <= 0;
}

/**
 * Hemp Battery (Q): switches it on or off. On, it gives a wider view, light through walls and a
 * speed boost while its charge lasts (see `updateHemp`); drained dry it's locked for a few seconds.
 */
export function tryHemp(w: World, h: SimPlayer): void {
  if (!abilitiesOn(h)) return;
  if (h.hempOn) {
    h.hempOn = false;
    return;
  }
  if (h.hempLock > 0 || (h.hemp !== 2 && h.hempLeft <= 0)) return;
  h.hempOn = true;
  w.emit('all', { k: 'hemp', by: h.id });
}

/** Drains the charge while it's on, refills it while it's off; `hempT` is 0 or a short grace, so the buffs match use exactly. */
function updateHemp(w: World, h: SimPlayer, dt: number): void {
  const HB = H.hemp;
  h.hempLock = Math.max(0, h.hempLock - dt);
  if (h.hempOn && !abilitiesOn(h)) h.hempOn = false;
  if (h.hempOn) {
    // Testing mode: the battery never runs down.
    if (!w.testMode && h.hemp !== 2) h.hempLeft = Math.max(0, h.hempLeft - dt);
    if (h.hempLeft <= 0) {
      h.hempOn = false;
      h.hempLock = HB.lockout;
      w.emit([h.id], { k: 'item', text: 'Hemp Battery drained' });
    }
  } else {
    h.hempLeft = Math.min(HB.duration, h.hempLeft + (dt * HB.duration) / HB.recover);
  }
  h.move.hempT = h.hempOn ? HB.grace : 0;
}

/**
 * JARVIS (Q, survivors with Sexton's tablet): for 10 s everyone's whole screen is visible;
 * its user also gets the whole map revealed and sees Zach on it.
 */
export function tryJarvis(w: World, p: SimPlayer): void {
  if (p.jarvis !== 1 && p.jarvis !== 3) return;
  if (p.health === Health.Eliminated || p.health === Health.Escaped) return;
  if (p.jarvis === 1) p.jarvis = 2;
  p.jarvisT = BALANCE.sexton.jarvisRadarSec;
  w.revealT = BALANCE.sexton.jarvisRadarSec;
  w.emit('all', { k: 'jarvis', by: p.id });
}

/** Scent trail points near a hunter (or a survivor in testing mode) not sent yet. */
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
    pts.push(Math.round(t.x), Math.round(t.y), t.kind, Math.round((w.time - t.t) * 10), t.who);
    if (pts.length >= 500) break;
  }
  if (pts.length) w.emit(hunterAudience(w, h), { k: 'trail', pts });
}

export function updateAbilities(w: World, dt: number): void {
  w.revealT = Math.max(0, w.revealT - dt);
  const sendNow = Math.floor(w.time / H.scent.sendEvery) !== Math.floor((w.time - dt) / H.scent.sendEvery);
  for (const h of w.order) {
    // Testing mode: survivors see their own scent trail.
    if (h.role === 'survivor' && w.testMode && sendNow) sendScent(w, h);
    if (h.role !== 'hunter') continue;
    h.burstCd = Math.max(0, h.burstCd - dt);
    // Testing mode: Zach's abilities never cool down.
    if (w.testMode) {
      h.burstCd = 0;
      h.vapeCd = 0;
      h.move.lungeCharges = H.lunge.charges + h.jadenBonus * H.jadenSlain.lunge;
      h.hempLock = 0;
      h.move.lungeRecharge = 0;
    }
    h.abilityLockT = Math.max(0, h.abilityLockT - dt);
    updateHemp(w, h, dt);
    // The scent is always on.
    if (sendNow && h.health !== Health.Eliminated) sendScent(w, h);
  }
  // Forget trail ids that expired.
  if (sendNow) {
    const live = new Set(w.trails.map((t) => t.id));
    for (const sent of w.trailSent.values()) for (const id of sent) if (!live.has(id)) sent.delete(id);
  }

  // Soundcloud Burst waves fly straight on, through everything. Tested against the swept
  // band between last tick's and this tick's front so nothing slips between ticks.
  const B = H.burst;
  const maxD = Math.hypot(w.map.width, w.map.height) + B.width;
  w.bursts = w.bursts.filter((b) => {
    const front = B.speed * (w.time - b.t0);
    const prev = Math.max(0, front - B.speed * dt);
    for (const p of w.order) {
      if (p.role !== 'survivor' || b.hit.has(p.id)) continue;
      if (p.health === Health.Escaped || p.health === Health.Eliminated) continue;
      const rx = p.move.x - b.x;
      const ry = p.move.y - b.y;
      const along = rx * b.dx + ry * b.dy;
      const side = rx * -b.dy + ry * b.dx;
      if (Math.abs(side) > B.width / 2 + p.radius) continue;
      const sag = burstSag(Math.min(Math.abs(side), B.width / 2));
      if (along < prev - B.thickness - sag - p.radius || along > front + sag + p.radius) continue;
      b.hit.add(p.id);
      p.scareT = B.scareTime;
      w.emit([p.id], { k: 'scare' });
    }
    // The wave also stuns NPCs that are being aggressive: an alerted Jaden, a raging Plasma, a defending Sexton.
    const jd = w.jaden;
    const px = w.plasma;
    const sx = w.sexton;
    const npcs: [number, boolean, { x: number; y: number }, number, () => void][] = [
      [-1, jd.alive && jd.mode === 'chase', jd, BALANCE.jaden.radius, () => (jd.stunT = Math.max(jd.stunT, B.npcStun))],
      [-2, px.alive && px.raging, px, px.radius, () => (px.stunT = Math.max(px.stunT, B.npcStun))],
      [-3, sx.alive && sx.defending, sx, BALANCE.sexton.radius, () => (sx.stunT = Math.max(sx.stunT, B.npcStun))],
    ];
    for (const [key, aggressive, n, r, stun] of npcs) {
      if (!aggressive || b.hit.has(key)) continue;
      const rx = n.x - b.x;
      const ry = n.y - b.y;
      const along = rx * b.dx + ry * b.dy;
      const side = rx * -b.dy + ry * b.dx;
      if (Math.abs(side) > B.width / 2 + r) continue;
      const sag = burstSag(Math.min(Math.abs(side), B.width / 2));
      if (along < prev - B.thickness - sag - r || along > front + sag + r) continue;
      b.hit.add(key);
      stun();
    }
    return prev < maxD;
  });
}
