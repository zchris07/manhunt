import { TAU } from '../math';
import { MSG_SNAPSHOT } from '../sim/input';
import type { Action, EntityKind, Health, MoveMode, Prompt } from '../sim/types';
import { ByteReader, ByteWriter } from './binary';

/** The receiving player's own full state (always sent in full; drives reconciliation and HUD). */
export interface SelfState {
  id: number;
  /** 0 survivor, 1 hunter, 2 spectator. */
  role: number;
  x: number;
  y: number;
  mode: MoveMode;
  health: Health;
  // Movement state mirrored for prediction.
  lungeT: number;
  lungeAng: number;
  lungeCharges: number;
  lungeRecharge: number;
  kbT: number;
  kbDur: number;
  kbPeak: number;
  kbAng: number;
  hasteT: number;
  slowT: number;
  slowMul: number;
  stamina: number;
  staminaLock: number;
  sprintBlocked: number;
  boostT: number;
  hempT: number;
  prevButtons: number;
  sprinting: number;

  stunT: number;
  immuneT: number;
  action: Action;
  actionProgress: number;
  actionTarget: number;
  prompt: Prompt;
  promptTarget: number;
  /** Space-bar action (slam a barricade). */
  prompt2: Prompt;
  hideSpot: number;
  hideState: number;
  carrying: number;
  carriedBy: number;
  stakeStage: number;
  stakeT: number;
  wiggle: number;
  breath: number;
  attackCd: number;
  burstCd: number;
  /** Zach holds a Hemp Battery (1) or has infinite ones in testing mode (2). */
  hemp: number;
  /** Survivor inventory: the eight slots in order. */
  slots: SlotState[];
  gogglesOn: number;
  /** Zach: seconds the swing has been charged (-1 = not charging). */
  chargeT: number;
  reloadT: number;
  /** JARVIS tablet: 1 unused, 2 used (map revealed), 3 infinite (testing mode). */
  jarvis: number;
  jarvisT: number;
  scareT: number;
  gassed: number;
  testMode: number;
  noise: number;
  spectating: number;
  /** Health, 0 (down) to 1 (full). */
  hp: number;
  /** Zach: golden pump shots left (it replaces the machete while he has any). */
  pump: number;
  /** Zach: times he's been put down (each slows him for good). */
  downs: number;
  /** Zach: seconds left of a Grapes of Wrath picture over his screen. */
  bookT: number;
  /** Field of view multiplier (Waz). */
  fovMul: number;
  /** Survivor: mini-shield bar, 0 to 1 (a full extra bar). */
  shield: number;
  /** Survivor: seconds left dizzy from Penjamin, and of its darkness. Zach: Penjamin cooldown. */
  vapeT: number;
  darkT: number;
  vapeCd: number;
  /** Zach: seconds of Hemp Battery left (held Q drains it). */
  hempLeft: number;
  /** Zach: survivors staked so far (+5% speed and view each). */
  stakeBuff: number;
  /** Zach: Hemp Battery lockout (s), Hemp Beam charges, cooldown and channel time left, Penjamin charges, abilities-off time, and Jaden-slain bonus (0/1). */
  hempLock: number;
  beamCharges: number;
  beamCd: number;
  beamT: number;
  vapeCharges: number;
  abilityLockT: number;
  jadenBonus: number;
  /** Zach: he has '50 Nic' in place of Penjamin. */
  nic: number;
  /** Zach: seconds left soaked in piss. */
  pissT: number;
  /** Monique's arrow: seconds left, the bearing to Zach (radians) and the distance (units). */
  arrowT: number;
  arrowAng: number;
  arrowDist: number;
}

/**
 * One inventory slot as the owner sees it. `amt` is the first unit's state: goggles' meter
 * (s), or a weapon's rounds left.
 */
export interface SlotState {
  kind: number;
  n: number;
  golden: boolean;
  amt: number;
}

export const emptySlots = (): SlotState[] => Array.from({ length: 8 }, () => ({ kind: 0, n: 0, golden: false, amt: 0 }));

export function emptySelf(id = 0): SelfState {
  return {
    id,
    role: 2,
    x: 0,
    y: 0,
    mode: 0,
    health: 0,
    lungeT: 0,
    lungeAng: 0,
    lungeCharges: 2,
    lungeRecharge: 0,
    kbT: 0,
    kbDur: 0,
    kbPeak: 0,
    kbAng: 0,
    hasteT: 0,
    slowT: 0,
    slowMul: 1,
    stamina: 0,
    staminaLock: 0,
    sprintBlocked: 0,
    boostT: 0,
    hempT: 0,
    prevButtons: 0,
    sprinting: 0,
    stunT: 0,
    immuneT: 0,
    action: 0,
    actionProgress: 0,
    actionTarget: -1,
    prompt: 0,
    promptTarget: -1,
    prompt2: 0,
    hideSpot: -1,
    hideState: 0,
    carrying: 0,
    carriedBy: 0,
    stakeStage: 0,
    stakeT: 0,
    wiggle: 0,
    breath: 1,
    attackCd: 0,
    burstCd: 0,
    hemp: 0,
    slots: emptySlots(),
    gogglesOn: 0,
    chargeT: -1,
    reloadT: 0,
    jarvis: 0,
    jarvisT: 0,
    scareT: 0,
    gassed: 0,
    testMode: 0,
    noise: 0,
    spectating: 0,
    hp: 1,
    pump: 0,
    downs: 0,
    bookT: 0,
    fovMul: 1,
    shield: 0,
    vapeT: 0,
    darkT: 0,
    vapeCd: 0,
    hempLeft: 0,
    stakeBuff: 0,
    hempLock: 0,
    beamCharges: 0,
    beamCd: 0,
    beamT: 0,
    vapeCharges: 0,
    abilityLockT: 0,
    jadenBonus: 0,
    nic: 0,
    pissT: 0,
    arrowT: 0,
    arrowAng: 0,
    arrowDist: 0,
  };
}

/** Entity state flag bits (u16). */
export const EF = {
  HealthMask: 0x7,
  Hunter: 1 << 3,
  GaitShift: 4,
  GaitMask: 0x3 << 4,
  Carrying: 1 << 6,
  Stunned: 1 << 7,
  Lunging: 1 << 8,
  /** Night vision goggles on. */
  Goggles: 1 << 9,
  /** Hemp Battery active. */
  Hemp: 1 << 10,
  Attacking: 1 << 11,
  /** Sprint meter ran dry and is locked out. */
  StaminaLock: 1 << 12,
  Busy: 1 << 13,
  Sprinting: 1 << 14,
  /** Slowed by galaxy gas. */
  Gassed: 1 << 15,
} as const;

/** Shane Jeans's state bits (EntityRecord.state for EntityKind.Shane). */
export const ShaneFlag = {
  Chasing: 1,
  Fleeing: 2,
} as const;

/** Jaden Nguyen's state bits: ShaneFlag's, plus a muzzle flash right after a shot. */
export const JadenFlag = {
  Chasing: 1,
  Fleeing: 2,
  Firing: 4,
  Dead: 8,
  Stunned: 16,
  Hurt: 32,
} as const;

/** Waz's state bits. */
export const WazFlag = {
  Fleeing: 1,
  Hurt: 2,
  Talking: 4,
} as const;

/** State bits shared by Njaaron, Monique, Thomas and Soham. */
export const FolkFlag = {
  Hurt: 1,
  Talking: 2,
  Fleeing: 4,
  /** Monique has her 0.50 cal out. */
  Armed: 8,
  /** Njaaron is swinging. */
  Punching: 16,
  /** Njaaron is following someone. */
  Following: 32,
  /** Soham's fuse is lit. */
  Fuse: 64,
  /** Njaaron is angry (attacking). */
  Angry: 128,
} as const;

/** Chacko's state bits. */
export const ChackoFlag = {
  Dead: 1,
  Hurt: 2,
  Talking: 4,
} as const;

/** Chris Zelley's state bits (EntityRecord.state for EntityKind.Chris). */
export const ChrisFlag = {
  Dead: 1,
  Fleeing: 2,
  /** Activated: he's left the ambulance and waits to be needed. */
  Active: 4,
  /** Running to a downed or staked survivor. */
  Rescuing: 8,
  /** Reviving or cutting someone down. */
  Working: 16,
  /** Done: wings out, flying to the heavens. */
  Ascending: 32,
  Hurt: 64,
} as const;

/** Sexton Science's state bits (EntityRecord.state for EntityKind.Sexton). */
export const SextonFlag = {
  Dead: 1,
  Fleeing: 2,
  Talking: 4,
  Hurt: 8,
  /** Self-defense mode (after a survivor hit him). */
  Defending: 16,
  Stunned: 32,
  Beaming: 64,
} as const;

/** Marc Cortez's state bits. */
export const MarcFlag = { Hurt: 1 } as const;

/** Plasma.TTV's state bits (action byte: transform progress 0-255). */
export const PlasmaFlag = {
  Raging: 1,
  Transforming: 2,
  Reverting: 4,
  Stunned: 8,
  Hurt: 16,
  Blind: 32,
  Punching: 64,
  Dead: 128,
} as const;

/**
 * A quantised entity as sent on the wire. x/y are in 1/8 units, facing in 1/256 turns.
 * `aux` holds a survivor's held item (low 4 bits, GOLDEN_BIT) or Zach's swing charge
 * (0-255), and `hp` the health bar over their head (0-255 of full health). A survivor's
 * `extra` is their stake timer while staked, otherwise their mini-shield bar (0-255).
 */
export interface EntityRecord {
  id: number;
  kind: EntityKind;
  qx: number;
  qy: number;
  qfacing: number;
  state: number;
  action: number;
  extra: number;
  aux: number;
  hp: number;
}

export function quantizeEntity(
  id: number,
  kind: EntityKind,
  x: number,
  y: number,
  facing: number,
  state: number,
  action: number,
  extra: number,
  aux = 0,
  hp = 0,
): EntityRecord {
  return {
    id,
    kind,
    qx: Math.max(0, Math.min(65535, Math.round(x * 8))),
    qy: Math.max(0, Math.min(65535, Math.round(y * 8))),
    qfacing: Math.round(((((facing % TAU) + TAU) % TAU) / TAU) * 256) & 0xff,
    state: state & 0xffff,
    action: action & 0xff,
    extra: extra & 0xff,
    aux: aux & 0xff,
    hp: Math.max(0, Math.min(255, Math.round(hp))),
  };
}

export const entityX = (e: EntityRecord): number => e.qx / 8;
export const entityY = (e: EntityRecord): number => e.qy / 8;
export const entityFacing = (e: EntityRecord): number => (e.qfacing / 256) * TAU;

/** World objective state visible to a player. */
export interface WorldState {
  timeLeft: number;
  required: number;
  repaired: number;
  escaped: number;
  eliminated: number;
  survivorsTotal: number;
  gens: { progress: number; flags: number }[];
  gatePowered: boolean;
  gateProgress: number;
  gateOpen: boolean;
  barricades: number[];
  lootTaken: boolean[];
  stakes: number[];
  hidingOccupied: boolean[];
  doors: boolean[];
  /** Doors Zach smashed. */
  doorsBroken: boolean[];
  /** Windows Zach smashed. */
  windowsBroken: boolean[];
  /** JARVIS radar: hunter positions (only while this player's radar is running). */
  radar: { x: number; y: number }[];
  /** JARVIS is running: everyone's whole screen is visible. */
  reveal: boolean;
  /** Zach only: direction (radians) to Shane Jeans while he's chasing someone, else null. */
  shaneDir: number | null;
  /** Testing mode: every NPC on the map (k = NPC_NAMES index). */
  npcs: { k: number; x: number; y: number }[];
}

export const GenFlag = {
  Repaired: 1,
  BeingRepaired: 2,
  Regressing: 16,
  Known: 32,
} as const;

function packBits(w: ByteWriter, bits: readonly boolean[]): void {
  w.u16(bits.length);
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8 && i + k < bits.length; k++) if (bits[i + k]) b |= 1 << k;
    w.u8(b);
  }
}

function unpackBits(r: ByteReader): boolean[] {
  const n = r.u16();
  const out: boolean[] = [];
  for (let i = 0; i < n; i += 8) {
    const b = r.u8();
    for (let k = 0; k < 8 && i + k < n; k++) out.push((b & (1 << k)) !== 0);
  }
  return out;
}

export function encodeWorld(ws: WorldState): Uint8Array {
  const w = new ByteWriter(160);
  w.u16(Math.max(0, Math.ceil(ws.timeLeft)));
  w.u8(ws.required).u8(ws.repaired).u8(ws.escaped).u8(ws.eliminated).u8(ws.survivorsTotal);
  w.u8(ws.gens.length);
  for (const g of ws.gens) w.u8(Math.round(Math.max(0, Math.min(1, g.progress)) * 255)).u8(g.flags);
  w.u8(ws.gatePowered ? 1 : 0).u8(Math.round(ws.gateProgress * 255)).u8(ws.gateOpen ? 1 : 0);
  w.u8(ws.barricades.length);
  for (const b of ws.barricades) w.u8(b);
  packBits(w, ws.lootTaken);
  w.u8(ws.stakes.length);
  for (const s of ws.stakes) w.u8(s);
  packBits(w, ws.hidingOccupied);
  packBits(w, ws.doors);
  packBits(w, ws.doorsBroken);
  packBits(w, ws.windowsBroken);
  w.u8(ws.radar.length);
  for (const p of ws.radar) w.u16(Math.max(0, Math.round(p.x))).u16(Math.max(0, Math.round(p.y)));
  w.u8(ws.reveal ? 1 : 0);
  w.u16(ws.shaneDir === null ? 0xffff : Math.round(((((ws.shaneDir % TAU) + TAU) % TAU) / TAU) * 0xfffe));
  w.u8(ws.npcs.length);
  for (const n of ws.npcs) w.u8(n.k).u16(Math.max(0, Math.round(n.x))).u16(Math.max(0, Math.round(n.y)));
  return w.finish();
}

export function decodeWorld(bytes: Uint8Array): WorldState {
  const r = new ByteReader(bytes);
  const timeLeft = r.u16();
  const required = r.u8();
  const repaired = r.u8();
  const escaped = r.u8();
  const eliminated = r.u8();
  const survivorsTotal = r.u8();
  const gens: WorldState['gens'] = [];
  const ng = r.u8();
  for (let i = 0; i < ng; i++) gens.push({ progress: r.u8() / 255, flags: r.u8() });
  const gatePowered = r.u8() === 1;
  const gateProgress = r.u8() / 255;
  const gateOpen = r.u8() === 1;
  const barricades: number[] = [];
  const nb = r.u8();
  for (let i = 0; i < nb; i++) barricades.push(r.u8());
  const lootTaken = unpackBits(r);
  const stakes: number[] = [];
  const ns = r.u8();
  for (let i = 0; i < ns; i++) stakes.push(r.u8());
  const hidingOccupied = unpackBits(r);
  const doors = unpackBits(r);
  const doorsBroken = unpackBits(r);
  const windowsBroken = unpackBits(r);
  const radar: WorldState['radar'] = [];
  const nr = r.u8();
  for (let i = 0; i < nr; i++) radar.push({ x: r.u16(), y: r.u16() });
  const reveal = r.u8() === 1;
  const sd = r.u16();
  const shaneDir = sd === 0xffff ? null : (sd / 0xfffe) * TAU;
  const npcs: WorldState['npcs'] = [];
  const nn = r.u8();
  for (let i = 0; i < nn; i++) npcs.push({ k: r.u8(), x: r.u16(), y: r.u16() });
  return {
    timeLeft,
    required,
    repaired,
    escaped,
    eliminated,
    survivorsTotal,
    gens,
    gatePowered,
    gateProgress,
    gateOpen,
    barricades,
    lootTaken,
    stakes,
    hidingOccupied,
    doors,
    doorsBroken,
    windowsBroken,
    radar,
    reveal,
    shaneDir,
    npcs,
  };
}

const ms = (s: number): number => Math.max(0, Math.min(65535, Math.round(s * 1000)));
const unit = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
const hundredths = (s: number): number => Math.max(0, Math.min(65535, Math.round(s * 100)));
const tenths = (s: number): number => Math.max(0, Math.min(65535, Math.round(s * 10)));
const ANG = 65535 / TAU;
const angQ = (a: number): number => Math.round((((a % TAU) + TAU) % TAU) * ANG) & 0xffff;

function writeSelf(w: ByteWriter, s: SelfState): void {
  w.u8(s.id).u8(s.role).f32(s.x).f32(s.y).u8(s.mode).u8(s.health);
  w.u16(ms(s.lungeT)).u16(angQ(s.lungeAng)).u8(s.lungeCharges).u16(ms(s.lungeRecharge));
  w.u16(ms(s.kbT)).u16(ms(s.kbDur)).u16(Math.round(s.kbPeak)).u16(angQ(s.kbAng));
  w.u16(ms(s.hasteT)).u16(ms(s.slowT)).u8(unit(s.slowMul));
  w.f32(s.stamina).u16(ms(s.staminaLock)).u8(s.sprintBlocked).u16(ms(s.boostT)).u16(ms(s.hempT)).u16(s.prevButtons).u8(s.sprinting);
  w.u16(ms(s.stunT)).u16(ms(s.immuneT));
  w.u8(s.action).u8(unit(s.actionProgress)).i16(s.actionTarget);
  w.u8(s.prompt).i16(s.promptTarget).u8(s.prompt2);
  w.i16(s.hideSpot).u8(s.hideState).u8(s.carrying).u8(s.carriedBy);
  w.u8(s.stakeStage).u16(tenths(s.stakeT)).u8(unit(s.wiggle));
  w.u8(unit(s.breath)).u16(ms(s.attackCd)).u16(tenths(s.burstCd)).u8(s.hemp);
  for (let i = 0; i < 8; i++) {
    const sl = s.slots[i] ?? { kind: 0, n: 0, golden: false, amt: 0 };
    w.u8((sl.kind & 15) | (sl.golden ? 16 : 0)).u16(Math.min(65535, sl.n)).u16(sl.kind === 2 ? tenths(sl.amt) : Math.max(0, Math.min(65535, Math.round(sl.amt))));
  }
  w.u8(s.gogglesOn).u16(ms(s.chargeT + 1)).u16(ms(s.reloadT));
  w.u8(s.jarvis).u16(tenths(s.jarvisT)).u16(tenths(s.scareT)).u8(s.gassed).u8(s.testMode);
  w.u8(unit(s.noise)).u8(s.spectating);
  w.u16(Math.round(Math.max(0, Math.min(1, s.hp)) * 65535)).u8(s.pump).u8(s.downs).u16(tenths(s.bookT)).u16(Math.round(s.fovMul * 1000)).u8(unit(s.shield));
  w.u16(tenths(s.vapeT)).u16(tenths(s.darkT)).u16(tenths(s.vapeCd)).u16(hundredths(s.hempLeft)).u8(Math.min(255, s.stakeBuff));
  w.u16(tenths(s.hempLock)).u8(s.beamCharges).u16(tenths(s.beamCd)).u16(tenths(s.beamT)).u8(s.vapeCharges).u16(tenths(s.abilityLockT)).u8(s.jadenBonus).u8(s.nic).u16(tenths(s.pissT)).u16(tenths(s.arrowT)).u16(Math.round((((s.arrowAng % TAU) + TAU) % TAU) * 10000)).u16(Math.min(65535, Math.round(s.arrowDist)));
}

function readSelf(r: ByteReader): SelfState {
  const s = emptySelf();
  s.id = r.u8();
  s.role = r.u8();
  s.x = r.f32();
  s.y = r.f32();
  s.mode = r.u8() as MoveMode;
  s.health = r.u8() as Health;
  s.lungeT = r.u16() / 1000;
  s.lungeAng = r.u16() / ANG;
  s.lungeCharges = r.u8();
  s.lungeRecharge = r.u16() / 1000;
  s.kbT = r.u16() / 1000;
  s.kbDur = r.u16() / 1000;
  s.kbPeak = r.u16();
  s.kbAng = r.u16() / ANG;
  s.hasteT = r.u16() / 1000;
  s.slowT = r.u16() / 1000;
  s.slowMul = r.u8() / 255;
  s.stamina = r.f32();
  s.staminaLock = r.u16() / 1000;
  s.sprintBlocked = r.u8();
  s.boostT = r.u16() / 1000;
  s.hempT = r.u16() / 1000;
  s.prevButtons = r.u16();
  s.sprinting = r.u8();
  s.stunT = r.u16() / 1000;
  s.immuneT = r.u16() / 1000;
  s.action = r.u8() as Action;
  s.actionProgress = r.u8() / 255;
  s.actionTarget = r.i16();
  s.prompt = r.u8() as Prompt;
  s.promptTarget = r.i16();
  s.prompt2 = r.u8() as Prompt;
  s.hideSpot = r.i16();
  s.hideState = r.u8();
  s.carrying = r.u8();
  s.carriedBy = r.u8();
  s.stakeStage = r.u8();
  s.stakeT = r.u16() / 10;
  s.wiggle = r.u8() / 255;
  s.breath = r.u8() / 255;
  s.attackCd = r.u16() / 1000;
  s.burstCd = r.u16() / 10;
  s.hemp = r.u8();
  s.slots = [];
  for (let i = 0; i < 8; i++) {
    const kg = r.u8();
    const n = r.u16();
    const raw = r.u16();
    const kind = kg & 15;
    s.slots.push({ kind, n, golden: (kg & 16) !== 0, amt: kind === 2 ? raw / 10 : raw });
  }
  s.gogglesOn = r.u8();
  s.chargeT = r.u16() / 1000 - 1;
  s.reloadT = r.u16() / 1000;
  s.jarvis = r.u8();
  s.jarvisT = r.u16() / 10;
  s.scareT = r.u16() / 10;
  s.gassed = r.u8();
  s.testMode = r.u8();
  s.noise = r.u8() / 255;
  s.spectating = r.u8();
  s.hp = r.u16() / 65535;
  s.pump = r.u8();
  s.downs = r.u8();
  s.bookT = r.u16() / 10;
  s.fovMul = r.u16() / 1000;
  s.shield = r.u8() / 255;
  s.vapeT = r.u16() / 10;
  s.darkT = r.u16() / 10;
  s.vapeCd = r.u16() / 10;
  s.hempLeft = r.u16() / 100;
  s.stakeBuff = r.u8();
  s.hempLock = r.u16() / 10;
  s.beamCharges = r.u8();
  s.beamCd = r.u16() / 10;
  s.beamT = r.u16() / 10;
  s.vapeCharges = r.u8();
  s.abilityLockT = r.u16() / 10;
  s.jadenBonus = r.u8();
  s.nic = r.u8();
  s.pissT = r.u16() / 10;
  s.arrowT = r.u16() / 10;
  s.arrowAng = r.u16() / 10000;
  s.arrowDist = r.u16();
  return s;
}

const M_POS = 1;
const M_FACING = 2;
const M_STATE = 4;
const M_ACTION = 8;
const M_EXTRA = 16;
const M_AUX = 32;
const M_HP = 64;
const M_FULL = 0x80;

/** What the host remembers about a snapshot it sent (for delta baselines). */
export interface SentSnapshot {
  tick: number;
  entities: Map<number, EntityRecord>;
  world: Uint8Array;
}

export interface DecodedSnapshot extends SentSnapshot {
  baseTick: number;
  lastSeq: number;
  self: SelfState;
  worldState: WorldState;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Encodes a snapshot, delta-compressed against `base` (the newest snapshot the client has
 * acknowledged) when available. Unchanged entities are omitted entirely.
 */
export function encodeSnapshot(
  tick: number,
  base: SentSnapshot | null,
  lastSeq: number,
  self: SelfState,
  entities: readonly EntityRecord[],
  world: Uint8Array,
): Uint8Array {
  const w = new ByteWriter(320);
  w.u8(MSG_SNAPSHOT).u32(tick).u32(base ? base.tick : 0).u32(lastSeq);
  writeSelf(w, self);

  const current = new Set<number>();
  let count = 0;
  const body = new ByteWriter(128);
  for (const e of entities) {
    current.add(e.id);
    const prev = base?.entities.get(e.id);
    if (!prev || prev.kind !== e.kind) {
      body.u8(e.id).u8(M_FULL).u8(e.kind).u16(e.qx).u16(e.qy).u8(e.qfacing).u16(e.state).u8(e.action).u8(e.extra).u8(e.aux).u8(e.hp);
      count++;
      continue;
    }
    let mask = 0;
    if (prev.qx !== e.qx || prev.qy !== e.qy) mask |= M_POS;
    if (prev.qfacing !== e.qfacing) mask |= M_FACING;
    if (prev.state !== e.state) mask |= M_STATE;
    if (prev.action !== e.action) mask |= M_ACTION;
    if (prev.extra !== e.extra) mask |= M_EXTRA;
    if (prev.aux !== e.aux) mask |= M_AUX;
    if (prev.hp !== e.hp) mask |= M_HP;
    if (!mask) continue;
    body.u8(e.id).u8(mask);
    if (mask & M_POS) body.u16(e.qx).u16(e.qy);
    if (mask & M_FACING) body.u8(e.qfacing);
    if (mask & M_STATE) body.u16(e.state);
    if (mask & M_ACTION) body.u8(e.action);
    if (mask & M_EXTRA) body.u8(e.extra);
    if (mask & M_AUX) body.u8(e.aux);
    if (mask & M_HP) body.u8(e.hp);
    count++;
  }
  w.u8(count).bytes(body.finish());
  const removed: number[] = [];
  if (base) for (const id of base.entities.keys()) if (!current.has(id)) removed.push(id);
  w.u8(removed.length);
  for (const id of removed) w.u8(id);

  if (base && bytesEqual(base.world, world)) {
    w.u8(0);
  } else {
    w.u8(1).u16(world.length).bytes(world);
  }
  return w.finish();
}

/**
 * Decodes a snapshot. `baseline` must return the previously decoded snapshot for the
 * snapshot's base tick; returns null if that baseline is unknown.
 */
export function decodeSnapshot(data: Uint8Array, baseline: (tick: number) => SentSnapshot | undefined): DecodedSnapshot | null {
  const r = new ByteReader(data);
  if (r.u8() !== MSG_SNAPSHOT) throw new Error('not a snapshot');
  const tick = r.u32();
  const baseTick = r.u32();
  const lastSeq = r.u32();
  const self = readSelf(r);
  const base = baseTick ? baseline(baseTick) : undefined;
  if (baseTick && !base) return null;

  const entities = new Map<number, EntityRecord>();
  if (base) for (const [id, e] of base.entities) entities.set(id, { ...e });
  const count = r.u8();
  for (let i = 0; i < count; i++) {
    const id = r.u8();
    const mask = r.u8();
    if (mask & M_FULL) {
      const kind = r.u8() as EntityKind;
      entities.set(id, { id, kind, qx: r.u16(), qy: r.u16(), qfacing: r.u8(), state: r.u16(), action: r.u8(), extra: r.u8(), aux: r.u8(), hp: r.u8() });
      continue;
    }
    const e = entities.get(id);
    if (!e) throw new Error(`delta for unknown entity ${id}`);
    if (mask & M_POS) {
      e.qx = r.u16();
      e.qy = r.u16();
    }
    if (mask & M_FACING) e.qfacing = r.u8();
    if (mask & M_STATE) e.state = r.u16();
    if (mask & M_ACTION) e.action = r.u8();
    if (mask & M_EXTRA) e.extra = r.u8();
    if (mask & M_AUX) e.aux = r.u8();
    if (mask & M_HP) e.hp = r.u8();
  }
  const removed = r.u8();
  for (let i = 0; i < removed; i++) entities.delete(r.u8());

  let world: Uint8Array;
  if (r.u8() === 1) {
    const n = r.u16();
    world = r.bytes(n).slice();
  } else {
    if (!base) throw new Error('world delta without baseline');
    world = base.world;
  }
  return { tick, baseTick, lastSeq, self, entities, world, worldState: decodeWorld(world) };
}
