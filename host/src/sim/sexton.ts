import { Action, BALANCE, Health, moveCircle, overlapsCollider, resolveOverlaps } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { nearbyDoor } from './interact';

const X = BALANCE.sexton;

type Mode = 'idle' | 'walk' | 'flee' | 'talk';

/**
 * Sexton Science: a harmless NPC who wanders the map (no light, but his reel audio plays
 * around him). Survivors who talk to him get a glowing tablet (JARVIS). Zach can slay him
 * in three hits; he drops a Hemp Battery.
 */
export class Sexton {
  readonly id: number;
  x = 0;
  y = 0;
  facing = 0;
  hp: number = X.hp;
  alive = true;
  mode: Mode = 'idle';
  moving = false;
  hurtT = 0;
  private modeT = 1;
  private heading = 0;
  private turnT = 0;
  private fleeT = 0;
  private talkTo = 0;
  private talkT = 0;
  private handT = 0;
  private deadT = 0;
  private stuckT = 0;
  readonly given = new Set<number>();

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    this.spawn();
  }

  /** A random spot in the open: a clearing or somewhere along a path, away from spawns. */
  private spawn(): void {
    const w = this.w;
    const cands: { x: number; y: number }[] = [];
    for (const c of w.map.clearings.slice(1)) cands.push({ x: c.x + w.rng.range(-c.r * 0.4, c.r * 0.4), y: c.y + w.rng.range(-c.r * 0.4, c.r * 0.4) });
    for (const p of w.map.paths) {
      const k = w.rng.int(0, p.points.length / 2 - 1) * 2;
      cands.push({ x: p.points[k], y: p.points[k + 1] });
    }
    const spawns = [...w.map.survivorSpawns.slice(0, 1), ...w.map.hunterSpawns.slice(0, 1)];
    const ok = cands.filter((c) => !overlapsCollider(w.geo, c.x, c.y, X.radius + 2) && spawns.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 500));
    const at = ok.length ? w.rng.pick(ok) : (cands[0] ?? { x: w.map.width / 2, y: w.map.height - 800 });
    this.x = at.x;
    this.y = at.y;
    this.heading = w.rng.range(-Math.PI, Math.PI);
    this.facing = this.heading;
    this.hp = X.hp;
    this.alive = true;
    this.mode = 'idle';
    this.modeT = 1;
    resolveOverlaps(w.geo, this, X.radius);
  }

  /** Survivors can ask him once each for a tablet. */
  canTalk(p: SimPlayer): boolean {
    return this.alive && this.mode !== 'talk' && this.mode !== 'flee' && !this.given.has(p.id) && Math.hypot(p.move.x - this.x, p.move.y - this.y) < X.reach;
  }

  startTalk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.mode = 'talk';
    this.talkTo = p.id;
    this.talkT = X.talkTime;
    this.handT = 0;
    this.moving = false;
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.w.startAction(p, Action.Talk, X.talkTime + X.handTime, 0);
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'sexton', say: "I'm working on something big" });
  }

  cancelTalk(playerId: number): void {
    if (this.talkTo !== playerId) return;
    this.talkTo = 0;
    if (this.mode === 'talk') this.setMode('walk', 2);
  }

  /** Zach hits him: he runs off erratically; the third hit kills him. */
  hit(h: SimPlayer): void {
    if (!this.alive) return;
    const w = this.w;
    this.hp--;
    this.hurtT = 0.35;
    if (this.talkTo) {
      const p = w.players.get(this.talkTo);
      this.talkTo = 0;
      if (p && p.action === Action.Talk) w.cancelAction(p);
    }
    h.stats.hits++;
    if (this.hp <= 0) {
      this.alive = false;
      this.mode = 'idle';
      this.moving = false;
      this.deadT = 0;
      w.hempDrop = { id: w.allocEntityId(), x: this.x + Math.cos(this.facing) * 22, y: this.y + Math.sin(this.facing) * 22 };
      w.feed(`${h.name} slayed Sexton Science. Something is glowing where he fell.`);
      return;
    }
    this.mode = 'flee';
    this.fleeT = X.fleeTime;
    this.turnT = 0;
    w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'sexton', say: this.hp === 2 ? 'AGH! Not the face!' : 'Somebody help!' });
  }

  unstick(): void {
    resolveOverlaps(this.w.geo, this, X.radius);
  }

  private setMode(m: Mode, t: number): void {
    this.mode = m;
    this.modeT = t;
  }

  update(dt: number): void {
    const w = this.w;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (!this.alive) {
      // Testing mode brings him back so the tablet and battery can be tried again.
      this.deadT += dt;
      if (w.testMode && this.deadT > 10) {
        this.given.clear();
        this.spawn();
      }
      return;
    }
    if (this.mode === 'talk') {
      this.updateTalk(dt);
      return;
    }
    let speed = 0;
    if (this.mode === 'flee') {
      this.fleeT -= dt;
      this.turnT -= dt;
      if (this.turnT <= 0) {
        // Erratic: a new direction every few tenths of a second, mostly away from Zach.
        const h = this.nearestHunter();
        const away = h ? Math.atan2(this.y - h.move.y, this.x - h.move.x) : this.heading;
        this.heading = away + w.rng.range(-1.3, 1.3);
        this.turnT = w.rng.range(0.2, 0.45);
      }
      speed = X.flee;
      if (this.fleeT <= 0) this.setMode('walk', w.rng.range(2, 5));
    } else {
      this.modeT -= dt;
      if (this.mode === 'idle') {
        // Looking around.
        this.facing += Math.sin(w.time * 1.3 + this.id) * dt * 0.8;
        if (this.modeT <= 0) {
          this.heading = this.facing + w.rng.range(-1.5, 1.5);
          this.setMode('walk', w.rng.range(3, 8));
        }
      } else {
        // A wandering walk that drifts gently.
        this.heading += w.rng.range(-1, 1) * dt * 1.6;
        speed = X.walk;
        if (this.modeT <= 0) this.setMode('idle', w.rng.range(1, 3.5));
      }
    }
    this.moving = speed > 0;
    if (!this.moving) return;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, X.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    const moved = Math.hypot(this.x - bx, this.y - by);
    this.facing = this.heading;
    if (moved < speed * dt * 0.35) {
      this.stuckT += dt;
      // Open a closed door in the way, otherwise turn away from the obstacle.
      const di = nearbyDoor(w, this.x + Math.cos(this.heading) * 30, this.y + Math.sin(this.heading) * 30, 40);
      if (di >= 0 && !w.doors[di] && w.doorCd[di] <= 0) w.setDoor(di, true);
      else if (this.stuckT > 0.25) {
        this.heading += Math.PI * (0.5 + w.rng.next());
        this.stuckT = 0;
      }
    } else {
      this.stuckT = 0;
    }
  }

  private updateTalk(dt: number): void {
    const w = this.w;
    const p = w.players.get(this.talkTo);
    if (!p || p.action !== Action.Talk || (p.health !== Health.Healthy && p.health !== Health.Wounded)) {
      this.talkTo = 0;
      this.setMode('walk', 2);
      return;
    }
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    p.actionT += dt;
    if (this.talkT > 0) {
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.handT = X.handTime;
        w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'tablet', to: p.id, x: Math.round(this.x), y: Math.round(this.y) });
      }
      return;
    }
    this.handT -= dt;
    if (this.handT > 0) return;
    this.given.add(p.id);
    if (p.jarvis === 0) p.jarvis = 1;
    p.action = Action.None;
    this.talkTo = 0;
    this.setMode('walk', w.rng.range(2, 4));
    w.emit([p.id], { k: 'item', text: 'Sexton handed you a glowing tablet. Press Q: JARVIS.' });
  }

  private nearestHunter(): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const h of this.w.order) {
      if (h.role !== 'hunter') continue;
      const d = Math.hypot(h.move.x - this.x, h.move.y - this.y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }
}

export function updateSexton(w: World, dt: number): void {
  w.sexton.update(dt);
}
