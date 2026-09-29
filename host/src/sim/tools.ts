import { Action, BALANCE, BarricadeState, Btn, DEG, Health, ToolKind, angleDiff, pointSegDist2, type InputCmd } from '@manhunt/shared';
import { canAct, type SimPlayer } from './player';
import type { World } from './World';
import { dropCarried } from './combat';
import { exitHiding } from './interact';

const T = BALANCE.tools;

function interruptHunter(w: World, h: SimPlayer): void {
  if (h.action !== Action.None && h.action !== Action.Vault) w.cancelAction(h);
  h.attackWindup = 0;
  h.move.lungeT = 0;
  if (h.carrying) dropCarried(w, h);
}

/**
 * Stuns Zach (he can never be killed). Every stun or blind grants stun immunity so survivors
 * cannot chain-stun him. Returns false if he is immune.
 */
export function stunHunter(w: World, h: SimPlayer, seconds: number, kind: string, by?: SimPlayer): boolean {
  if (h.role !== 'hunter' || h.immuneT > 0 || h.health === Health.Eliminated) return false;
  const dur = seconds * w.balance.stunMul;
  h.stunT = Math.max(h.stunT, dur);
  h.immuneT = T.stunImmunity + dur;
  interruptHunter(w, h);
  h.stats.stunnedTimes++;
  if (by) by.stats.stuns++;
  w.emit('all', { k: 'stun', target: h.id, kind });
  return true;
}

/** Blinds Zach: his vision shrinks and he drops anyone he is carrying. */
export function blindHunter(w: World, h: SimPlayer, seconds: number, kind: string, by?: SimPlayer): boolean {
  if (h.role !== 'hunter' || h.immuneT > 0 || h.health === Health.Eliminated) return false;
  const dur = seconds * w.balance.stunMul;
  h.blindT = Math.max(h.blindT, dur);
  h.immuneT = T.stunImmunity + dur;
  if (h.carrying) dropCarried(w, h);
  h.attackWindup = 0;
  h.stats.stunnedTimes++;
  if (by) by.stats.stuns++;
  w.emit('all', { k: 'stun', target: h.id, kind });
  return true;
}

/** Slams a standing barricade down across its gap, stunning Zach if he is in it. */
export function dropBarricade(w: World, p: SimPlayer, bi: number): void {
  if (w.barricades[bi] !== BarricadeState.Up) return;
  const b = w.map.barricades[bi];
  const ux = Math.cos(b.angle) * (b.length / 2);
  const uy = Math.sin(b.angle) * (b.length / 2);
  const stunned: SimPlayer[] = [];
  for (const h of w.order) {
    if (h.role !== 'hunter') continue;
    const d2 = pointSegDist2(h.move.x, h.move.y, b.x - ux, b.y - uy, b.x + ux, b.y + uy);
    if (d2 < (T.barricade.slamRadius + h.radius) ** 2) stunned.push(h);
  }
  w.setBarricade(bi, BarricadeState.Down);
  w.noise(b.x, b.y, 750, 'barricade', true);
  for (const h of stunned) {
    if (stunHunter(w, h, T.barricade.stun, 'barricade', p)) w.feed(`${p.name} slammed a barricade on ${h.name}`);
  }
}

/** Bursting out of a hiding spot while Zach is searching it. */
export function lockerSlam(w: World, p: SimPlayer): boolean {
  const h = w.order.find((q) => q.role === 'hunter' && q.action === Action.Search && q.actionTarget === p.hideSpot);
  if (!h) return false;
  if (!stunHunter(w, h, BALANCE.hiding.slamStun, 'slam', p)) return false;
  exitHiding(w, p, true);
  p.move.hasteT = BALANCE.survivor.hitHasteTime;
  w.feed(`${p.name} burst out on ${h.name}`);
  return true;
}

export function useTool(w: World, p: SimPlayer, cmd: InputCmd): void {
  if (p.tool === ToolKind.None || p.toolCount <= 0 || p.action !== Action.None) return;
  if (p.tool === ToolKind.Flare) {
    w.flares.push({ id: w.allocEntityId(), x: p.move.x, y: p.move.y, t: T.flare.burnTime, owner: p.id });
    w.noise(p.move.x, p.move.y, 520, 'flare', true);
    for (const h of w.order) {
      if (h.role !== 'hunter') continue;
      if (Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) > T.flare.radius) continue;
      if (!w.geo.hasLineOfSight(p.move.x, p.move.y, h.move.x, h.move.y)) continue;
      if (blindHunter(w, h, T.flare.blind, 'flare', p)) w.feed(`${p.name} blinded ${h.name} with a flare`);
    }
  } else if (p.tool === ToolKind.Bottle) {
    const dist = Math.min(T.bottle.maxRange, Math.max(40, cmd.aimDist));
    const free = w.geo.raycastVision(p.move.x, p.move.y, cmd.aim, dist);
    const d = Math.max(20, free - 12);
    const tx = p.move.x + Math.cos(cmd.aim) * d;
    const ty = p.move.y + Math.sin(cmd.aim) * d;
    w.bottles.push({ id: w.allocEntityId(), fx: p.move.x, fy: p.move.y, tx, ty, t: 0, dur: T.bottle.flightTime * (d / T.bottle.maxRange) + 0.2, owner: p.id });
  }
  p.toolCount--;
  if (p.toolCount <= 0) {
    p.tool = ToolKind.None;
    p.toolCount = 0;
  }
}

export function updateTools(w: World, dt: number): void {
  for (const f of w.flares) f.t -= dt;
  w.flares = w.flares.filter((f) => f.t > 0);

  const landed = w.bottles.filter((b) => (b.t += dt) >= b.dur);
  w.bottles = w.bottles.filter((b) => b.t < b.dur);
  for (const b of landed) {
    // A noise decoy: loud, and Stalker's Pulse reports it like any survivor noise.
    w.noise(b.tx, b.ty, T.bottle.noiseRadius, 'glass', true);
  }

  // Flashlight flash: hold F on Zach for ~2 s.
  for (const p of w.order) {
    if (p.role !== 'survivor') continue;
    const holding = (p.lastCmd.buttons & Btn.Flash) !== 0 && canAct(p) && p.flashCharges > 0;
    if (!holding) {
      p.flashHold = 0;
      p.flashTarget = 0;
      if (p.action === Action.FlashAim) p.action = Action.None;
      continue;
    }
    if (p.action === Action.None) p.action = Action.FlashAim;
    if (p.action !== Action.FlashAim) continue;
    let target: SimPlayer | null = null;
    for (const h of w.order) {
      if (h.role !== 'hunter' || h.health === Health.Eliminated) continue;
      const d = Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y);
      if (d > T.flash.range) continue;
      const a = Math.atan2(h.move.y - p.move.y, h.move.x - p.move.x);
      if (Math.abs(angleDiff(a, p.facing)) > T.flash.halfAngleDeg * DEG + Math.atan2(h.radius, d)) continue;
      if (!w.geo.hasLineOfSight(p.move.x, p.move.y, h.move.x, h.move.y)) continue;
      target = h;
      break;
    }
    if (!target) {
      p.flashHold = Math.max(0, p.flashHold - dt * 0.5);
      continue;
    }
    p.flashTarget = target.id;
    p.flashHold += dt / T.flash.holdTime;
    if (p.flashHold >= 1) {
      p.flashHold = 0;
      if (blindHunter(w, target, T.flash.blind, 'flash', p)) {
        p.flashCharges--;
        w.feed(`${p.name} flashed ${target.name}`);
      }
    }
  }
}
