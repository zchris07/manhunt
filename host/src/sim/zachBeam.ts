import { BALANCE, Health, pointSegDist2, raySegment } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { hurtHunter, hurtSurvivor } from './combat';
import { abilitiesOn } from './abilities';
import { canAct } from './player';
import type { NpcTarget } from './npc';

const D = BALANCE.sexton.defense;
const HB = BALANCE.hunter.beam;

/**
 * Hemp Beam (R, from slaying Sexton Science): channels the very beam Sexton fires (the same
 * length of time, damage and reach) along Zach's aim, swinging as slowly as Sexton's. Each
 * charge is single use; there's a short cooldown between them. He can't swing the machete
 * while it fires but every other ability still works.
 */
/** Zach (when his abilities are on) or a survivor on their feet (a Hemp Beam from Thomas Bourgeois). */
function usable(h: SimPlayer): boolean {
  return h.role === 'hunter' ? abilitiesOn(h) : h.role === 'survivor' && canAct(h);
}

export function tryBeam(w: World, h: SimPlayer, aim: number): void {
  if (h.role === 'spectator' || h.beamCharges <= 0 || h.beamCd > 0 || h.beamT > 0 || !usable(h) || h.carrying) return;
  if (!h.beamId) h.beamId = w.allocEntityId();
  if (!w.testMode) h.beamCharges--;
  // The first second is the charge-up; the beam proper lasts as long as Sexton's.
  h.beamT = HB.windup + D.beamTime;
  h.beamTick = 0;
  h.beamAng = aim;
  h.beamLen = 0;
  h.beamHit.clear();
  h.chargeT = -1;
  w.feed(`${h.name} fired a Hemp Beam`);
}

export function updateBeams(w: World, dt: number): void {
  for (const h of w.order) {
    if (h.role === 'spectator') continue;
    h.beamCd = Math.max(0, h.beamCd - dt);
    if (w.testMode && h.beamT <= 0) h.beamCd = 0;
    if (h.beamT <= 0) continue;
    if (!usable(h)) {
      h.beamT = 0;
      h.beamCd = HB.cooldown;
      continue;
    }
    h.beamT = Math.max(0, h.beamT - dt);
    h.chargeT = -1;
    // The beam swings toward his aim, slowly enough to dodge.
    let da = h.lastCmd.aim - h.beamAng;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    h.beamAng += Math.max(-D.turnRate * dt, Math.min(D.turnRate * dt, da));
    // Charging: no beam yet. Then it hits ten times a second.
    if (h.beamT > D.beamTime) {
      h.beamLen = 0;
    } else {
      h.beamTick += dt;
      let ticks = 0;
      while (h.beamTick >= 1 / HB.tickRate - 1e-9) {
        h.beamTick -= 1 / HB.tickRate;
        ticks++;
      }
      fire(w, h, ticks);
    }
    if (h.beamT <= 0) h.beamCd = HB.cooldown;
  }
}

/** The beam runs until it meets something solid (walls, trees, glass) or a survivor, and hurts what it touches once each. */
function fire(w: World, h: SimPlayer, ticks: number): void {
  const dx = Math.cos(h.beamAng);
  const dy = Math.sin(h.beamAng);
  const sx = h.move.x + dx * (h.radius + 2);
  const sy = h.move.y + dy * (h.radius + 2);
  let len = w.geo.raycastVision(sx, sy, h.beamAng, D.beamRange);
  const ms = w.geo.moveSeg;
  w.geo.windowSegs.forEach((m, i) => {
    if (w.windowsBroken[i]) return;
    const o = m * 4;
    len = Math.min(len, raySegment(sx, sy, dx, dy, ms[o], ms[o + 1], ms[o + 2], ms[o + 3]));
  });
  let victim: SimPlayer | null = null;
  let vt = len;
  // Zach's beam hurts survivors; a survivor's (from Thomas) hurts Zach.
  const vsZach = h.role === 'survivor';
  for (const p of w.order) {
    if (vsZach ? p.role !== 'hunter' || p.health === Health.Eliminated : p.role !== 'survivor' || (p.health !== Health.Healthy && p.health !== Health.Wounded) || p.hideState === 2) continue;
    const along = (p.move.x - sx) * dx + (p.move.y - sy) * dy;
    if (along < 0 || along > vt) continue;
    const r = p.radius + D.beamWidth / 2;
    if (pointSegDist2(p.move.x, p.move.y, sx, sy, sx + dx * len, sy + dy * len) > r * r) continue;
    vt = Math.max(0, along - p.radius * 0.6);
    victim = p;
  }
  h.beamLen = vt + h.radius + 2;
  // Ten ticks a second, each 3% of their full health, quietly; every third tick they visibly flinch.
  if (victim) {
    for (let i = 0; i < ticks; i++) {
      h.beamFlinch++;
      if (vsZach) hurtHunter(w, victim, HB.zachTickDamage * BALANCE.hunter.health.max, h, h.beamFlinch % 3 === 0 ? 'beam' : 'gas');
      else hurtSurvivor(w, victim, HB.tickDamage, h, h.beamFlinch % 3 === 0 ? 'beam' : 'gas');
      if (victim.health === Health.Downed || victim.knockT > 0) break;
    }
  }
  // NPCs in its way (it doesn't stop at them): each takes a light swipe's hit every half second while it touches.
  const ex = sx + dx * vt;
  const ey = sy + dy * vt;
  const touches = (x: number, y: number, r: number): boolean => pointSegDist2(x, y, sx, sy, ex, ey) <= (r + D.beamWidth / 2) ** 2;
  const list: [string, boolean, NpcTarget, number, () => void][] = [
    ['sexton', w.sexton.alive, w.sexton, BALANCE.sexton.radius, () => w.sexton.hit(h)],
    ['chris', w.chris.hittable, w.chris, BALANCE.chris.radius, () => w.chris.hit(h)],
    ['marc', true, w.marc, BALANCE.marc.radius, () => w.marc.hit(h)],
    ['plasma', w.plasma.alive, w.plasma, w.plasma.radius, () => w.plasma.slashHit(h, 1)],
    ['jaden', w.jaden.alive, w.jaden, BALANCE.jaden.radius, () => w.jaden.slashHit(h, 1)],
    ['waz', w.waz.solid, w.waz, BALANCE.waz.radius, () => w.waz.hit(h)],
    ['chacko', w.chacko.solid, w.chacko, BALANCE.chacko.radius, () => w.chacko.hit(h)],
    ['njaaron', w.njaaron.solid, w.njaaron, BALANCE.njaaron.radius, () => w.njaaron.slashHit(h, 1)],
    ['monique', w.monique.solid, w.monique, BALANCE.monique.radius, () => w.monique.hit(h)],
    ['thomas', w.thomas.solid, w.thomas, BALANCE.thomas.radius, () => w.thomas.hit(h)],
  ];
  // A survivor's beam counts as a thrown item to an NPC (it can't kill Sexton, say), Zach's as a machete hit.
  const npcs = list.map(([key, ok, n, r, hit]): [string, boolean, NpcTarget, number, () => void] => [key, ok, n, r, vsZach ? () => n.itemHit(h, 'bottle') : hit]);
  for (const [key, ok, n, r, hit] of npcs) {
    if (!ok || !touches(n.x, n.y, r)) continue;
    if (w.time - (h.beamHit.get(key) ?? -Infinity) < HB.npcHitEvery - 1e-9) continue;
    h.beamHit.set(key, w.time);
    hit();
  }
}
