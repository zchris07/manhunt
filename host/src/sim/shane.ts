import { BALANCE, EntityKind, Health, NavGrid, ShaneFlag, inCone, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { ItemHit, NpcTarget } from './npc';
import type { World } from './World';
import { visionFor } from './view';

const S = BALANCE.shane;

type Mode = 'idle' | 'walk' | 'chase' | 'flee';

/**
 * Shane Jeans: a harmless, unkillable wanderer with a faint light. Survivors who crowd him
 * or keep a flashlight on him alert him, and he tails that survivor as closely as he can,
 * a beacon for Zach, who sees an arrow toward him while he's chasing. He ignores Zach
 * entirely, can't open doors or break barricades, and gives up after a while.
 */
export class Shane implements NpcTarget {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  mode: Mode = 'idle';
  moving = false;
  /** Who he's chasing (0 = nobody). */
  target = 0;
  /** Seconds of flashlight each survivor has built up on him. */
  readonly meter = new Map<number, number>();
  private modeT = 1;
  private heading = 0;
  private chaseT = 0;
  private cooldownT = 0;
  private fleeFrom = { x: 0, y: 0 };
  private bottleHits = 0;
  private stuckT = 0;
  private path: number[] = [];
  private pathT = 0;
  private nav: NavGrid | null = null;

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    this.spawn();
  }

  /** Anywhere open on the map, away from the spawns. */
  private spawn(): void {
    const w = this.w;
    const spawns = [w.map.survivorSpawns[0], w.map.hunterSpawns[0]];
    for (let i = 0; i < 400; i++) {
      const x = w.rng.range(300, w.map.width - 300);
      const y = w.rng.range(300, w.map.height - 300);
      if (overlapsCollider(w.geo, x, y, S.radius + 4)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 700)) continue;
      this.x = x;
      this.y = y;
      break;
    }
    this.heading = w.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
  }

  readonly hitRadius = S.radius;
  readonly solid = true;

  itemHit(_by: SimPlayer, kind: ItemHit): void {
    if (kind === 'bottle') this.bottleHit();
    else this.shotHit();
  }

  /** Caught in galaxy gas: he loses the survivor and runs off. */
  gassed(): void {
    if (this.mode === 'chase') this.shakeOff();
  }

  get chasing(): boolean {
    return this.mode === 'chase';
  }

  record(): EntityRecord {
    const state = (this.mode === 'chase' ? ShaneFlag.Chasing : 0) | (this.mode === 'flee' ? ShaneFlag.Fleeing : 0);
    return quantizeEntity(this.id, EntityKind.Shane, this.x, this.y, this.facing, state, this.moving ? 1 : 0, 0, 0, 0);
  }

  /** A thrown bottle hit him: two in one chase shake him off. */
  bottleHit(): void {
    if (this.mode !== 'chase') return;
    this.bottleHits++;
    if (this.bottleHits >= S.bottlesToShake) this.shakeOff();
  }

  /** A shotgun blast shakes him off at once. */
  shotHit(): void {
    if (this.mode === 'chase') this.shakeOff();
  }

  private shakeOff(): void {
    const t = this.w.players.get(this.target);
    this.fleeFrom = t ? { x: t.move.x, y: t.move.y } : { x: this.x, y: this.y };
    this.endChase('flee');
    this.w.feed('Shane Jeans ran off');
  }

  private endChase(next: 'walk' | 'flee'): void {
    this.target = 0;
    this.cooldownT = S.cooldown;
    this.path = [];
    this.mode = next;
    this.modeT = next === 'flee' ? S.fleeTime : this.w.rng.range(2, 5);
  }

  private alert(p: SimPlayer): void {
    const w = this.w;
    this.mode = 'chase';
    this.target = p.id;
    this.chaseT = S.chaseTime;
    this.bottleHits = 0;
    this.meter.clear();
    this.path = [];
    this.pathT = 0;
    w.emit('all', { k: 'shane', alerted: true });
    w.feed('Shane Jeans has been alerted');
  }

  private eligible(p: SimPlayer): boolean {
    return p.role === 'survivor' && (p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed) && p.hideState === 0;
  }

  /** Close survivors alert him at once; a flashlight on him builds (and slowly loses) alert. */
  private watch(dt: number): void {
    const w = this.w;
    if (this.cooldownT > 0 || this.mode === 'chase' || this.mode === 'flee') {
      this.meter.clear();
      return;
    }
    for (const p of w.order) {
      if (!this.eligible(p)) continue;
      const d = Math.hypot(p.move.x - this.x, p.move.y - this.y);
      if (d <= S.alertRadius + p.radius) {
        this.alert(p);
        return;
      }
      const { cone } = visionFor(w, p);
      const lit = inCone(cone, this.x, this.y, S.radius) && w.geo.hasLineOfSight(p.move.x, p.move.y, this.x, this.y);
      const m = Math.max(0, (this.meter.get(p.id) ?? 0) + (lit ? dt : -S.alertDecay * dt));
      if (m >= S.flashAlertSec) {
        this.alert(p);
        return;
      }
      if (m > 0) this.meter.set(p.id, m);
      else this.meter.delete(p.id);
    }
  }

  update(dt: number): void {
    const w = this.w;
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    this.watch(dt);
    let speed = 0;
    if (this.mode === 'chase') {
      const t = w.players.get(this.target);
      this.chaseT -= dt;
      const zachNear = w.order.some((h) => h.role === 'hunter' && h.health !== Health.Eliminated && Math.hypot(h.move.x - this.x, h.move.y - this.y) < S.hunterBreakRadius);
      if (!t || !this.eligible(t) || this.chaseT <= 0 || zachNear || Math.hypot(t.move.x - this.x, t.move.y - this.y) > S.loseRadius) {
        this.endChase('walk');
        w.emit('all', { k: 'shane', alerted: false });
      } else {
        const d = Math.hypot(t.move.x - this.x, t.move.y - this.y);
        this.heading = this.steer(t.move.x, t.move.y, dt);
        // As close as he can get: he stops right beside them.
        speed = d > S.radius + t.radius + 6 ? S.chase : 0;
        this.facing = Math.atan2(t.move.y - this.y, t.move.x - this.x);
      }
    } else if (this.mode === 'flee') {
      this.modeT -= dt;
      this.heading = Math.atan2(this.y - this.fleeFrom.y, this.x - this.fleeFrom.x) + Math.sin(w.time * 5) * 0.5;
      speed = S.chase;
      if (this.modeT <= 0) {
        this.mode = 'walk';
        this.modeT = w.rng.range(2, 5);
      }
    } else {
      this.modeT -= dt;
      if (this.mode === 'idle') {
        this.facing += Math.sin(w.time * 1.1 + this.id) * dt * 0.7;
        if (this.modeT <= 0) {
          this.heading = this.facing + w.rng.range(-1.5, 1.5);
          this.mode = 'walk';
          this.modeT = w.rng.range(3, 8);
        }
      } else {
        this.heading += w.rng.range(-1, 1) * dt * 1.6;
        speed = S.walk;
        if (this.modeT <= 0) {
          this.mode = 'idle';
          this.modeT = w.rng.range(1, 3.5);
        }
      }
    }
    this.moving = speed > 0;
    if (!this.moving) return;
    const bx = this.x;
    const by = this.y;
    // No door opening, no barricade breaking: closed doors and walls simply stop him.
    moveCircle(w.geo, this, S.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    if (this.mode !== 'chase') this.facing = this.heading;
    if (Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35) {
      this.stuckT += dt;
      if (this.mode !== 'chase' && this.stuckT > 0.25) {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  /** Straight at the target when he can see them, otherwise along a path around walls. */
  private steer(tx: number, ty: number, dt: number): number {
    const w = this.w;
    if (w.geo.hasLineOfSight(this.x, this.y, tx, ty) && this.stuckT < 0.3) {
      this.path = [];
      return Math.atan2(ty - this.y, tx - this.x);
    }
    this.pathT -= dt;
    if (this.pathT <= 0 || this.path.length < 2) {
      this.pathT = 0.6;
      this.nav ??= new NavGrid(w.geo, 25, S.radius);
      this.path = this.nav.findPath(this.x, this.y, tx, ty, 20000) ?? [tx, ty];
    }
    while (this.path.length > 2 && Math.hypot(this.path[0] - this.x, this.path[1] - this.y) < 20) this.path.splice(0, 2);
    return Math.atan2(this.path[1] - this.y, this.path[0] - this.x);
  }

  unstick(): void {
    resolveOverlaps(this.w.geo, this, S.radius);
  }
}
