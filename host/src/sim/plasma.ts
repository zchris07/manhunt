import { BALANCE, EntityKind, Health, ItemKind, PlasmaFlag, moveCircle, overlapsCollider, quantizeEntity, resolveOverlaps, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { nearbyDoor } from './interact';
import { hurtHunter, hurtSurvivor } from './combat';
import { addItem } from './inventory';
import { Chaser } from './nav';
import type { ItemHit, NpcTarget } from './npc';

const P = BALANCE.plasma;

type Mode = 'idle' | 'walk' | 'transform' | 'rage' | 'revert';

/**
 * Plasma.TTV: looks like a regular guy wandering around. Attack him and GAMER RAGE: over 2 s
 * he turns into a hulking beast, then chases whoever hit him and punches until they're down
 * (Zach goes down, without the lasting slowdown), then turns back and walks off. Losing him
 * for 10 s calms him too, and 10 s after transforming he turns back on his own. Items and the machete stun him (gas blinds and slows him); nothing kills him. Talk to
 * him (either side) and he says "ggs" and hands you a golden pump, once each.
 */
export class Plasma implements NpcTarget {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  mode: Mode = 'idle';
  moving = false;
  hurtT = 0;
  stunT = 0;
  /** Seconds left in galaxy gas: blind and slowed. */
  gasT = 0;
  /** Who he's after (0 = nobody). */
  target = 0;
  /** Seconds since the last punch landed (drives the punch animation). */
  punchAge = 9;
  readonly solid = true;
  readonly given = new Set<number>();
  private modeT = 1;
  private heading = 0;
  private stuckT = 0;
  private escapeT = 0;
  /** Seconds since he transformed (he turns back after `rageTime`). */
  private rageT = 0;
  private punchCd = 0;
  private readonly chaser: Chaser;

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    this.chaser = new Chaser(w, P.beastRadius - 6);
    const spawns = [w.map.survivorSpawns[0], w.map.hunterSpawns[0]];
    for (let i = 0; i < 400; i++) {
      const x = w.rng.range(300, w.map.width - 300);
      const y = w.rng.range(300, w.map.height - 300);
      if (overlapsCollider(w.geo, x, y, P.beastRadius + 6)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 700)) continue;
      this.x = x;
      this.y = y;
      break;
    }
    this.heading = w.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
  }

  get raging(): boolean {
    return this.mode === 'transform' || this.mode === 'rage';
  }

  get beast(): boolean {
    return this.mode === 'transform' || this.mode === 'rage' || this.mode === 'revert';
  }

  get radius(): number {
    return this.mode === 'rage' || this.mode === 'revert' ? P.beastRadius : P.radius;
  }

  get hitRadius(): number {
    return this.radius;
  }

  canTalk(p: SimPlayer): boolean {
    if (this.beast || this.given.has(p.id)) return false;
    if (p.role === 'survivor' && p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    if (p.role === 'hunter' && (p.carrying || p.knockT > 0)) return false;
    return Math.hypot(p.move.x - this.x, p.move.y - this.y) < P.reach;
  }

  /** "ggs": a golden pump for whoever asks (once each). */
  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    const w = this.w;
    this.given.add(p.id);
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.mode = 'idle';
    this.modeT = 1.5;
    this.say('ggs');
    if (p.role === 'hunter') {
      p.pump = BALANCE.items.zachPump.shots;
      p.chargeT = -1;
      w.emit([p.id], { k: 'item', text: 'Got golden pump' });
    } else {
      addItem(w, p, ItemKind.Shotgun, undefined, true);
      w.emit([p.id], { k: 'item', text: 'Got golden pump' });
    }
  }

  /** A survivor's item or Zach's pump. */
  itemHit(by: SimPlayer, kind: ItemHit): void {
    this.attacked(by, kind === 'bottle' ? P.bottleStun : P.shotStun);
  }

  /** Zach's machete. */
  slashHit(h: SimPlayer): void {
    h.stats.hits++;
    this.attacked(h, P.slashStun);
  }

  private attacked(by: SimPlayer, stun: number): void {
    this.hurtT = 0.3;
    if (this.beast) {
      // Already raging: it only stuns him (and he flinches).
      this.stunT = Math.max(this.stunT, stun);
      return;
    }
    // GAMER RAGE.
    const w = this.w;
    this.mode = 'transform';
    this.modeT = P.transformTime;
    this.target = by.id;
    this.escapeT = 0;
    this.rageT = 0;
    this.moving = false;
    this.facing = Math.atan2(by.move.y - this.y, by.move.x - this.x);
    this.chaser.reset();
    this.say('GAMER RAGE');
    w.feed(`${by.name} made Plasma.TTV rage`);
  }

  private say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'plasma', say: text });
  }

  record(): EntityRecord {
    let st = 0;
    if (this.mode === 'rage') st |= PlasmaFlag.Raging;
    if (this.mode === 'transform') st |= PlasmaFlag.Transforming;
    if (this.mode === 'revert') st |= PlasmaFlag.Reverting;
    if (this.stunT > 0) st |= PlasmaFlag.Stunned;
    if (this.hurtT > 0) st |= PlasmaFlag.Hurt;
    if (this.gasT > 0) st |= PlasmaFlag.Blind;
    if (this.punchAge < 0.3) st |= PlasmaFlag.Punching;
    const progress = this.mode === 'transform' ? 1 - this.modeT / P.transformTime : this.mode === 'revert' ? 1 - this.modeT / 1 : 0;
    return quantizeEntity(this.id, EntityKind.Plasma, this.x, this.y, this.facing, st, Math.round(Math.max(0, Math.min(1, progress)) * 255), 0, this.moving ? 1 : 0, 0);
  }

  unstick(): void {
    resolveOverlaps(this.w.geo, this, this.radius);
  }

  private calmDown(): void {
    this.mode = 'revert';
    this.modeT = 1;
    this.target = 0;
    this.moving = false;
  }

  /** Can he still go after `p`? */
  private huntable(p: SimPlayer | undefined): p is SimPlayer {
    if (!p) return false;
    if (p.role === 'hunter') return p.health !== Health.Eliminated && p.knockT <= 0;
    return (p.health === Health.Healthy || p.health === Health.Wounded) && p.hideState === 0;
  }

  update(dt: number): void {
    const w = this.w;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.gasT = Math.max(0, this.gasT - dt);
    this.punchCd = Math.max(0, this.punchCd - dt);
    this.punchAge += dt;
    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.moving = false;
      return;
    }
    let speed = 0;
    if (this.raging) {
      this.rageT += dt;
      if (this.rageT >= P.rageTime) {
        this.calmDown();
        return;
      }
    }
    switch (this.mode) {
      case 'transform':
        // In place, over two seconds.
        this.modeT -= dt;
        if (this.modeT <= 0) {
          this.mode = 'rage';
          resolveOverlaps(w.geo, this, P.beastRadius);
        }
        break;
      case 'revert':
        this.modeT -= dt;
        if (this.modeT <= 0) {
          this.mode = 'walk';
          this.modeT = w.rng.range(3, 6);
          this.heading = this.facing + Math.PI * 0.8;
        }
        break;
      case 'rage':
        speed = this.updateRage(dt);
        break;
      case 'idle':
        this.modeT -= dt;
        this.facing += Math.sin(w.time * 1.2 + this.id) * dt * 0.7;
        if (this.modeT <= 0) {
          this.mode = 'walk';
          this.modeT = w.rng.range(3, 8);
          this.heading = this.facing + w.rng.range(-1.5, 1.5);
        }
        break;
      case 'walk':
        this.modeT -= dt;
        this.heading += w.rng.range(-1, 1) * dt * 1.6;
        speed = P.walk;
        if (this.modeT <= 0) {
          this.mode = 'idle';
          this.modeT = w.rng.range(1, 3.5);
        }
        break;
    }
    if (this.gasT > 0) speed *= P.gasSlowMul;
    this.moving = speed > 0;
    if (!this.moving) return;
    if (w.geo.inWater(this.x, this.y)) speed *= BALANCE.wadeMul;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, this.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    if (this.mode !== 'rage' || this.gasT > 0) this.facing = this.heading;
    if (Math.hypot(this.x - bx, this.y - by) < speed * dt * 0.35) {
      this.stuckT += dt;
      const di = nearbyDoor(w, this.x + Math.cos(this.heading) * 34, this.y + Math.sin(this.heading) * 34, 44);
      if (di >= 0 && !w.doors[di] && w.doorCd[di] <= 0) w.setDoor(di, true);
      else if (this.stuckT > 0.25 && this.mode !== 'rage') {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  private updateRage(dt: number): number {
    const w = this.w;
    const t = w.players.get(this.target);
    if (!this.huntable(t)) {
      this.calmDown();
      return 0;
    }
    const d = Math.hypot(t.move.x - this.x, t.move.y - this.y);
    // Out of reach or out of sight counts toward escaping him; 10 s and he gives up.
    const lost = this.gasT > 0 || d > P.loseRadius || !w.geo.hasLineOfSight(this.x, this.y, t.move.x, t.move.y);
    this.escapeT = lost ? this.escapeT + dt : 0;
    if (this.escapeT >= P.escapeTime) {
      w.feed(`${t.name} got away from Plasma.TTV`);
      this.calmDown();
      return 0;
    }
    if (this.gasT > 0) {
      // Blinded: stumbling about.
      this.heading += w.rng.range(-1, 1) * dt * 5;
      return P.chase;
    }
    const reach = this.radius + t.radius + P.punchRange;
    if (d <= reach) {
      this.facing = Math.atan2(t.move.y - this.y, t.move.x - this.x);
      if (this.punchCd <= 0) this.punch(t);
      return 0;
    }
    this.heading = this.chaser.heading(this.x, this.y, t.move.x, t.move.y, dt, this.stuckT > 0.3);
    this.facing = this.heading;
    return P.chase;
  }

  private punch(t: SimPlayer): void {
    const w = this.w;
    this.punchCd = P.punchCooldown;
    this.punchAge = 0;
    if (t.role === 'survivor') {
      hurtSurvivor(w, t, P.punchDamage, null, 'punch');
      if (t.health === Health.Downed) {
        w.feed(`Plasma.TTV beat ${t.name} down`);
        this.calmDown();
      }
      return;
    }
    // Zach: punched until he goes down.
    hurtHunter(w, t, P.zachPunchDamage, null, 'punch');
    if (t.knockT > 0) this.calmDown();
  }
}
