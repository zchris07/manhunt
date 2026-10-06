import { BALANCE, EntityKind, Health, NavGrid, ShaneFlag, inCone, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { ItemHit, NpcTarget } from './npc';
import type { World } from './World';
import { visionFor } from './view';

/** What Shane Jeans (and anyone built like him) is tuned by. */
export interface WandererCfg {
  radius: number;
  walk: number;
  chase: number;
  alertRadius: number;
  proxAlertSec: number;
  flashAlertSec: number;
  alertDecay: number;
  chaseTime: number;
  hunterBreakRadius: number;
  loseRadius: number;
  bottlesToShake: number;
  fleeTime: number;
  cooldown: number;
}

type Mode = 'idle' | 'walk' | 'chase' | 'flee';

/**
 * Shane Jeans: a harmless, unkillable wanderer with a faint light. Survivors who crowd him
 * or keep a flashlight on him alert him, and he tails that survivor as closely as he can,
 * a beacon for Zach, who sees an arrow toward him while he's chasing. He ignores Zach
 * entirely, can't open doors or break barricades, and gives up after a while.
 */
export class Shane implements NpcTarget {
  protected readonly S: WandererCfg;
  /** Who he is (feed lines). */
  protected readonly who: string = 'Shane Jeans';
  readonly id: number;
  /** Penjamin: seconds left of its slow, and how strong (0 to 1). */
  vapeSlowT = 0;
  vapeSlow = 0;
  x = 0;
  y = 0;
  facing = 0;
  mode: Mode = 'idle';
  moving = false;
  /** Who he's chasing (0 = nobody). */
  target = 0;
  /** Alert each survivor has built up on him (0 to 1; full alerts him). */
  readonly meter = new Map<number, number>();
  protected modeT = 1;
  protected heading = 0;
  protected chaseT = 0;
  protected cooldownT = 0;
  protected fleeFrom = { x: 0, y: 0 };
  protected bottleHits = 0;
  /** Hunting someone for Chacko's sake: no giving up until they're downed (or the hunt is called off). */
  protected avenging = false;
  protected stuckT = 0;
  protected path: number[] = [];
  protected pathT = 0;
  protected nav: NavGrid | null = null;

  readonly hitRadius: number;

  constructor(
    protected readonly w: World,
    cfg: WandererCfg = BALANCE.shane,
  ) {
    this.S = cfg;
    this.hitRadius = cfg.radius;
    this.id = w.allocEntityId();
    this.spawn();
  }

  /** Anywhere open on the map, away from the spawns. */
  private spawn(): void {
    const S = this.S;
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

  get solid(): boolean {
    return true;
  }

  /** How close he is to being alerted (0-1), as everyone sees it over his head. */
  get alertLevel(): number {
    if (this.mode === 'chase') return 1;
    let m = 0;
    for (const v of this.meter.values()) m = Math.max(m, v);
    return Math.min(1, m);
  }

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
    return quantizeEntity(this.id, EntityKind.Shane, this.x, this.y, this.facing, state, this.moving ? 1 : 0, Math.round(this.alertLevel * 255), 0, 0);
  }

  /** A thrown bottle hit him: two in one chase shake him off. */
  bottleHit(): void {
    const S = this.S;
    if (this.mode !== 'chase') return;
    this.bottleHits++;
    if (this.bottleHits >= S.bottlesToShake) this.shakeOff();
  }

  /** A shotgun blast shakes him off at once. */
  shotHit(): void {
    if (this.mode === 'chase') this.shakeOff();
  }

  protected shakeOff(): void {
    const t = this.w.players.get(this.target);
    this.fleeFrom = t ? { x: t.move.x, y: t.move.y } : { x: this.x, y: this.y };
    this.endChase('flee');
    this.w.feed(`${this.who} ran off`);
  }

  protected endChase(next: 'walk' | 'flee'): void {
    const S = this.S;
    this.target = 0;
    this.avenging = false;
    this.cooldownT = S.cooldown;
    this.path = [];
    this.mode = next;
    this.modeT = next === 'flee' ? S.fleeTime : this.w.rng.range(2, 5);
  }

  protected alert(p: SimPlayer): void {
    this.avenging = false;
    this.mode = 'chase';
    this.target = p.id;
    this.chaseT = this.S.chaseTime;
    this.bottleHits = 0;
    this.meter.clear();
    this.path = [];
    this.pathT = 0;
    this.announce(true);
  }

  /** Alerted (or calmed down): everyone is told. */
  protected announce(alerted: boolean): void {
    this.w.emit('all', { k: 'shane', alerted });
    if (alerted) this.w.feed('Shane Jeans has been alerted');
  }

  /** One chase step toward `t`, `d` away: returns his speed. */
  protected chaseStep(t: SimPlayer, d: number, dt: number): number {
    const S = this.S;
    this.heading = this.steer(t.move.x, t.move.y, dt);
    // As close as he can get: he stops right beside them.
    this.facing = Math.atan2(t.move.y - this.y, t.move.x - this.x);
    return d > S.radius + t.radius + 6 ? S.chase : 0;
  }

  protected eligible(p: SimPlayer): boolean {
    return p.role === 'survivor' && (p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed) && p.hideState === 0;
  }

  /**
   * Standing close to him (faster the closer) or keeping a flashlight on him builds a
   * survivor's alert meter; otherwise it drains. Full, he's alerted.
   */
  protected watch(dt: number): void {
    const w = this.w;
    const S = this.S;
    if (this.cooldownT > 0 || this.mode === 'chase' || this.mode === 'flee') {
      this.meter.clear();
      return;
    }
    for (const p of w.order) {
      if (!this.eligible(p)) continue;
      const d = Math.hypot(p.move.x - this.x, p.move.y - this.y);
      const near = S.alertRadius + p.radius;
      let rate = 0;
      if (d <= near && w.geo.hasLineOfSight(p.move.x, p.move.y, this.x, this.y)) rate += (0.5 + 0.5 * (1 - d / near)) / S.proxAlertSec;
      const { cone } = visionFor(w, p);
      if (inCone(cone, this.x, this.y, S.radius) && w.geo.hasLineOfSight(p.move.x, p.move.y, this.x, this.y)) rate += 1 / S.flashAlertSec;
      const m = Math.max(0, (this.meter.get(p.id) ?? 0) + (rate > 0 ? rate * dt : -S.alertDecay * dt));
      if (m >= 1) {
        this.alert(p);
        return;
      }
      if (m > 0) this.meter.set(p.id, m);
      else this.meter.delete(p.id);
    }
  }

  update(dt: number): void {
    const w = this.w;
    const S = this.S;
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    this.watch(dt);
    let speed = 0;
    if (this.mode === 'chase') {
      const t = w.players.get(this.target);
      this.chaseT -= dt;
      // Zach coming close ends a chase, unless Zach is the one being chased (Jaden, provoked).
      const zachNear = t?.role !== 'hunter' && w.order.some((h) => h.role === 'hunter' && h.health !== Health.Eliminated && Math.hypot(h.move.x - this.x, h.move.y - this.y) < S.hunterBreakRadius);
      const sticky = this.avenging && t?.id === this.target;
      if (!t || !this.eligible(t) || (!sticky && (this.chaseT <= 0 || zachNear || Math.hypot(t.move.x - this.x, t.move.y - this.y) > S.loseRadius))) {
        this.endChase('walk');
        this.announce(false);
      } else {
        speed = this.chaseStep(t, Math.hypot(t.move.x - this.x, t.move.y - this.y), dt);
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
    if (this.vapeSlowT > 0) speed *= 1 - this.vapeSlow;
    if (w.geo.inWater(this.x, this.y)) speed *= BALANCE.wadeMul;
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
  protected steer(tx: number, ty: number, dt: number): number {
    const w = this.w;
    const S = this.S;
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
    resolveOverlaps(this.w.geo, this, this.S.radius);
  }
}
