import { Action, BALANCE, Health, moveCircle, overlapsCollider, pointSegDist2, raySegment, resolveOverlaps } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { nearbyDoor } from './interact';
import { hurtSurvivor } from './combat';
import type { ItemHit, NpcTarget } from './npc';

const X = BALANCE.sexton;
const D = X.defense;

type Mode = 'idle' | 'walk' | 'flee' | 'talk' | 'leave' | 'defend';
/** Talking: first line, waiting for the survivor to press E again, second line, handoff. */
type TalkStage = 'first' | 'await' | 'second' | 'hand';
type DefensePhase = 'retreat' | 'approach' | 'beam' | 'flee';

/**
 * Sexton Science: a harmless NPC who wanders the map (no light, but his reel audio plays
 * around him). Survivors who talk to him (and press E again to keep listening) get a glowing
 * tablet (JARVIS), then he walks off. Zach can slay him in three hits; he drops a Hemp
 * Battery. Survivors can't kill him: hit him with a bottle or shotgun and he defends himself
 * against every survivor with a Hemp Beam until they've all left him alone for a while.
 */
export class Sexton implements NpcTarget {
  readonly id: number;
  /** Entity id of his Hemp Beam. */
  readonly beamId: number;
  x = 0;
  y = 0;
  facing = 0;
  hp: number = X.hp;
  alive = true;
  mode: Mode = 'idle';
  moving = false;
  hurtT = 0;
  stunT = 0;
  /** Seconds left in galaxy gas (slows him). */
  gasT = 0;
  // Talking.
  talkStage: TalkStage = 'first';
  talkTo = 0;
  private talkT = 0;
  private handT = 0;
  private leaveFrom = { x: 0, y: 0 };
  // Self-defense.
  phase: DefensePhase = 'retreat';
  attacks = 0;
  /** The beam: direction, current length, seconds it has been firing. */
  beamAng = 0;
  beamLen = 0;
  beamAge = 0;
  private phaseT = 0;
  private target = 0;
  private awayT = 0;
  private readonly beamHit = new Set<number>();
  private modeT = 1;
  private heading = 0;
  private turnT = 0;
  private fleeT = 0;
  private stuckT = 0;
  readonly given = new Set<number>();
  readonly hitRadius = X.radius;

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    this.beamId = w.allocEntityId();
    this.spawn();
  }

  get solid(): boolean {
    return this.alive;
  }

  get defending(): boolean {
    return this.mode === 'defend';
  }

  get beaming(): boolean {
    return this.mode === 'defend' && this.phase === 'beam' && this.stunT <= 0;
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
    resolveOverlaps(w.geo, this, X.radius);
  }

  /** Survivors can ask him once each for a tablet. */
  canTalk(p: SimPlayer): boolean {
    return this.alive && (this.mode === 'idle' || this.mode === 'walk') && !this.given.has(p.id) && Math.hypot(p.move.x - this.x, p.move.y - this.y) < X.reach;
  }

  /** He's said his first line and waits for `p` to press E again. */
  awaiting(p: SimPlayer): boolean {
    return this.alive && this.mode === 'talk' && this.talkStage === 'await' && this.talkTo === p.id && Math.hypot(p.move.x - this.x, p.move.y - this.y) < X.reach + 30;
  }

  startTalk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.mode = 'talk';
    this.talkStage = 'first';
    this.talkTo = p.id;
    this.talkT = X.talkTime;
    this.moving = false;
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.w.startAction(p, Action.Talk, X.talkTime, 0);
    this.say("I'm working on something big");
  }

  /** The survivor pressed E again: the second line, then the tablet. */
  continueTalk(p: SimPlayer): void {
    if (!this.awaiting(p)) return;
    this.talkStage = 'second';
    this.talkT = X.secondTalkTime;
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    this.w.startAction(p, Action.Talk, X.secondTalkTime + X.handTime, 0);
    this.say(X.secondLine.replace('NAME', p.name));
  }

  cancelTalk(playerId: number): void {
    if (this.talkTo !== playerId || this.mode !== 'talk') return;
    // Walking off while he waits for you is fine; he'll keep waiting a moment.
    if (this.talkStage === 'await') return;
    this.endTalk();
  }

  private endTalk(): void {
    this.talkTo = 0;
    if (this.mode === 'talk') this.setMode('walk', 2);
  }

  private say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'sexton', say: text });
  }

  /** Zach hits him: he runs off erratically; the third hit kills him. */
  hit(h: SimPlayer): void {
    if (!this.alive) return;
    const w = this.w;
    this.hp--;
    this.hurtT = 0.35;
    this.dropTalk();
    h.stats.hits++;
    if (this.hp <= 0) {
      this.alive = false;
      this.mode = 'idle';
      this.moving = false;
      w.hempDrop = { id: w.allocEntityId(), x: this.x + Math.cos(this.facing) * 22, y: this.y + Math.sin(this.facing) * 22 };
      w.feed(`${h.name} slayed Sexton Science. Something is glowing where he fell.`);
      return;
    }
    this.mode = 'flee';
    this.fleeT = X.fleeTime;
    this.turnT = 0;
    this.say(this.hp === 2 ? 'AGH! Not the face!' : 'Somebody help!');
  }

  /**
   * A bottle or pellets. From Zach (his golden pump) it's like a machete hit. From a survivor
   * it can't hurt him: he flinches and turns to self-defense, or, already defending, is stunned.
   */
  itemHit(by: SimPlayer, kind: ItemHit): void {
    if (!this.alive) return;
    if (by.role === 'hunter') {
      this.hit(by);
      return;
    }
    this.hurtT = 0.35;
    if (this.mode === 'defend') {
      this.stunT = Math.max(this.stunT, kind === 'bottle' ? D.bottleStun : D.shotStun);
      return;
    }
    this.dropTalk();
    this.mode = 'defend';
    this.phase = 'retreat';
    this.phaseT = 1;
    this.attacks = 0;
    this.awayT = 0;
    this.target = by.id;
    this.say('Oh, you want to play? HEMP BEAM!');
    this.w.feed('Sexton Science is defending himself');
  }

  private dropTalk(): void {
    if (!this.talkTo) return;
    const p = this.w.players.get(this.talkTo);
    this.talkTo = 0;
    if (p && p.action === Action.Talk) this.w.cancelAction(p);
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
    this.gasT = Math.max(0, this.gasT - dt);
    // There is only ever one Sexton Science, and once slain he stays dead.
    if (!this.alive) return;
    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.moving = false;
      return;
    }
    if (this.mode === 'talk') {
      this.updateTalk(dt);
      return;
    }
    let speed = 0;
    if (this.mode === 'defend') {
      speed = this.updateDefense(dt);
    } else if (this.mode === 'flee') {
      this.fleeT -= dt;
      speed = this.erratic(dt, this.nearestHunter());
      if (this.fleeT <= 0) this.setMode('walk', w.rng.range(2, 5));
    } else if (this.mode === 'leave') {
      // Mysteriously away, never looking back.
      this.modeT -= dt;
      this.heading = Math.atan2(this.y - this.leaveFrom.y, this.x - this.leaveFrom.x) + Math.sin(w.time * 0.7) * 0.25;
      speed = X.walk;
      if (this.modeT <= 0) this.setMode('walk', w.rng.range(2, 4));
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
    if (this.gasT > 0) speed *= D.gasSlowMul;
    this.moving = speed > 0;
    if (!this.moving) return;
    const bx = this.x;
    const by = this.y;
    moveCircle(w.geo, this, X.radius, Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    const moved = Math.hypot(this.x - bx, this.y - by);
    if (!(this.mode === 'defend' && this.phase === 'approach')) this.facing = this.heading;
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

  /** A new direction every few tenths of a second, mostly away from `from`. */
  private erratic(dt: number, from: { move: { x: number; y: number } } | null): number {
    this.turnT -= dt;
    if (this.turnT <= 0) {
      const away = from ? Math.atan2(this.y - from.move.y, this.x - from.move.x) : this.heading;
      this.heading = away + this.w.rng.range(-1.3, 1.3);
      this.turnT = this.w.rng.range(0.2, 0.45);
    }
    return X.flee;
  }

  /** Survivors he's defending himself from: anyone up and about (or crawling) near him. */
  private threats(): SimPlayer[] {
    return this.w.order.filter(
      (p) => p.role === 'survivor' && (p.health === Health.Healthy || p.health === Health.Wounded || p.health === Health.Downed) && p.hideState !== 2 && Math.hypot(p.move.x - this.x, p.move.y - this.y) < D.vicinity,
    );
  }

  /**
   * Self-defense: walk away from the survivors, turn and step toward one to fire a Hemp Beam
   * (3 s), walk away again for the cooldown (3 s); after 3 beams just flee. Once no survivor
   * has been near him for 10 s he calms down.
   */
  private updateDefense(dt: number): number {
    const w = this.w;
    const near = this.threats();
    this.awayT = near.length ? 0 : this.awayT + dt;
    if (this.awayT >= D.resetAfter) {
      this.setMode('walk', 2);
      this.w.feed('Sexton Science calmed down');
      return 0;
    }
    const closest = near.reduce<SimPlayer | null>((b, p) => (!b || Math.hypot(p.move.x - this.x, p.move.y - this.y) < Math.hypot(b.move.x - this.x, b.move.y - this.y) ? p : b), null);
    this.phaseT -= dt;
    switch (this.phase) {
      case 'retreat': {
        if (closest) this.heading = Math.atan2(this.y - closest.move.y, this.x - closest.move.x) + Math.sin(w.time * 1.7) * 0.4;
        if (this.phaseT <= 0) {
          if (this.attacks >= D.attacks) {
            this.phase = 'flee';
            this.say('I did not sign up for this!');
          } else {
            const t = this.pickTarget(near);
            if (t) {
              this.target = t.id;
              this.phase = 'approach';
              this.phaseT = D.approachTime;
            }
          }
        }
        return closest ? D.walk : 0;
      }
      case 'approach': {
        const t = w.players.get(this.target);
        if (!t || !near.includes(t)) {
          this.phase = 'retreat';
          this.phaseT = 0.5;
          return 0;
        }
        const a = Math.atan2(t.move.y - this.y, t.move.x - this.x);
        this.heading = a;
        this.facing = a;
        if (this.phaseT <= 0) {
          this.phase = 'beam';
          this.phaseT = D.beamTime;
          this.beamAng = a;
          this.beamAge = 0;
          this.beamHit.clear();
          this.say('HEMP BEAM!');
          return 0;
        }
        return D.walk;
      }
      case 'beam': {
        this.beamAge += dt;
        const t = w.players.get(this.target);
        if (t) {
          // The beam swings toward its target, slowly enough to dodge.
          let da = Math.atan2(t.move.y - this.y, t.move.x - this.x) - this.beamAng;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          this.beamAng += Math.max(-D.turnRate * dt, Math.min(D.turnRate * dt, da));
        }
        this.facing = this.beamAng;
        this.fireBeam();
        if (this.phaseT <= 0) {
          this.attacks++;
          this.phase = 'retreat';
          this.phaseT = D.cooldown;
        }
        return 0;
      }
      case 'flee':
        return this.erratic(dt, closest);
    }
  }

  private pickTarget(near: SimPlayer[]): SimPlayer | null {
    const w = this.w;
    const seen = near.filter((p) => w.geo.hasLineOfSight(this.x, this.y, p.move.x, p.move.y));
    const pool = seen.length ? seen : near;
    const first = pool.find((p) => p.id === this.target);
    return first ?? pool[0] ?? null;
  }

  /** The beam runs until it meets something solid (walls, trees, glass) or a survivor. */
  private fireBeam(): void {
    const w = this.w;
    const dx = Math.cos(this.beamAng);
    const dy = Math.sin(this.beamAng);
    const sx = this.x + dx * (X.radius + 2);
    const sy = this.y + dy * (X.radius + 2);
    let len = w.geo.raycastVision(sx, sy, this.beamAng, D.beamRange);
    const ms = w.geo.moveSeg;
    w.geo.windowSegs.forEach((m, i) => {
      if (w.windowsBroken[i]) return;
      const o = m * 4;
      len = Math.min(len, raySegment(sx, sy, dx, dy, ms[o], ms[o + 1], ms[o + 2], ms[o + 3]));
    });
    let victim: SimPlayer | null = null;
    let vt = len;
    for (const p of w.order) {
      if (p.role !== 'survivor' || (p.health !== Health.Healthy && p.health !== Health.Wounded) || p.hideState === 2) continue;
      const along = (p.move.x - sx) * dx + (p.move.y - sy) * dy;
      if (along < 0 || along > vt) continue;
      const r = p.radius + D.beamWidth / 2;
      if (pointSegDist2(p.move.x, p.move.y, sx, sy, sx + dx * len, sy + dy * len) > r * r) continue;
      vt = Math.max(0, along - p.radius * 0.6);
      victim = p;
    }
    this.beamLen = vt + X.radius + 2;
    if (victim && !this.beamHit.has(victim.id)) {
      // One hit per beam: three beams take a survivor down.
      this.beamHit.add(victim.id);
      hurtSurvivor(w, victim, D.beamDamage, null, 'beam');
    }
  }

  private updateTalk(dt: number): void {
    const w = this.w;
    const p = w.players.get(this.talkTo);
    const upright = p && (p.health === Health.Healthy || p.health === Health.Wounded);
    if (!p || !upright) {
      this.endTalk();
      return;
    }
    this.facing = Math.atan2(p.move.y - this.y, p.move.x - this.x);
    switch (this.talkStage) {
      case 'first':
        if (p.action !== Action.Talk) {
          this.endTalk();
          return;
        }
        p.actionT += dt;
        this.talkT -= dt;
        if (this.talkT <= 0) {
          // He waits for them to press E again to keep listening.
          this.talkStage = 'await';
          this.talkT = 8;
          p.action = Action.None;
          w.emit([p.id], { k: 'item', text: 'Press E again to keep listening to Sexton' });
        }
        return;
      case 'await':
        this.talkT -= dt;
        if (this.talkT <= 0 || Math.hypot(p.move.x - this.x, p.move.y - this.y) > X.reach + 60) this.endTalk();
        return;
      case 'second':
        if (p.action !== Action.Talk) {
          this.endTalk();
          return;
        }
        p.actionT += dt;
        this.talkT -= dt;
        if (this.talkT <= 0) {
          this.talkStage = 'hand';
          this.handT = X.handTime;
          w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'tablet', to: p.id, x: Math.round(this.x), y: Math.round(this.y) });
        }
        return;
      case 'hand':
        p.actionT += dt;
        this.handT -= dt;
        if (this.handT > 0) return;
        this.given.add(p.id);
        if (p.jarvis === 0) p.jarvis = 1;
        p.action = Action.None;
        this.talkTo = 0;
        // Then he walks away, mysteriously.
        this.leaveFrom = { x: p.move.x, y: p.move.y };
        this.setMode('leave', X.leaveTime);
        w.emit([p.id], { k: 'item', text: 'Sexton handed you a glowing tablet. Press Q: JARVIS.' });
        return;
    }
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
