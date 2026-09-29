import {
  Action,
  BALANCE,
  Btn,
  Health,
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
import type { SimPlayer } from '../sim/player';

/**
 * DEV-ONLY headless bots for regression and balance tests. Not a gameplay feature: they
 * cheat (full knowledge of positions) and exist to push complete matches through the rules.
 */

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
    this.nav = new NavGrid(w.geo, 30, 17);
    this.rng = new Rng(seed);
  }

  private bot(p: SimPlayer): BotState {
    let b = this.bots.get(p.id);
    if (!b) {
      b = { path: [], pathIdx: 0, goalX: p.move.x, goalY: p.move.y, repathAt: 0, lastX: p.move.x, lastY: p.move.y, stuckFor: 0, seq: 0, wander: null };
      this.bots.set(p.id, b);
    }
    return b;
  }

  /** Steers along an A* path toward (x,y). Returns the move vector. */
  private steer(p: SimPlayer, x: number, y: number): { mx: number; my: number } {
    const b = this.bot(p);
    const t = this.w.time;
    const goalMoved = Math.hypot(b.goalX - x, b.goalY - y) > 60;
    if (goalMoved || t >= b.repathAt || b.pathIdx * 2 >= b.path.length) {
      b.goalX = x;
      b.goalY = y;
      b.path = this.nav.findPath(p.move.x, p.move.y, x, y, 30000) ?? [x, y];
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
    if (l < 1) return { mx: 0, my: 0 };
    dx /= l;
    dy /= l;
    // Unstick with a random jiggle.
    const moved = Math.hypot(p.move.x - b.lastX, p.move.y - b.lastY);
    b.lastX = p.move.x;
    b.lastY = p.move.y;
    b.stuckFor = moved < 0.5 ? b.stuckFor + 1 : 0;
    if (b.stuckFor > 20) {
      const a = this.rng.range(0, Math.PI * 2);
      dx = Math.cos(a);
      dy = Math.sin(a);
      if (b.stuckFor > 40) {
        b.stuckFor = 0;
        b.repathAt = 0;
      }
    }
    return { mx: dx, my: dy };
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

  private goTo(p: SimPlayer, x: number, y: number, buttons: number, arrive = 40, arriveButtons = 0): Omit<InputCmd, 'seq'> {
    const d = Math.hypot(x - p.move.x, y - p.move.y);
    const aim = Math.atan2(y - p.move.y, x - p.move.x);
    if (d < arrive) return { buttons: arriveButtons, moveX: 0, moveY: 0, aim, aimDist: d };
    const { mx, my } = this.steer(p, x, y);
    return { buttons, moveX: mx, moveY: my, aim: Math.atan2(my, mx), aimDist: 100 };
  }

  survivorInput(p: SimPlayer): Omit<InputCmd, 'seq'> {
    const w = this.w;
    // Answer skill checks with human-like timing (instant answers are rejected by the host).
    if (p.skill && w.time - p.skill.issued > 0.65 + BALANCE.objectives.skillCheck.needleTime * 0.6) {
      const r = this.rng.next();
      skillCheckResult(w, p, p.skill.id, r < this.skill.great ? 'great' : r < this.skill.great + this.skill.good ? 'good' : 'miss');
    }
    if (p.health === Health.Carried) return { buttons: 0, moveX: this.rng.range(-1, 1), moveY: 1, aim: 0, aimDist: 0 };
    if (p.health !== Health.Healthy && p.health !== Health.Wounded && p.health !== Health.Downed) return { buttons: 0, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
    if (p.hideState !== 0) return { buttons: 0, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
    const hunter = this.nearest(p, this.hunters().map((h) => ({ x: h.move.x, y: h.move.y, h })));
    const hd = hunter ? Math.hypot(hunter.x - p.move.x, hunter.y - p.move.y) : Infinity;
    const seen = hunter && hd < 420 && w.geo.hasLineOfSight(hunter.x, hunter.y, p.move.x, p.move.y);

    if (p.health === Health.Downed && hunter) {
      const dx = p.move.x - hunter.x;
      const dy = p.move.y - hunter.y;
      const l = Math.hypot(dx, dy) || 1;
      return { buttons: 0, moveX: dx / l, moveY: dy / l, aim: 0, aimDist: 0 };
    }
    // Chase response: slam barricades and vault, otherwise run away.
    if (seen && hunter) {
      if (hd < 150 && p.prompt2 === Prompt.DropBarricade) return { buttons: Btn.Vault, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
      if (hd < 200 && p.prompt2 === Prompt.Vault && this.rng.chance(0.5)) return { buttons: Btn.Vault | Btn.Run, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
      if (hd < 180 && p.tool !== 0 && this.rng.chance(0.3)) return { buttons: Btn.UseItem, moveX: 0, moveY: 0, aim: Math.atan2(hunter.y - p.move.y, hunter.x - p.move.x), aimDist: 200 };
      const b = this.bot(p);
      if (!b.wander || Math.hypot(b.wander.x - p.move.x, b.wander.y - p.move.y) < 80 || this.rng.chance(0.01)) {
        const a = Math.atan2(p.move.y - hunter.y, p.move.x - hunter.x) + this.rng.range(-0.9, 0.9);
        b.wander = { x: clampMap(p.move.x + Math.cos(a) * 700), y: clampMap(p.move.y + Math.sin(a) * 700) };
      }
      return this.goTo(p, b.wander.x, b.wander.y, Btn.Run);
    }
    // Help teammates.
    for (const q of this.survivors()) {
      if (q === p) continue;
      if (q.health === Health.Staked || q.health === Health.Downed) {
        const danger = this.hunters().some((h) => Math.hypot(h.move.x - q.move.x, h.move.y - q.move.y) < 350);
        if (!danger && Math.hypot(q.move.x - p.move.x, q.move.y - p.move.y) < 1800) {
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
      if (p.action === Action.OpenGate) return { buttons: Btn.Interact, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
      return this.goTo(p, w.map.gate.leverX, w.map.gate.leverY, Btn.Run, 30, Btn.Interact);
    }
    if (p.action === Action.Repair || p.action === Action.Install || p.action === Action.Loot) return { buttons: Btn.Interact, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
    // Find a generator that needs what we have (or needs repair).
    const gens = w.map.generators
      .map((g, i) => ({ x: g.x, y: g.y, i, s: w.gens[i] }))
      .filter((g) => !g.s.repaired && (g.s.fuel && g.s.wire ? true : (!g.s.fuel && p.fuel > 0) || (!g.s.wire && p.wire > 0)));
    const g = this.nearest(p, gens);
    const partsNeeded = p.fuel + p.wire < 2;
    const loot = w.map.loot.map((l, i) => ({ ...l, i })).filter((l) => !w.lootTaken[l.i] && (l.item === 'fuel' || l.item === 'wire' || (p.tool === 0 && (l.item === 'flare' || l.item === 'bottle'))));
    const nearLoot = this.nearest(p, loot);
    if (nearLoot && (partsNeeded || !g) && (!g || Math.hypot(nearLoot.x - p.move.x, nearLoot.y - p.move.y) < Math.hypot(g.x - p.move.x, g.y - p.move.y) * 1.3)) {
      return this.goTo(p, nearLoot.x, nearLoot.y, 0, 30, Btn.Interact);
    }
    if (g) return this.goTo(p, g.x + 50, g.y + 10, 0, 22, Btn.Interact);
    const b = this.bot(p);
    if (!b.wander || Math.hypot(b.wander.x - p.move.x, b.wander.y - p.move.y) < 80) b.wander = { x: this.rng.range(400, 5600), y: this.rng.range(400, 5600) };
    return this.goTo(p, b.wander.x, b.wander.y, 0);
  }

  hunterInput(h: SimPlayer): Omit<InputCmd, 'seq'> {
    const w = this.w;
    if (h.stunT > 0 || h.action !== Action.None || h.vault) return { buttons: 0, moveX: 0, moveY: 0, aim: h.facing, aimDist: 0 };
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
    // Hunts what it can plausibly perceive: nearby, or noisy (repairing) targets.
    const known = prey.filter((t) => {
      const d = Math.hypot(t.x - h.move.x, t.y - h.move.y);
      return (d < 600 && w.geo.hasLineOfSight(h.move.x, h.move.y, t.x, t.y)) || d < t.q.noise;
    });
    const target = this.nearest(h, known);
    if (target) {
      const d = Math.hypot(target.x - h.move.x, target.y - h.move.y);
      const aim = Math.atan2(target.y - h.move.y, target.x - h.move.x);
      if (h.prompt2 === Prompt.BreakBarricade && d > 60) return { buttons: h.smashCd <= 0 ? Btn.Ability3 : Btn.Vault, moveX: 0, moveY: 0, aim, aimDist: d };
      if (d < BALANCE.hunter.attack.range + 10 && h.attackCd <= 0) return { buttons: Btn.Attack, moveX: Math.cos(aim), moveY: Math.sin(aim), aim, aimDist: d };
      if (d < 150 && h.move.lungeCd <= 0 && h.attackCd <= 0 && w.geo.hasLineOfSight(h.move.x, h.move.y, target.x, target.y)) {
        return { buttons: Btn.Lunge | Btn.Attack, moveX: Math.cos(aim), moveY: Math.sin(aim), aim, aimDist: d };
      }
      const cmd = this.goTo(h, target.x, target.y, 0, 10);
      return { ...cmd, aim };
    }
    // Patrol: use Stalker's Pulse, then check generators being worked on.
    if (h.pulseCd <= 0) return { buttons: Btn.Ability1, moveX: 0, moveY: 0, aim: h.facing, aimDist: 0 };
    const b = this.bot(h);
    const busy = w.map.generators.filter((_g, i) => w.gens[i].workers > 0 || (!w.gens[i].repaired && w.gens[i].progress > 0.2));
    if (w.gate.powered && this.rng.chance(0.5)) {
      b.wander = { x: w.map.gate.leverX, y: w.map.gate.leverY + 80 };
    } else if (!b.wander || Math.hypot(b.wander.x - h.move.x, b.wander.y - h.move.y) < 90) {
      const pick = busy.length ? this.rng.pick(busy) : this.rng.pick(w.map.generators);
      b.wander = { x: pick.x + this.rng.range(-60, 60), y: pick.y + this.rng.range(-60, 60) };
    }
    return this.goTo(h, b.wander.x, b.wander.y, 0, 60);
  }

  /** Feeds one input to every player and advances the world one tick. */
  step(): void {
    for (const p of this.w.order) {
      const b = this.bot(p);
      const cmd = p.role === 'hunter' ? this.hunterInput(p) : p.role === 'survivor' ? this.survivorInput(p) : { buttons: 0, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
      this.w.enqueueInputs(p.id, [{ seq: ++b.seq, ...cmd }]);
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
