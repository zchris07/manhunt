import { BALANCE, EntityKind, Health, WazFlag, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import type { ItemHit, NpcTarget } from './npc';

const Z = BALANCE.waz;

/**
 * Waz wanders the map. Talk to him as a survivor and he takes a looksie: you see 10% more of
 * the map for good (once each). Zach slays him in three hits (he bolts like Sexton after
 * each); a survivor slays him with any one item, and sees 10% less for it. Zach who slays him
 * sees 10% more. Either way, the slayer gets a picture flashed across their screen.
 */
export class Waz implements NpcTarget {
  readonly id: number;
  /** Penjamin: seconds left of its slow, and how strong (0 to 1). */
  vapeSlowT = 0;
  vapeSlow = 0;
  x = 0;
  y = 0;
  facing = 0;
  moving = false;
  hurtT = 0;
  gasT = 0;
  alive = true;
  readonly hitRadius = Z.radius;
  private hp = Z.hp;
  private mode: 'idle' | 'walk' | 'flee' = 'idle';
  private modeT = 1;
  private heading = 0;
  private turnT = 0;
  private stuckT = 0;
  private talkT = 0;
  private fleeFrom: SimPlayer | null = null;

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    const spawns = [w.map.survivorSpawns[0], w.map.hunterSpawns[0]];
    for (let i = 0; i < 400; i++) {
      const x = w.rng.range(300, w.map.width - 300);
      const y = w.rng.range(300, w.map.height - 300);
      if (overlapsCollider(w.geo, x, y, Z.radius + 4)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 600)) continue;
      this.x = x;
      this.y = y;
      break;
    }
    this.heading = w.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
  }

  get solid(): boolean {
    return this.alive;
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || p.role !== 'survivor' || p.wazLooked || this.mode === 'flee') return false;
    if (p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    return Math.hypot(p.move.x - this.x, p.move.y - this.y) < Z.reach;
  }

  /** "lemme take a looksie": that survivor sees more of the map for good. */
  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    p.wazLooked = true;
    p.fovMul *= 1 + Z.fovBonus;
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.talkT = 2;
    this.mode = 'idle';
    this.modeT = 2;
    this.say(Z.line);
    this.w.emit([p.id], { k: 'item', text: 'Waz took a looksie: you see 10% more' });
  }

  /** Zach's machete or lunge: three and he's slain; until then he bolts. */
  hit(h: SimPlayer, harm = true): void {
    if (!this.alive) return;
    if (harm) {
      h.stats.hits++;
      this.hurtT = 0.35;
      this.hp--;
    }
    if (this.hp <= 0) {
      this.slay(h);
      return;
    }
    this.mode = 'flee';
    this.modeT = Z.fleeTime;
    this.fleeFrom = h;
    this.turnT = 0;
  }

  /** A survivor's item slays him on the spot; Zach's pump counts as a hit. */
  itemHit(by: SimPlayer, _kind: ItemHit): void {
    if (!this.alive) return;
    if (by.role === 'hunter') this.hit(by);
    else this.slay(by);
  }

  private slay(by: SimPlayer): void {
    const w = this.w;
    this.alive = false;
    this.moving = false;
    by.fovMul *= by.role === 'hunter' ? 1 + Z.fovBonus : 1 - Z.fovPenalty;
    w.emit([by.id], { k: 'wazSlain' });
    w.emit([by.id], { k: 'item', text: by.role === 'hunter' ? 'Slew Waz: you see 10% more' : 'Slew Waz: you see 10% less' });
    w.feed(`${by.name} slew Waz`);
  }

  private say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'waz', say: text });
  }

  record(): EntityRecord {
    let st = 0;
    if (this.mode === 'flee') st |= WazFlag.Fleeing;
    if (this.hurtT > 0) st |= WazFlag.Hurt;
    if (this.talkT > 0) st |= WazFlag.Talking;
    return quantizeEntity(this.id, EntityKind.Waz, this.x, this.y, this.facing, st, 0, 0, this.moving ? 1 : 0, 0);
  }

  unstick(): void {
    if (this.alive) resolveOverlaps(this.w.geo, this, Z.radius);
  }

  update(dt: number): void {
    if (!this.alive) return;
    const w = this.w;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.gasT = Math.max(0, this.gasT - dt);
    this.talkT = Math.max(0, this.talkT - dt);
    this.modeT -= dt;
    let speed = 0;
    if (this.mode === 'flee') {
      // Erratic, mostly away from whoever hit him.
      this.turnT -= dt;
      if (this.turnT <= 0) {
        const f = this.fleeFrom;
        const away = f ? Math.atan2(this.y - f.move.y, this.x - f.move.x) : this.heading;
        this.heading = away + w.rng.range(-1.3, 1.3);
        this.turnT = w.rng.range(0.2, 0.45);
      }
      speed = Z.flee;
      if (this.modeT <= 0) {
        this.mode = 'walk';
        this.modeT = w.rng.range(2, 5);
      }
    } else if (this.mode === 'idle') {
      if (this.talkT <= 0) this.facing += Math.sin(w.time * 1.2 + this.id) * dt * 0.7;
      if (this.modeT <= 0) {
        this.mode = 'walk';
        this.modeT = w.rng.range(3, 8);
        this.heading = this.facing + w.rng.range(-1.5, 1.5);
      }
    } else {
      this.heading += w.rng.range(-1, 1) * dt * 1.6;
      speed = Z.walk;
      if (this.modeT <= 0) {
        this.mode = 'idle';
        this.modeT = w.rng.range(1, 3.5);
      }
    }
    if (this.gasT > 0) speed *= 0.5;
    this.moving = speed > 0;
    if (!this.moving) return;
    if (this.vapeSlowT > 0) speed *= 1 - this.vapeSlow;
    if (w.geo.inWater(this.x, this.y)) speed *= BALANCE.wadeMul;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, Z.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    this.facing = this.heading;
    if (Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35) {
      this.stuckT += dt;
      if (this.stuckT > 0.25) {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }
}
