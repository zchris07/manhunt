import type { ResolvedBalance } from '../balance';
import type { MapParams } from '../map/types';
import type { Role } from '../sim/types';
import { decodeText, encodeText } from './binary';

export type RolePref = 'hunter' | 'survivor' | 'any';
export type AssignedRole = 'auto' | 'hunter' | 'survivor' | 'spectator';
export type Phase = 'lobby' | 'match' | 'results';

export interface LobbySettings {
  hunters: number;
  survivors: number;
  /** Map seed text; empty means random each match. */
  seed: string;
  /** Testing mode: switch roles in-match (T), infinite items and abilities, no win checks. */
  testMode: boolean;
}

export interface LobbyPlayerInfo {
  id: number;
  name: string;
  pref: RolePref;
  assigned: AssignedRole;
  ready: boolean;
  owner: boolean;
  connected: boolean;
  ping: number;
}

export interface MatchPlayerInfo {
  id: number;
  name: string;
  role: Role;
  tint: number;
}

export interface PlayerStats {
  id: number;
  name: string;
  role: Role;
  outcome: 'escaped' | 'eliminated' | 'survived' | 'hunter';
  repairSec: number;
  heals: number;
  revives: number;
  unstakes: number;
  stuns: number;
  hits: number;
  downs: number;
  stakes: number;
  eliminations: number;
  stunnedTimes: number;
  gensDamaged: number;
  timeAlive: number;
}

export interface MatchResult {
  winner: 'survivors' | 'hunters';
  reason: string;
  durationSec: number;
  escaped: number;
  eliminated: number;
  survivors: number;
  hunters: number;
  generatorsRepaired: number;
  generatorsRequired: number;
  stats: PlayerStats[];
}

export type GameEvent =
  | { k: 'noise'; x: number; y: number; r: number; s: string }
  | { k: 'feed'; text: string }
  /** Someone took damage (they flinch). `w` is what hit them. */
  | { k: 'hit'; victim: number; by: number; x: number; y: number; w?: 'slash' | 'bottle' | 'pellet' | 'beam' | 'punch' | 'bullet' }
  | { k: 'down'; victim: number }
  | { k: 'stun'; target: number; kind: string }
  | { k: 'staked'; victim: number; stage: number }
  | { k: 'unstaked'; victim: number }
  | { k: 'eliminated'; victim: number }
  | { k: 'escaped'; victim: number }
  | { k: 'genDone'; id: number }
  | { k: 'gatePowered' }
  | { k: 'gateOpen' }
  | { k: 'skill'; id: number; delayMs: number; zone: number; size: number; great: number; needleMs: number }
  | { k: 'skillResult'; ok: boolean; great: boolean }
  /** Scent trail points for Zach: x, y, kind (0 scent, 1 blood), age in tenths of a second. */
  /** Scent and blood: x, y, kind (0 scent, 1 blood), age in tenths of a second, owner id; repeated. */
  | { k: 'trail'; pts: number[] }
  | { k: 'breath'; x: number; y: number }
  | { k: 'item'; text: string }
  | { k: 'health'; id: number; h: number }
  /** Zach's melee swing (everyone near sees the swipe). */
  | { k: 'swing'; id: number; hit: boolean }
  /**
   * A shotgun blast from (x,y): `p` holds each pellet's angle (milliradians) and tracer length;
   * `hit` if any pellet hit a person; `gold` for a golden pump.
   */
  | { k: 'shot'; x: number; y: number; p: number[]; hit: boolean; gold: boolean }
  /** Soundcloud Burst wave launched from (x,y) at angle a. */
  | { k: 'burst'; x: number; y: number; a: number }
  /** The wave reached you: jump scare. */
  | { k: 'scare' }
  /** The Grapes of Wrath hit you (Zach): picture `img` covers your screen. */
  | { k: 'book'; img: number }
  /** The book's boom, heard by everyone near (x,y). */
  | { k: 'boom'; x: number; y: number }
  /** You slew Waz. */
  | { k: 'wazSlain' }
  | { k: 'jarvis'; by: number }
  /** Shane Jeans was alerted (true) or gave up the chase (false). */
  | { k: 'shane'; alerted: boolean }
  | { k: 'hemp'; by: number }
  | { k: 'sexton'; say: string }
  /** Chris Zelley speaks (a speech bubble over him). */
  | { k: 'chris'; say: string }
  /** Marc Cortez or Plasma.TTV speaks. */
  | { k: 'npc'; who: 'marc' | 'plasma' | 'jaden' | 'waz'; say: string }
  /** Sexton hands a glowing tablet to a survivor. */
  | { k: 'tablet'; to: number; x: number; y: number }
  | { k: 'gas'; x: number; y: number }
  | { k: 'barricadeHit'; id: number; hits: number }
  /** Testing mode: roles changed. */
  | { k: 'roles'; players: MatchPlayerInfo[] };

/** Messages from a client to the host (validated by the host). */
export type ClientMessage =
  | { t: 'hello'; name: string; token?: string; version: number }
  | { t: 'rolePref'; pref: RolePref }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; settings: LobbySettings }
  | { t: 'assign'; player: number; role: AssignedRole }
  | { t: 'shuffle' }
  | { t: 'start' }
  | { t: 'toLobby' }
  | { t: 'chat'; text: string }
  | { t: 'skill'; id: number; result: 'miss' | 'good' | 'great' }
  | { t: 'spectate'; dir: 1 | -1 }
  | { t: 'mapReq' }
  /** Testing mode only: switch between Zach and survivor mid-match. */
  | { t: 'switchRole' }
  /** Testing mode: teleport to a world point (clicked on the full map). */
  | { t: 'teleport'; x: number; y: number }
  /** Reorder the inventory: swap two slots. */
  | { t: 'moveSlot'; from: number; to: number }
  /** Dev/test commands; only honoured by a host started in dev mode (?dev=1). */
  | { t: 'dev'; cmd: string; args: number[] };

/** Messages from the host to a client. */
export type HostMessage =
  | { t: 'welcome'; you: number; token: string; room: string; version: number }
  | { t: 'lobby'; players: LobbyPlayerInfo[]; settings: LobbySettings; phase: Phase; owner: number }
  | {
      t: 'start';
      params: MapParams;
      balance: ResolvedBalance;
      players: MatchPlayerInfo[];
      you: number;
      role: Role;
      mapHash: number;
      tick: number;
    }
  | { t: 'ev'; e: GameEvent }
  | { t: 'end'; result: MatchResult }
  | { t: 'chat'; from: string; text: string }
  | { t: 'err'; msg: string }
  | { t: 'kick'; reason: string }
  | { t: 'mapChunk'; i: number; n: number; data: string }
  | { t: 'handicap'; ms: number };

export const JSON_TAG = 0x7b; // '{'

export function encodeJson(msg: ClientMessage | HostMessage): Uint8Array {
  return encodeText(JSON.stringify(msg));
}

export function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(decodeText(data));
}

export const NAME_RE = /^[\p{L}\p{N} _.\-']{2,16}$/u;

/** Trims, collapses whitespace and strips anything outside letters, digits and a few symbols. */
export function sanitizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.\-']/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

export function sanitizeChat(raw: string): string {
  return raw
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 140);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export function validSettings(s: unknown): s is LobbySettings {
  return (
    isObj(s) &&
    isInt(s.hunters, 1, 9) &&
    isInt(s.survivors, 1, 9) &&
    isStr(s.seed, 32) &&
    typeof s.testMode === 'boolean'
  );
}

/** Validates an untrusted client message against its schema. Returns null if invalid. */
export function parseClientMessage(v: unknown): ClientMessage | null {
  if (!isObj(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'hello':
      return isStr(v.name, 64) && isInt(v.version, 0, 1e6) && (v.token === undefined || isStr(v.token, 64))
        ? { t: 'hello', name: v.name, token: v.token as string | undefined, version: v.version }
        : null;
    case 'rolePref':
      return v.pref === 'hunter' || v.pref === 'survivor' || v.pref === 'any' ? { t: 'rolePref', pref: v.pref } : null;
    case 'ready':
      return typeof v.ready === 'boolean' ? { t: 'ready', ready: v.ready } : null;
    case 'settings':
      return validSettings(v.settings) ? { t: 'settings', settings: { ...v.settings } } : null;
    case 'assign':
      return isInt(v.player, 0, 255) && (v.role === 'auto' || v.role === 'hunter' || v.role === 'survivor' || v.role === 'spectator')
        ? { t: 'assign', player: v.player, role: v.role }
        : null;
    case 'shuffle':
    case 'start':
    case 'toLobby':
    case 'mapReq':
    case 'switchRole':
      return { t: v.t };
    case 'chat':
      return isStr(v.text, 280) ? { t: 'chat', text: v.text } : null;
    case 'skill':
      return isInt(v.id, 0, 1e9) && (v.result === 'miss' || v.result === 'good' || v.result === 'great') ? { t: 'skill', id: v.id, result: v.result } : null;
    case 'moveSlot':
      return isInt(v.from, 0, 7) && isInt(v.to, 0, 7) ? { t: 'moveSlot', from: v.from, to: v.to } : null;
    case 'teleport':
      return isNum(v.x, 0, 1e5) && isNum(v.y, 0, 1e5) ? { t: 'teleport', x: v.x, y: v.y } : null;
    case 'spectate':
      return v.dir === 1 || v.dir === -1 ? { t: 'spectate', dir: v.dir } : null;
    case 'dev':
      return isStr(v.cmd, 16) && Array.isArray(v.args) && v.args.length <= 4 && v.args.every((a) => isNum(a, -1e6, 1e6))
        ? { t: 'dev', cmd: v.cmd, args: v.args as number[] }
        : null;
    default:
      return null;
  }
}
