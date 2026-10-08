import { BALANCE, EntityKind, FolkFlag, Health, ItemKind, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import type { ItemHit, NpcTarget } from './npc';
import { hurtHunter, hurtSurvivor } from './combat';
import { addItem } from './inventory';
import { canAct } from './player';
import { spawnBullet } from './sniper';
import type { Rng } from '@manhunt/shared';

const NJ = BALANCE.njaaron;
const SO = BALANCE.soham;
const MO = BALANCE.monique;
const TH = BALANCE.thomas;

/** A bloody explosion at (x,y): everyone near is hurt, Zach by up to 20 hp, a survivor by up to half a bar, less the farther away. */
export function explodeAt(w: World, x: number, y: number): void {
  w.emit(w.near(x, y, BALANCE.net.maxSensingRadius), { k: 'chackoBoom', x: Math.round(x), y: Math.round(y) });
  w.noise(x, y, 1300, 'smash');
  for (const p of w.order) {
    const d = Math.hypot(p.move.x - x, p.move.y - y);
    if (d >= NJ.blastRadius) continue;
    const k = 1 - d / NJ.blastRadius;
    if (p.role === 'hunter') hurtHunter(w, p, NJ.zachBlast * k, null, 'blast');
    else if (p.role === 'survivor') hurtSurvivor(w, p, NJ.survivorBlast * k, null, 'blast');
  }
}

/** A small shove away from a point (a punch, a blast). */
function shove(p: SimPlayer, fromX: number, fromY: number, peak: number, dur: number): void {
  p.move.kbT = dur;
  p.move.kbDur = dur;
  p.move.kbPeak = peak;
  p.move.kbAng = Math.atan2(p.move.y - fromY, p.move.x - fromX);
  p.move.lungeT = 0;
}

/** Shared behaviour for the walking townsfolk: wander, flee, speak, be hit. */
abstract class Folk implements NpcTarget {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  moving = false;
  hurtT = 0;
  talkT = 0;
  alive = true;
  vapeSlowT = 0;
  vapeSlow = 0;
  protected heading = 0;
  protected modeT = 1;
  protected idle = true;
  protected fleeT = 0;
  protected fleeFrom = { x: 0, y: 0 };
  protected stuckT = 0;
  protected readonly rng: Rng;
  abstract readonly hitRadius: number;
  protected abstract readonly kind: number;
  protected abstract readonly who: 'njaaron' | 'monique' | 'thomas' | 'soham';

  constructor(
    protected readonly w: World,
    protected readonly radius: number,
    salt: number,
  ) {
    this.id = w.allocEntityId();
    // Its own random stream, so adding townsfolk doesn't change anything else.
    this.rng = w.rng.fork(salt);
    const spawns = [w.map.survivorSpawns[0], w.map.hunterSpawns[0]];
    for (let i = 0; i < 500; i++) {
      const x = this.rng.range(300, w.map.width - 300);
      const y = this.rng.range(300, w.map.height - 300);
      if (overlapsCollider(w.geo, x, y, radius + 6) || w.geo.inWater(x, y)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 600)) continue;
      this.x = x;
      this.y = y;
      break;
    }
    this.heading = this.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
  }

  get solid(): boolean {
    return this.alive;
  }

  abstract itemHit(by: SimPlayer, kind: ItemHit): void;

  protected say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: this.who, say: text });
  }

  protected near(p: SimPlayer, reach: number): boolean {
    return Math.hypot(p.move.x - this.x, p.move.y - this.y) < reach;
  }

  protected face(x: number, y: number): void {
    this.facing = Math.atan2(y - this.y, x - this.x);
  }

  protected flags(): number {
    let st = 0;
    if (this.hurtT > 0) st |= FolkFlag.Hurt;
    if (this.talkT > 0) st |= FolkFlag.Talking;
    if (this.fleeT > 0) st |= FolkFlag.Fleeing;
    return st;
  }

  record(): EntityRecord {
    return quantizeEntity(this.id, this.kind as EntityKind, this.x, this.y, this.facing, this.flags(), 0, 0, this.moving ? 1 : 0, 0);
  }

  unstick(): void {
    if (this.alive) resolveOverlaps(this.w.geo, this, this.radius);
  }

  /** Runs from a point for a while, much faster than he walks. */
  protected startFlee(from: { x: number; y: number }, seconds: number): void {
    this.fleeFrom = { x: from.x, y: from.y };
    this.fleeT = seconds;
  }

  /** One step of walking toward (tx,ty); returns true once he's within `stop`. */
  protected walkTo(tx: number, ty: number, speed: number, stop: number, dt: number): boolean {
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d <= stop) {
      this.moving = false;
      return true;
    }
    // Round whatever is in the way: sidestep while stuck.
    this.heading = Math.atan2(ty - this.y, tx - this.x) + (this.stuckT > 0.3 ? Math.sin(this.w.time * 3) * 1.2 : 0);
    this.step(speed, dt);
    this.facing = Math.atan2(ty - this.y, tx - this.x);
    return false;
  }

  protected step(speed: number, dt: number): void {
    const w = this.w;
    if (this.vapeSlowT > 0) speed *= 1 - this.vapeSlow;
    if (w.geo.inWater(this.x, this.y)) speed *= BALANCE.wadeMul;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, this.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    this.moving = true;
    this.stuckT = Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35 ? this.stuckT + dt : 0;
  }

  /** Idle and stroll about. */
  protected wander(speed: number, dt: number): void {
    this.modeT -= dt;
    if (this.idle) {
      this.moving = false;
      this.facing += Math.sin(this.w.time * 1.2 + this.id) * dt * 0.7;
      if (this.modeT <= 0) {
        this.idle = false;
        this.modeT = this.rng.range(3, 8);
        this.heading = this.facing + this.rng.range(-1.5, 1.5);
      }
      return;
    }
    this.heading += this.rng.range(-1, 1) * dt * 1.6;
    this.step(speed, dt);
    this.facing = this.heading;
    if (this.stuckT > 0.25) {
      this.heading += Math.PI * (0.5 + this.rng.next());
      this.stuckT = 0;
    }
    if (this.modeT <= 0) {
      this.idle = true;
      this.modeT = this.rng.range(1, 3.5);
    }
  }

  /** Running away: erratic, mostly away from `fleeFrom`. */
  protected runAway(speed: number, dt: number): void {
    this.fleeT -= dt;
    this.heading = Math.atan2(this.y - this.fleeFrom.y, this.x - this.fleeFrom.x) + Math.sin(this.w.time * 4 + this.id) * 0.8;
    this.step(speed, dt);
    this.facing = this.heading;
    if (this.fleeT <= 0) {
      this.idle = false;
      this.modeT = this.rng.range(2, 4);
    }
  }

  protected tick(dt: number): void {
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.talkT = Math.max(0, this.talkT - dt);
    this.vapeSlowT = Math.max(0, this.vapeSlowT - dt);
  }
}

type NMode = 'wander' | 'ask' | 'follow' | 'defend' | 'attack';

/** Njaaron: "you wanna go to the Y later?". See `BALANCE.njaaron`. */
export class Njaaron extends Folk {
  readonly hitRadius = NJ.radius;
  protected readonly kind = EntityKind.Njaaron;
  protected readonly who = 'njaaron' as const;
  mode: NMode = 'wander';
  private hp: number = NJ.hp;
  private stunHits = 0;
  stunT = 0;
  private askWho = 0;
  private askT = 0;
  private followId = 0;
  private targetId = 0;
  private angryT = 0;
  private punchCd = 0;
  private punchAge = 9;
  private lastHp = 1;

  constructor(w: World) {
    super(w, NJ.radius, 201);
  }

  /** Waiting for `p`'s answer. */
  awaiting(p: SimPlayer): boolean {
    return this.alive && this.mode === 'ask' && this.askWho === p.id;
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || this.mode === 'attack' || this.mode === 'ask' || this.stunT > 0) return false;
    if (this.mode === 'follow' || this.mode === 'defend') return false;
    if (p.role === 'survivor' && p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    if (p.role === 'hunter' && !canAct(p)) return false;
    if (p.role === 'spectator') return false;
    return this.near(p, NJ.reach);
  }

  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.mode = 'ask';
    this.askWho = p.id;
    this.askT = NJ.askSec;
    this.face(p.move.x, p.move.y);
    this.say(NJ.lineAsk);
  }

  /** Y or N from whoever he asked. */
  answer(p: SimPlayer, yes: boolean): void {
    if (!this.awaiting(p)) return;
    const w = this.w;
    this.askWho = 0;
    this.talkT = 1.5;
    if (yes) {
      this.say(NJ.lineYes);
      if (p.role === 'hunter') {
        // Zach's health comes back faster for good.
        p.njaaronRegen = true;
        w.emit([p.id], { k: 'item', text: `Njaaron: health recovery +${Math.round((NJ.regenMul - 1) * 100)}%` });
        this.mode = 'wander';
        this.idle = false;
        this.modeT = 3;
      } else {
        this.mode = 'follow';
        this.followId = p.id;
        this.lastHp = p.hp;
        w.emit([p.id], { k: 'item', text: 'Njaaron is coming with you' });
      }
    } else {
      this.say(NJ.lineNo);
      this.mode = 'attack';
      this.targetId = p.id;
      this.angryT = NJ.angrySec;
    }
  }

  /** Zach's machete (a light swipe 1, a heavy 2) or beam tick. */
  slashHit(h: SimPlayer, power: number): void {
    if (!this.alive) return;
    h.stats.hits++;
    this.hp -= power;
    this.hurtT = 0.3;
    this.stunT = Math.max(this.stunT, 0.2);
    if (this.hp <= 0) {
      this.die();
      return;
    }
    // Hit by Zach he fights back.
    this.mode = 'attack';
    this.targetId = h.id;
    this.angryT = NJ.angrySec;
    this.askWho = 0;
  }

  itemHit(by: SimPlayer, kind: ItemHit): void {
    if (!this.alive) return;
    if (by.role === 'hunter') {
      this.slashHit(by, 1);
      return;
    }
    // A firearm kills him; three stunning hits do.
    if (kind === 'shot') {
      this.die();
      return;
    }
    this.stunHits++;
    this.hurtT = 0.3;
    this.stunT = NJ.stun;
    if (this.stunHits >= NJ.stunHits) this.die();
  }

  /** However he dies: a bloody explosion. */
  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.moving = false;
    this.w.feed('Njaaron exploded');
    explodeAt(this.w, this.x, this.y);
  }

  protected override flags(): number {
    let st = super.flags();
    if (this.punchAge < 0.3) st |= FolkFlag.Punching;
    if (this.mode === 'follow') st |= FolkFlag.Following;
    if (this.mode === 'attack' || this.mode === 'defend') st |= FolkFlag.Angry;
    return st;
  }

  private punch(t: SimPlayer): void {
    const w = this.w;
    this.punchCd = NJ.punchCooldown;
    this.punchAge = 0;
    if (t.role === 'hunter') hurtHunter(w, t, NJ.punchHp, null, 'fist');
    else hurtSurvivor(w, t, NJ.survivorPunch, null, 'fist');
    shove(t, this.x, this.y, NJ.kbPeak, NJ.kbDuration);
  }

  /** Goes after `t` and punches them when close. */
  private fight(t: SimPlayer, dt: number): void {
    this.face(t.move.x, t.move.y);
    const reach = this.radius + t.radius + NJ.punchRange * 0.4;
    const close = this.walkTo(t.move.x, t.move.y, NJ.run, reach, dt);
    if (close && this.punchCd <= 0) this.punch(t);
  }

  private zachNear(p: SimPlayer): SimPlayer | undefined {
    return this.w.order.find((h) => h.role === 'hunter' && h.health !== Health.Eliminated && h.knockT <= 0 && Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y) < NJ.zachClose);
  }

  update(dt: number): void {
    if (!this.alive) return;
    const w = this.w;
    this.tick(dt);
    this.punchCd = Math.max(0, this.punchCd - dt);
    this.punchAge += dt;
    this.moving = false;
    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      return;
    }
    switch (this.mode) {
      case 'ask': {
        const p = w.players.get(this.askWho);
        this.askT -= dt;
        if (p) this.face(p.move.x, p.move.y);
        if (!p || this.askT <= 0 || !this.near(p, NJ.reach * 2.5)) {
          this.mode = 'wander';
          this.askWho = 0;
        }
        return;
      }
      case 'follow':
      case 'defend': {
        const f = w.players.get(this.followId);
        if (!f || (f.health !== Health.Healthy && f.health !== Health.Wounded && f.health !== Health.Downed)) {
          this.mode = 'wander';
          return;
        }
        const zach = this.zachNear(f);
        const attacked = f.hp < this.lastHp - 0.001;
        this.lastHp = f.hp;
        if (this.mode === 'follow') {
          // Attacked, or Zach closing in: he takes on Zach.
          if (zach || attacked) {
            const z = zach ?? w.order.find((h) => h.role === 'hunter' && h.health !== Health.Eliminated);
            if (z) {
              this.mode = 'defend';
              this.targetId = z.id;
              return;
            }
          }
          this.walkTo(f.move.x, f.move.y, NJ.run, 90, dt);
          return;
        }
        const z = w.players.get(this.targetId);
        if (!z || z.health === Health.Eliminated || Math.hypot(z.move.x - f.move.x, z.move.y - f.move.y) > NJ.zachLose) {
          this.mode = 'follow';
          return;
        }
        if (z.knockT > 0) {
          // Zach is down: back to their side.
          this.walkTo(f.move.x, f.move.y, NJ.run, 90, dt);
          return;
        }
        this.fight(z, dt);
        return;
      }
      case 'attack': {
        const t = w.players.get(this.targetId);
        this.angryT -= dt;
        const ok = t && (t.role === 'hunter' ? t.health !== Health.Eliminated && t.knockT <= 0 : t.health === Health.Healthy || t.health === Health.Wounded);
        if (!t || !ok || this.angryT <= 0) {
          this.mode = 'wander';
          this.idle = true;
          this.modeT = 2;
          return;
        }
        this.fight(t, dt);
        return;
      }
      default:
        this.wander(NJ.walk, dt);
    }
  }
}

/** Soham: says Hi, then his fuse burns for two seconds and he explodes. */
export class Soham extends Folk {
  readonly hitRadius = SO.radius;
  protected readonly kind = EntityKind.Soham;
  protected readonly who = 'soham' as const;
  private fuseT = 0;
  private lit = false;

  constructor(w: World) {
    super(w, SO.radius, 204);
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || this.lit || p.role === 'spectator') return false;
    if (p.role === 'survivor' && p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    if (p.role === 'hunter' && !canAct(p)) return false;
    return this.near(p, SO.reach);
  }

  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.lit = true;
    this.fuseT = SO.fuse;
    this.talkT = SO.fuse + 0.5;
    this.face(p.move.x, p.move.y);
    this.say(SO.line);
  }

  /** He can't be slain: he just flinches. */
  itemHit(): void {
    if (this.alive) this.hurtT = 0.3;
  }

  protected override flags(): number {
    return super.flags() | (this.lit ? FolkFlag.Fuse : 0);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.tick(dt);
    if (this.lit) {
      this.moving = false;
      this.fuseT -= dt;
      if (this.fuseT <= 0) {
        this.alive = false;
        this.w.feed('Soham exploded');
        explodeAt(this.w, this.x, this.y);
      }
      return;
    }
    this.wander(SO.walk, dt);
  }
}

/** Thomas Bourgeois: hands one player a fully charged Hemp Beam. */
export class Thomas extends Folk {
  readonly hitRadius = TH.radius;
  protected readonly kind = EntityKind.Thomas;
  protected readonly who = 'thomas' as const;
  private given = false;

  constructor(w: World) {
    super(w, TH.radius, 203);
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || this.fleeT > 0 || p.role === 'spectator') return false;
    if (p.role === 'survivor' && p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    if (p.role === 'hunter' && !canAct(p)) return false;
    return this.near(p, TH.reach);
  }

  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.face(p.move.x, p.move.y);
    this.talkT = 1.5;
    if (this.given) {
      this.say(TH.lineAfter);
      return;
    }
    this.given = true;
    p.beamCharges = BALANCE.hunter.beam.charges;
    this.say(TH.line);
    this.w.emit([p.id], { k: 'item', text: `Got a full Hemp Beam: R, ${BALANCE.hunter.beam.charges} charges` });
  }

  /** Attacked by anyone he runs. */
  itemHit(by: SimPlayer): void {
    if (!this.alive) return;
    this.hurtT = 0.3;
    this.startFlee(by.move, TH.fleeTime);
  }

  hit(by: SimPlayer, harm = true): void {
    if (harm) this.itemHit(by);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.tick(dt);
    this.moving = false;
    if (this.fleeT > 0) this.runAway(BALANCE.sexton.flee * TH.fleeMul, dt);
    else this.wander(TH.walk, dt);
  }
}

/** Monique Bourgeois: gives one survivor an arrow to Zach; shoots anyone who hits her. */
export class Monique extends Folk {
  readonly hitRadius = MO.radius;
  protected readonly kind = EntityKind.Monique;
  protected readonly who = 'monique' as const;
  private gaveArrow = false;
  private readonly fed = new Set<number>();
  private armedT = 0;
  private targetId = 0;
  private shotCd = 0;

  constructor(w: World) {
    super(w, MO.radius, 202);
  }

  get armed(): boolean {
    return this.armedT > 0;
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || p.role !== 'survivor' || this.fleeT > 0 || this.armed || this.fed.has(p.id)) return false;
    if (p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    return this.near(p, MO.reach);
  }

  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.fed.add(p.id);
    this.face(p.move.x, p.move.y);
    this.talkT = 1.5;
    if (!this.gaveArrow) {
      this.gaveArrow = true;
      p.arrowT = MO.arrowSec;
      this.say(MO.lineArrow);
      this.w.emit([p.id], { k: 'item', text: `Monique's arrow points to Zach for ${MO.arrowSec} s` });
    } else {
      this.say(MO.lineHi);
      addItem(this.w, p, ItemKind.BeastBar);
      this.w.emit([p.id], { k: 'item', text: 'Got a Mr Beast bar' });
    }
  }

  /** Zach attacks her: she bolts. A survivor: she pulls out a 0.50 cal. */
  private attacked(by: SimPlayer): void {
    if (!this.alive) return;
    this.hurtT = 0.3;
    if (by.role === 'hunter') {
      this.armedT = 0;
      this.startFlee(by.move, MO.fleeTime);
    } else if (by.role === 'survivor') {
      this.armedT = MO.attackSec;
      this.targetId = by.id;
      this.shotCd = 0.4;
      this.fleeT = 0;
    }
  }

  itemHit(by: SimPlayer): void {
    this.attacked(by);
  }

  hit(by: SimPlayer, harm = true): void {
    if (harm) this.attacked(by);
  }

  protected override flags(): number {
    return super.flags() | (this.armed ? FolkFlag.Armed : 0);
  }

  update(dt: number): void {
    if (!this.alive) return;
    const w = this.w;
    this.tick(dt);
    this.moving = false;
    if (this.armed) {
      this.armedT = Math.max(0, this.armedT - dt);
      this.shotCd = Math.max(0, this.shotCd - dt);
      const t = w.players.get(this.targetId);
      if (t && t.role === 'survivor' && (t.health === Health.Healthy || t.health === Health.Wounded)) {
        this.face(t.move.x, t.move.y);
        if (this.shotCd <= 0) {
          this.shotCd = MO.reload;
          spawnBullet(w, this.x + Math.cos(this.facing) * (this.radius + 4), this.y + Math.sin(this.facing) * (this.radius + 4), this.facing, 0, MO.shotDamage);
        }
      }
      return;
    }
    if (this.fleeT > 0) this.runAway(BALANCE.sexton.flee * MO.fleeMul, dt);
    else this.wander(MO.walk, dt);
  }
}
