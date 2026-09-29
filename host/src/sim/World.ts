import {
  Action,
  BALANCE,
  BarricadeState,
  Btn,
  Gait,
  Health,
  MapWorld,
  MoveMode,
  Rng,
  TICK_DT,
  resolveOverlaps,
  stepMovement,
  type GameEvent,
  type InputCmd,
  type MapData,
  type MatchPlayerInfo,
  type MatchResult,
  type ResolvedBalance,
} from '@manhunt/shared';
import { HISTORY_TICKS, createPlayer, type SimPlayer } from './player';
import { updateInteractions, handlePresses, computePrompts } from './interact';
import { updateCombat } from './combat';
import { updateTools } from './tools';
import { updateAbilities } from './abilities';
import { updateObjectives, checkWin } from './objectives';
import { updateSenses } from './senses';

export interface GenState {
  progress: number;
  repaired: boolean;
  fuel: boolean;
  wire: boolean;
  regressing: boolean;
  workers: number;
}

export interface Flare {
  id: number;
  x: number;
  y: number;
  t: number;
  owner: number;
}

export interface Bottle {
  id: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  owner: number;
}

export interface NoiseRecord {
  x: number;
  y: number;
  t: number;
  kind: string;
  /** True if a survivor caused it (Stalker's Pulse only reports these). */
  survivor: boolean;
}

export interface TrailRecord {
  x: number;
  y: number;
  t: number;
  /** 0 footprint, 1 blood. */
  kind: number;
}

export interface OutEvent {
  to: number[];
  e: GameEvent;
}

export interface WorldOptions {
  map: MapData;
  balance: ResolvedBalance;
  players: MatchPlayerInfo[];
  seed: number;
  /** Returns how far back (ms) a hunter's view lags, for lag compensation. */
  viewLagMs?: (playerId: number) => number;
}

/**
 * The authoritative match simulation. Pure and environment-agnostic: it only consumes
 * inputs and produces events and per-player views. GameHost owns networking.
 */
export class World {
  tick = 0;
  time = 0;
  readonly map: MapData;
  readonly mw: MapWorld;
  readonly balance: ResolvedBalance;
  readonly players = new Map<number, SimPlayer>();
  readonly order: SimPlayer[] = [];
  readonly rng: Rng;
  readonly gens: GenState[];
  readonly gate = { powered: false, progress: 0, open: false };
  readonly barricades: number[];
  readonly lootTaken: boolean[];
  readonly stakes: number[];
  readonly hiding: number[];
  flares: Flare[] = [];
  bottles: Bottle[] = [];
  noises: NoiseRecord[] = [];
  trails: TrailRecord[] = [];
  events: OutEvent[] = [];
  result: MatchResult | null = null;
  nextEntityId = 32;
  skillSeq = 1;
  readonly survivorsTotal: number;
  readonly viewLagMs: (playerId: number) => number;

  constructor(opts: WorldOptions) {
    this.map = opts.map;
    this.mw = new MapWorld(opts.map);
    this.balance = opts.balance;
    this.rng = new Rng(opts.seed ^ 0x5eed);
    this.viewLagMs = opts.viewLagMs ?? (() => BALANCE.net.interpolationDelayMs);
    this.gens = opts.map.generators.map(() => ({ progress: 0, repaired: false, fuel: false, wire: false, regressing: false, workers: 0 }));
    this.barricades = opts.map.barricades.map(() => BarricadeState.Up);
    this.lootTaken = opts.map.loot.map(() => false);
    this.stakes = opts.map.stakes.map(() => 0);
    this.hiding = opts.map.hidingSpots.map(() => 0);
    let si = 0;
    let hi = 0;
    for (const info of opts.players) {
      const spawn =
        info.role === 'hunter'
          ? opts.map.hunterSpawns[hi++ % opts.map.hunterSpawns.length]
          : opts.map.survivorSpawns[si++ % opts.map.survivorSpawns.length];
      const p = createPlayer(info.id, info.name, info.role, info.tint, spawn.x, spawn.y);
      if (info.role === 'survivor') p.flashCharges = BALANCE.survivor.startFlashCharges;
      this.addPlayer(p);
    }
    this.survivorsTotal = this.order.filter((p) => p.role === 'survivor').length;
  }

  get geo() {
    return this.mw.geo;
  }

  addPlayer(p: SimPlayer): void {
    p.joinedTime = this.time;
    this.players.set(p.id, p);
    this.order.push(p);
    this.order.sort((a, b) => a.id - b.id);
    if (p.role === 'spectator') p.spectating = this.defaultSpectateTarget(p.id);
  }

  defaultSpectateTarget(exclude: number): number {
    const live = this.order.find((q) => q.id !== exclude && (q.role === 'hunter' || (q.role === 'survivor' && q.health !== Health.Escaped && q.health !== Health.Eliminated)));
    return live?.id ?? 0;
  }

  /** Queues inputs from the network; older or duplicate sequence numbers are ignored. */
  enqueueInputs(id: number, cmds: InputCmd[]): void {
    const p = this.players.get(id);
    if (!p) return;
    let last = p.inputs.length ? p.inputs[p.inputs.length - 1].seq : p.lastSeq;
    for (const c of cmds) {
      if (c.seq <= last) continue;
      p.inputs.push(c);
      last = c.seq;
    }
    if (p.inputs.length > BALANCE.net.maxInputQueue * 4) p.inputs.splice(0, p.inputs.length - BALANCE.net.maxInputQueue * 4);
  }

  emit(to: number[] | 'all' | 'survivors' | 'hunters', e: GameEvent): void {
    let ids: number[];
    if (to === 'all') ids = this.order.map((p) => p.id);
    else if (to === 'survivors') ids = this.order.filter((p) => p.role !== 'hunter').map((p) => p.id);
    else if (to === 'hunters') ids = this.order.filter((p) => p.role === 'hunter' || p.role === 'spectator').map((p) => p.id);
    else ids = to;
    if (ids.length) this.events.push({ to: ids, e });
  }

  /** Emits a positional sound to everyone in earshot and records it for Stalker's Pulse. */
  noise(x: number, y: number, r: number, kind: string, survivor: boolean): void {
    this.noises.push({ x, y, t: this.time, kind, survivor });
    const to: number[] = [];
    for (const p of this.order) {
      const v = this.viewerFor(p);
      if (!v) continue;
      if (Math.hypot(v.move.x - x, v.move.y - y) <= r) to.push(p.id);
    }
    if (to.length) this.emit(to, { k: 'noise', x: Math.round(x), y: Math.round(y), r: Math.round(r), s: kind });
  }

  feed(text: string): void {
    this.emit('all', { k: 'feed', text });
  }

  viewerFor(p: SimPlayer): SimPlayer | undefined {
    if (p.role === 'spectator' || p.health === Health.Escaped || p.health === Health.Eliminated) {
      return this.players.get(p.spectating) ?? undefined;
    }
    return p;
  }

  moveModeFor(p: SimPlayer): MoveMode {
    if (p.role === 'spectator') return MoveMode.Locked;
    if (p.vault) return MoveMode.Locked;
    if (p.role === 'hunter') {
      if (p.stunT > 0) return MoveMode.Locked;
      if (p.action === Action.PickUp || p.action === Action.Stake || p.action === Action.Search || p.action === Action.BreakBarricade || p.action === Action.DamageGen) {
        return MoveMode.Locked;
      }
      return MoveMode.Normal;
    }
    if (p.health === Health.Downed) return MoveMode.Crawl;
    if (p.health !== Health.Healthy && p.health !== Health.Wounded) return MoveMode.Locked;
    if (p.hideState !== 0) return MoveMode.Locked;
    return MoveMode.Normal;
  }

  /** Advances the match by one fixed tick. */
  step(): void {
    if (this.result) return;
    this.tick++;
    this.time += TICK_DT;
    const dt = TICK_DT;

    for (const p of this.order) {
      p.inputBudget = Math.min(40, p.inputBudget + BALANCE.net.tickHz * dt * 1.1);
      // Catch up gently when inputs arrived in a burst.
      const n = p.inputs.length > 3 ? 2 : p.inputs.length > 0 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        if (p.inputBudget < 1) break;
        p.inputBudget -= 1;
        this.applyInput(p, p.inputs.shift()!);
      }
    }

    computePrompts(this);
    updateInteractions(this, dt);
    updateCombat(this, dt);
    updateTools(this, dt);
    updateAbilities(this, dt);
    updateObjectives(this, dt);
    updateSenses(this, dt);

    // Survivor health states are public (HUD roster).
    for (const p of this.order) {
      if (p.role !== 'survivor' || p.health === p.lastHealth) continue;
      p.lastHealth = p.health;
      this.emit('all', { k: 'health', id: p.id, h: p.health });
    }

    const slot = this.tick % HISTORY_TICKS;
    for (const p of this.order) {
      p.history[slot * 2] = p.move.x;
      p.history[slot * 2 + 1] = p.move.y;
      if (p.role !== 'spectator' && (p.role === 'hunter' || p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed || p.health === Health.Carried || p.health === Health.Staked)) {
        p.stats.timeAlive = this.time - p.joinedTime;
      }
    }
    checkWin(this);
  }

  private applyInput(p: SimPlayer, cmd: InputCmd): void {
    p.lastSeq = cmd.seq;
    p.lastCmd = cmd;
    const pressed = cmd.buttons & ~p.prevButtons;
    p.prevButtons = cmd.buttons;
    if (p.role === 'spectator' || p.health === Health.Escaped || p.health === Health.Eliminated) return;

    const locked = this.moveModeFor(p) === MoveMode.Locked;
    if (!locked || p.hideState === 2) {
      p.facing = cmd.aim;
      p.aimDist = cmd.aimDist;
    }
    handlePresses(this, p, cmd, pressed);

    // Moving cancels survivor interactions.
    if ((cmd.moveX || cmd.moveY) && p.role === 'survivor' && p.action !== Action.None && p.action !== Action.Vault && p.action !== Action.HideEnter && p.action !== Action.HideExit) {
      if (p.action !== Action.FlashAim) this.cancelAction(p);
    }

    p.move.mode = this.moveModeFor(p);
    const role = p.role === 'hunter' ? 'hunter' : 'survivor';
    const gait = stepMovement(p.move, cmd, { role, hunterSpeed: this.balance.hunterSpeed, carrying: p.carrying > 0 }, this.geo, TICK_DT);
    p.gait = p.move.mode === MoveMode.Locked ? Gait.Idle : gait;
    if (p.role === 'hunter' && cmd.buttons & Btn.Lunge && p.move.lungeT > 0 && !p.wasLunging) {
      p.lungeHit = false;
    }
  }

  startAction(p: SimPlayer, action: Action, dur: number, target: number): void {
    p.action = action;
    p.actionT = 0;
    p.actionDur = dur;
    p.actionTarget = target;
  }

  cancelAction(p: SimPlayer): void {
    if (p.action === Action.Repair && p.actionTarget >= 0) this.gens[p.actionTarget].workers = Math.max(0, this.gens[p.actionTarget].workers - 1);
    p.action = Action.None;
    p.actionT = 0;
    p.actionDur = 0;
    p.actionTarget = -1;
    p.skill = null;
  }

  /** Sets a barricade state and its collider. */
  setBarricade(id: number, state: number): void {
    this.barricades[id] = state;
    this.geo.setDynamicActive(this.map.barricades[id].dyn, state === BarricadeState.Down);
    if (state === BarricadeState.Down) {
      // Push anyone standing in the gap out of the new collider.
      for (const p of this.order) {
        if (p.role === 'spectator' || p.health === Health.Carried || p.hideState === 2 || p.vault) continue;
        resolveOverlaps(this.geo, p.move, p.radius);
      }
    }
  }

  allocEntityId(): number {
    const id = this.nextEntityId;
    this.nextEntityId = this.nextEntityId >= 250 ? 32 : this.nextEntityId + 1;
    return id;
  }

  setConnected(id: number, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.disconnectedAt = connected ? 0 : this.time;
    if (!connected) {
      p.inputs.length = 0;
      p.lastCmd = { ...p.lastCmd, buttons: 0, moveX: 0, moveY: 0 };
      p.prevButtons = 0;
    }
  }

  /** Grace period expired: survivors are eliminated, hunters leave the match. */
  forfeit(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.role === 'survivor' && p.health !== Health.Escaped && p.health !== Health.Eliminated) {
      eliminate(this, p, 'disconnected');
    } else if (p.role === 'hunter') {
      if (p.carrying) {
        const s = this.players.get(p.carrying);
        if (s) {
          s.health = Health.Wounded;
          s.carriedBy = 0;
        }
        p.carrying = 0;
      }
      p.health = Health.Eliminated;
      this.feed(`${p.name} left the hunt`);
    }
  }

  playerInfo(): MatchPlayerInfo[] {
    return this.order.map((p) => ({ id: p.id, name: p.name, role: p.role, tint: p.tint }));
  }
}

/** Removes a survivor from play (stake stage 2 or disconnect). */
export function eliminate(w: World, p: SimPlayer, why: 'stake' | 'disconnected', credit?: SimPlayer): void {
  if (p.stakeId >= 0) w.stakes[p.stakeId] = 0;
  if (p.carriedBy) {
    const h = w.players.get(p.carriedBy);
    if (h) h.carrying = 0;
  }
  if (p.hideSpot >= 0) w.hiding[p.hideSpot] = 0;
  w.cancelAction(p);
  p.health = Health.Eliminated;
  p.stakeId = -1;
  p.carriedBy = 0;
  p.hideSpot = -1;
  p.hideState = 0;
  p.stats.outcome = 'eliminated';
  p.endedTime = w.time;
  p.spectating = w.defaultSpectateTarget(p.id);
  if (credit) credit.stats.eliminations++;
  w.emit('all', { k: 'eliminated', victim: p.id });
  w.feed(why === 'disconnected' ? `${p.name} disconnected` : `${p.name} was sacrificed`);
}
