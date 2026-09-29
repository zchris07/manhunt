import { Action, BALANCE, DEG, Health, angleDiff, resolveOverlaps } from '@manhunt/shared';
import { HISTORY_TICKS, type SimPlayer } from './player';
import { eliminate, type World } from './World';

const H = BALANCE.hunter;

/** Starts a swing (resolved after the wind-up). */
export function attemptAttack(_w: World, h: SimPlayer): void {
  if (h.carrying || h.attackCd > 0 || h.attackWindup > 0 || h.action !== Action.None || h.vault || h.stunT > 0) return;
  h.attackWindup = H.attack.windup;
  h.attackFromLunge = h.move.lungeT > 0;
  if (!h.attackFromLunge) {
    h.move.slowT = Math.max(h.move.slowT, H.attack.windup);
    h.move.slowMul = Math.min(h.move.slowMul, 0.85);
  }
}

/** Survivor position as the hunter saw it (lag compensation, capped at maxRewindMs). */
function rewoundPos(w: World, h: SimPlayer, q: SimPlayer): { x: number; y: number } {
  const lagMs = Math.min(BALANCE.net.maxRewindMs, Math.max(0, w.viewLagMs(h.id)));
  const ticks = Math.min(HISTORY_TICKS - 1, Math.round(lagMs / (1000 / BALANCE.net.tickHz)));
  if (ticks <= 0) return { x: q.move.x, y: q.move.y };
  const slot = (((w.tick - ticks) % HISTORY_TICKS) + HISTORY_TICKS) % HISTORY_TICKS;
  return { x: q.history[slot * 2], y: q.history[slot * 2 + 1] };
}

function resolveAttack(w: World, h: SimPlayer): void {
  const reach = H.attack.range + (h.attackFromLunge ? H.lunge.reachBonus : 0) + BALANCE.net.hunterHitTolerance;
  const halfArc = (H.attack.arcDeg / 2) * DEG;
  let best: SimPlayer | null = null;
  let bestD = Infinity;
  for (const q of w.order) {
    if (q.role !== 'survivor' || (q.health !== Health.Healthy && q.health !== Health.Wounded) || q.hideState === 2) continue;
    // Test both the live and the rewound position; the hunter gets the benefit of the doubt.
    for (const pos of [rewoundPos(w, h, q), { x: q.move.x, y: q.move.y }]) {
      const d = Math.hypot(pos.x - h.move.x, pos.y - h.move.y) - q.radius;
      if (d > reach || d >= bestD) continue;
      const a = Math.atan2(pos.y - h.move.y, pos.x - h.move.x);
      if (Math.abs(angleDiff(a, h.facing)) > halfArc && d > h.radius) continue;
      if (!w.geo.hasLineOfSight(h.move.x, h.move.y, pos.x, pos.y)) continue;
      best = q;
      bestD = d;
    }
  }
  if (best) {
    damageSurvivor(w, best, h);
    h.attackCd = H.attack.hitCooldown;
    h.move.slowT = H.attack.hitCooldown * 0.75;
    h.move.slowMul = H.attack.hitSlowMul;
    h.move.lungeT = 0;
    h.lungeHit = true;
  } else {
    h.attackCd = H.attack.missCooldown;
    h.move.slowT = Math.max(h.move.slowT, 0.45);
    h.move.slowMul = Math.min(h.move.slowMul, H.attack.missSlowMul);
    w.noise(h.move.x, h.move.y, 220, 'swing', false);
  }
}

/** One hit: Healthy -> Wounded -> Downed. */
export function damageSurvivor(w: World, q: SimPlayer, h: SimPlayer): void {
  if (q.health !== Health.Healthy && q.health !== Health.Wounded) return;
  if (q.action !== Action.Vault) w.cancelAction(q);
  h.stats.hits++;
  w.emit('all', { k: 'hit', victim: q.id, by: h.id, x: Math.round(q.move.x), y: Math.round(q.move.y) });
  w.noise(q.move.x, q.move.y, 850, 'scream', true);
  if (q.health === Health.Healthy) {
    q.health = Health.Wounded;
    q.move.hasteT = BALANCE.survivor.hitHasteTime;
  } else {
    q.health = Health.Downed;
    q.move.hasteT = 0;
    q.flashHold = 0;
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
  w.noise(h.move.x, h.move.y, 500, 'grunt', false);
}

/** Drops the carried survivor (wiggle free, stun, blind). They get a burst of speed. */
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
  w.noise(stake.x, stake.y, BALANCE.objectives.stakeNoise, 'stake', false);
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
    if (p.blindT > 0) p.blindT = Math.max(0, p.blindT - dt);
    if (p.attackCd > 0) p.attackCd = Math.max(0, p.attackCd - dt);

    if (p.role === 'hunter') {
      if (p.attackWindup > 0) {
        p.attackWindup -= dt;
        if (p.attackWindup <= 0) {
          p.attackWindup = 0;
          resolveAttack(w, p);
        }
      }
      const lunging = p.move.lungeT > 0;
      if (lunging && !p.wasLunging) p.lungeHit = false;
      if (!lunging && p.wasLunging && !p.lungeHit && p.attackWindup <= 0) {
        // Missed lunge: recovery penalty.
        p.move.slowT = Math.max(p.move.slowT, H.lunge.missPenalty);
        p.move.slowMul = Math.min(p.move.slowMul, H.lunge.missSlowMul);
      }
      p.wasLunging = lunging;
      if (p.carrying) {
        const q = w.players.get(p.carrying);
        if (!q || q.health !== Health.Carried) p.carrying = 0;
      }
      continue;
    }

    if (p.role !== 'survivor') continue;
    if (p.health === Health.Staked) {
      p.stakeT -= dt;
      if (p.stakeT <= 0) {
        w.emit('all', { k: 'staked', victim: p.id, stage: 2 });
        eliminate(w, p, 'stake', w.players.get(p.stakedBy));
      }
    } else if (p.health === Health.Carried) {
      const h = w.players.get(p.carriedBy);
      if (!h) {
        p.health = Health.Wounded;
        p.carriedBy = 0;
        continue;
      }
      p.move.x = h.move.x;
      p.move.y = h.move.y;
      if (p.lastCmd.moveX || p.lastCmd.moveY) p.wiggle += dt / BALANCE.survivor.wiggleTime;
      if (p.wiggle >= 1) {
        dropCarried(w, h);
        h.stunT = Math.max(h.stunT, 1.5);
        h.stats.stunnedTimes++;
        w.emit('all', { k: 'stun', target: h.id, kind: 'wiggle' });
      }
    }
  }
}
