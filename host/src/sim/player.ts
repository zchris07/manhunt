import {
  BALANCE,
  Action,
  Gait,
  Health,
  Prompt,
  emptyInput,
  newMoveState,
  type InputCmd,
  type MoveState,
  type PlayerStats,
  type Role,
} from '@manhunt/shared';
import { newInventory, type Slot } from './inventory';

export const HISTORY_TICKS = 16;

/** Authoritative per-player state on the host. */
export interface SimPlayer {
  id: number;
  name: string;
  role: Role;
  tint: number;
  connected: boolean;
  disconnectedAt: number;

  move: MoveState;
  facing: number;
  aimDist: number;
  gait: Gait;
  radius: number;

  inputs: InputCmd[];
  lastSeq: number;
  lastCmd: InputCmd;
  /** Buttons held on the previous processed input (for edge detection). */
  prevButtons: number;
  inputBudget: number;

  health: Health;
  lastHealth: Health;
  /** Health, 0 to 1 (full). Survivors are down at 0; Zach (out of 100 hp) is down for a while. */
  hp: number;
  /** Zach: Penjamin cooldown, and how far he can see to the corner of his screen (his client says). */
  vapeCd: number;
  viewReach: number;
  /** Survivor, in Penjamin gas: seconds the slow and burn last, their strength, and seconds of darkness. */
  vapeT: number;
  vapeSlow: number;
  vapeDps: number;
  darkT: number;
  /** Survivor: blue shield bar on top of health, 0 to 1 (a full extra bar). Damage takes it first. */
  shield: number;
  /** Zach: seconds left down. */
  knockT: number;
  /** Zach: times he's been put down (Plasma's don't count): each one slows him for good. */
  downs: number;
  /** Zach: survivors he has staked (each buffs his speed and view for good). */
  stakeBuff: number;
  /** Zach: seconds left with a book picture over his screen. */
  bookT: number;
  /** Field of view multiplier (Waz). */
  fovMul: number;
  /** Already had Waz take a looksie. */
  wazLooked: boolean;
  action: Action;
  actionT: number;
  actionDur: number;
  actionTarget: number;

  stunT: number;
  immuneT: number;
  carrying: number;
  carriedBy: number;
  stakeId: number;
  stakeStage: number;
  stakeT: number;
  stakeCount: number;
  wiggle: number;

  hideSpot: number;
  /** 0 none, 1 entering, 2 hidden, 3 leaving. */
  hideState: number;
  hideT: number;
  breath: number;
  holdingBreath: boolean;
  gaspCd: number;

  /** Survivor inventory: eight free slots. */
  inv: Slot[];
  /** Selected slot (0-7), -1 for none. */
  selSlot: number;
  gogglesOn: boolean;
  /** Zach: golden pump shots left (it replaces the machete while he has any). */
  pump: number;
  reloadT: number;
  /** JARVIS: 0 none, 1 tablet in hand, 2 used, 3 infinite (testing mode). */
  jarvis: number;
  jarvisT: number;
  scareT: number;
  gassed: boolean;

  attackCd: number;
  attackWindup: number;
  swingT: number;
  /** Seconds the swing has been charged (left click held); -1 when not charging. */
  chargeT: number;
  /** Seconds left click has been held this charge (it strikes by itself at autoRelease). */
  chargeHeld: number;
  /** The swing being wound up is a fully charged heavy swipe. */
  heavy: boolean;
  /** Health the swipe being wound up will take. */
  swingDamage: number;
  lungeHit: boolean;
  wasLunging: boolean;
  burstCd: number;
  /** Hemp Battery: 0 none, 1 carried, 2 infinite (testing mode). */
  hemp: number;
  /** Seconds of Hemp Battery use left, whether it's switched on, and its lockout after running dry. */
  hempLeft: number;
  hempOn: boolean;
  hempLock: number;
  /** Hemp Beam (R): charges, cooldown, channel time left, its direction and length, entity id and what it already hit. */
  beamCharges: number;
  beamCd: number;
  beamT: number;
  beamAng: number;
  beamLen: number;
  beamTick: number;
  beamFlinch: number;
  beamId: number;
  readonly beamHit: Set<string>;
  /** Penjamin charges (the cooldown `vapeCd` is the time to the next one). */
  vapeCharges: number;
  /** Seconds left of the Penjamin slow. */
  vapeSlowT: number;
  /** Zach: the Grapes of Wrath switches his abilities off for this long. */
  abilityLockT: number;
  /** Zach: slew Jaden Nguyen (one more lunge charge, longer reach). */
  jadenBonus: number;
  /** Zach: he has '50 Nic' (from Chacko) in place of Penjamin. */
  nic: boolean;
  /** A survivor's sniper laser entity id. */
  laserId: number;

  noise: number;
  prompt: Prompt;
  promptTarget: number;
  prompt2: Prompt;
  prompt2Target: number;
  stakedBy: number;
  lastScent: number;
  lastBlood: number;
  terror: number;

  spectating: number;
  history: Float32Array;
  skill: { id: number; issued: number; deadline: number } | null;
  rtt: number;
  stats: PlayerStats;
  joinedTime: number;
  endedTime: number;
}

export function createPlayer(id: number, name: string, role: Role, tint: number, x: number, y: number): SimPlayer {
  const p: SimPlayer = {
    id,
    name,
    role,
    tint,
    connected: true,
    disconnectedAt: 0,
    move: newMoveState(x, y, role === 'hunter' ? 'hunter' : 'survivor'),
    facing: -Math.PI / 2,
    aimDist: 0,
    gait: Gait.Idle,
    radius: role === 'hunter' ? 19 : 15,
    inputs: [],
    lastSeq: 0,
    lastCmd: emptyInput(),
    prevButtons: 0,
    inputBudget: 40,
    health: role === 'spectator' ? Health.Eliminated : Health.Healthy,
    lastHealth: role === 'spectator' ? Health.Eliminated : Health.Healthy,
    hp: 1,
    knockT: 0,
    vapeCd: 0,
    viewReach: 0,
    vapeT: 0,
    vapeSlow: 0,
    vapeDps: 0,
    darkT: 0,
    shield: 0,
    downs: 0,
    stakeBuff: 0,
    bookT: 0,
    fovMul: 1,
    wazLooked: false,
    action: Action.None,
    actionT: 0,
    actionDur: 0,
    actionTarget: -1,
    stunT: 0,
    immuneT: 0,
    carrying: 0,
    carriedBy: 0,
    stakeId: -1,
    stakeStage: 0,
    stakeT: 0,
    stakeCount: 0,
    wiggle: 0,
    hideSpot: -1,
    hideState: 0,
    hideT: 0,
    breath: 1,
    holdingBreath: false,
    gaspCd: 0,
    inv: newInventory(),
    selSlot: -1,
    gogglesOn: false,
    pump: 0,
    reloadT: 0,
    jarvis: 0,
    jarvisT: 0,
    scareT: 0,
    gassed: false,
    attackCd: 0,
    attackWindup: 0,
    swingT: 0,
    chargeT: -1,
    chargeHeld: 0,
    heavy: false,
    swingDamage: 1 / 3,
    lungeHit: false,
    wasLunging: false,
    burstCd: 0,
    hemp: 0,
    hempLeft: BALANCE.hunter.hemp.duration,
    hempOn: false,
    hempLock: 0,
    beamCharges: 0,
    beamCd: 0,
    beamT: 0,
    beamAng: 0,
    beamLen: 0,
    beamTick: 0,
    beamFlinch: 0,
    beamId: 0,
    beamHit: new Set<string>(),
    vapeCharges: BALANCE.hunter.vape.charges,
    vapeSlowT: 0,
    abilityLockT: 0,
    jadenBonus: 0,
    laserId: 0,
    nic: false,
    noise: 0,
    prompt: Prompt.None,
    promptTarget: -1,
    prompt2: Prompt.None,
    prompt2Target: -1,
    stakedBy: 0,
    lastScent: 0,
    lastBlood: 0,
    terror: 0,
    spectating: 0,
    history: new Float32Array(HISTORY_TICKS * 2),
    skill: null,
    rtt: 0,
    stats: {
      id,
      name,
      role,
      outcome: role === 'hunter' ? 'hunter' : 'survived',
      repairSec: 0,
      heals: 0,
      revives: 0,
      unstakes: 0,
      stuns: 0,
      hits: 0,
      downs: 0,
      stakes: 0,
      eliminations: 0,
      stunnedTimes: 0,
      gensDamaged: 0,
      timeAlive: 0,
    },
    joinedTime: 0,
    endedTime: 0,
  };
  for (let i = 0; i < HISTORY_TICKS; i++) {
    p.history[i * 2] = x;
    p.history[i * 2 + 1] = y;
  }
  return p;
}

export const isSurvivor = (p: SimPlayer): boolean => p.role === 'survivor';
export const isHunter = (p: SimPlayer): boolean => p.role === 'hunter';

/** Survivor still in the match (not escaped or eliminated). */
export function inPlay(p: SimPlayer): boolean {
  return p.role === 'survivor' && p.health !== Health.Escaped && p.health !== Health.Eliminated;
}

/** Can walk around and interact (not downed, carried, staked, hidden). */
export function canAct(p: SimPlayer): boolean {
  if (p.role === 'spectator') return false;
  if (p.role === 'hunter') return p.stunT <= 0 && p.knockT <= 0 && p.health !== Health.Eliminated;
  return (p.health === Health.Healthy || p.health === Health.Wounded) && p.hideState === 0;
}
