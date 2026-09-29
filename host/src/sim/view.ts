import {
  Action,
  BALANCE,
  DEG,
  EF,
  EntityKind,
  GenFlag,
  Health,
  emptySelf,
  inCone,
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

/** The vision a player has right now (mirrors what the client draws into its mask). */
export function visionFor(w: World, v: SimPlayer): { cone: ViewCone; prox: number } {
  const x = v.move.x;
  const y = v.move.y;
  if (v.role === 'hunter') {
    const hv = BALANCE.hunter.vision;
    const blind = v.blindT > 0 ? BALANCE.tools.flare.visionMul : 1;
    return { cone: { x, y, dir: v.facing, halfAngle: hv.coneHalfAngleDeg * DEG, range: hv.range * blind }, prox: hv.proximity * (blind < 1 ? BALANCE.hunter.blindProximityMul : 1) };
  }
  if (v.hideState === 2 && v.hideSpot >= 0) {
    const spot = w.map.hidingSpots[v.hideSpot];
    const pk = spot.kind === 'grass' ? BALANCE.hiding.grassPeek : BALANCE.hiding.peek;
    return { cone: { x, y, dir: spot.facing, halfAngle: pk.coneHalfAngleDeg * DEG, range: pk.range }, prox: pk.proximity };
  }
  const sv = BALANCE.survivor.vision;
  const k = v.health === Health.Downed ? BALANCE.survivor.downedVisionMul : 1;
  return { cone: { x, y, dir: v.facing, halfAngle: sv.coneHalfAngleDeg * DEG, range: sv.range * k }, prox: sv.proximity };
}

/** True if (x,y) is lit by a lamp, campfire, burning flare or restored generator. */
export function isLit(w: World, x: number, y: number): boolean {
  for (const l of w.map.lights) {
    if (Math.abs(l.x - x) > l.radius || Math.abs(l.y - y) > l.radius) continue;
    if (Math.hypot(l.x - x, l.y - y) <= l.radius && w.geo.hasLineOfSight(l.x, l.y, x, y)) return true;
  }
  const fr = BALANCE.tools.flare.lightRadius;
  for (const f of w.flares) {
    if (Math.hypot(f.x - x, f.y - y) <= fr && w.geo.hasLineOfSight(f.x, f.y, x, y)) return true;
  }
  const gr = BALANCE.lights.generatorRadius;
  for (let i = 0; i < w.gens.length; i++) {
    if (!w.gens[i].repaired) continue;
    const g = w.map.generators[i];
    if (Math.hypot(g.x - x, g.y - y) <= gr && w.geo.hasLineOfSight(g.x, g.y, x, y)) return true;
  }
  return false;
}

/** Whether viewer `v` can see point (x,y): own cone/proximity, or a lit area in line of sight. */
export function canSee(w: World, v: SimPlayer, x: number, y: number): boolean {
  const { cone, prox } = visionFor(w, v);
  const d = Math.hypot(x - v.move.x, y - v.move.y);
  const own = d <= prox || inCone(cone, x, y);
  if (!own && !(d <= BALANCE.lights.losRange && isLit(w, x, y))) return false;
  return w.geo.hasLineOfSight(v.move.x, v.move.y, x, y);
}

function entityState(p: SimPlayer): number {
  let s = p.health & EF.HealthMask;
  if (p.role === 'hunter') s |= EF.Hunter;
  s |= (p.gait & 3) << EF.GaitShift;
  if (p.carrying) s |= EF.Carrying;
  if (p.stunT > 0) s |= EF.Stunned;
  if (p.move.lungeT > 0) s |= EF.Lunging;
  if (p.action === Action.FlashAim) s |= EF.FlashBeam;
  if (p.blindT > 0) s |= EF.Blinded;
  if (p.attackWindup > 0) s |= EF.Attacking;
  if (p.vault) s |= EF.Vaulting;
  if (p.action !== Action.None && p.action !== Action.FlashAim) s |= EF.Busy;
  if (p.inChase) s |= EF.Chase;
  return s;
}

function playerRecord(p: SimPlayer): EntityRecord {
  const extra = p.role === 'hunter' ? p.carrying : p.health === Health.Staked ? Math.round((p.stakeT / BALANCE.objectives.stakeStageTime) * 255) : 0;
  return quantizeEntity(p.id, EntityKind.Player, p.move.x, p.move.y, p.facing, entityState(p), p.action, extra);
}

function selfState(w: World, p: SimPlayer, v: SimPlayer | undefined): SelfState {
  const s = emptySelf(p.id);
  const watching = !v || v.id !== p.id;
  s.role = p.role === 'survivor' ? 0 : p.role === 'hunter' ? 1 : 2;
  s.x = watching && v ? v.move.x : p.move.x;
  s.y = watching && v ? v.move.y : p.move.y;
  s.mode = p.move.mode;
  s.health = p.health;
  s.lungeT = p.move.lungeT;
  s.lungeCd = p.move.lungeCd;
  s.hasteT = p.move.hasteT;
  s.slowT = p.move.slowT;
  s.slowMul = p.move.slowMul;
  s.stunT = p.stunT;
  s.blindT = p.blindT;
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
  s.fuel = p.fuel;
  s.wire = p.wire;
  s.tool = p.tool;
  s.toolCount = p.toolCount;
  s.flashCharges = p.flashCharges;
  s.flashHold = p.flashHold;
  s.breath = p.breath;
  s.attackCd = p.attackCd;
  s.pulseCd = p.pulseCd;
  s.bloodhoundCd = p.bloodhoundCd;
  s.bloodhoundT = p.bloodhoundT;
  s.smashCd = p.smashCd;
  s.terror = (v ?? p).terror;
  s.noise = Math.min(1, p.noise / BALANCE.survivor.noise.run);
  s.spectating = watching && v ? v.id : 0;
  return s;
}

/**
 * Interest management: builds what one peer may know. Entities outside a sensing radius are
 * never sent; hidden survivors are never sent; everyone else only if the viewer can see them
 * (own vision or lit area in line of sight) or hear them (within their noise radius).
 */
export function buildView(w: World, peerPlayer: SimPlayer): PlayerView {
  const v = w.viewerFor(peerPlayer);
  const entities: EntityRecord[] = [];
  const survivorSide = peerPlayer.role !== 'hunter';
  if (v) {
    const R = BALANCE.net.maxSensingRadius;
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
      if (aura || d <= q.noise || canSee(w, v, q.move.x, q.move.y)) entities.push(playerRecord(q));
    }
    for (const f of w.flares) {
      if (Math.hypot(f.x - v.move.x, f.y - v.move.y) > R) continue;
      entities.push(quantizeEntity(f.id, EntityKind.Flare, f.x, f.y, 0, 0, 0, Math.round((f.t / BALANCE.tools.flare.burnTime) * 255)));
    }
    for (const b of w.bottles) {
      const k = Math.min(1, b.t / b.dur);
      const x = b.fx + (b.tx - b.fx) * k;
      const y = b.fy + (b.ty - b.fy) * k;
      if (Math.hypot(x - v.move.x, y - v.move.y) > 700) continue;
      entities.push(quantizeEntity(b.id, EntityKind.Bottle, x, y, 0, 0, 0, Math.round(Math.sin(k * Math.PI) * 255)));
    }
  }

  const gens = w.gens.map((g, i) => {
    let flags = 0;
    if (g.repaired) flags |= GenFlag.Repaired;
    const def = w.map.generators[i];
    const known = survivorSide || (v ? Math.hypot(def.x - v.move.x, def.y - v.move.y) < BALANCE.hunter.genKnownRadius : false);
    if (!known) return { progress: g.repaired ? 1 : 0, flags };
    flags |= GenFlag.Known;
    if (g.workers > 0) flags |= GenFlag.BeingRepaired;
    if (g.fuel) flags |= GenFlag.Fuel;
    if (g.wire) flags |= GenFlag.Wire;
    if (g.regressing) flags |= GenFlag.Regressing;
    return { progress: g.progress, flags };
  });
  const hidingOccupied = w.hiding.map((occ, i) => {
    if (!occ || !survivorSide || !v) return false;
    if (occ === v.id) return true;
    const spot = w.map.hidingSpots[i];
    return canSee(w, v, spot.x, spot.y);
  });
  const survivors = w.order.filter((p) => p.role === 'survivor');
  const world: WorldState = {
    timeLeft: Math.max(0, w.balance.timeLimit - w.time),
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
  };
  return { self: selfState(w, peerPlayer, v), entities, world };
}
