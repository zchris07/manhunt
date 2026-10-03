import { BALANCE, EntityKind, Health, ItemKind, MarcFlag, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { nearbyDoor } from './interact';
import { addItem } from './inventory';
import type { NpcTarget } from './npc';

const M = BALANCE.marc;

/**
 * Marc Cortez starts in the warehouse and wanders (through doors, out into the woods and
 * back). Talk to him and he hands you duck confit (once each).
 * Nothing hurts him: Zach's machete gets a complaint, a survivor's item a flinch. He never
 * runs; he just stands there for a moment.
 */
export class Marc implements NpcTarget {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  moving = false;
  hurtT = 0;
  readonly hitRadius = M.radius;
  readonly solid = true;
  private mode: 'idle' | 'walk' = 'idle';
  private modeT = 1;
  private heading = 0;
  private stuckT = 0;
  /** Stands still (after a hit or a chat) this long. */
  private holdT = 0;
  private complaints = 0;
  /** Survivors he already gave duck confit. */
  readonly confitGiven = new Set<number>();
  private readonly lastTalk = new Map<number, number>();

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    const r = w.map.warehouse;
    for (let i = 0; i < 400; i++) {
      const x = w.rng.range(r.x + 60, r.x + r.w - 60);
      const y = w.rng.range(r.y + 60, r.y + r.h - 60);
      if (overlapsCollider(w.geo, x, y, M.radius + 6)) continue;
      this.x = x;
      this.y = y;
      break;
    }
    if (!this.x) {
      this.x = r.x + r.w / 2;
      this.y = r.y + r.h / 2;
      resolveOverlaps(w.geo, this, M.radius);
    }
    this.heading = w.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
  }

  canTalk(p: SimPlayer): boolean {
    if (p.role !== 'survivor' || (p.health !== Health.Healthy && p.health !== Health.Wounded)) return false;
    if (this.w.time - (this.lastTalk.get(p.id) ?? -99) < M.talkCooldown) return false;
    return Math.hypot(p.move.x - this.x, p.move.y - this.y) < M.reach;
  }

  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    const w = this.w;
    this.lastTalk.set(p.id, w.time);
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.holdT = 2;
    const confit = !this.confitGiven.has(p.id);
    if (confit) {
      this.confitGiven.add(p.id);
      addItem(w, p, ItemKind.Confit);
      w.emit([p.id], { k: 'item', text: 'Got duck confit' });
    }
    this.say(confit ? 'Here, take some duck confit. Trust me.' : "That's all the confit I've got, man. Stay safe out there.");
  }

  /** Zach's machete (or anything of his): he protests and stands his ground. */
  hit(h: SimPlayer): void {
    h.stats.hits++;
    this.hurtT = 0.35;
    this.holdT = 1.5;
    this.facing = Math.atan2(h.move.y - this.y, h.move.x - this.x);
    this.say(this.complaints++ % 2 === 0 ? 'Hey man, what the heck?' : 'Cut it out');
  }

  itemHit(by: SimPlayer): void {
    if (by.role === 'hunter') {
      this.hit(by);
      return;
    }
    this.hurtT = 0.35;
    this.holdT = 1;
  }

  private say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'marc', say: text });
  }

  record(): EntityRecord {
    return quantizeEntity(this.id, EntityKind.Marc, this.x, this.y, this.facing, this.hurtT > 0 ? MarcFlag.Hurt : 0, 0, 0, this.moving ? 1 : 0, 0);
  }

  unstick(): void {
    resolveOverlaps(this.w.geo, this, M.radius);
  }

  update(dt: number): void {
    const w = this.w;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.holdT > 0) {
      this.holdT -= dt;
      this.moving = false;
      return;
    }
    this.modeT -= dt;
    let speed = 0;
    if (this.mode === 'idle') {
      this.facing += Math.sin(w.time * 1.1 + this.id) * dt * 0.7;
      if (this.modeT <= 0) {
        this.mode = 'walk';
        this.modeT = w.rng.range(3, 9);
        this.heading = this.facing + w.rng.range(-1.5, 1.5);
      }
    } else {
      this.heading += w.rng.range(-1, 1) * dt * 1.4;
      speed = M.walk;
      if (this.modeT <= 0) {
        this.mode = 'idle';
        this.modeT = w.rng.range(1, 4);
      }
    }
    this.moving = speed > 0;
    if (!this.moving) return;
    if (w.geo.inWater(this.x, this.y)) speed *= BALANCE.wadeMul;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, M.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    this.facing = this.heading;
    if (Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35) {
      this.stuckT += dt;
      // He uses doors: open the one in the way, else turn from the wall.
      const di = nearbyDoor(w, this.x + Math.cos(this.heading) * 30, this.y + Math.sin(this.heading) * 30, 40);
      if (di >= 0 && !w.doors[di] && w.doorCd[di] <= 0) w.setDoor(di, true);
      else if (this.stuckT > 0.25) {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }
}
