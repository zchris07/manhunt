import { Action, BALANCE, Btn, DEG, Gait, Health, angleDiff } from '@manhunt/shared';
import type { World } from './World';

const S = BALANCE.survivor;
const HD = BALANCE.hiding;

/** Noise radii, footprints and blood, terror radius, chases and breath-holding. */
export function updateSenses(w: World, dt: number): void {
  const hunters = w.order.filter((p) => p.role === 'hunter' && p.health !== Health.Eliminated);

  for (const p of w.order) {
    if (p.role === 'hunter') {
      p.noise = p.gait === Gait.Idle ? BALANCE.noise.hunterIdle : BALANCE.hunter.noise;
      continue;
    }
    if (p.role !== 'survivor') continue;
    let noise = 0;
    if (p.health === Health.Healthy || p.health === Health.Wounded) {
      if (p.hideState === 2) noise = 0;
      else noise = p.gait === Gait.Run ? S.noise.run : p.gait === Gait.Walk ? S.noise.walk : p.gait === Gait.Crouch ? S.noise.crouch : S.noise.idle;
      if (p.action === Action.Repair) noise = Math.max(noise, BALANCE.objectives.repairNoise);
      if (p.action === Action.OpenGate) noise = Math.max(noise, BALANCE.objectives.gateNoise);
      if (p.health === Health.Wounded && p.hideState === 0) noise = Math.max(noise, BALANCE.noise.woundedMin);
    } else if (p.health === Health.Downed) {
      noise = BALANCE.noise.downed;
    }
    p.noise = noise;

    // Footprints (running) and blood (wounded or downed) for Bloodhound.
    const visibleOnGround = p.hideState === 0 && (p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed);
    if (visibleOnGround) {
      if (p.gait === Gait.Run && w.time - p.lastPrint >= BALANCE.trails.footprintEvery) {
        p.lastPrint = w.time;
        w.trails.push({ x: p.move.x, y: p.move.y, t: w.time, kind: 0 });
      }
      // Running is loud: Stalker's Pulse hears it twice a second.
      if (p.gait === Gait.Run && Math.floor(w.time * 2) !== Math.floor((w.time - dt) * 2)) {
        w.noises.push({ x: p.move.x, y: p.move.y, t: w.time, kind: 'run', survivor: true });
      }
      if ((p.health === Health.Wounded || p.health === Health.Downed) && w.time - p.lastBlood >= BALANCE.trails.bloodEvery) {
        p.lastBlood = w.time;
        w.trails.push({ x: p.move.x + w.rng.range(-6, 6), y: p.move.y + w.rng.range(-6, 6), t: w.time, kind: 1 });
      }
    }

    // Terror radius: heartbeat and darkening as a hunter closes in.
    let terror = 0;
    for (const h of hunters) {
      const d = Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y);
      terror = Math.max(terror, 1 - d / BALANCE.hunter.terrorRadius);
    }
    p.terror = Math.max(0, Math.min(1, terror));

    // Chase: a hunter can see this survivor up close.
    if (p.health === Health.Healthy || p.health === Health.Wounded) {
      let chaser = 0;
      for (const h of hunters) {
        if (p.hideState === 2) break;
        const d = Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y);
        if (d > BALANCE.hunter.chaseRange) continue;
        const a = Math.atan2(p.move.y - h.move.y, p.move.x - h.move.x);
        const inCone = Math.abs(angleDiff(a, h.facing)) <= BALANCE.hunter.vision.coneHalfAngleDeg * DEG || d < BALANCE.hunter.vision.proximity;
        if (inCone && w.geo.hasLineOfSight(h.move.x, h.move.y, p.move.x, p.move.y)) {
          chaser = h.id;
          break;
        }
      }
      if (chaser) {
        if (!p.inChase) {
          p.inChase = true;
          w.emit([p.id, chaser], { k: 'chase', on: true });
        }
        p.chaseT = BALANCE.hunter.chaseLoseSec;
      } else if (p.inChase) {
        p.chaseT -= dt;
        if (p.chaseT <= 0) {
          p.inChase = false;
          w.emit([p.id], { k: 'chase', on: false });
        }
      }
    } else if (p.inChase) {
      p.inChase = false;
    }

    // Breath: holding it silences you in a hiding spot; running out makes you gasp.
    p.gaspCd = Math.max(0, p.gaspCd - dt);
    const wantsHold = p.hideState === 2 && (p.lastCmd.buttons & (Btn.HoldBreath | Btn.Vault)) !== 0 && p.gaspCd <= 0;
    if (wantsHold && p.breath > 0) {
      p.holdingBreath = true;
      p.breath = Math.max(0, p.breath - dt / HD.breathMax);
      if (p.breath <= 0) {
        p.holdingBreath = false;
        p.gaspCd = HD.gaspCooldown;
        w.noise(p.move.x, p.move.y, HD.gaspNoise, 'gasp', true);
      }
    } else {
      p.holdingBreath = false;
      p.breath = Math.min(1, p.breath + (HD.breathRegen * dt) / HD.breathMax);
    }
    if (p.hideState === 2 && !p.holdingBreath && Math.floor(w.time / HD.breathingIntervalSec) !== Math.floor((w.time - dt) / HD.breathingIntervalSec)) {
      for (const h of hunters) {
        if (Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) < HD.breathingHearRadius) {
          w.emit([h.id], { k: 'breath', x: Math.round(p.move.x), y: Math.round(p.move.y) });
        }
      }
    }
  }

  // Forget old noises and trails.
  const noiseCut = w.time - 12;
  if (w.noises.length && w.noises[0].t < noiseCut) w.noises = w.noises.filter((n) => n.t >= noiseCut);
  const trailCut = w.time - BALANCE.trails.maxAgeSec;
  if (w.trails.length && w.trails[0].t < trailCut) w.trails = w.trails.filter((t) => t.t >= trailCut);
}
