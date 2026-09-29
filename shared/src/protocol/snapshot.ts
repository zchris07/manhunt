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
  lungeT: number;
  lungeCd: number;
  hasteT: number;
  slowT: number;
  slowMul: number;
  stunT: number;
  blindT: number;
  immuneT: number;
  action: Action;
  actionProgress: number;
  actionTarget: number;
  prompt: Prompt;
  promptTarget: number;
  /** Space-bar action (vault, slam barricade, break barricade). */
  prompt2: Prompt;
  hideSpot: number;
  hideState: number;
  carrying: number;
  carriedBy: number;
  stakeStage: number;
  stakeT: number;
  wiggle: number;
  fuel: number;
  wire: number;
  tool: number;
  toolCount: number;
  flashCharges: number;
  flashHold: number;
  breath: number;
  attackCd: number;
  pulseCd: number;
  bloodhoundCd: number;
  bloodhoundT: number;
  smashCd: number;
  terror: number;
  noise: number;
  spectating: number;
}

export function emptySelf(id = 0): SelfState {
  return {
    id,
    role: 2,
    x: 0,
    y: 0,
    mode: 0,
    health: 0,
    lungeT: 0,
    lungeCd: 0,
    hasteT: 0,
    slowT: 0,
    slowMul: 1,
    stunT: 0,
    blindT: 0,
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
    fuel: 0,
    wire: 0,
    tool: 0,
    toolCount: 0,
    flashCharges: 0,
    flashHold: 0,
    breath: 1,
    attackCd: 0,
    pulseCd: 0,
    bloodhoundCd: 0,
    bloodhoundT: 0,
    smashCd: 0,
    terror: 0,
    noise: 0,
    spectating: 0,
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
  FlashBeam: 1 << 9,
  Blinded: 1 << 10,
  Attacking: 1 << 11,
  Vaulting: 1 << 12,
  Busy: 1 << 13,
  Chase: 1 << 14,
} as const;

/** A quantised entity as sent on the wire. x/y are in 1/8 units, facing in 1/256 turns. */
export interface EntityRecord {
  id: number;
  kind: EntityKind;
  qx: number;
  qy: number;
  qfacing: number;
  state: number;
  action: number;
  extra: number;
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
}

export const GenFlag = {
  Repaired: 1,
  BeingRepaired: 2,
  Fuel: 4,
  Wire: 8,
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
  const w = new ByteWriter(128);
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
  };
}

const ms = (s: number): number => Math.max(0, Math.min(65535, Math.round(s * 1000)));
const unit = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

function writeSelf(w: ByteWriter, s: SelfState): void {
  w.u8(s.id).u8(s.role).f32(s.x).f32(s.y).u8(s.mode).u8(s.health);
  w.u16(ms(s.lungeT)).u16(ms(s.lungeCd)).u16(ms(s.hasteT)).u16(ms(s.slowT)).u8(unit(s.slowMul));
  w.u16(ms(s.stunT)).u16(ms(s.blindT)).u16(ms(s.immuneT));
  w.u8(s.action).u8(unit(s.actionProgress)).i16(s.actionTarget);
  w.u8(s.prompt).i16(s.promptTarget).u8(s.prompt2);
  w.i16(s.hideSpot).u8(s.hideState).u8(s.carrying).u8(s.carriedBy);
  w.u8(s.stakeStage).u16(Math.round(s.stakeT * 10)).u8(unit(s.wiggle));
  w.u8(s.fuel).u8(s.wire).u8(s.tool).u8(s.toolCount).u8(s.flashCharges).u8(unit(s.flashHold));
  w.u8(unit(s.breath));
  w.u16(ms(s.attackCd)).u16(Math.round(s.pulseCd * 10)).u16(Math.round(s.bloodhoundCd * 10)).u16(ms(s.bloodhoundT)).u16(Math.round(s.smashCd * 10));
  w.u8(unit(s.terror)).u8(unit(s.noise)).u8(s.spectating);
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
  s.lungeCd = r.u16() / 1000;
  s.hasteT = r.u16() / 1000;
  s.slowT = r.u16() / 1000;
  s.slowMul = r.u8() / 255;
  s.stunT = r.u16() / 1000;
  s.blindT = r.u16() / 1000;
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
  s.fuel = r.u8();
  s.wire = r.u8();
  s.tool = r.u8();
  s.toolCount = r.u8();
  s.flashCharges = r.u8();
  s.flashHold = r.u8() / 255;
  s.breath = r.u8() / 255;
  s.attackCd = r.u16() / 1000;
  s.pulseCd = r.u16() / 10;
  s.bloodhoundCd = r.u16() / 10;
  s.bloodhoundT = r.u16() / 1000;
  s.smashCd = r.u16() / 10;
  s.terror = r.u8() / 255;
  s.noise = r.u8() / 255;
  s.spectating = r.u8();
  return s;
}

const M_POS = 1;
const M_FACING = 2;
const M_STATE = 4;
const M_ACTION = 8;
const M_EXTRA = 16;
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
  const w = new ByteWriter(256);
  w.u8(MSG_SNAPSHOT).u32(tick).u32(base ? base.tick : 0).u32(lastSeq);
  writeSelf(w, self);

  const current = new Set<number>();
  let count = 0;
  const body = new ByteWriter(128);
  for (const e of entities) {
    current.add(e.id);
    const prev = base?.entities.get(e.id);
    if (!prev || prev.kind !== e.kind) {
      body.u8(e.id).u8(M_FULL).u8(e.kind).u16(e.qx).u16(e.qy).u8(e.qfacing).u16(e.state).u8(e.action).u8(e.extra);
      count++;
      continue;
    }
    let mask = 0;
    if (prev.qx !== e.qx || prev.qy !== e.qy) mask |= M_POS;
    if (prev.qfacing !== e.qfacing) mask |= M_FACING;
    if (prev.state !== e.state) mask |= M_STATE;
    if (prev.action !== e.action) mask |= M_ACTION;
    if (prev.extra !== e.extra) mask |= M_EXTRA;
    if (!mask) continue;
    body.u8(e.id).u8(mask);
    if (mask & M_POS) body.u16(e.qx).u16(e.qy);
    if (mask & M_FACING) body.u8(e.qfacing);
    if (mask & M_STATE) body.u16(e.state);
    if (mask & M_ACTION) body.u8(e.action);
    if (mask & M_EXTRA) body.u8(e.extra);
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
      entities.set(id, { id, kind, qx: r.u16(), qy: r.u16(), qfacing: r.u8(), state: r.u16(), action: r.u8(), extra: r.u8() });
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
