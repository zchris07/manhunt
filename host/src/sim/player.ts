import {
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

  /** Survivor inventory: count per ItemKind (index 0 unused). */
  inv: number[];
  /** Selected item kind (from the client's inventory slot). */
  selItem: number;
  /** Meter (seconds) of each pair of goggles carried, the one in use first. */
  goggles: number[];
  gogglesOn: boolean;
  /** Shells left in each shotgun carried, the one in use first. */
  shells: number[];
  reloadT: number;
  confit: number;
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
  /** The swing being wound up is a fully charged heavy swipe. */
  heavy: boolean;
  lungeHit: boolean;
  wasLunging: boolean;
  burstCd: number;
  /** Hemp Battery: 0 none, 1 carried, 2 infinite (testing mode). */
  hemp: number;

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
    inv: [0, 0, 0, 0, 0, 0],
    selItem: 0,
    goggles: [],
    gogglesOn: false,
    shells: [],
    reloadT: 0,
    confit: 0,
    jarvis: 0,
    jarvisT: 0,
    scareT: 0,
    gassed: false,
    attackCd: 0,
    attackWindup: 0,
    swingT: 0,
    chargeT: -1,
    heavy: false,
    lungeHit: false,
    wasLunging: false,
    burstCd: 0,
    hemp: 0,
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
  if (p.role === 'hunter') return p.stunT <= 0 && p.health !== Health.Eliminated;
  return (p.health === Health.Healthy || p.health === Health.Wounded) && p.hideState === 0;
}
