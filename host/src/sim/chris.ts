import { BALANCE, ChrisFlag, EntityKind, Health, NavGrid, moveCircle, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { NpcTarget } from './npc';
import type { World } from './World';
import { nearbyDoor, releaseFromStake } from './interact';
import { restoreSurvivor } from './combat';

const C = BALANCE.chris;

type Mode = 'pace' | 'idle' | 'wander' | 'rescue' | 'work' | 'flee' | 'ascend' | 'gone';

/**
 * Chris Zelley, the paramedic. Until a survivor talks to him he paces around his ambulance
 * (and never strays from it). Activated, he wanders the map; the first time a survivor stays
 * downed or staked too long he sprints to them, revives or cuts them down, then sprouts wings
 * and flies to the heavens. Zach can kill him in two hits at any point.
 */
export class Chris implements NpcTarget {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  hp: number = C.hp;
  alive = true;
  /** A survivor talked to him: he's left the ambulance. */
  active = false;
  mode: Mode = 'pace';
  moving = false;
  hurtT = 0;
  /** Who he's rescuing (0 = nobody). */
  target = 0;
  ascendT = 0;
  workT = 0;
  private workDur = 0;
  /** The ambulance's corners pushed out by `pace`: his beat, walked corner to corner. */
  private readonly beat: { x: number; y: number }[];
  private wp = 0;
  private dir = 1;
  private modeT = 0;
  private heading = 0;
  private fleeT = 0;
  private turnT = 0;
  private stuckT = 0;
  private path: number[] = [];
  private pathT = 0;
  private nav: NavGrid | null = null;
  private readonly downFor = new Map<number, number>();

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    const a = w.map.ambulance;
    const ux = Math.cos(a.angle);
    const uy = Math.sin(a.angle);
    const hl = a.length / 2 + C.pace;
    const hw = a.width / 2 + C.pace;
    this.beat = [
      { x: a.x + ux * hl - uy * hw, y: a.y + uy * hl + ux * hw },
      { x: a.x + ux * hl + uy * hw, y: a.y + uy * hl - ux * hw },
      { x: a.x - ux * hl + uy * hw, y: a.y - uy * hl - ux * hw },
      { x: a.x - ux * hl - uy * hw, y: a.y - uy * hl + ux * hw },
    ];
    this.wp = w.rng.int(0, 3);
    this.x = this.beat[this.wp].x;
    this.y = this.beat[this.wp].y;
    this.dir = w.rng.chance(0.5) ? 1 : -1;
    this.wp = (this.wp + this.dir + 4) % 4;
    resolveOverlaps(w.geo, this, C.radius);
  }

  readonly hitRadius = C.radius;

  get solid(): boolean {
    return this.hittable;
  }

  /** A survivor's bottle or pellet: he flinches, and that's all (he never runs or fights back). */
  itemHit(): void {
    if (this.hittable) this.hurtT = 0.35;
  }

  /** Still on the map (not flown away) and alive: Zach's machete and bottles can hit him. */
  get hittable(): boolean {
    return this.alive && this.mode !== 'ascend' && this.mode !== 'gone';
  }

  get gone(): boolean {
    return this.mode === 'gone';
  }

  canTalk(p: SimPlayer): boolean {
    return this.alive && !this.active && this.mode !== 'flee' && p.role === 'survivor' && Math.hypot(p.move.x - this.x, p.move.y - this.y) < C.reach;
  }

  /** A survivor talks to him: he promises to come when needed, then heads off. */
  activate(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    const w = this.w;
    this.active = true;
    this.mode = 'idle';
    this.modeT = 2.2;
    this.moving = false;
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.heading = this.facing + Math.PI;
    w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'chris', say: "I'll be there when you need me." });
    w.feed(`${p.name} enlisted Chris Zelley`);
  }

  /** Zach hits him: he runs (slowly); the second hit kills him. */
  hit(h: SimPlayer): void {
    if (!this.hittable) return;
    const w = this.w;
    this.hp--;
    this.hurtT = 0.35;
    h.stats.hits++;
    if (this.hp <= 0) {
      this.alive = false;
      this.moving = false;
      this.target = 0;
      w.feed(`${h.name} killed Chris Zelley`);
      return;
    }
    this.target = 0;
    this.path = [];
    this.mode = 'flee';
    this.fleeT = C.fleeTime;
    this.turnT = 0;
    if (!this.active) {
      // Around the ambulance, the way that takes him away from Zach.
      const next = this.beat[this.wp];
      const other = this.beat[(this.wp - this.dir + 4) % 4];
      if (Math.hypot(other.x - h.move.x, other.y - h.move.y) > Math.hypot(next.x - h.move.x, next.y - h.move.y)) {
        this.dir = -this.dir;
        this.wp = (this.wp + this.dir + 4) % 4;
      }
    }
    w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'chris', say: 'Whoa, whoa! I’m a medic!' });
  }

  record(): EntityRecord {
    let st = 0;
    if (!this.alive) st |= ChrisFlag.Dead;
    if (this.mode === 'flee') st |= ChrisFlag.Fleeing;
    if (this.active) st |= ChrisFlag.Active;
    if (this.mode === 'rescue') st |= ChrisFlag.Rescuing;
    if (this.mode === 'work') st |= ChrisFlag.Working;
    if (this.mode === 'ascend') st |= ChrisFlag.Ascending;
    if (this.hurtT > 0) st |= ChrisFlag.Hurt;
    const progress = this.mode === 'ascend' ? this.ascendT / C.ascendTime : this.mode === 'work' && this.workDur > 0 ? this.workT / this.workDur : 0;
    return quantizeEntity(this.id, EntityKind.Chris, this.x, this.y, this.facing, st, Math.round(Math.min(1, progress) * 255), this.hp, this.moving ? 1 : 0, 0);
  }

  unstick(): void {
    if (this.alive && !this.gone) resolveOverlaps(this.w.geo, this, C.radius);
  }

  /** How long each survivor has been down (staking time comes from the stake timer). */
  private track(dt: number): void {
    for (const p of this.w.order) {
      if (p.role === 'survivor' && p.health === Health.Downed) this.downFor.set(p.id, (this.downFor.get(p.id) ?? 0) + dt);
      else this.downFor.delete(p.id);
    }
  }

  private needsHelp(p: SimPlayer): boolean {
    if (p.role !== 'survivor') return false;
    if (p.health === Health.Downed) return (this.downFor.get(p.id) ?? 0) >= C.downedAfter;
    if (p.health === Health.Staked) return BALANCE.objectives.stakeStageTime - p.stakeT >= C.stakedAfter;
    return false;
  }

  private stillDown(p: SimPlayer | undefined): p is SimPlayer {
    return !!p && (p.health === Health.Downed || p.health === Health.Staked);
  }

  private pickPatient(): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const p of this.w.order) {
      if (!this.needsHelp(p)) continue;
      const d = Math.hypot(p.move.x - this.x, p.move.y - this.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  update(dt: number): void {
    const w = this.w;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (!this.alive || this.mode === 'gone') {
      this.moving = false;
      return;
    }
    if (this.mode === 'ascend') {
      this.moving = false;
      this.ascendT += dt;
      if (this.ascendT >= C.ascendTime) this.mode = 'gone';
      return;
    }
    this.track(dt);
    if (this.active && this.mode !== 'flee' && this.mode !== 'rescue' && this.mode !== 'work') {
      const p = this.pickPatient();
      if (p) {
        this.mode = 'rescue';
        this.target = p.id;
        this.path = [];
        this.pathT = 0;
        w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'chris', say: 'Hang on, I’m coming!' });
        w.feed(`Chris Zelley is running to ${p.name}`);
      }
    }
    let speed = 0;
    switch (this.mode) {
      case 'pace':
      case 'idle':
        speed = this.updateCalm(dt);
        break;
      case 'wander':
        speed = this.updateWander(dt);
        break;
      case 'flee':
        speed = this.updateFlee(dt);
        break;
      case 'rescue':
        speed = this.updateRescue(dt);
        break;
      case 'work':
        this.updateWork(dt);
        break;
    }
    this.moving = speed > 0;
    if (!this.moving) return;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, C.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    if (this.mode !== 'work') this.facing = this.heading;
    if (Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35) {
      this.stuckT += dt;
      const di = nearbyDoor(w, this.x + Math.cos(this.heading) * 30, this.y + Math.sin(this.heading) * 30, 40);
      if (this.active && di >= 0 && !w.doors[di] && w.doorCd[di] <= 0) w.setDoor(di, true);
      else if (this.stuckT > 0.3 && (this.mode === 'pace' || (this.mode === 'flee' && !this.active))) {
        this.dir = -this.dir;
        this.wp = (this.wp + this.dir + 4) % 4;
        this.stuckT = 0;
      } else if (this.stuckT > 0.25 && (this.mode === 'wander' || (this.mode === 'flee' && this.active))) {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  /**
   * Before activation he walks his beat around the ambulance, pausing now and then, and stops
   * to face any survivor who walks up to him.
   */
  private updateCalm(dt: number): number {
    const w = this.w;
    if (!this.active) {
      const p = w.order.find((q) => q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState === 0 && Math.hypot(q.move.x - this.x, q.move.y - this.y) < C.reach + 30);
      if (p) {
        this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
        return 0;
      }
    }
    if (this.mode === 'idle') {
      this.modeT -= dt;
      if (this.modeT > 0) {
        if (!this.active) this.facing += Math.sin(w.time * 1.2 + this.id) * dt * 0.6;
        return 0;
      }
      if (this.active) {
        this.mode = 'wander';
        this.modeT = w.rng.range(3, 7);
        return 0;
      }
      this.mode = 'pace';
    }
    return this.walkBeat(C.walk, true);
  }

  private walkBeat(speed: number, mayPause: boolean): number {
    const w = this.w;
    const t = this.beat[this.wp];
    if (Math.hypot(t.x - this.x, t.y - this.y) < 8) {
      if (w.rng.chance(0.2)) this.dir = -this.dir;
      this.wp = (this.wp + this.dir + 4) % 4;
      if (mayPause && w.rng.chance(0.45)) {
        this.mode = 'idle';
        this.modeT = w.rng.range(0.8, 3);
        return 0;
      }
    }
    const n = this.beat[this.wp];
    this.heading = Math.atan2(n.y - this.y, n.x - this.x);
    return speed;
  }

  private updateWander(dt: number): number {
    const w = this.w;
    this.modeT -= dt;
    this.heading += w.rng.range(-1, 1) * dt * 1.5;
    if (this.modeT <= 0) {
      this.mode = 'idle';
      this.modeT = w.rng.range(1, 3);
    }
    return C.wander;
  }

  private updateFlee(dt: number): number {
    const w = this.w;
    this.fleeT -= dt;
    if (this.fleeT <= 0) {
      this.mode = this.active ? 'wander' : 'pace';
      this.modeT = w.rng.range(2, 4);
      return 0;
    }
    if (!this.active) return this.walkBeat(C.flee, false);
    this.turnT -= dt;
    if (this.turnT <= 0) {
      const h = this.nearestHunter();
      const away = h ? Math.atan2(this.y - h.move.y, this.x - h.move.x) : this.heading;
      this.heading = away + w.rng.range(-0.9, 0.9);
      this.turnT = w.rng.range(0.3, 0.6);
    }
    return C.flee;
  }

  private updateRescue(dt: number): number {
    const w = this.w;
    let p = w.players.get(this.target);
    if (!this.stillDown(p)) {
      p = this.pickPatient() ?? undefined;
      if (!p) {
        this.target = 0;
        this.mode = 'wander';
        this.modeT = w.rng.range(2, 4);
        return 0;
      }
      this.target = p.id;
      this.path = [];
    }
    const d = Math.hypot(p.move.x - this.x, p.move.y - this.y);
    if (d <= BALANCE.reach.teammate - 8) {
      this.mode = 'work';
      this.workT = 0;
      this.workDur = p.health === Health.Downed ? BALANCE.survivor.reviveTime : BALANCE.survivor.unstakeTime;
      this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
      return 0;
    }
    this.heading = this.steer(p.move.x, p.move.y, dt);
    return C.run;
  }

  /** Reviving or cutting down takes him as long as it would take a survivor. */
  private updateWork(dt: number): void {
    const w = this.w;
    const p = w.players.get(this.target);
    const want = this.workDur === BALANCE.survivor.reviveTime ? Health.Downed : Health.Staked;
    if (!p || p.health !== want || Math.hypot(p.move.x - this.x, p.move.y - this.y) > BALANCE.reach.teammate + 15) {
      this.mode = 'rescue';
      this.workT = 0;
      return;
    }
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.workT += dt;
    if (this.workT < this.workDur) return;
    if (p.health === Health.Downed) {
      restoreSurvivor(p, BALANCE.survivor.reviveHp);
      w.feed(`Chris Zelley got ${p.name} back on their feet`);
    } else {
      releaseFromStake(w, p);
      w.feed(`Chris Zelley cut ${p.name} down`);
    }
    this.target = 0;
    this.mode = 'ascend';
    this.ascendT = 0;
    this.moving = false;
    w.emit('all', { k: 'chris', say: 'My work here is done.' });
    w.feed('Chris Zelley sprouted wings and flew to the heavens');
  }

  /**
   * Along a walkable path (doors he opens on the way); straight at the patient only for the
   * last few steps. Sight isn't enough: windows and logs let you see but not pass.
   */
  private steer(tx: number, ty: number, dt: number): number {
    const w = this.w;
    if (Math.hypot(tx - this.x, ty - this.y) < 90 && w.geo.hasLineOfSight(this.x, this.y, tx, ty) && this.stuckT < 0.3) {
      this.path = [];
      return Math.atan2(ty - this.y, tx - this.x);
    }
    this.pathT -= dt;
    if (this.pathT <= 0 || this.path.length < 2) {
      this.pathT = 1;
      this.path = this.navGrid().findPath(this.x, this.y, tx, ty, 40000) ?? [tx, ty];
    }
    while (this.path.length > 2 && Math.hypot(this.path[0] - this.x, this.path[1] - this.y) < 20) this.path.splice(0, 2);
    return Math.atan2(this.path[1] - this.y, this.path[0] - this.x);
  }

  /** Walkable grid that treats every door as passable (he opens them on the way). */
  private navGrid(): NavGrid {
    if (this.nav) return this.nav;
    const geo = this.w.geo;
    const doors = this.w.map.doors;
    const was = doors.map((d) => geo.isDynamicActive(d.dyn));
    for (const d of doors) geo.setDynamicActive(d.dyn, false);
    this.nav = new NavGrid(geo, 25, C.radius);
    doors.forEach((d, i) => geo.setDynamicActive(d.dyn, was[i]));
    return this.nav;
  }

  private nearestHunter(): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const h of this.w.order) {
      if (h.role !== 'hunter' || h.health === Health.Eliminated) continue;
      const d = Math.hypot(h.move.x - this.x, h.move.y - this.y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }
}
