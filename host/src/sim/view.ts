import {
  Action,
  BALANCE,
  DEG,
  EF,
  EntityKind,
  GenFlag,
  Health,
  SextonFlag,
  emptySelf,
  inCone,
  maxStamina,
  quantizeEntity,
  type EntityRecord,
  type SelfState,
  type ViewCone,
  type WorldState,
} from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';

export interface PlayerView {
  self: SelfState;
  entities: EntityRecord[];
  world: WorldState;
}

export interface Vision {
  cone: ViewCone;
  prox: number;
  /** The cone sees through walls (night vision goggles, Hemp Battery). */
  xray: boolean;
}

/** The vision a player has right now (mirrors what the client draws into its mask). */
export function visionFor(w: World, v: SimPlayer): Vision {
  const x = v.move.x;
  const y = v.move.y;
  if (v.role === 'hunter') {
    const hv = BALANCE.hunter.vision;
    return { cone: { x, y, dir: v.facing, halfAngle: hv.coneHalfAngleDeg * DEG, range: hv.range }, prox: hv.proximity, xray: v.move.hempT > 0 };
  }
  if (v.hideState === 2 && v.hideSpot >= 0) {
    const spot = w.map.hidingSpots[v.hideSpot];
    const pk = spot.kind === 'grass' ? BALANCE.hiding.grassPeek : BALANCE.hiding.peek;
    return { cone: { x, y, dir: spot.facing, halfAngle: pk.coneHalfAngleDeg * DEG, range: pk.range }, prox: pk.proximity, xray: false };
  }
  const sv = BALANCE.survivor.vision;
  const k = v.health === Health.Downed ? BALANCE.survivor.downedVisionMul : 1;
  const wide = v.gogglesOn ? BALANCE.items.goggles.coneMul : 1;
  return { cone: { x, y, dir: v.facing, halfAngle: sv.coneHalfAngleDeg * DEG * wide, range: sv.range * k }, prox: sv.proximity, xray: v.gogglesOn };
}

/**
 * Whether viewer `v` can see point (x,y): own cone or proximity with line of sight, or
 * anywhere in the near part of a see-through (x-ray) cone.
 */
export function canSee(w: World, v: SimPlayer, x: number, y: number): boolean {
  const { cone, prox, xray } = visionFor(w, v);
  if (xray && inCone({ ...cone, range: Math.min(cone.range, BALANCE.xray.range) }, x, y)) return true;
  const d = Math.hypot(x - v.move.x, y - v.move.y);
  // Only your own light lifts the fog of war: lamps light the scene, not who is in it.
  if (d > prox && !inCone(cone, x, y)) return false;
  return w.geo.hasLineOfSight(v.move.x, v.move.y, x, y);
}

function entityState(p: SimPlayer): number {
  let s = p.health & EF.HealthMask;
  if (p.role === 'hunter') s |= EF.Hunter;
  s |= (p.gait & 3) << EF.GaitShift;
  if (p.carrying) s |= EF.Carrying;
  if (p.stunT > 0) s |= EF.Stunned;
  if (p.move.lungeT > 0) s |= EF.Lunging;
  if (p.gogglesOn) s |= EF.Goggles;
  if (p.move.hempT > 0) s |= EF.Hemp;
  if (p.attackWindup > 0 || p.swingT > 0) s |= EF.Attacking;
  if (p.move.staminaLock > 0) s |= EF.StaminaLock;
  if (p.action !== Action.None) s |= EF.Busy;
  if (p.move.sprinting) s |= EF.Sprinting;
  if (p.gassed) s |= EF.Gassed;
  return s;
}

/** Fraction of the sprint meter, 0-255. */
function staminaByte(p: SimPlayer): number {
  const role = p.role === 'hunter' ? 'hunter' : 'survivor';
  return (p.move.stamina / maxStamina(role, p.move.boostT)) * 255;
}

function playerRecord(p: SimPlayer): EntityRecord {
  const extra = p.role === 'hunter' ? p.carrying : p.health === Health.Staked ? Math.round((p.stakeT / BALANCE.objectives.stakeStageTime) * 255) : 0;
  // aux: a survivor's item in hand, or how far Zach has charged his swing (0-255).
  const aux =
    p.role === 'survivor' ? (p.selItem && p.inv[p.selItem] > 0 ? p.selItem : 0) : p.chargeT >= 0 ? Math.round((p.chargeT / BALANCE.hunter.attack.charge.max) * 255) : 0;
  return quantizeEntity(p.id, EntityKind.Player, p.move.x, p.move.y, p.facing, entityState(p), p.action, extra, aux, staminaByte(p));
}

function selfState(w: World, p: SimPlayer, v: SimPlayer | undefined): SelfState {
  const s = emptySelf(p.id);
  const watching = !v || v.id !== p.id;
  const m = p.move;
  s.role = p.role === 'survivor' ? 0 : p.role === 'hunter' ? 1 : 2;
  s.x = watching && v ? v.move.x : m.x;
  s.y = watching && v ? v.move.y : m.y;
  s.mode = m.mode;
  s.health = p.health;
  s.lungeT = m.lungeT;
  s.lungeAng = m.lungeAng;
  s.lungeCharges = m.lungeCharges;
  s.lungeRecharge = m.lungeRecharge;
  s.kbT = m.kbT;
  s.kbDur = m.kbDur;
  s.kbPeak = m.kbPeak;
  s.kbAng = m.kbAng;
  s.hasteT = m.hasteT;
  s.slowT = m.slowT;
  s.slowMul = m.slowMul;
  s.stamina = m.stamina;
  s.staminaLock = m.staminaLock;
  s.sprintBlocked = m.sprintBlocked;
  s.boostT = m.boostT;
  s.hempT = m.hempT;
  s.prevButtons = m.prevButtons;
  s.sprinting = m.sprinting;
  s.stunT = p.stunT;
  s.immuneT = p.immuneT;
  s.action = p.action;
  s.actionProgress = p.action === Action.Repair && p.actionTarget >= 0 ? w.gens[p.actionTarget].progress : p.action === Action.OpenGate ? w.gate.progress : p.actionDur > 0 ? Math.min(1, p.actionT / p.actionDur) : 0;
  s.actionTarget = p.actionTarget;
  s.prompt = p.prompt;
  s.promptTarget = p.promptTarget;
  s.prompt2 = p.prompt2;
  s.hideSpot = p.hideSpot;
  s.hideState = p.hideState;
  s.carrying = p.carrying;
  s.carriedBy = p.carriedBy;
  s.stakeStage = p.health === Health.Staked ? p.stakeStage : 0;
  s.stakeT = p.stakeT;
  s.wiggle = p.wiggle;
  s.breath = p.breath;
  s.attackCd = p.attackCd;
  s.burstCd = p.burstCd;
  s.hemp = p.hemp;
  s.inv = p.inv.slice();
  s.goggleMeter = p.goggles[0] ?? 0;
  s.gogglesOn = p.gogglesOn ? 1 : 0;
  s.chargeT = p.chargeT;
  s.shells = p.shells[0] ?? 0;
  s.reloadT = p.reloadT;
  s.confit = p.confit;
  s.jarvis = p.jarvis;
  s.jarvisT = p.jarvisT;
  s.scareT = p.scareT;
  s.gassed = p.gassed ? 1 : 0;
  s.testMode = w.testMode ? 1 : 0;
  s.noise = Math.min(1, p.noise / BALANCE.survivor.noise.run);
  s.spectating = watching && v ? v.id : 0;
  return s;
}

/**
 * Interest management: builds what one peer may know. Entities outside a sensing radius are
 * never sent; hidden survivors are never sent; everyone else only if the viewer can see them
 * (own vision, x-ray cone, or a lit area in line of sight).
 */
export function buildView(w: World, peerPlayer: SimPlayer): PlayerView {
  const v = w.viewerFor(peerPlayer);
  const entities: EntityRecord[] = [];
  const survivorSide = peerPlayer.role !== 'hunter';
  const R = BALANCE.net.maxSensingRadius;
  if (v) {
    for (const q of w.order) {
      if (q.role === 'spectator' || q.health === Health.Escaped || q.health === Health.Eliminated || q.health === Health.Carried) continue;
      if (q.id === peerPlayer.id && q.id === v.id) continue;
      if (q.id === v.id) {
        entities.push(playerRecord(q));
        continue;
      }
      if (q.hideState === 2) continue;
      const d = Math.hypot(q.move.x - v.move.x, q.move.y - v.move.y);
      if (d > R) continue;
      const aura = survivorSide && q.role === 'survivor' && q.health === Health.Staked;
      if (aura || canSee(w, v, q.move.x, q.move.y)) entities.push(playerRecord(q));
    }
    for (const b of w.bottles) {
      if (Math.hypot(b.x - v.move.x, b.y - v.move.y) > 900) continue;
      entities.push(quantizeEntity(b.id, EntityKind.Bottle, b.x, b.y, Math.atan2(b.dy, b.dx), 0, 0, Math.round(Math.min(1, b.travelled / b.max) * 255)));
    }
    for (const t of w.traps) {
      if (Math.hypot(t.x - v.move.x, t.y - v.move.y) > R) continue;
      // Semi-hidden: Zach only gets a trap he can actually see.
      if (!survivorSide && !canSee(w, v, t.x, t.y)) continue;
      entities.push(quantizeEntity(t.id, EntityKind.Trap, t.x, t.y, 0, t.armT > 0 ? 0 : 1, 0, 0));
    }
    const T = BALANCE.items.trap;
    for (const g of w.gases) {
      if (Math.hypot(g.x - v.move.x, g.y - v.move.y) > R + T.gasRadius) continue;
      entities.push(quantizeEntity(g.id, EntityKind.Gas, g.x, g.y, 0, 0, 0, Math.round(Math.min(1, g.age / T.gasTime) * 255)));
    }
    // Sexton is sent to everyone in earshot: his reel audio plays around him even in the dark.
    const sx = w.sexton;
    if (Math.hypot(sx.x - v.move.x, sx.y - v.move.y) <= BALANCE.sexton.audio.far + 250) {
      let st = 0;
      if (!sx.alive) st |= SextonFlag.Dead;
      if (sx.mode === 'flee') st |= SextonFlag.Fleeing;
      if (sx.mode === 'talk') st |= SextonFlag.Talking;
      if (sx.hurtT > 0) st |= SextonFlag.Hurt;
      entities.push(quantizeEntity(sx.id, EntityKind.Sexton, sx.x, sx.y, sx.facing, st, 0, sx.hp, sx.moving ? 1 : 0, 0));
    }
    const hd = w.hempDrop;
    if (hd && Math.hypot(hd.x - v.move.x, hd.y - v.move.y) <= R) entities.push(quantizeEntity(hd.id, EntityKind.Hemp, hd.x, hd.y, 0, 0, 0, 0));
  }

  const gens = w.gens.map((g, i) => {
    let flags = 0;
    if (g.repaired) flags |= GenFlag.Repaired;
    const def = w.map.generators[i];
    const known = survivorSide || (v ? Math.hypot(def.x - v.move.x, def.y - v.move.y) < BALANCE.hunter.genKnownRadius : false);
    if (!known) return { progress: g.repaired ? 1 : 0, flags };
    flags |= GenFlag.Known;
    if (g.workers > 0) flags |= GenFlag.BeingRepaired;
    if (g.regressing) flags |= GenFlag.Regressing;
    return { progress: g.progress, flags };
  });
  const hidingOccupied = w.hiding.map((occ, i) => {
    if (!occ || !survivorSide || !v) return false;
    if (occ === v.id) return true;
    const spot = w.map.hidingSpots[i];
    return canSee(w, v, spot.x, spot.y);
  });
  const radar: WorldState['radar'] = [];
  if (peerPlayer.jarvisT > 0) {
    for (const h of w.order) if (h.role === 'hunter' && h.health !== Health.Eliminated) radar.push({ x: h.move.x, y: h.move.y });
  }
  const survivors = w.order.filter((p) => p.role === 'survivor');
  const world: WorldState = {
    timeLeft: w.testMode ? 0 : Math.max(0, w.balance.timeLimit - w.time),
    required: w.balance.requiredGenerators,
    repaired: w.gens.filter((g) => g.repaired).length,
    escaped: survivors.filter((p) => p.health === Health.Escaped).length,
    eliminated: survivors.filter((p) => p.health === Health.Eliminated).length,
    survivorsTotal: survivors.length,
    gens,
    gatePowered: w.gate.powered,
    gateProgress: w.gate.progress,
    gateOpen: w.gate.open,
    barricades: w.barricades.slice(),
    lootTaken: w.lootTaken.slice(),
    stakes: w.stakes.slice(),
    hidingOccupied,
    doors: w.doors.slice(),
    doorsBroken: w.doorBroken.slice(),
    radar,
  };
  return { self: selfState(w, peerPlayer, v), entities, world };
}
