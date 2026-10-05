import { BALANCE, DEG, EntityKind, Health, ItemKind, JadenFlag, moveCircle, quantizeEntity, rayCircle, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import type { ItemHit } from './npc';
import { hurtHunter, hurtSurvivor } from './combat';
import { placeDrop } from './items';
import { Shane } from './shane';

const J = BALANCE.jaden;
const G = J.pistol;

/**
 * Jaden Nguyen: wanders and is alerted exactly like Shane Jeans, but he has a pistol. Once
 * alerted he hangs back at a few metres and shoots the survivor who set him off, until they
 * get out of range or have lost half the health they had when he started. Any survivor item
 * stuns him for a moment; three of them kill him, and he drops his pistol. Anyone who attacks
 * him (a survivor's item, Zach's machete, lunge, golden pump or Penjamin) sets him on them.
 */
export class Jaden extends Shane {
  protected override readonly who = 'Jaden Nguyen';
  alive = true;
  stunT = 0;
  private fireCd = 0;
  /** Seconds since his last shot (muzzle flash). */
  private shotAge = 9;
  /** Health his current target has lost to him this chase, and what they had to start. */
  private dealt = 0;
  private startHp = 1;
  private hits = 0;
  private zachHits = 0;
  hurtT = 0;

  constructor(w: World) {
    super(w, J);
  }

  override get solid(): boolean {
    return this.alive;
  }

  override get alertLevel(): number {
    return this.alive ? super.alertLevel : 0;
  }

  override record(): EntityRecord {
    let st = 0;
    if (!this.alive) st |= JadenFlag.Dead;
    if (this.mode === 'chase') st |= JadenFlag.Chasing;
    if (this.mode === 'flee') st |= JadenFlag.Fleeing;
    if (this.shotAge < 0.15) st |= JadenFlag.Firing;
    if (this.stunT > 0) st |= JadenFlag.Stunned;
    if (this.hurtT > 0) st |= JadenFlag.Hurt;
    return quantizeEntity(this.id, EntityKind.Jaden, this.x, this.y, this.facing, st, this.moving ? 1 : 0, Math.round(this.alertLevel * 255), 0, 0);
  }

  /** Anything thrown or fired at him stuns him, and he goes after whoever did it; three survivor hits and he's dead. */
  override itemHit(by: SimPlayer, _kind: ItemHit): void {
    if (!this.alive) return;
    this.stunT = Math.max(this.stunT, J.stun);
    this.moving = false;
    if (by.role === 'survivor') {
      this.hits++;
      if (this.hits >= J.hp) {
        this.die(by);
        return;
      }
    }
    this.provoke(by);
  }

  /**
   * Zach's machete (power 1 light, 2 heavy; a lunge counts as light): he flinches, is shoved
   * back and stunned for a moment, and six points of it kill him.
   */
  slashHit(by: SimPlayer, power: number): void {
    if (!this.alive) return;
    this.zachHits += power;
    this.hurtT = 0.3;
    this.stunT = Math.max(this.stunT, J.meleeStun);
    this.moving = false;
    if (this.zachHits >= J.zachHp) {
      this.die(by);
      return;
    }
    const a = Math.atan2(this.y - by.move.y, this.x - by.move.x);
    moveCircle(this.w.geo, this, J.radius, Math.cos(a) * J.kb, Math.sin(a) * J.kb);
    this.provoke(by);
  }

  /** Attacked or gassed with Penjamin, by anyone: he turns on them at once. */
  provoke(by: SimPlayer): void {
    if (!this.alive || (this.mode === 'chase' && this.target === by.id)) return;
    if (!this.targetable(by)) return;
    this.alert(by);
  }

  /** Anyone he's after: a survivor on their feet, or Zach (only once Zach has provoked him). */
  private targetable(p: SimPlayer): boolean {
    if (p.role === 'hunter') return p.health !== Health.Eliminated && p.knockT <= 0;
    return p.role === 'survivor' && (p.health === Health.Healthy || p.health === Health.Wounded) && p.hideState === 0;
  }

  override gassed(): void {
    if (this.alive) this.stunT = Math.max(this.stunT, J.stun);
  }

  private die(by: SimPlayer): void {
    const w = this.w;
    this.alive = false;
    this.moving = false;
    this.hurtT = 0;
    if (this.mode === 'chase') this.endChase('walk');
    this.meter.clear();
    placeDrop(w, { id: w.allocEntityId(), x: this.x, y: this.y, kind: ItemKind.Pistol, golden: false, amount: BALANCE.items.pistol.shots }, this.x + Math.cos(this.facing) * 22, this.y + Math.sin(this.facing) * 22);
    w.feed(`${by.name} took Jaden Nguyen down. His pistol is on the ground`);
  }

  protected override alert(p: SimPlayer): void {
    super.alert(p);
    this.dealt = 0;
    this.startHp = p.hp;
    this.fireCd = 0.6;
  }

  protected override announce(alerted: boolean): void {
    if (!alerted) return;
    this.w.feed('Jaden Nguyen has been alerted');
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'jaden', say: 'Back up!' });
  }

  /** Only someone on their feet sets him off (he won't shoot the downed); Zach only once he's the target. */
  protected override eligible(p: SimPlayer): boolean {
    if (p.role === 'hunter') return p.id === this.target && this.targetable(p);
    return this.targetable(p);
  }

  override update(dt: number): void {
    if (!this.alive) return;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.shotAge += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.moving = false;
      return;
    }
    super.update(dt);
  }

  /** Closes to a few metres, then stands and shoots while he has a clear line. */
  protected override chaseStep(t: SimPlayer, d: number, dt: number): number {
    const w = this.w;
    const clear = w.geo.hasLineOfSight(this.x, this.y, t.move.x, t.move.y);
    this.heading = this.steer(t.move.x, t.move.y, dt);
    if (clear) this.facing = Math.atan2(t.move.y - this.y, t.move.x - this.x);
    else this.facing = this.heading;
    if (clear && d <= G.range && this.fireCd <= 0) this.fire(t);
    if (this.mode !== 'chase') return 0;
    return clear && d <= G.keep ? 0 : J.chase;
  }

  private fire(t: SimPlayer): void {
    const w = this.w;
    this.fireCd = G.cooldown;
    this.shotAge = 0;
    const a = this.facing + w.rng.range(-1, 1) * G.spreadDeg * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const sx = this.x + dx * (J.radius + 2);
    const sy = this.y + dy * (J.radius + 2);
    const wall = Math.min(G.range * 1.5, w.geo.raycastVision(sx, sy, a, G.range * 1.5));
    // The first survivor in the line of fire takes it (not always his target).
    let best = wall;
    let hit: SimPlayer | null = null;
    for (const q of w.order) {
      const ok = q.role === 'hunter' ? q.health !== Health.Eliminated && q.knockT <= 0 : q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2;
      if (!ok) continue;
      const tt = rayCircle(sx, sy, dx, dy, q.move.x, q.move.y, q.radius);
      if (tt < best) {
        best = tt;
        hit = q;
      }
    }
    w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'shot', x: Math.round(this.x), y: Math.round(this.y), p: [Math.round(a * 1000), Math.round(best + J.radius + 2)], hit: hit !== null, gold: false });
    w.noise(this.x, this.y, 900, 'shot');
    if (!hit) return;
    const before = hit.hp;
    if (hit.role === 'hunter') hurtHunter(w, hit, G.damage * BALANCE.hunter.health.max, null, 'bullet');
    else hurtSurvivor(w, hit, G.damage, null, 'bullet');
    if (hit !== t) return;
    this.dealt += before - hit.hp;
    if (this.dealt >= this.startHp * G.stopAfter - 1e-6 || t.health === Health.Downed || t.knockT > 0) {
      w.feed(`Jaden Nguyen let ${t.name} go`);
      this.endChase('walk');
    }
  }
}
