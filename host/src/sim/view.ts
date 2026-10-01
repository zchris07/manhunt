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
  ItemKind,
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
  // JARVIS: for a few seconds survivors see everything on their screen (never Zach).
  if (w.revealT > 0 && v.role !== 'hunter') return true;
  const { cone, prox, xray } = visionFor(w, v);
  if (xray && inCone({ ...cone, range: Math.min(cone.range, BALANCE.xray.range) }, x, y)) return true;
  const d = Math.hypot(x - v.move.x, y - v.move.y);
  // Only your own light lifts the fog of war: lamps light the scene, not who is in it.
  if (d > prox && !inCone(cone, x, y)) return false;
  return w.geo.hasLineOfSight(v.move.x, v.move.y, x, y);
}

function entityState(p: SimPlayer): number {
  // Zach knocked out by Plasma shows as down.
  let s = (p.role === 'hunter' && p.knockT > 0 ? Health.Downed : p.health) & EF.HealthMask;
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


function playerRecord(p: SimPlayer): EntityRecord {
  const extra = p.role === 'hunter' ? p.carrying : p.health === Health.Staked ? Math.round((p.stakeT / BALANCE.objectives.stakeStageTime) * 255) : 0;
  // aux: a survivor's item in hand, or how far Zach has charged his swing (0-255).
  // A survivor's item in hand (bit 3: it's the golden pump), or Zach's swing charge (0-254;
  // 255 = he's holding the golden pump).
  const aux =
    p.role === 'survivor'
      ? p.selItem && p.inv[p.selItem] > 0
        ? p.selItem | (p.selItem === ItemKind.Shotgun && p.golden ? 8 : 0)
        : 0
      : p.pump > 0
        ? 255
        : p.chargeT >= 0
          ? Math.round((p.chargeT / BALANCE.hunter.attack.charge.max) * 254)
          : 0;
  return quantizeEntity(p.id, EntityKind.Player, p.move.x, p.move.y, p.facing, entityState(p), p.action, extra, aux, p.hp * 255);
}

function selfState(w: World, p: SimPlayer, v: SimPlayer | undefined): SelfState {
  const s = emptySelf(p.id);
  const watching = !v || v.id !== p.id;
  const m = p.move;
  s.role = p.role === 'survivor' ? 0 : p.role === 'hunter' ? 1 : 2;
  s.x = watching && v ? v.move.x : m.x;
  s.y = watching && v ? v.move.y : m.y;
  s.mode = m.mode;
  s.health = p.role === 'hunter' && p.knockT > 0 ? Health.Downed : p.health;
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
  s.hp = p.hp;
  s.golden = p.golden ? 1 : 0;
  s.pump = p.pump;
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
  // Testing mode: every NPC is sent to everyone, wherever they are.
  const npcR = w.testMode ? Infinity : R;
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
      entities.push(quantizeEntity(b.id, EntityKind.Bottle, b.x, b.y, Math.atan2(b.dy, b.dx), 0, 0, Math.min(255, Math.round(b.travelled / 4))));
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
    if (w.testMode || Math.hypot(sx.x - v.move.x, sx.y - v.move.y) <= BALANCE.sexton.audio.far + 250) {
      let st = 0;
      if (!sx.alive) st |= SextonFlag.Dead;
      if (sx.mode === 'flee') st |= SextonFlag.Fleeing;
      if (sx.mode === 'talk') st |= SextonFlag.Talking;
      if (sx.hurtT > 0) st |= SextonFlag.Hurt;
      if (sx.defending) st |= SextonFlag.Defending;
      if (sx.stunT > 0) st |= SextonFlag.Stunned;
      if (sx.beaming) st |= SextonFlag.Beaming;
      entities.push(quantizeEntity(sx.id, EntityKind.Sexton, sx.x, sx.y, sx.facing, st, 0, sx.hp, sx.moving ? 1 : 0, 0));
    }
    // Shane Jeans is sent to everyone nearby (his faint light shows even in the dark; he is
    // still only drawn inside your own light).
    for (const sh of [w.shane, w.jaden]) if (Math.hypot(sh.x - v.move.x, sh.y - v.move.y) <= npcR) entities.push(sh.record());
    // His Hemp Beam glows: everyone nearby gets it.
    if (sx.beaming && Math.hypot(sx.x - v.move.x, sx.y - v.move.y) <= R + BALANCE.sexton.defense.beamRange) {
      entities.push(quantizeEntity(sx.beamId, EntityKind.Beam, sx.x, sx.y, sx.beamAng, 0, Math.round(Math.min(1, sx.beamAge / BALANCE.sexton.defense.beamTime) * 255), Math.round(sx.beamLen / 8)));
    }
    for (const n of [w.marc, w.plasma]) if (Math.hypot(n.x - v.move.x, n.y - v.move.y) <= npcR) entities.push(n.record());
    for (const d of w.drops) {
      if (Math.hypot(d.x - v.move.x, d.y - v.move.y) <= R) entities.push(quantizeEntity(d.id, EntityKind.Drop, d.x, d.y, 0, 0, 0, d.kind | (d.golden ? 8 : 0)));
    }
    const cz = w.chris;
    if (!cz.gone && Math.hypot(cz.x - v.move.x, cz.y - v.move.y) <= npcR) entities.push(cz.record());
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
    windowsBroken: w.windowsBroken.slice(),
    radar,
    reveal: w.revealT > 0 && !!v && v.role !== 'hunter',
    // Zach gets only the direction to a chasing Shane, never his position.
    shaneDir: v && v.role === 'hunter' && w.shane.chasing ? Math.atan2(w.shane.y - v.move.y, w.shane.x - v.move.x) : null,
    // Testing mode: where every NPC is (the map shows them all), in NPC_NAMES order.
    npcs: w.testMode
      ? [w.sexton.alive ? w.sexton : null, w.shane, w.chris.gone ? null : w.chris, w.marc, w.plasma, w.jaden].flatMap((n, k) => (n ? [{ k, x: n.x, y: n.y }] : []))
      : [],
  };
  return { self: selfState(w, peerPlayer, v), entities, world };
}
