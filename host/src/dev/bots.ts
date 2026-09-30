import {
  Action,
  BALANCE,
  Btn,
  Health,
  ItemKind,
  NavGrid,
  Prompt,
  Rng,
  generateMap,
  mapParamsFor,
  resolveBalance,
  type InputCmd,
  type MatchPlayerInfo,
  type MatchResult,
} from '@manhunt/shared';
import { World } from '../sim/World';
import { skillCheckResult } from '../sim/objectives';
import { canSee } from '../sim/view';
import { nearbyDoor } from '../sim/interact';
import type { SimPlayer } from '../sim/player';

/**
 * DEV-ONLY headless bots for regression and balance tests. Not a gameplay feature: they
 * cheat (full knowledge of positions) and exist to push complete matches through the rules.
 */

type Cmd = Omit<InputCmd, 'seq'>;

const cmd = (buttons: number, moveX = 0, moveY = 0, aim = 0, aimDist = 0, item = 0): Cmd => ({ buttons, moveX, moveY, aim, aimDist, item });

interface BotState {
  path: number[];
  pathIdx: number;
  goalX: number;
  goalY: number;
  repathAt: number;
  lastX: number;
  lastY: number;
  stuckFor: number;
  seq: number;
  wander: { x: number; y: number } | null;
  lastButtons: number;
  /** Chase target the hunter gave up on (unreachable) and until when. */
  ignore: { id: number; until: number } | null;
  progressAt: { x: number; y: number; t: number };
}

export class BotDirector {
  private readonly nav: NavGrid;
  private readonly bots = new Map<number, BotState>();
  private readonly rng: Rng;

  constructor(
    private readonly w: World,
    seed: number,
    private readonly skill = { good: 0.8, great: 0.08 },
  ) {
    // Plan paths as if every door were open; bots open doors they bump into.
    const closed = w.map.doors.filter((_d, i) => !w.doors[i]);
    for (const d of closed) w.geo.setDynamicActive(d.dyn, false);
    this.nav = new NavGrid(w.geo, 25, 15);
    for (const d of closed) w.geo.setDynamicActive(d.dyn, true);
    this.rng = new Rng(seed);
  }

  private bot(p: SimPlayer): BotState {
    let b = this.bots.get(p.id);
    if (!b) {
      b = {
        path: [],
        pathIdx: 0,
        goalX: p.move.x,
        goalY: p.move.y,
        repathAt: 0,
        lastX: p.move.x,
        lastY: p.move.y,
        stuckFor: 0,
        seq: 0,
        wander: null,
        lastButtons: 0,
        ignore: null,
        progressAt: { x: p.move.x, y: p.move.y, t: 0 },
      };
      this.bots.set(p.id, b);
    }
    return b;
  }

  /** Steers along an A* path toward (x,y). Returns the move vector and whether we're stuck at a door. */
  private steer(p: SimPlayer, x: number, y: number): { mx: number; my: number; door: boolean } {
    const b = this.bot(p);
    const t = this.w.time;
    const goalMoved = Math.hypot(b.goalX - x, b.goalY - y) > 60;
    if (goalMoved || t >= b.repathAt || b.pathIdx * 2 >= b.path.length) {
      b.goalX = x;
      b.goalY = y;
      b.path = this.nav.findPath(p.move.x, p.move.y, x, y, 70000) ?? [x, y];
      b.pathIdx = 0;
      b.repathAt = t + 1.2 + this.rng.next() * 0.6;
    }
    while (b.pathIdx * 2 < b.path.length - 2) {
      const wx = b.path[b.pathIdx * 2];
      const wy = b.path[b.pathIdx * 2 + 1];
      if (Math.hypot(wx - p.move.x, wy - p.move.y) < 26) b.pathIdx++;
      else break;
    }
    const wx = b.path[b.pathIdx * 2] ?? x;
    const wy = b.path[b.pathIdx * 2 + 1] ?? y;
    let dx = wx - p.move.x;
    let dy = wy - p.move.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return { mx: 0, my: 0, door: false };
    dx /= l;
    dy /= l;
    const moved = Math.hypot(p.move.x - b.lastX, p.move.y - b.lastY);
    b.lastX = p.move.x;
    b.lastY = p.move.y;
    b.stuckFor = moved < 0.5 ? b.stuckFor + 1 : 0;
    let door = false;
    if (b.stuckFor > 4) {
      const di = nearbyDoor(this.w, p.move.x + dx * 30, p.move.y + dy * 30, 50);
      if (di >= 0 && !this.w.doors[di]) door = true;
    }
    if (b.stuckFor > 20 && !door) {
      const a = this.rng.range(0, Math.PI * 2);
      dx = Math.cos(a);
      dy = Math.sin(a);
      if (b.stuckFor > 40) {
        b.stuckFor = 0;
        b.repathAt = 0;
      }
    }
    return { mx: dx, my: dy, door };
  }

  private hunters(): SimPlayer[] {
    return this.w.order.filter((q) => q.role === 'hunter' && q.health !== Health.Eliminated);
  }

  private survivors(): SimPlayer[] {
    return this.w.order.filter((q) => q.role === 'survivor');
  }

  private nearest<T extends { x: number; y: number }>(p: SimPlayer, items: T[]): T | null {
    let best: T | null = null;
    let bd = Infinity;
    for (const it of items) {
      const d = Math.hypot(it.x - p.move.x, it.y - p.move.y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  private goTo(p: SimPlayer, x: number, y: number, buttons: number, arrive = 40, arriveButtons = 0): Cmd {
    const d = Math.hypot(x - p.move.x, y - p.move.y);
    const aim = Math.atan2(y - p.move.y, x - p.move.x);
    if (d < arrive) return cmd(arriveButtons, 0, 0, aim, d);
    const { mx, my, door } = this.steer(p, x, y);
    return cmd(buttons | (door ? Btn.Interact : 0), mx, my, Math.atan2(my, mx), 100);
  }

  survivorInput(p: SimPlayer): Cmd {
    const w = this.w;
    // Answer skill checks with human-like timing (instant answers are rejected by the host).
    if (p.skill && w.time - p.skill.issued > BALANCE.objectives.skillCheck.warnMs / 1000 + BALANCE.objectives.skillCheck.needleTime * 0.6) {
      const r = this.rng.next();
      skillCheckResult(w, p, p.skill.id, r < this.skill.great ? 'great' : r < this.skill.great + this.skill.good ? 'good' : 'miss');
    }
    if (p.health === Health.Carried) return cmd(0, this.rng.range(-1, 1), 1);
    if (p.health !== Health.Healthy && p.health !== Health.Wounded && p.health !== Health.Downed) return cmd(0);
    if (p.hideState === 2) return cmd(p.terror < 0.2 && this.rng.chance(0.05) ? Btn.Interact : Btn.Space);
    if (p.hideState !== 0 || p.action === Action.Talk) return cmd(0);
    const hunter = this.nearest(p, this.hunters().map((h) => ({ x: h.move.x, y: h.move.y, h })));
    const hd = hunter ? Math.hypot(hunter.x - p.move.x, hunter.y - p.move.y) : Infinity;
    const seen = hunter && hd < 420 && w.geo.hasLineOfSight(hunter.x, hunter.y, p.move.x, p.move.y);

    if (p.health === Health.Downed && hunter) {
      const dx = p.move.x - hunter.x;
      const dy = p.move.y - hunter.y;
      const l = Math.hypot(dx, dy) || 1;
      return cmd(0, dx / l, dy / l);
    }
    // Chase response: fight back with items, slam barricades, otherwise sprint away.
    if (seen && hunter) {
      const aim = Math.atan2(hunter.y - p.move.y, hunter.x - p.move.x);
      if (hd < 150 && p.prompt2 === Prompt.DropBarricade) return cmd(Btn.Space);
      if (hd < 330 && p.inv[ItemKind.Shotgun] > 0 && p.reloadT <= 0 && hunter.h.immuneT <= 0) return cmd(Btn.Primary, 0, 0, aim, hd, ItemKind.Shotgun);
      if (hd < 300 && p.inv[ItemKind.Bottle] > 0 && hunter.h.immuneT <= 0 && this.rng.chance(0.4)) return cmd(Btn.Primary, 0, 0, aim, hd, ItemKind.Bottle);
      if (hd < 260 && p.inv[ItemKind.Trap] > 0 && this.rng.chance(0.2)) return cmd(Btn.Primary, 0, 0, aim, hd, ItemKind.Trap);
      if (p.move.stamina < 1 && p.inv[ItemKind.Energy] > 0 && p.move.boostT <= 0) return cmd(Btn.Primary, 0, 0, aim, hd, ItemKind.Energy);
      // Loop: head for a standing barricade that isn't toward Zach.
      const loops = w.map.barricades
        .filter((_o, i) => w.barricades[i] === 0)
        .map((o) => ({ x: o.x, y: o.y }))
        .filter((o) => {
          const dp = Math.hypot(o.x - p.move.x, o.y - p.move.y);
          return dp < 380 && dp > 25 && Math.hypot(o.x - hunter.x, o.y - hunter.y) > dp + 120;
        });
      const loopTarget = this.nearest(p, loops);
      if (loopTarget && hd < 380) return this.goTo(p, loopTarget.x, loopTarget.y, Btn.Run, 20, Btn.Space | Btn.Run);
      const b = this.bot(p);
      if (!b.wander || Math.hypot(b.wander.x - p.move.x, b.wander.y - p.move.y) < 80 || this.rng.chance(0.01)) {
        const a = Math.atan2(p.move.y - hunter.y, p.move.x - hunter.x) + this.rng.range(-0.9, 0.9);
        b.wander = { x: clampMap(p.move.x + Math.cos(a) * 700), y: clampMap(p.move.y + Math.sin(a) * 700) };
      }
      return this.goTo(p, b.wander.x, b.wander.y, Btn.Run);
    }
    // Zach close but not spotted: stop, hide if a spot is close, otherwise crouch away.
    if (hunter && p.terror > 0.45 && (p.action === Action.None || p.action === Action.Repair)) {
      const spots = w.map.hidingSpots.filter((h, i) => w.hiding[i] === 0 && Math.hypot(h.exitX - p.move.x, h.exitY - p.move.y) < 220);
      const spot = this.nearest(p, spots.map((h) => ({ x: h.exitX, y: h.exitY })));
      if (spot) return this.goTo(p, spot.x, spot.y, Btn.Crouch, 20, Btn.Interact);
      const a = Math.atan2(p.move.y - hunter.y, p.move.x - hunter.x);
      return this.goTo(p, clampMap(p.move.x + Math.cos(a) * 300), clampMap(p.move.y + Math.sin(a) * 300), Btn.Crouch);
    }
    // Help teammates: the nearest free survivor goes for a rescue.
    for (const q of this.survivors()) {
      if (q === p) continue;
      if (q.health === Health.Staked || q.health === Health.Downed) {
        const danger = this.hunters().some((h) => Math.hypot(h.move.x - q.move.x, h.move.y - q.move.y) < 300);
        const myD = Math.hypot(q.move.x - p.move.x, q.move.y - p.move.y);
        const closer = this.survivors().some(
          (o) => o !== p && o !== q && (o.health === Health.Healthy || o.health === Health.Wounded) && Math.hypot(q.move.x - o.move.x, q.move.y - o.move.y) < myD,
        );
        if (!danger && !closer && myD < 4000) {
          const holding = p.action === Action.Unstake || p.action === Action.Revive;
          return this.goTo(p, q.move.x, q.move.y, Btn.Run, holding ? 999 : 45, Btn.Interact);
        }
      }
    }
    // Escape.
    if (w.gate.open) {
      const ez = w.map.exitZone;
      return this.goTo(p, ez.x + ez.w / 2, ez.y + ez.h / 2, Btn.Run, 5);
    }
    if (w.gate.powered) {
      if (p.action === Action.OpenGate) return cmd(Btn.Interact);
      return this.goTo(p, w.map.gate.leverX, w.map.gate.leverY, Btn.Run, 30, Btn.Interact);
    }
    if (p.action === Action.Repair || p.action === Action.Loot) return cmd(Btn.Interact);
    // Grab useful items nearby, then start generators.
    const loot = w.map.loot
      .map((l, i) => ({ ...l, i }))
      .filter((l) => !w.lootTaken[l.i] && Math.hypot(l.x - p.move.x, l.y - p.move.y) < 300 && (l.item === 'confit' ? p.confit < 1 : l.item !== 'goggles'));
    const nearLoot = this.nearest(p, loot);
    if (nearLoot && p.prompt !== Prompt.InventoryFull) return this.goTo(p, nearLoot.x, nearLoot.y, 0, 30, Btn.Interact);
    const gens = w.map.generators.map((g, i) => ({ x: g.x, y: g.y, i, s: w.gens[i] })).filter((g) => !g.s.repaired);
    const g = this.nearest(p, gens);
    if (g) return this.goTo(p, g.x + 50, g.y + 10, 0, 22, Btn.Interact);
    const b = this.bot(p);
    if (!b.wander || Math.hypot(b.wander.x - p.move.x, b.wander.y - p.move.y) < 80) b.wander = { x: this.rng.range(400, 5600), y: this.rng.range(400, 5600) };
    return this.goTo(p, b.wander.x, b.wander.y, 0);
  }

  hunterInput(h: SimPlayer): Cmd {
    const w = this.w;
    if (h.stunT > 0 || h.action !== Action.None) return cmd(0, 0, 0, h.facing);
    if (h.carrying) {
      const stakes = w.map.stakes.map((s, i) => ({ ...s, i })).filter((s) => w.stakes[s.i] === 0);
      const s = this.nearest(h, stakes);
      if (s) return this.goTo(h, s.x, s.y, 0, 50, Btn.Interact);
    }
    const downed = this.survivors().filter((q) => q.health === Health.Downed).map((q) => ({ x: q.move.x, y: q.move.y }));
    const dn = this.nearest(h, downed);
    if (dn && !h.carrying) return this.goTo(h, dn.x, dn.y, 0, 45, Btn.Interact);
    const prey = this.survivors()
      .filter((q) => (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2)
      .map((q) => ({ x: q.move.x, y: q.move.y, q }));
    // Hunts only what a player in its place could perceive: its vision cone, lit areas and
    // anything close and loud. It remembers the last sighting for a few seconds.
    const mem = this.bot(h);
    const known = prey.filter((t) => {
      if (mem.ignore && mem.ignore.id === t.q.id && w.time < mem.ignore.until) return false;
      const d = Math.hypot(t.x - h.move.x, t.y - h.move.y);
      return canSee(w, h, t.x, t.y) || d < t.q.noise * 0.6;
    });
    // No real progress for 3 s while chasing: the target is unreachable for now.
    if (w.time - mem.progressAt.t > 3) {
      const moved = Math.hypot(h.move.x - mem.progressAt.x, h.move.y - mem.progressAt.y);
      if (moved < 60 && known.length) mem.ignore = { id: this.nearest(h, known)!.q.id, until: w.time + 6 };
      mem.progressAt = { x: h.move.x, y: h.move.y, t: w.time };
    }
    if (known.length) {
      const t = this.nearest(h, known)!;
      mem.wander = { x: t.x, y: t.y };
    }
    const target = this.nearest(h, known);
    if (target) {
      const d = Math.hypot(target.x - h.move.x, target.y - h.move.y);
      const aim = Math.atan2(target.y - h.move.y, target.x - h.move.x);
      if (d < BALANCE.hunter.attack.range * 0.8 && h.attackCd <= 0) return cmd(Btn.Primary, Math.cos(aim), Math.sin(aim), aim, d);
      if (d < 230 && d > 90 && h.move.lungeCharges > 0 && h.attackCd <= 0 && w.geo.hasLineOfSight(h.move.x, h.move.y, target.x, target.y)) {
        return cmd(Btn.Lunge, Math.cos(aim), Math.sin(aim), aim, d);
      }
      if (h.hemp > 0 && h.move.hempT <= 0) return cmd(Btn.Ability, 0, 0, aim, d);
      const c = this.goTo(h, target.x, target.y, Btn.Run, 10);
      return { ...c, aim };
    }
    if (w.hempDrop) {
      const c = this.goTo(h, w.hempDrop.x, w.hempDrop.y, 0, 40, Btn.Interact);
      if (Math.hypot(w.hempDrop.x - h.move.x, w.hempDrop.y - h.move.y) < 900) return c;
    }
    // Patrol: burst now and then, check generators being worked on.
    if (h.burstCd <= 0 && this.rng.chance(0.02)) return cmd(Btn.Secondary, 0, 0, h.facing);
    const b = this.bot(h);
    const busy = w.map.generators.filter((_g, i) => w.gens[i].workers > 0 || (!w.gens[i].repaired && w.gens[i].progress > 0.2));
    if (w.gate.powered && this.rng.chance(0.5)) {
      b.wander = { x: w.map.gate.leverX, y: w.map.gate.leverY + 80 };
    } else if (!b.wander || Math.hypot(b.wander.x - h.move.x, b.wander.y - h.move.y) < 90) {
      const pick = busy.length ? this.rng.pick(busy) : this.rng.pick(w.map.generators);
      b.wander = { x: pick.x + this.rng.range(-60, 60), y: pick.y + this.rng.range(-60, 60) };
    }
    const c = this.goTo(h, b.wander.x, b.wander.y, 0, 60);
    return { ...c, aim: c.aim + Math.sin(w.time * 1.7 + h.id) * 0.9 };
  }

  /** Feeds one input to every player and advances the world one tick. */
  step(): void {
    const EDGE = Btn.Space | Btn.Primary | Btn.Secondary | Btn.Ability | Btn.Lunge;
    for (const p of this.w.order) {
      const b = this.bot(p);
      const c = p.role === 'hunter' ? this.hunterInput(p) : p.role === 'survivor' ? this.survivorInput(p) : cmd(0);
      // Presses only count on the edge: bots release a held button every other tick,
      // except Interact while an interaction is running (those are hold-to-act).
      const mask = EDGE | (p.action === Action.None ? Btn.Interact : 0);
      const buttons = c.buttons & ~(b.lastButtons & mask);
      b.lastButtons = buttons;
      this.w.enqueueInputs(p.id, [{ seq: ++b.seq, ...c, buttons }]);
    }
    this.w.step();
    this.w.events.length = 0;
  }
}

function clampMap(v: number): number {
  return Math.max(120, Math.min(BALANCE.world.size - 120, v));
}

export interface BotMatchOptions {
  seed: number;
  hunters: number;
  survivors: number;
  difficulty?: number;
  timeLimitSec?: number;
}

/** Plays a whole match with bots and returns the result. */
export function runBotMatch(o: BotMatchOptions): { result: MatchResult; world: World } {
  const rb = resolveBalance({ hunters: o.hunters, survivors: o.survivors, difficulty: o.difficulty ?? 1 });
  if (o.timeLimitSec) rb.timeLimit = o.timeLimitSec;
  const map = generateMap(mapParamsFor(o.seed, rb));
  const players: MatchPlayerInfo[] = [];
  for (let i = 0; i < o.hunters; i++) players.push({ id: i + 1, name: `Zach${i + 1}`, role: 'hunter', tint: 0 });
  for (let i = 0; i < o.survivors; i++) players.push({ id: o.hunters + i + 1, name: `Bot${i + 1}`, role: 'survivor', tint: i });
  const world = new World({ map, balance: rb, players, seed: o.seed, viewLagMs: () => 0 });
  const director = new BotDirector(world, o.seed);
  const maxTicks = Math.ceil((rb.timeLimit + 5) * BALANCE.net.tickHz);
  for (let i = 0; i < maxTicks && !world.result; i++) director.step();
  return { result: world.result!, world };
}
