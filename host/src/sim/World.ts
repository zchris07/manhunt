import {
  Action,
  BALANCE,
  BarricadeState,
  Gait,
  Health,
  ItemKind,
  MapWorld,
  MoveMode,
  Rng,
  SLOT_ITEMS,
  TICK_DT,
  newMoveState,
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
import { updateInteractions, handlePresses, computePrompts, exitHiding } from './interact';
import { lungeContact, restoreSurvivor, updateCombat } from './combat';
import { updateItems } from './items';
import { updateAbilities } from './abilities';
import { updateObjectives, checkWin } from './objectives';
import { updateSenses } from './senses';
import { Sexton, updateSexton } from './sexton';
import { Shane } from './shane';
import { Chris } from './chris';
import { Marc } from './marc';
import { Plasma } from './plasma';
import type { NpcTarget } from './npc';

export interface GenState {
  progress: number;
  repaired: boolean;
  regressing: boolean;
  workers: number;
}

export interface ThrownBottle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
  owner: number;
}

/** An item a survivor dropped (G) for a teammate. `amount`: goggle meter or shells left. */
export interface Drop {
  id: number;
  x: number;
  y: number;
  kind: ItemKind;
  golden: boolean;
  amount: number;
}

export interface Trap {
  id: number;
  x: number;
  y: number;
  owner: number;
  armT: number;
}

export interface Gas {
  id: number;
  x: number;
  y: number;
  age: number;
}

/** A Soundcloud Burst wave: origin, unit direction, launch time. */
export interface Burst {
  x: number;
  y: number;
  dx: number;
  dy: number;
  t0: number;
  by: number;
  hit: Set<number>;
}

export interface TrailRecord {
  id: number;
  x: number;
  y: number;
  t: number;
  /** 0 scent (sprinting), 1 blood. */
  kind: number;
  /** Whose trail it is (points of one person join into one unbroken ribbon). */
  who: number;
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
  /** Testing mode: role switching, infinite items, no win checks. */
  testMode?: boolean;
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
  readonly barricadeHits: number[];
  readonly doors: boolean[];
  /** Swipes each closed door has taken, and doors Zach smashed (open for good). */
  readonly doorHits: number[];
  readonly doorBroken: boolean[];
  /** Windows Zach smashed (he can climb through them). */
  readonly windowsBroken: boolean[];
  readonly doorCd: number[];
  readonly lootTaken: boolean[];
  readonly stakes: number[];
  readonly hiding: number[];
  bottles: ThrownBottle[] = [];
  traps: Trap[] = [];
  drops: Drop[] = [];
  gases: Gas[] = [];
  bursts: Burst[] = [];
  trails: TrailRecord[] = [];
  trailSeq = 1;
  /** Per hunter: scent trail ids already sent. */
  readonly trailSent = new Map<number, Set<number>>();
  hempDrop: { id: number; x: number; y: number } | null = null;
  readonly sexton: Sexton;
  readonly shane: Shane;
  readonly chris: Chris;
  readonly marc: Marc;
  readonly plasma: Plasma;
  /** Seconds left of a JARVIS reveal: everyone sees everything on screen. */
  revealT = 0;
  events: OutEvent[] = [];
  result: MatchResult | null = null;
  nextEntityId = 32;
  skillSeq = 1;
  readonly survivorsTotal: number;
  readonly viewLagMs: (playerId: number) => number;
  readonly testMode: boolean;

  constructor(opts: WorldOptions) {
    this.map = opts.map;
    this.mw = new MapWorld(opts.map);
    this.balance = opts.balance;
    this.testMode = opts.testMode === true;
    this.rng = new Rng(opts.seed ^ 0x5eed);
    this.viewLagMs = opts.viewLagMs ?? (() => BALANCE.net.interpolationDelayMs);
    this.gens = opts.map.generators.map(() => ({ progress: 0, repaired: false, regressing: false, workers: 0 }));
    this.barricades = opts.map.barricades.map(() => BarricadeState.Up);
    this.barricadeHits = opts.map.barricades.map(() => 0);
    this.doors = opts.map.doors.map((d) => !opts.map.dynamicSegments[d.dyn].active);
    this.doorCd = opts.map.doors.map(() => 0);
    this.doorHits = opts.map.doors.map(() => 0);
    this.doorBroken = opts.map.doors.map(() => false);
    this.windowsBroken = this.geo.windowSegs.map(() => false);
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
      this.addPlayer(p);
      if (this.testMode) this.fillTestKit(p);
    }
    this.survivorsTotal = this.order.filter((p) => p.role === 'survivor').length;
    this.sexton = new Sexton(this);
    this.shane = new Shane(this);
    this.chris = new Chris(this);
    this.marc = new Marc(this);
    this.plasma = new Plasma(this);
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

  /** Testing mode: every item and ability, never used up. */
  fillTestKit(p: SimPlayer): void {
    if (p.role === 'survivor') {
      for (const k of SLOT_ITEMS) p.inv[k] = BALANCE.items.maxStack;
      p.goggles = [BALANCE.items.goggles.meter, BALANCE.items.goggles.meter];
      p.shells = [BALANCE.items.shotgun.shells, BALANCE.items.shotgun.shells];
      p.confit = 1;
      p.jarvis = 3;
    } else if (p.role === 'hunter') {
      p.hemp = 2;
    }
  }

  /** Testing mode: flips a player between Zach and survivor where they stand. */
  /** Testing mode: jump to a point on the map. */
  teleport(id: number, x: number, y: number): void {
    const p = this.players.get(id);
    if (!this.testMode || !p || p.role === 'spectator' || p.health === Health.Carried || p.health === Health.Staked) return;
    if (p.hideState) exitHiding(this, p, true);
    this.cancelAction(p);
    p.move.x = Math.min(this.map.width - 40, Math.max(40, x));
    p.move.y = Math.min(this.map.height - 40, Math.max(40, y));
    resolveOverlaps(this.geo, p.move, p.radius);
  }

  switchRole(id: number): boolean {
    const p = this.players.get(id);
    if (!this.testMode || !p || p.role === 'spectator') return false;
    if (p.carrying) {
      const q = this.players.get(p.carrying);
      if (q) {
        restoreSurvivor(q, BALANCE.survivor.reviveHp);
        q.carriedBy = 0;
      }
    }
    if (p.carriedBy) {
      const h = this.players.get(p.carriedBy);
      if (h) h.carrying = 0;
    }
    if (p.stakeId >= 0) this.stakes[p.stakeId] = 0;
    if (p.hideState !== 0) exitHiding(this, p, false);
    this.cancelAction(p);
    const role = p.role === 'hunter' ? 'survivor' : 'hunter';
    const fresh = createPlayer(p.id, p.name, role, p.tint, p.move.x, p.move.y);
    fresh.connected = p.connected;
    fresh.lastSeq = p.lastSeq;
    fresh.inputs = p.inputs;
    fresh.rtt = p.rtt;
    fresh.facing = p.facing;
    fresh.joinedTime = p.joinedTime;
    Object.assign(p, fresh);
    p.move = newMoveState(p.move.x, p.move.y, role);
    resolveOverlaps(this.geo, p.move, p.radius);
    this.fillTestKit(p);
    return true;
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

  /** Everyone whose view (own or spectated) is within r of (x,y). */
  near(x: number, y: number, r: number): number[] {
    const to: number[] = [];
    for (const p of this.order) {
      const v = this.viewerFor(p);
      if (v && Math.hypot(v.move.x - x, v.move.y - y) <= r) to.push(p.id);
    }
    return to;
  }

  /** A visual cue at a spot (particles for explosions, glass and splinters). */
  noise(x: number, y: number, r: number, kind: string): void {
    const to = this.near(x, y, r);
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
    if (p.role === 'hunter') {
      if (p.stunT > 0 || p.knockT > 0 || p.health === Health.Eliminated) return MoveMode.Locked;
      if (p.action === Action.PickUp || p.action === Action.Stake || p.action === Action.Search || p.action === Action.DamageGen) {
        return MoveMode.Locked;
      }
      return MoveMode.Normal;
    }
    if (p.health === Health.Downed) return MoveMode.Crawl;
    if (p.health !== Health.Healthy && p.health !== Health.Wounded) return MoveMode.Locked;
    if (p.hideState !== 0 || p.action === Action.Talk || p.stunT > 0) return MoveMode.Locked;
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

    for (let i = 0; i < this.doorCd.length; i++) if (this.doorCd[i] > 0) this.doorCd[i] = Math.max(0, this.doorCd[i] - dt);
    computePrompts(this);
    updateInteractions(this, dt);
    updateCombat(this, dt);
    updateItems(this, dt);
    updateAbilities(this, dt);
    updateSexton(this, dt);
    this.shane.update(dt);
    this.chris.update(dt);
    this.marc.update(dt);
    this.plasma.update(dt);
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
    if (!this.testMode) checkWin(this);
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
    if (p.role === 'survivor') p.selItem = cmd.item >= ItemKind.Bottle && cmd.item <= ItemKind.Trap ? cmd.item : 0;
    handlePresses(this, p, cmd, pressed);

    // Moving cancels survivor interactions.
    if ((cmd.moveX || cmd.moveY) && p.role === 'survivor' && p.action !== Action.None && p.action !== Action.HideEnter && p.action !== Action.HideExit && p.action !== Action.Talk) {
      this.cancelAction(p);
    }

    p.move.mode = this.moveModeFor(p);
    const role = p.role === 'hunter' ? 'hunter' : 'survivor';
    const fromX = p.move.x;
    const fromY = p.move.y;
    const gait = stepMovement(p.move, cmd, { role, hunterSpeedMul: this.balance.hunterSpeedMul, carrying: p.carrying > 0 }, this.geo, TICK_DT);
    p.gait = p.move.mode === MoveMode.Locked ? Gait.Idle : gait;
    if (p.role === 'hunter') {
      const lunging = p.move.lungeT > 0 || (p.wasLunging && Math.hypot(p.move.x - fromX, p.move.y - fromY) > 0);
      if (p.move.lungeT > 0 && !p.wasLunging) p.lungeHit = false;
      if (lunging && !p.lungeHit) lungeContact(this, p, fromX, fromY);
      p.wasLunging = p.move.lungeT > 0;
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
    if (p.action === Action.Talk) this.sexton.cancelTalk(p.id);
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
    if (state === BarricadeState.Down) this.pushOutOfColliders();
  }

  /** Opens or closes a door. Anyone standing in a closing doorway is pushed out. */
  setDoor(id: number, open: boolean): void {
    if (this.doorBroken[id] && !open) return;
    this.doors[id] = open;
    this.doorCd[id] = 0.35;
    this.geo.setDynamicActive(this.map.doors[id].dyn, !open);
    if (!open) this.pushOutOfColliders();
  }

  /** Smashes a window: Zach can climb through it from now on. */
  breakWindow(i: number): void {
    this.windowsBroken[i] = true;
    this.geo.setWindowBroken(i, true);
  }

  private pushOutOfColliders(): void {
    for (const p of this.order) {
      if (p.role === 'spectator' || p.health === Health.Carried || p.hideState === 2) continue;
      resolveOverlaps(this.geo, p.move, p.radius, p.role === 'hunter');
    }
    this.sexton.unstick();
    this.shane.unstick();
    this.chris.unstick();
    this.marc.unstick();
    this.plasma.unstick();
  }

  /** NPCs that bottles and pellets can hit right now. */
  npcTargets(): NpcTarget[] {
    return [this.sexton, this.shane, this.chris, this.marc, this.plasma].filter((n) => n.solid);
  }

  allocEntityId(): number {
    // Entity ids share the byte range with player ids: skip any id a player has.
    for (let i = 0; i < 230; i++) {
      const id = this.nextEntityId;
      this.nextEntityId = this.nextEntityId >= 250 ? 32 : this.nextEntityId + 1;
      if (!this.players.has(id)) return id;
    }
    return 251;
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
          restoreSurvivor(s, BALANCE.survivor.reviveHp);
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
  p.gogglesOn = false;
  p.stats.outcome = 'eliminated';
  p.endedTime = w.time;
  p.spectating = w.defaultSpectateTarget(p.id);
  if (credit) credit.stats.eliminations++;
  w.emit('all', { k: 'eliminated', victim: p.id });
  w.feed(why === 'disconnected' ? `${p.name} disconnected` : `${p.name} was sacrificed`);
}
