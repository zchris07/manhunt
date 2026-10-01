import { BALANCE, DEG, EntityKind, Health, JadenFlag, quantizeEntity, rayCircle, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { hurtSurvivor } from './combat';
import { Shane } from './shane';

const J = BALANCE.jaden;
const G = J.pistol;

/**
 * Jaden Nguyen: wanders and is alerted exactly like Shane Jeans, but he has a pistol. Once
 * alerted he hangs back at a few metres and shoots the survivor who set him off, until
 * they've lost half their health to him, then calms down and wanders off. Bottles, shotgun
 * blasts and galaxy gas shake him off like Shane. Unkillable.
 */
export class Jaden extends Shane {
  protected override readonly who = 'Jaden Nguyen';
  private fireCd = 0;
  /** Seconds since his last shot (muzzle flash). */
  private shotAge = 9;
  /** Health his current target has lost to him this chase. */
  private dealt = 0;

  constructor(w: World) {
    super(w, J);
  }

  override record(): EntityRecord {
    let st = 0;
    if (this.mode === 'chase') st |= JadenFlag.Chasing;
    if (this.mode === 'flee') st |= JadenFlag.Fleeing;
    if (this.shotAge < 0.15) st |= JadenFlag.Firing;
    return quantizeEntity(this.id, EntityKind.Jaden, this.x, this.y, this.facing, st, this.moving ? 1 : 0, 0, 0, 0);
  }

  protected override alert(p: SimPlayer): void {
    super.alert(p);
    this.dealt = 0;
    this.fireCd = 0.6;
  }

  protected override announce(alerted: boolean): void {
    if (!alerted) return;
    this.w.feed('Jaden Nguyen has been alerted');
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'jaden', say: 'Back up!' });
  }

  /** Only someone on their feet sets him off (he won't shoot the downed). */
  protected override eligible(p: SimPlayer): boolean {
    return p.role === 'survivor' && (p.health === Health.Healthy || p.health === Health.Wounded) && p.hideState === 0;
  }

  override update(dt: number): void {
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.shotAge += dt;
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
      if (q.role !== 'survivor' || (q.health !== Health.Healthy && q.health !== Health.Wounded) || q.hideState === 2) continue;
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
    hurtSurvivor(w, hit, G.damage, null, 'bullet');
    if (hit !== t) return;
    this.dealt += before - hit.hp;
    if (this.dealt >= G.stopAfter - 1e-6 || t.health === Health.Downed) {
      w.feed(`Jaden Nguyen let ${t.name} go`);
      this.endChase('walk');
    }
  }
}
