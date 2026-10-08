import { Action, BALANCE, BarricadeState, Btn, DEG, Health, angleDiff, closestOnSeg, pointSegDist2, resolveOverlaps } from '@manhunt/shared';
import { HISTORY_TICKS, type SimPlayer } from './player';
import { eliminate, type World } from './World';

const H = BALANCE.hunter;

/** Lunging doesn't stop a swipe: slash and lunge combo freely. */
function canSwing(h: SimPlayer): boolean {
  return !h.carrying && h.attackCd <= 0 && h.attackWindup <= 0 && h.action === Action.None && h.stunT <= 0 && h.knockT <= 0 && h.pump <= 0;
}

/** A charge in progress survives a lunge hit that lands mid-combo. */
function canKeepCharging(h: SimPlayer): boolean {
  return !h.carrying && h.attackWindup <= 0 && h.action === Action.None && h.stunT <= 0 && h.knockT <= 0;
}

/** Left click pressed: start charging a swing (released in updateCombat). */
export function startCharge(h: SimPlayer): void {
  if (h.chargeT < 0 && canSwing(h)) {
    h.chargeT = 0;
    h.chargeHeld = 0;
  }
}

/** Health a swipe charged for `chargeT` s takes: a third, up to two thirds fully charged. */
export function swipeDamage(chargeT: number): number {
  const D = H.attack.damage;
  const C = H.attack.charge;
  // A plain click (held under `tapGrace`) is exactly a third.
  const k = Math.max(0, Math.min(1, (chargeT - D.tapGrace) / (C.heavyAt - D.tapGrace)));
  return D.base + (D.full - D.base) * k;
}

/** Starts a swing (resolved after the wind-up). A heavy swing is a fully charged one. */
export function attemptAttack(w: World, h: SimPlayer, heavy = false, chargeT = 0): void {
  if (!canSwing(h)) return;
  h.heavy = heavy;
  h.swingDamage = swipeDamage(heavy ? H.attack.charge.max : chargeT);
  h.attackWindup = H.attack.windup;
  h.swingT = H.attack.swingTime;
  h.move.slowT = Math.max(h.move.slowT, H.attack.windup);
  h.move.slowMul = Math.min(h.move.slowMul, H.windupSlowMul);
  void w;
}

/** Survivor position as the hunter saw it (lag compensation, capped at maxRewindMs). */
function rewoundPos(w: World, h: SimPlayer, q: SimPlayer): { x: number; y: number } {
  const lagMs = Math.min(BALANCE.net.maxRewindMs, Math.max(0, w.viewLagMs(h.id)));
  const ticks = Math.min(HISTORY_TICKS - 1, Math.round(lagMs / (1000 / BALANCE.net.tickHz)));
  if (ticks <= 0) return { x: q.move.x, y: q.move.y };
  const slot = (((w.tick - ticks) % HISTORY_TICKS) + HISTORY_TICKS) % HISTORY_TICKS;
  return { x: q.history[slot * 2], y: q.history[slot * 2 + 1] };
}

function hittable(q: SimPlayer): boolean {
  return q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2;
}

/** True if (x,y) with radius r is inside the swipe in front of the hunter. */
function inSwipe(h: SimPlayer, x: number, y: number, r: number): boolean {
  const C = H.attack.charge;
  const reach = H.attack.range * (h.heavy ? C.rangeMul : 1) * (h.jadenBonus ? H.jadenSlain.rangeMul : 1) + BALANCE.net.hunterHitTolerance;
  const d = Math.hypot(x - h.move.x, y - h.move.y) - r;
  if (d > reach) return false;
  if (d <= h.radius) return true;
  const a = Math.atan2(y - h.move.y, x - h.move.x);
  return Math.abs(angleDiff(a, h.facing)) <= (H.attack.arcDeg / 2) * DEG * (h.heavy ? C.arcMul : 1) + Math.atan2(r, Math.max(1, d));
}

function resolveAttack(w: World, h: SimPlayer): void {
  let best: SimPlayer | null = null;
  let bestD = Infinity;
  for (const q of w.order) {
    if (!hittable(q)) continue;
    // Test both the live and the rewound position; the hunter gets the benefit of the doubt.
    for (const pos of [rewoundPos(w, h, q), { x: q.move.x, y: q.move.y }]) {
      const d = Math.hypot(pos.x - h.move.x, pos.y - h.move.y);
      if (d >= bestD || !inSwipe(h, pos.x, pos.y, q.radius)) continue;
      if (!w.geo.hasLineOfSight(h.move.x, h.move.y, pos.x, pos.y)) continue;
      best = q;
      bestD = d;
    }
  }
  let hit = false;
  const power = h.heavy ? 2 : 1;
  if (best) {
    damageSurvivor(w, best, h, h.swingDamage);
    hit = true;
  } else if (w.sexton.alive && inSwipe(h, w.sexton.x, w.sexton.y, BALANCE.sexton.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.sexton.x, w.sexton.y)) {
    w.sexton.hit(h);
    hit = true;
  } else if (w.chris.hittable && inSwipe(h, w.chris.x, w.chris.y, BALANCE.chris.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.chris.x, w.chris.y)) {
    w.chris.hit(h);
    hit = true;
  } else if (inSwipe(h, w.marc.x, w.marc.y, BALANCE.marc.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.marc.x, w.marc.y)) {
    w.marc.hit(h);
    hit = true;
  } else if (w.plasma.alive && inSwipe(h, w.plasma.x, w.plasma.y, w.plasma.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.plasma.x, w.plasma.y)) {
    w.plasma.slashHit(h, power);
    hit = true;
  } else if (w.jaden.alive && inSwipe(h, w.jaden.x, w.jaden.y, BALANCE.jaden.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.jaden.x, w.jaden.y)) {
    // Six points (3 heavy swipes, or 6 light) kill him; each hit shoves him back and stuns him briefly.
    w.jaden.slashHit(h, power);
    hit = true;
  } else if (w.njaaron.solid && inSwipe(h, w.njaaron.x, w.njaaron.y, BALANCE.njaaron.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.njaaron.x, w.njaaron.y)) {
    w.njaaron.slashHit(h, power);
    hit = true;
  } else if (w.monique.solid && inSwipe(h, w.monique.x, w.monique.y, BALANCE.monique.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.monique.x, w.monique.y)) {
    w.monique.hit(h);
    hit = true;
  } else if (w.thomas.solid && inSwipe(h, w.thomas.x, w.thomas.y, BALANCE.thomas.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.thomas.x, w.thomas.y)) {
    w.thomas.hit(h);
    hit = true;
  } else if (w.soham.solid && inSwipe(h, w.soham.x, w.soham.y, BALANCE.soham.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.soham.x, w.soham.y)) {
    w.soham.itemHit();
    hit = true;
  } else if (w.chacko.solid && inSwipe(h, w.chacko.x, w.chacko.y, BALANCE.chacko.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.chacko.x, w.chacko.y)) {
    // One hit and he blows up.
    w.chacko.hit(h);
    hit = true;
  } else if (w.waz.solid && inSwipe(h, w.waz.x, w.waz.y, BALANCE.waz.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.waz.x, w.waz.y)) {
    w.waz.hit(h);
    hit = true;
  } else {
    // Two swings break a dropped barricade.
    w.map.barricades.forEach((b, i) => {
      if (hit || w.barricades[i] !== BarricadeState.Down) return;
      const ux = Math.cos(b.angle) * (b.length / 2);
      const uy = Math.sin(b.angle) * (b.length / 2);
      const { x: cx, y: cy } = closestOnSeg(h.move.x, h.move.y, b.x - ux, b.y - uy, b.x + ux, b.y + uy, { x: 0, y: 0 });
      if (!inSwipe(h, cx, cy, 6)) return;
      hit = true;
      w.barricadeHits[i] += power;
      w.noise(cx, cy, 700, 'smash');
      w.emit(w.near(b.x, b.y, BALANCE.net.maxSensingRadius), { k: 'barricadeHit', id: i, hits: w.barricadeHits[i] });
      if (w.barricadeHits[i] >= H.attack.barricadeHits) w.setBarricade(i, BarricadeState.Broken);
    });
    // Two swings smash a closed door (it stays open for good).
    w.map.doors.forEach((d, i) => {
      if (hit || w.doors[i] || w.doorBroken[i]) return;
      const ex = d.hx + Math.cos(d.angle) * d.length;
      const ey = d.hy + Math.sin(d.angle) * d.length;
      const { x: cx, y: cy } = closestOnSeg(h.move.x, h.move.y, d.hx, d.hy, ex, ey, { x: 0, y: 0 });
      if (!inSwipe(h, cx, cy, 6)) return;
      hit = true;
      w.doorHits[i] += power;
      w.noise(cx, cy, 700, 'smash');
      if (w.doorHits[i] >= H.attack.doorHits) {
        w.setDoor(i, true);
        w.doorBroken[i] = true;
        w.noise(cx, cy, 900, 'door_smash');
      }
    });
  }
  // One swipe smashes a window; Zach can climb through the frame afterwards.
  if (!hit) {
    w.geo.windowSegs.forEach((m, i) => {
      if (hit || w.windowsBroken[i]) return;
      const ms = w.geo.moveSeg;
      const o = m * 4;
      const { x: cx, y: cy } = closestOnSeg(h.move.x, h.move.y, ms[o], ms[o + 1], ms[o + 2], ms[o + 3], { x: 0, y: 0 });
      if (!inSwipe(h, cx, cy, 6)) return;
      hit = true;
      w.breakWindow(i);
      w.noise(cx, cy, 800, 'glass');
    });
  }
  h.heavy = false;
  w.emit(w.near(h.move.x, h.move.y, BALANCE.net.maxSensingRadius), { k: 'swing', id: h.id, hit });
  if (hit) {
    h.attackCd = H.attack.hitCooldown;
    h.move.slowT = H.attack.hitCooldown * H.hitSlowFraction;
    h.move.slowMul = H.attack.hitSlowMul;
  } else {
    h.attackCd = H.attack.missCooldown;
    h.move.slowT = Math.max(h.move.slowT, H.missSlowTime);
    h.move.slowMul = Math.min(h.move.slowMul, H.attack.missSlowMul);
  }
}

/**
 * Lunge contact: during the dash Zach's hitbox is 50% larger than his body, and touching a
 * survivor is enough to hit them. Tested along the path moved this tick.
 */
export function lungeContact(w: World, h: SimPlayer, fromX: number, fromY: number): void {
  const reach = h.radius * H.lunge.hitboxMul;
  for (const q of w.order) {
    if (!hittable(q)) continue;
    for (const pos of [rewoundPos(w, h, q), { x: q.move.x, y: q.move.y }]) {
      const r = reach + q.radius + BALANCE.net.hunterHitTolerance * 0.5;
      if (pointSegDist2(pos.x, pos.y, fromX, fromY, h.move.x, h.move.y) > r * r) continue;
      if (!w.geo.hasLineOfSight(h.move.x, h.move.y, pos.x, pos.y)) continue;
      damageSurvivor(w, q, h, H.lunge.damage);
      lungeLanded(h);
      w.emit(w.near(h.move.x, h.move.y, BALANCE.net.maxSensingRadius), { k: 'swing', id: h.id, hit: true });
      return;
    }
  }
  const sx = w.sexton;
  if (sx.alive) {
    const r = reach + BALANCE.sexton.radius;
    if (pointSegDist2(sx.x, sx.y, fromX, fromY, h.move.x, h.move.y) <= r * r) {
      sx.hit(h);
      lungeLanded(h);
      return;
    }
  }
  const cz = w.chris;
  if (cz.hittable) {
    const r = reach + BALANCE.chris.radius;
    if (pointSegDist2(cz.x, cz.y, fromX, fromY, h.move.x, h.move.y) <= r * r) {
      cz.hit(h);
      lungeLanded(h);
      return;
    }
  }
  const mc = w.marc;
  if (pointSegDist2(mc.x, mc.y, fromX, fromY, h.move.x, h.move.y) <= (reach + BALANCE.marc.radius) ** 2) {
    mc.hit(h);
    lungeLanded(h);
    return;
  }
  const pl = w.plasma;
  if (pl.alive && pointSegDist2(pl.x, pl.y, fromX, fromY, h.move.x, h.move.y) <= (reach + pl.radius) ** 2) {
    pl.slashHit(h, 1);
    lungeLanded(h);
    return;
  }
  const jd = w.jaden;
  if (jd.alive && pointSegDist2(jd.x, jd.y, fromX, fromY, h.move.x, h.move.y) <= (reach + BALANCE.jaden.radius) ** 2) {
    jd.slashHit(h, 1);
    lungeLanded(h);
    return;
  }
  for (const [n, r, act] of [
    [w.njaaron, BALANCE.njaaron.radius, () => w.njaaron.slashHit(h, 1)],
    [w.monique, BALANCE.monique.radius, () => w.monique.hit(h)],
    [w.thomas, BALANCE.thomas.radius, () => w.thomas.hit(h)],
  ] as const) {
    if (n.solid && pointSegDist2(n.x, n.y, fromX, fromY, h.move.x, h.move.y) <= (reach + r) ** 2) {
      act();
      lungeLanded(h);
      return;
    }
  }
  const ch = w.chacko;
  if (ch.solid && pointSegDist2(ch.x, ch.y, fromX, fromY, h.move.x, h.move.y) <= (reach + BALANCE.chacko.radius) ** 2) {
    ch.hit(h);
    lungeLanded(h);
    return;
  }
  const wz = w.waz;
  if (wz.solid && pointSegDist2(wz.x, wz.y, fromX, fromY, h.move.x, h.move.y) <= (reach + BALANCE.waz.radius) ** 2) {
    wz.hit(h);
    lungeLanded(h);
  }
}

/** The dash stops on contact. A swipe already charging or winding up still goes off (the combo). */
function lungeLanded(h: SimPlayer): void {
  h.lungeHit = true;
  h.move.lungeT = 0;
  if (h.chargeT >= 0 || h.attackWindup > 0) return;
  h.attackCd = Math.max(h.attackCd, H.attack.hitCooldown);
  h.move.slowT = H.attack.hitCooldown * H.hitSlowFraction;
  h.move.slowMul = H.attack.hitSlowMul;
}

export type HitKind = 'slash' | 'bottle' | 'pellet' | 'beam' | 'punch' | 'bullet' | 'blast' | 'fist';

/**
 * Takes `amount` hp (out of his 100) off Zach. At zero he goes down for a while; Plasma's
 * punches put him down without the lasting slowdown. Gas burns quietly (no flinch).
 */
export function hurtHunter(w: World, h: SimPlayer, amount: number, by: SimPlayer | null, kind: HitKind | 'gas'): void {
  if (h.role !== 'hunter' || h.health === Health.Eliminated || h.knockT > 0 || amount <= 0) return;
  // Soaked in piss, he takes half again as much.
  if (h.pissT > 0 && kind !== 'gas') amount *= BALANCE.items.piss.mul;
  h.hp = Math.max(0, h.hp - amount / H.health.max);
  if (kind !== 'gas') w.emit('all', { k: 'hit', victim: h.id, by: by?.id ?? 0, x: Math.round(h.move.x), y: Math.round(h.move.y), w: kind });
  if (h.hp > 1e-4) return;
  downHunter(w, h, kind !== 'punch' && kind !== 'blast');
  w.feed(kind === 'blast' ? `${h.name} was blown apart` : kind === 'punch' ? `Plasma.TTV knocked ${h.name} out` : by ? `${by.name} put ${h.name} down` : `${h.name} went down`);
}

/** Zach is down: everything he was doing stops, and he drops whoever he carried. */
export function downHunter(w: World, h: SimPlayer, counts: boolean): void {
  h.hp = 0;
  h.knockT = H.health.downTime;
  h.chargeT = -1;
  h.attackWindup = 0;
  h.swingT = 0;
  h.move.lungeT = 0;
  if (h.action !== Action.None) w.cancelAction(h);
  if (h.carrying) dropCarried(w, h);
  if (counts) h.downs++;
  w.emit('all', { k: 'stun', target: h.id, kind: 'down' });
}

/**
 * Takes `amount` (a fraction of full health) off a survivor: they flinch, and at zero they're
 * down. Zach's hits also give them a burst of speed.
 */
export function hurtSurvivor(w: World, q: SimPlayer, amount: number, by: SimPlayer | null, kind: HitKind | 'gas'): void {
  if (q.role !== 'survivor' || (q.health !== Health.Healthy && q.health !== Health.Wounded) || q.hideState === 2) return;
  const zach = by?.role === 'hunter';
  // Gas (Penjamin) burns away quietly: no flinch, and it doesn't stop what you're doing.
  const quiet = kind === 'gas';
  if (!quiet) w.cancelAction(q);
  if (zach && !quiet) by.stats.hits++;
  // A mini-shield bar soaks up damage before health does.
  const soaked = Math.min(q.shield, amount);
  q.shield -= soaked;
  q.hp = Math.max(0, q.hp - (amount - soaked));
  if (!quiet) w.emit('all', { k: 'hit', victim: q.id, by: by?.id ?? 0, x: Math.round(q.move.x), y: Math.round(q.move.y), w: kind });
  if (q.hp > 0.001) {
    q.health = Health.Wounded;
    if (zach && !quiet) q.move.hasteT = BALANCE.survivor.hitHasteTime;
    return;
  }
  if (quiet) w.cancelAction(q);
  q.hp = 0;
  q.health = Health.Downed;
  q.move.hasteT = 0;
  q.gogglesOn = false;
  if (zach) by.stats.downs++;
  w.emit('all', { k: 'down', victim: q.id });
  w.feed(`${q.name} is down`);
}

/** Zach's machete (a third of their health unless charged) or lunge. */
export function damageSurvivor(w: World, q: SimPlayer, h: SimPlayer, amount: number = H.attack.damage.base): void {
  hurtSurvivor(w, q, amount, h, 'slash');
}

/** Sets a survivor's health (back on their feet): full is Healthy, anything less Wounded. */
export function restoreSurvivor(q: SimPlayer, hp: number): void {
  q.hp = Math.max(0.001, Math.min(1, hp));
  q.health = q.hp >= 0.999 ? Health.Healthy : Health.Wounded;
}

export function carrySurvivor(w: World, h: SimPlayer, q: SimPlayer): void {
  w.cancelAction(q);
  q.health = Health.Carried;
  q.carriedBy = h.id;
  q.wiggle = 0;
  h.carrying = q.id;
}

/** Drops the carried survivor (wiggle free or stun). They get a burst of speed. */
export function dropCarried(w: World, h: SimPlayer): void {
  const q = w.players.get(h.carrying);
  h.carrying = 0;
  if (!q) return;
  q.carriedBy = 0;
  restoreSurvivor(q, BALANCE.survivor.reviveHp);
  q.wiggle = 0;
  q.move.x = h.move.x - Math.cos(h.facing) * 30;
  q.move.y = h.move.y - Math.sin(h.facing) * 30;
  q.move.hasteT = BALANCE.survivor.hitHasteTime;
  resolveOverlaps(w.geo, q.move, q.radius);
  w.feed(`${q.name} broke free`);
}

/** Stage 1 on the first staking; a second staking (or the stage timer) is stage 2: eliminated. */
export function stakeSurvivor(w: World, h: SimPlayer, q: SimPlayer, stakeId: number): void {
  h.carrying = 0;
  q.carriedBy = 0;
  q.stakeCount++;
  q.stakedBy = h.id;
  h.stats.stakes++;
  // Every survivor staked buffs Zach for good: faster, and he sees further.
  h.stakeBuff++;
  h.fovMul *= 1 + BALANCE.hunter.stakeBuff;
  w.emit([h.id], { k: 'item', text: `Staked ${q.name}: +${Math.round(BALANCE.hunter.stakeBuff * 100)}% speed and view` });
  const stake = w.map.stakes[stakeId];
  if (q.stakeCount >= 2) {
    q.move.x = stake.x;
    q.move.y = stake.y;
    w.emit('all', { k: 'staked', victim: q.id, stage: 2 });
    eliminate(w, q, 'stake', h);
    return;
  }
  q.health = Health.Staked;
  q.stakeId = stakeId;
  q.stakeStage = 1;
  q.stakeT = BALANCE.objectives.stakeStageTime;
  q.move.x = stake.x;
  q.move.y = stake.y;
  w.stakes[stakeId] = q.id;
  w.emit('all', { k: 'staked', victim: q.id, stage: 1 });
  w.feed(`${q.name} is on a stake`);
}

export function updateCombat(w: World, dt: number): void {
  for (const p of w.order) {
    if (p.stunT > 0) p.stunT = Math.max(0, p.stunT - dt);
    if (p.immuneT > 0) p.immuneT = Math.max(0, p.immuneT - dt);
    if (p.attackCd > 0) p.attackCd = Math.max(0, p.attackCd - dt);
    if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);

    if (p.role === 'hunter') {
      p.reloadT = Math.max(0, p.reloadT - dt);
      // Down: back up after a while at half health. Up: the bar slowly fills again.
      if (p.knockT > 0) {
        p.knockT = Math.max(0, p.knockT - dt);
        if (p.knockT === 0) {
          p.hp = H.health.recoverFraction;
          w.feed(`${p.name} got back up`);
        }
      } else if (p.health !== Health.Eliminated) {
        p.hp = Math.min(1, p.hp + (dt / H.health.regenTime) * (1 + H.stakeRegen * p.stakeBuff) * (p.njaaronRegen ? BALANCE.njaaron.regenMul : 1));
      }
      if (p.chargeT >= 0) {
        const C = H.attack.charge;
        if (!canKeepCharging(p)) p.chargeT = -1;
        else if (p.lastCmd.buttons & Btn.Primary && p.chargeHeld + dt < C.autoRelease) {
          p.chargeHeld += dt;
          p.chargeT = Math.min(C.max, p.chargeT + dt);
          p.move.slowT = Math.max(p.move.slowT, 0.1);
          p.move.slowMul = Math.min(p.move.slowMul, 1 - (1 - C.slowMul) * (p.chargeT / C.max));
        } else {
          // Released (or held too long): strike.
          const heavy = p.chargeT >= C.heavyAt;
          const charged = p.chargeT;
          p.chargeT = -1;
          attemptAttack(w, p, heavy, charged);
        }
      }
      if (p.attackWindup > 0) {
        p.attackWindup -= dt;
        if (p.attackWindup <= 0) {
          p.attackWindup = 0;
          resolveAttack(w, p);
        }
      }
      if (p.carrying) {
        const q = w.players.get(p.carrying);
        if (!q || q.health !== Health.Carried) p.carrying = 0;
      }
      continue;
    }

    if (p.role !== 'survivor') continue;
    if (p.health === Health.Staked) {
      p.stakeT -= dt;
      if (p.stakeT <= 0 && !w.testMode) {
        w.emit('all', { k: 'staked', victim: p.id, stage: 2 });
        eliminate(w, p, 'stake', w.players.get(p.stakedBy));
      }
    } else if (p.health === Health.Carried) {
      const h = w.players.get(p.carriedBy);
      if (!h || h.role !== 'hunter') {
        restoreSurvivor(p, BALANCE.survivor.reviveHp);
        p.carriedBy = 0;
        continue;
      }
      p.move.x = h.move.x;
      p.move.y = h.move.y;
      if (p.lastCmd.moveX || p.lastCmd.moveY) p.wiggle += dt / BALANCE.survivor.wiggleTime;
      if (p.wiggle >= 1) {
        dropCarried(w, h);
        h.stunT = Math.max(h.stunT, H.wiggleStun);
        h.stats.stunnedTimes++;
        w.emit('all', { k: 'stun', target: h.id, kind: 'wiggle' });
      }
    }
  }
}
