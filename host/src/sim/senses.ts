import { Action, BALANCE, Btn, Gait, Health } from '@manhunt/shared';
import type { World } from './World';

const S = BALANCE.survivor;
const HD = BALANCE.hiding;

/** Noise radii (bots), scent and blood trails, terror (bots) and breath-holding. */
export function updateSenses(w: World, dt: number): void {
  const hunters = w.order.filter((p) => p.role === 'hunter' && p.health !== Health.Eliminated);

  for (const p of w.order) {
    if (p.role !== 'survivor') continue;
    let noise = 0;
    if (p.health === Health.Healthy || p.health === Health.Wounded) {
      if (p.hideState === 2) noise = 0;
      else noise = p.gait === Gait.Run ? S.noise.run : p.gait === Gait.Walk ? S.noise.walk : p.gait === Gait.Crouch ? S.noise.crouch : S.noise.idle;
      if (p.action === Action.Repair) noise = Math.max(noise, BALANCE.objectives.repairNoise);
    }
    p.noise = noise;

    // Scent (sprinting) and blood (wounded or downed) for Zach's always-on nose.
    const onGround = p.hideState === 0 && (p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed);
    if (onGround) {
      if (p.move.sprinting && w.time - p.lastScent >= BALANCE.trails.scentEvery) {
        p.lastScent = w.time;
        w.trails.push({ id: w.trailSeq++, x: p.move.x, y: p.move.y, t: w.time, kind: 0, who: p.id });
      }
      if ((p.health === Health.Wounded || p.health === Health.Downed) && w.time - p.lastBlood >= BALANCE.trails.bloodEvery) {
        p.lastBlood = w.time;
        w.trails.push({ id: w.trailSeq++, x: p.move.x + w.rng.range(-6, 6), y: p.move.y + w.rng.range(-6, 6), t: w.time, kind: 1, who: p.id });
      }
    }

    // How close the nearest hunter is (bots use it to decide to hide).
    let terror = 0;
    for (const h of hunters) terror = Math.max(terror, 1 - Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) / 700);
    p.terror = Math.max(0, Math.min(1, terror));

    // Breath: holding it hides your breathing; running out makes you gasp.
    p.gaspCd = Math.max(0, p.gaspCd - dt);
    const wantsHold = p.hideState === 2 && (p.lastCmd.buttons & Btn.Space) !== 0 && p.gaspCd <= 0;
    if (wantsHold && p.breath > 0) {
      p.holdingBreath = true;
      p.breath = Math.max(0, p.breath - dt / HD.breathMax);
      if (p.breath <= 0) {
        p.holdingBreath = false;
        p.gaspCd = HD.gaspCooldown;
        for (const h of hunters) {
          if (Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) < HD.breathingHearRadius * 2) w.emit([h.id], { k: 'breath', x: Math.round(p.move.x), y: Math.round(p.move.y) });
        }
      }
    } else {
      p.holdingBreath = false;
      p.breath = Math.min(1, p.breath + (HD.breathRegen * dt) / HD.breathMax);
    }
    // Zach sees the breath of anyone hiding close by who isn't holding it.
    if (p.hideState === 2 && !p.holdingBreath && Math.floor(w.time / HD.breathingIntervalSec) !== Math.floor((w.time - dt) / HD.breathingIntervalSec)) {
      for (const h of hunters) {
        if (Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) < HD.breathingHearRadius) {
          w.emit([h.id], { k: 'breath', x: Math.round(p.move.x), y: Math.round(p.move.y) });
        }
      }
    }
  }

  // Forget old trails.
  const trailCut = w.time - BALANCE.trails.maxAgeSec;
  if (w.trails.length && w.trails[0].t < trailCut) w.trails = w.trails.filter((t) => t.t >= trailCut);
}
