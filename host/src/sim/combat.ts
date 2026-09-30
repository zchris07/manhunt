import { Action, BALANCE, BarricadeState, Btn, DEG, Health, angleDiff, closestOnSeg, pointSegDist2, resolveOverlaps } from '@manhunt/shared';
import { HISTORY_TICKS, type SimPlayer } from './player';
import { eliminate, type World } from './World';

const H = BALANCE.hunter;

function canSwing(h: SimPlayer): boolean {
  return !h.carrying && h.attackCd <= 0 && h.attackWindup <= 0 && h.action === Action.None && h.stunT <= 0 && h.move.lungeT <= 0;
}

/** Left click pressed: start charging a swing (released in updateCombat). */
export function startCharge(h: SimPlayer): void {
  if (h.chargeT < 0 && canSwing(h)) {
    h.chargeT = 0;
    h.chargeHeld = 0;
  }
}

/** Starts a swing (resolved after the wind-up). A heavy swing is a fully charged one. */
export function attemptAttack(w: World, h: SimPlayer, heavy = false): void {
  if (!canSwing(h)) return;
  h.heavy = heavy;
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
  const reach = H.attack.range * (h.heavy ? C.rangeMul : 1) + BALANCE.net.hunterHitTolerance;
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
    damageSurvivor(w, best, h);
    if (h.heavy) damageSurvivor(w, best, h);
    hit = true;
  } else if (w.sexton.alive && inSwipe(h, w.sexton.x, w.sexton.y, BALANCE.sexton.radius) && w.geo.hasLineOfSight(h.move.x, h.move.y, w.sexton.x, w.sexton.y)) {
    w.sexton.hit(h);
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
      damageSurvivor(w, q, h);
      h.lungeHit = true;
      h.move.lungeT = 0;
      h.attackCd = Math.max(h.attackCd, H.attack.hitCooldown * 0.6);
      h.move.slowT = H.attack.hitCooldown * H.hitSlowFraction * 0.6;
      h.move.slowMul = H.attack.hitSlowMul;
      w.emit(w.near(h.move.x, h.move.y, BALANCE.net.maxSensingRadius), { k: 'swing', id: h.id, hit: true });
      return;
    }
  }
  const sx = w.sexton;
  if (sx.alive) {
    const r = reach + BALANCE.sexton.radius;
    if (pointSegDist2(sx.x, sx.y, fromX, fromY, h.move.x, h.move.y) <= r * r) {
      sx.hit(h);
      h.lungeHit = true;
      h.move.lungeT = 0;
    }
  }
}

/** One hit: Healthy -> Wounded -> Downed. */
export function damageSurvivor(w: World, q: SimPlayer, h: SimPlayer): void {
  if (q.health !== Health.Healthy && q.health !== Health.Wounded) return;
  w.cancelAction(q);
  h.stats.hits++;
  w.emit('all', { k: 'hit', victim: q.id, by: h.id, x: Math.round(q.move.x), y: Math.round(q.move.y) });
  if (q.health === Health.Healthy) {
    q.health = Health.Wounded;
    q.move.hasteT = BALANCE.survivor.hitHasteTime;
  } else {
    q.health = Health.Downed;
    q.move.hasteT = 0;
    q.gogglesOn = false;
    h.stats.downs++;
    w.emit('all', { k: 'down', victim: q.id });
    w.feed(`${q.name} is down`);
  }
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
  q.health = Health.Wounded;
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
      if (p.chargeT >= 0) {
        const C = H.attack.charge;
        if (!canSwing(p)) p.chargeT = -1;
        else if (p.lastCmd.buttons & Btn.Primary && p.chargeHeld + dt < C.autoRelease) {
          p.chargeHeld += dt;
          p.chargeT = Math.min(C.max, p.chargeT + dt);
          p.move.slowT = Math.max(p.move.slowT, 0.1);
          p.move.slowMul = Math.min(p.move.slowMul, 1 - (1 - C.slowMul) * (p.chargeT / C.max));
        } else {
          // Released (or held too long): strike.
          const heavy = p.chargeT >= C.heavyAt;
          p.chargeT = -1;
          attemptAttack(w, p, heavy);
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
        p.health = Health.Wounded;
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
