import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BALANCE, ChrisFlag, DEG, EF, EntityKind, GenFlag, Health, ItemKind, MarcFlag, PlasmaFlag, SextonFlag, ShaneFlag, type MapData, type MatchPlayerInfo, type WorldState } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import type { InterpEntity } from '../net/GameClient';

export interface RenderPlayer {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: number;
  action: number;
  extra: number;
  aux: number;
  /** Health 0-255. */
  hp: number;
}

const INK = 0x0a0a0a;
const ITEM_TEX: Record<number, string> = {
  [ItemKind.Bottle]: 'item.bottle',
  [ItemKind.Goggles]: 'item.goggles',
  [ItemKind.Shotgun]: 'item.shotgun',
  [ItemKind.Energy]: 'item.energy',
  [ItemKind.Trap]: 'item.trap',
};
export const LOOT_TEX: Record<string, string> = {
  bottle: 'item.bottle',
  goggles: 'item.goggles',
  confit: 'item.confit',
  shotgun: 'item.shotgun',
  energy: 'item.energy',
  trap: 'item.trap',
};

/** Walk cycle: legs swing under the body in the direction of travel. */
class Walker {
  phase = 0;
  moveDir = 0;
  speed = 0;
  private lx = NaN;
  private ly = NaN;

  update(x: number, y: number, dt: number, stride: number): void {
    if (Number.isNaN(this.lx)) {
      this.lx = x;
      this.ly = y;
    }
    const dx = x - this.lx;
    const dy = y - this.ly;
    const d = Math.hypot(dx, dy);
    this.lx = x;
    this.ly = y;
    const v = dt > 0 ? d / dt : 0;
    this.speed += (Math.min(v, 900) - this.speed) * Math.min(1, dt * 12);
    if (d > 0.3 && d < 120) {
      let da = Math.atan2(dy, dx) - this.moveDir;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.moveDir += da * Math.min(1, dt * 14);
      this.phase += (d / stride) * Math.PI * 2;
    } else if (this.speed < 8) {
      // Ease the feet back together when standing still.
      const k = Math.sin(this.phase);
      if (Math.abs(k) > 0.05) this.phase += (k > 0 ? -1 : 1) * dt * 6 * Math.sign(Math.cos(this.phase) || 1);
    }
  }
}

/** Health over a player's head, with a pale trail showing damage just taken as it drains. */
class HealthBar {
  readonly g = new Graphics();
  private trail = -1;
  draw(frac: number, dt: number, w = 38): void {
    const g = this.g;
    g.clear();
    const h = 5;
    const f = Math.max(0, Math.min(1, frac));
    if (this.trail < f) this.trail = f;
    else this.trail = Math.max(f, this.trail - dt * 0.6);
    g.rect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2).fill({ color: INK, alpha: 0.8 });
    g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x241a18 });
    if (this.trail > f + 0.005) g.rect(-w / 2 + w * f, -h / 2, w * (this.trail - f), h).fill({ color: 0xe8d8b0, alpha: 0.85 });
    const color = f > 0.6 ? 0x8a9a5a : f > 0.3 ? 0xc0903a : 0xb3261e;
    if (f > 0.005) g.rect(-w / 2, -h / 2, w * f, h).fill({ color });
    // Thirds: one machete swipe each.
    for (const t of [1 / 3, 2 / 3]) g.rect(-w / 2 + w * t - 0.5, -h / 2, 1, h).fill({ color: INK, alpha: 0.55 });
  }
}

class PlayerSprite {
  readonly root = new Container();
  readonly shadow = new Graphics();
  readonly legs = new Container();
  readonly legA: Sprite;
  readonly legB: Sprite;
  readonly body = new Container();
  readonly torso: Sprite;
  readonly held: Sprite;
  readonly weapon: Sprite | null;
  readonly swipe = new Graphics();
  readonly downed: Sprite;
  readonly carried: Sprite;
  readonly fx = new Graphics();
  readonly aura = new Graphics();
  readonly bar = new HealthBar();
  /** Seconds left of the flinch after being hit. */
  private flinchT = 0;
  private flinchAng = 0;
  readonly label: Text;
  readonly walker = new Walker();
  private shake = 0;
  /** Seconds since the current swing started (-1 when not swinging). */
  private swingAge = -1;
  private heavy = false;
  private wasAttacking = false;
  /** Latest swing charge (0..1) seen before the swing started. */
  private charge = 0;
  private readonly hunter: boolean;
  private readonly look: number;

  constructor(
    private readonly assets: AssetManager,
    readonly info: MatchPlayerInfo,
    showLabel: boolean,
  ) {
    this.hunter = info.role === 'hunter';
    this.look = info.tint % 10;
    const tex = (id: string, v = 0): Sprite => {
      const s = new Sprite(assets.getTexture(id, v));
      const [ax, ay] = assets.anchorOf(id);
      s.anchor.set(ax, ay);
      return s;
    };
    const legVariant = this.hunter ? 10 : this.look;
    this.legA = tex('char.legs', legVariant);
    this.legB = tex('char.legs', legVariant);
    this.legs.addChild(this.legA, this.legB);
    this.torso = tex(this.hunter ? 'char.hunter' : 'char.survivor', this.look);
    if (this.hunter) this.torso.anchor.set(38 / 84, 0.5);
    else this.torso.anchor.set(30 / 64, 0.5);
    this.held = new Sprite();
    this.held.anchor.set(0.5);
    this.held.visible = false;
    this.weapon = this.hunter ? tex('char.machete') : null;
    this.body.addChild(this.swipe, this.torso, this.held);
    if (this.weapon) {
      this.weapon.position.set(20, 11);
      this.body.addChild(this.weapon);
    }
    this.downed = tex('char.survivorDowned', this.look);
    this.downed.visible = false;
    this.carried = tex('char.survivorDowned', 0);
    this.carried.scale.set(0.7);
    this.carried.visible = false;
    this.label = new Text({ text: info.name.toUpperCase(), style: { fontFamily: '"Special Elite", "Courier New", monospace', fontSize: 11, fill: 0xd8d2c0, letterSpacing: 1, stroke: { color: INK, width: 3 } } });
    this.label.anchor.set(0.5, 1);
    this.label.visible = showLabel;
    this.aura.blendMode = 'add';
    this.root.addChild(this.shadow, this.aura, this.legs, this.downed, this.body, this.carried, this.fx, this.bar.g, this.label);
  }

  set(p: RenderPlayer, time: number, dt: number, stakePos: { x: number; y: number } | null): void {
    const health = p.state & EF.HealthMask;
    const hunter = (p.state & EF.Hunter) !== 0;
    const r = hunter ? BALANCE.hunter.radius : BALANCE.survivor.radius;
    this.root.position.set(p.x, p.y);
    this.walker.update(p.x, p.y, dt, hunter ? 46 : 38);
    const staked = !hunter && health === Health.Staked && stakePos;
    const down = !hunter && health === Health.Downed;
    // Zach knocked out cold by Plasma.
    const knocked = hunter && health === Health.Downed;
    if (staked) {
      this.shake += dt * 30;
      this.root.position.set(stakePos.x + Math.sin(this.shake) * 1.5, stakePos.y);
    }

    this.shadow.clear();
    if (!down) {
      this.shadow.ellipse(5, 8, r + 5, r + 3).fill({ color: 0x000000, alpha: 0.18 });
      this.shadow.ellipse(4, 6, r + 1, r).fill({ color: 0x000000, alpha: 0.28 });
    }

    // Legs: two feet swinging along the direction of travel.
    const moving = this.walker.speed > 12 && !staked;
    this.legs.visible = !down && !staked && !knocked;
    if (this.legs.visible) {
      this.legs.rotation = moving ? this.walker.moveDir : p.facing;
      const stride = moving ? Math.min(1, this.walker.speed / (hunter ? 220 : 170)) * (hunter ? 10 : 8) : 0;
      const s = Math.sin(this.walker.phase);
      const sideOff = hunter ? 7 : 5.5;
      this.legA.position.set(-4 + s * stride, -sideOff);
      this.legB.position.set(-4 - s * stride, sideOff);
    }

    this.downed.visible = down;
    this.body.visible = !down;
    if (down) {
      this.downed.rotation = p.facing;
    } else {
      this.body.rotation = staked ? -Math.PI / 2 : knocked ? p.facing + Math.PI / 2 : p.facing;
      const bob = moving ? Math.abs(Math.sin(this.walker.phase)) * 0.04 : 0;
      this.body.scale.set(1 + bob, 1 - bob * 0.5);
      this.torso.tint = staked ? 0xd09090 : knocked ? 0x9a9a9a : 0xffffff;
      // Flinch: knocked back a step, flashing red, easing back.
      this.flinchT = Math.max(0, this.flinchT - dt);
      const f = this.flinchT / 0.3;
      this.body.position.set(Math.cos(this.flinchAng) * 5 * f + Math.sin(time * 60) * 1.5 * f, Math.sin(this.flinchAng) * 5 * f);
      if (f > 0 && Math.sin(time * 45) > 0) this.torso.tint = 0xff7a6a;
    }

    // Held item (survivors).
    const item = hunter ? 0 : p.aux & 7;
    this.held.visible = !down && !staked && item > 0 && item !== ItemKind.Goggles;
    if (this.held.visible) {
      this.held.texture = this.assets.getTexture(item === ItemKind.Shotgun && p.aux & 8 ? 'item.goldenPump' : ITEM_TEX[item]);
      const big = item === ItemKind.Shotgun;
      this.held.position.set(big ? 24 : 21, big ? 3 : 7);
      this.held.scale.set(big ? 0.62 : 0.48);
      this.held.rotation = big ? 0.35 : 0.2;
    }

    if (hunter) {
      this.carried.visible = (p.state & EF.Carrying) !== 0;
      if (this.carried.visible) {
        this.carried.position.set(Math.cos(p.facing + Math.PI * 0.6) * 12, Math.sin(p.facing + Math.PI * 0.6) * 12);
        this.carried.rotation = p.facing + Math.PI / 2;
      }
      // With Plasma's golden pump in hand the machete is put away.
      const pump = p.aux === 255;
      if (this.weapon) {
        this.weapon.texture = this.assets.getTexture(pump ? 'item.goldenPump' : 'char.machete');
        if (pump) {
          this.weapon.anchor.set(0.3, 0.5);
          this.weapon.rotation = 0.1;
          this.weapon.scale.set(0.7);
        } else {
          const [ax, ay] = this.assets.anchorOf('char.machete');
          this.weapon.anchor.set(ax, ay);
          this.weapon.scale.set(1);
        }
      }
      // Machete: hold to charge (the blade draws back and shakes), release to swing.
      const attacking = (p.state & EF.Attacking) !== 0 && !pump;
      const charging = attacking || pump ? 0 : p.aux / 254;
      if (!attacking) this.charge = charging;
      if (attacking && !this.wasAttacking) {
        this.swingAge = 0;
        const C = BALANCE.hunter.attack.charge;
        this.heavy = Math.max(this.charge, p.aux / 254) >= C.heavyAt / C.max - 0.02;
      }
      this.wasAttacking = attacking;
      if (!pump) this.drawSwing(dt, charging, time, p.facing);
      else this.swipe.clear();
      this.body.scale.x *= (p.state & EF.Lunging) !== 0 ? 1.12 : 1;
    }

    this.fx.clear();
    if (p.state & EF.Stunned || knocked) {
      for (let i = 0; i < 4; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 4;
        this.star(Math.cos(a) * 16, -r - 8 + Math.sin(a) * 5, 4);
      }
    }
    if (p.state & EF.Gassed) {
      for (let i = 0; i < 5; i++) {
        const a = time * 2 + i * 1.3;
        this.fx.circle(Math.cos(a) * (r + 6), Math.sin(a * 1.3) * (r + 4) - 4, 3 + (i % 2)).fill({ color: i % 2 ? 0xd06aff : 0x6a8aff, alpha: 0.8 });
      }
    }
    if (p.state & EF.Lunging) {
      for (let i = 1; i <= 3; i++) {
        const back = p.facing + Math.PI;
        this.fx
          .moveTo(Math.cos(back) * (r + i * 7) + Math.cos(p.facing + Math.PI / 2) * 8, Math.sin(back) * (r + i * 7) + Math.sin(p.facing + Math.PI / 2) * 8)
          .lineTo(Math.cos(back) * (r + i * 7 + 14) + Math.cos(p.facing + Math.PI / 2) * 8, Math.sin(back) * (r + i * 7 + 14) + Math.sin(p.facing + Math.PI / 2) * 8)
          .stroke({ width: 3, color: 0xffffff, alpha: 0.6 / i });
        this.fx
          .moveTo(Math.cos(back) * (r + i * 7) - Math.cos(p.facing + Math.PI / 2) * 8, Math.sin(back) * (r + i * 7) - Math.sin(p.facing + Math.PI / 2) * 8)
          .lineTo(Math.cos(back) * (r + i * 7 + 14) - Math.cos(p.facing + Math.PI / 2) * 8, Math.sin(back) * (r + i * 7 + 14) - Math.sin(p.facing + Math.PI / 2) * 8)
          .stroke({ width: 3, color: 0xffffff, alpha: 0.6 / i });
      }
    }
    this.aura.clear();
    if (p.state & EF.Hemp) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      this.aura.circle(0, 0, r + 14 + pulse * 4).fill({ color: 0x6dff6a, alpha: 0.18 + pulse * 0.1 });
    }
    if (p.state & EF.Goggles) {
      const ex = Math.cos(p.facing) * 8;
      const ey = Math.sin(p.facing) * 8;
      this.aura.circle(ex, ey, 10).fill({ color: 0x5cff6a, alpha: 0.35 });
      this.fx.circle(ex - Math.sin(p.facing) * 3, ey + Math.cos(p.facing) * 3, 2).fill({ color: 0x9dff9a });
      this.fx.circle(ex + Math.sin(p.facing) * 3, ey - Math.cos(p.facing) * 3, 2).fill({ color: 0x9dff9a });
    }

    // Everyone's health shows over their head.
    const showBar = !staked && health !== Health.Carried;
    this.bar.g.visible = showBar;
    if (showBar) {
      this.bar.g.position.set(0, -r - 16);
      this.bar.draw(p.hp / 255, dt, hunter ? 44 : 38);
    }
    this.label.position.set(0, -r - 22);
  }

  /** Hit: a quick flinch away from `from` (radians, direction the hit came from). */
  flinch(from: number): void {
    this.flinchT = 0.3;
    this.flinchAng = from + Math.PI;
  }

  private star(x: number, y: number, s: number): void {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? s : s * 0.45;
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    this.fx.poly(pts).fill({ color: 0xc8b890 }).stroke({ width: 1, color: INK });
  }

  /**
   * The machete: anticipation (blade drawn back during the wind-up), a fast eased strike
   * across the arc with a fading smear behind the blade, then a follow-through and recovery.
   * While charging the blade draws back further and trembles; a heavy swipe is wider,
   * longer and leaves a darker, heavier smear.
   */
  private drawSwing(dt: number, charge: number, time: number, facing: number): void {
    const g = this.swipe;
    g.clear();
    const A = BALANCE.hunter.attack;
    const C = A.charge;
    const rest = 0.35;
    const w = this.weapon;
    if (this.swingAge < 0) {
      // Idle or charging.
      const back = -((A.arcDeg / 2) * DEG + 0.55) * charge;
      const tremble = charge > 0.05 ? Math.sin(time * 55) * 0.05 * charge : 0;
      if (w) w.rotation = rest + (back - rest) * Math.min(1, charge * 1.4) + tremble;
      this.torso.rotation = -0.3 * charge;
      this.body.position.set(Math.sin(time * 60) * 1.2 * charge, 0);
      if (charge > 0.05) {
        // Charge meter: a dark arc filling around Zach's feet, flaring when full.
        const full = charge >= C.heavyAt / C.max;
        const R = 30;
        g.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge).stroke({ width: 3, color: full ? 0xb01818 : 0x6a2020, alpha: full ? 0.6 + 0.3 * Math.sin(time * 20) : 0.6 });
      }
      void facing;
      return;
    }
    this.swingAge += dt;
    const total = A.windup + A.swingTime;
    const t = this.swingAge;
    const heavy = this.heavy;
    const half = (A.arcDeg / 2) * DEG * (heavy ? C.arcMul : 1);
    const R = A.range * (heavy ? C.rangeMul : 1);
    const start = -half - 0.45;
    const end = half + 0.35;
    const strike = 0.13;
    let a: number;
    let smear = 0;
    if (t < A.windup) {
      // Anticipation: pull back (from wherever the charge left the blade).
      const k = t / A.windup;
      const e = 1 - (1 - k) * (1 - k);
      a = rest + (start - rest) * e;
      this.torso.rotation = -0.3 * e;
    } else if (t < A.windup + strike) {
      // The strike: very fast, easing out.
      const k = (t - A.windup) / strike;
      const e = 1 - Math.pow(1 - k, 4);
      a = start + (end - start) * e;
      smear = 1;
      this.torso.rotation = -0.3 + 0.55 * e;
    } else if (t < total) {
      // Follow-through and recovery back to rest.
      const k = (t - A.windup - strike) / (total - A.windup - strike);
      const e = k * k * (3 - 2 * k);
      a = end + (rest - end) * e;
      smear = 1 - k;
      this.torso.rotation = 0.25 * (1 - e);
    } else {
      this.swingAge = -1;
      this.torso.rotation = 0;
      if (w) w.rotation = rest;
      return;
    }
    if (w) w.rotation = a;
    this.body.position.set(0, 0);
    if (smear <= 0) return;
    // Smear: slices of the swept arc, brightest right behind the blade.
    const from = start;
    const to = Math.min(a, end);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = from + ((to - from) * i) / n;
      const a1 = from + ((to - from) * (i + 1)) / n;
      const f = (i + 1) / n;
      const alpha = smear * f * f * (heavy ? 0.5 : 0.36);
      g.moveTo(Math.cos(a0) * 24, Math.sin(a0) * 24);
      g.arc(0, 0, R, a0, a1);
      g.arc(0, 0, R * 0.55, a1, a0, true);
      g.closePath();
      g.fill({ color: heavy ? 0x5a0808 : 0xb8b0a0, alpha });
    }
    g.arc(0, 0, R, Math.max(from, to - 0.5), to).stroke({ width: heavy ? 4 : 2.5, color: heavy ? 0x9a1010 : 0xe0dccc, alpha: smear * 0.7 });
  }
}

type Speaker = 'sexton' | 'chris' | 'marc' | 'plasma';

interface Bubble {
  root: Container;
  until: number;
  who: Speaker;
  dur: number;
}

/** A walking NPC: legs that step along with his movement and a body turned to face. */
class NpcSprite {
  readonly root = new Container();
  readonly legs = new Container();
  readonly legA: Sprite;
  readonly legB: Sprite;
  readonly body: Sprite;
  readonly fx = new Graphics();
  readonly walker = new Walker();

  constructor(assets: AssetManager, bodyId: string, legVariant: number, parent: Container) {
    this.legA = new Sprite(assets.getTexture('char.legs', legVariant));
    this.legB = new Sprite(assets.getTexture('char.legs', legVariant));
    const [ax, ay] = assets.anchorOf('char.legs');
    for (const l of [this.legA, this.legB]) l.anchor.set(ax, ay);
    this.legs.addChild(this.legA, this.legB);
    this.body = new Sprite(assets.getTexture(bodyId));
    this.body.anchor.set(30 / 64, 0.5);
    const shadow = new Graphics().ellipse(4, 6, 16, 15).fill({ color: 0x000000, alpha: 0.28 });
    this.root.addChild(shadow, this.legs, this.body, this.fx);
    parent.addChild(this.root);
  }

  step(e: InterpEntity, dt: number, stride = 34, maxSpeed = 150): void {
    this.root.position.set(e.x, e.y);
    this.walker.update(e.x, e.y, dt, stride);
    const moving = this.walker.speed > 10;
    this.legs.rotation = moving ? this.walker.moveDir : e.facing;
    const st = moving ? Math.min(1, this.walker.speed / maxSpeed) * 8 : 0;
    const k = Math.sin(this.walker.phase);
    this.legA.position.set(-4 + k * st, -5.5);
    this.legB.position.set(-4 - k * st, 5.5);
    this.body.rotation = e.facing;
  }

  stars(time: number, r: number): void {
    for (let i = 0; i < 4; i++) {
      const a = time * 5 + (i * Math.PI * 2) / 4;
      const x = Math.cos(a) * 16;
      const y = -r - 8 + Math.sin(a) * 5;
      const pts: number[] = [];
      for (let j = 0; j < 10; j++) {
        const b = (j / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = j % 2 === 0 ? 4 : 1.8;
        pts.push(x + Math.cos(b) * rr, y + Math.sin(b) * rr);
      }
      this.fx.poly(pts).fill({ color: 0xc8b890 }).stroke({ width: 1, color: INK });
    }
  }
}

interface ChrisSprite {
  root: Container;
  body: Sprite;
  dead: Sprite;
  walker: Walker;
  legs: Container;
  legA: Sprite;
  legB: Sprite;
  wings: Graphics;
  halo: Sprite;
  mark: Graphics;
}

/** One feathered angel wing out of the shoulder on side `k` (-1 or +1), swept back; `spread` unfolds it. */
function drawWing(g: Graphics, k: number, spread: number): void {
  const pts: [number, number][] = [
    [2, 6],
    [5, 18],
    [2, 32],
    [-8, 46],
    [-17, 41],
    [-14, 35],
    [-23, 31],
    [-19, 24],
    [-27, 19],
    [-21, 13],
    [-13, 8],
  ];
  const flat = pts.flatMap(([x, y]) => [x * (0.6 + 0.4 * spread), k * (6 + (y - 6) * spread)]);
  g.poly(flat).fill({ color: 0xf6f4ea }).stroke({ width: 1.6, color: INK });
  for (const [x, y] of [
    [-14, 35],
    [-19, 24],
    [-21, 13],
  ]) {
    g.moveTo(0, k * 8)
      .lineTo(x * (0.6 + 0.4 * spread) + 3, k * (6 + (y - 6) * spread))
      .stroke({ width: 1, color: 0xb8b2a0 });
  }
}

interface TabletFlight {
  sprite: Sprite;
  fx: number;
  fy: number;
  to: number;
  t: number;
}

/**
 * Dynamic things drawn on the entity layer, which the entity-occlusion filter hides outside
 * the vision mask: players, Sexton, thrown bottles, traps, gas, loot, generator progress,
 * hiding markers, dialogue bubbles and the tablet handoff.
 */
export class EntityLayer {
  readonly root = new Container();
  /** Drawn above the vision mask (Sexton's dialogue box, readable next to him). */
  readonly overlay = new Container();
  /** Whether a speech bubble at (x,y) should be readable from the viewer's position. */
  bubbleCheck: (x: number, y: number) => boolean = () => true;
  private readonly ground = new Container();
  private readonly players = new Map<number, PlayerSprite>();
  private readonly things = new Map<number, Container>();
  private readonly loot: Container[] = [];
  private readonly markers = new Graphics();
  private readonly gens = new Graphics();
  private readonly effects = new Graphics();
  /** Objectives (generators, the gate lever): hidden in the fog like everything here. */
  private readonly objectives = new Container();
  private readonly genSprites: Sprite[] = [];
  private readonly genGlows: Sprite[] = [];
  private sexton: { root: Container; body: Sprite; dead: Sprite; walker: Walker; legs: Container; legA: Sprite; legB: Sprite; fx: Graphics } | null = null;
  private shane: { root: Container; body: Sprite; walker: Walker; legs: Container; legA: Sprite; legB: Sprite; mark: Text } | null = null;
  private chris: ChrisSprite | null = null;
  private bubble: Bubble | null = null;
  private tablets: TabletFlight[] = [];
  private shots: { x: number; y: number; p: number[]; gold: boolean; t: number }[] = [];
  private marc: NpcSprite | null = null;
  private plasma: { man: NpcSprite; beast: Sprite; aura: Graphics } | null = null;
  /** Sexton's Hemp Beam (redrawn every frame while it fires). */
  private readonly beam = new Graphics();
  private lastTime = 0;
  private readonly positions = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly assets: AssetManager,
    private readonly map: MapData,
    private roster: Map<number, MatchPlayerInfo>,
    private viewerIsHunter: boolean,
  ) {
    for (const l of map.loot) {
      const c = new Container();
      const glow = new Sprite(assets.getTexture('fx.glow'));
      glow.anchor.set(0.5);
      glow.scale.set(0.55);
      glow.tint = 0xb09a60;
      glow.blendMode = 'add';
      const s = new Sprite(assets.getTexture(LOOT_TEX[l.item]));
      s.anchor.set(0.5);
      s.scale.set(0.8);
      c.addChild(glow, s);
      c.position.set(l.x, l.y);
      this.loot.push(c);
      this.ground.addChild(c);
    }
    for (const gen of map.generators) {
      const glow = new Sprite(assets.getTexture('fx.glow'));
      glow.anchor.set(0.5);
      glow.position.set(gen.x, gen.y);
      glow.scale.set(2.2);
      glow.tint = 0xd8b060;
      glow.blendMode = 'add';
      glow.alpha = 0.5;
      glow.visible = false;
      const s = new Sprite(assets.getTexture('obj.generator', 0));
      s.anchor.set(0.5);
      s.position.set(gen.x, gen.y);
      s.rotation = gen.angle;
      this.objectives.addChild(glow, s);
      this.genSprites.push(s);
      this.genGlows.push(glow);
    }
    const gt = map.gate;
    const lever = new Graphics();
    lever.rect(gt.leverX - 9 + 4, gt.leverY - 13 + 6, 18, 26).fill({ color: 0x000000, alpha: 0.4 });
    lever.rect(gt.leverX - 9, gt.leverY - 13, 18, 26).fill({ color: 0x4a4636 });
    lever.rect(gt.leverX - 9, gt.leverY - 13, 18, 4).fill({ color: 0x6a654e });
    lever.rect(gt.leverX - 3, gt.leverY - 18, 6, 12).fill({ color: 0x6a1a14 });
    this.objectives.addChild(lever);
    this.beam.blendMode = 'add';
    this.root.addChild(this.objectives, this.ground, this.gens, this.markers, this.effects, this.beam);
  }

  /** A generator started (or not): swap its art and light its lamp. */
  setGenerator(id: number, repaired: boolean): void {
    const s = this.genSprites[id];
    if (!s) return;
    s.texture = this.assets.getTexture('obj.generator', repaired ? 1 : 0);
    this.genGlows[id].visible = repaired;
  }

  /** Testing mode: roles changed, rebuild the player sprites. */
  setRoster(roster: Map<number, MatchPlayerInfo>, viewerIsHunter: boolean): void {
    this.roster = roster;
    this.viewerIsHunter = viewerIsHunter;
    for (const s of this.players.values()) s.root.destroy({ children: true });
    this.players.clear();
  }

  /** Sexton's or Chris Zelley's dialogue box. */
  say(text: string, time: number, who: Speaker): void {
    this.bubble?.root.destroy({ children: true });
    const root = new Container();
    const t = new Text({ text, style: { fontFamily: '"Special Elite", "Courier New", monospace', fontSize: 14, fill: 0x141210, wordWrap: true, wordWrapWidth: 200, align: 'center' } });
    t.anchor.set(0.5, 1);
    const w = t.width + 20;
    const h = t.height + 12;
    const box = new Graphics();
    box.rect(-w / 2, -h - 10, w, h).fill({ color: 0xd8d2c0 }).stroke({ width: 2, color: INK });
    box.poly([-7, -11, 7, -11, 0, -1]).fill({ color: 0xd8d2c0 }).stroke({ width: 2, color: INK });
    box.rect(-6, -12, 12, 3).fill({ color: 0xd8d2c0 });
    t.position.set(0, -16);
    root.addChild(box, t);
    root.scale.set(0.2);
    this.overlay.addChild(root);
    this.bubble = { root, until: time + Math.max(2.6, text.length * 0.075), who, dur: Math.max(2.6, text.length * 0.075) };
  }

  /** Sexton hands a glowing tablet to a survivor. */
  handTablet(x: number, y: number, to: number): void {
    const s = new Sprite(this.assets.getTexture('item.tablet'));
    s.anchor.set(0.5);
    s.scale.set(0.3);
    const glow = new Sprite(this.assets.getTexture('fx.glow'));
    glow.anchor.set(0.5);
    glow.tint = 0x7af8ff;
    glow.blendMode = 'add';
    glow.scale.set(1.4);
    s.addChild(glow);
    this.root.addChild(s);
    this.tablets.push({ sprite: s, fx: x, fy: y, to, t: 0 });
  }

  /** Someone was hit: they flinch away from whoever hit them. */
  flinch(victim: number, by: number): void {
    const s = this.players.get(victim);
    const v = this.positions.get(victim);
    const a = this.positions.get(by);
    if (s) s.flinch(v && a ? Math.atan2(a.y - v.y, a.x - v.x) : Math.random() * Math.PI * 2);
  }

  shot(x: number, y: number, pellets: number[], gold: boolean): void {
    this.shots.push({ x, y, p: pellets, gold, t: 0 });
  }

  update(ents: InterpEntity[], self: RenderPlayer | null, world: WorldState | null, time: number): void {
    const dt = this.lastTime ? Math.min(0.1, time - this.lastTime) : 1 / 60;
    this.lastTime = time;
    const seen = new Set<number>();
    const stakeOf = new Map<number, { x: number; y: number }>();
    if (world) world.stakes.forEach((occ, i) => occ && stakeOf.set(occ, this.map.stakes[i]));

    const draw = (p: RenderPlayer): void => {
      const info = this.roster.get(p.id);
      if (!info) return;
      let s = this.players.get(p.id);
      if (!s) {
        const label = info.role === 'survivor' && !this.viewerIsHunter;
        s = new PlayerSprite(this.assets, info, label && p.id !== self?.id);
        this.players.set(p.id, s);
        this.root.addChild(s.root);
      }
      s.root.visible = true;
      s.set(p, time, dt, stakeOf.get(p.id) ?? null);
      this.positions.set(p.id, { x: p.x, y: p.y });
      seen.add(p.id);
    };

    let sextonSeen = false;
    let shaneSeen = false;
    let chrisSeen = false;
    let marcSeen = false;
    let plasmaSeen = false;
    this.beam.clear();
    for (const e of ents) {
      if (e.kind === EntityKind.Player) {
        if (self && e.id === self.id) continue;
        draw({ ...e });
      } else if (e.kind === EntityKind.Shane) {
        shaneSeen = true;
        this.drawShane(e, dt, time);
      } else if (e.kind === EntityKind.Sexton) {
        sextonSeen = true;
        this.drawSexton(e, dt, time);
      } else if (e.kind === EntityKind.Chris) {
        chrisSeen = true;
        this.drawChris(e, dt, time);
      } else if (e.kind === EntityKind.Marc) {
        marcSeen = true;
        this.drawMarc(e, dt, time);
      } else if (e.kind === EntityKind.Plasma) {
        plasmaSeen = true;
        this.drawPlasma(e, dt, time);
      } else if (e.kind === EntityKind.Beam) {
        this.drawBeam(e, time);
      } else {
        this.drawThing(e, time);
        seen.add(e.id);
      }
    }
    if (self) draw(self);
    if (this.sexton) this.sexton.root.visible = sextonSeen;
    if (this.shane) this.shane.root.visible = shaneSeen;
    if (this.chris) this.chris.root.visible = chrisSeen;
    if (this.marc) this.marc.root.visible = marcSeen;
    if (this.plasma) this.plasma.man.root.visible = plasmaSeen;

    for (const [id, s] of this.players) if (!seen.has(id)) s.root.visible = false;
    for (const [id, c] of this.things) {
      if (!seen.has(id)) {
        c.destroy({ children: true });
        this.things.delete(id);
      }
    }

    // Dialogue bubble pops in above whoever is speaking.
    if (this.bubble) {
      const b = this.bubble;
      const speaker = b.who === 'chris' ? this.chris : b.who === 'marc' ? this.marc : b.who === 'plasma' ? this.plasma?.man : this.sexton;
      if (time > b.until || !speaker) {
        b.root.destroy({ children: true });
        this.bubble = null;
      } else {
        const s = speaker.root;
        b.root.position.set(s.x, s.y - 30);
        b.root.visible = s.visible && this.bubbleCheck(s.x, s.y);
        const age = b.dur - (b.until - time);
        const pop = Math.min(1, age / 0.18);
        b.root.scale.set(0.2 + 0.8 * (1 - Math.pow(1 - pop, 3)) + Math.sin(Math.min(1, age / 0.4) * Math.PI) * 0.06);
        b.root.alpha = Math.min(1, (b.until - time) / 0.3);
      }
    }
    // Tablet flies to its new owner with a quick ease and a spin.
    this.tablets = this.tablets.filter((f) => {
      f.t += dt / BALANCE.sexton.handTime;
      const to = this.positions.get(f.to) ?? { x: f.fx, y: f.fy };
      const k = Math.min(1, f.t);
      const e = 1 - Math.pow(1 - k, 3);
      f.sprite.position.set(f.fx + (to.x - f.fx) * e, f.fy + (to.y - f.fy) * e - Math.sin(k * Math.PI) * 26);
      f.sprite.rotation = k * Math.PI * 2;
      f.sprite.scale.set(0.3 + 0.35 * Math.sin(k * Math.PI));
      if (k >= 1) {
        f.sprite.destroy({ children: true });
        return false;
      }
      return true;
    });
    // Shotgun tracers.
    this.effects.clear();
    this.shots = this.shots.filter((s) => {
      s.t += dt;
      const a = 1 - s.t / 0.22;
      if (a <= 0) return false;
      // Eight thin pellet trails, each running to where that pellet stopped.
      let mid = 0;
      for (let i = 0; i + 1 < s.p.length; i += 2) {
        const ang = s.p[i] / 1000;
        mid += ang;
        const len = s.p[i + 1];
        const from = 18 + (1 - a) * len * 0.5;
        this.effects
          .moveTo(s.x + Math.cos(ang) * from, s.y + Math.sin(ang) * from)
          .lineTo(s.x + Math.cos(ang) * len, s.y + Math.sin(ang) * len)
          .stroke({ width: 1, color: s.gold ? 0xffe27a : 0xfff2c0, alpha: a * 0.85 });
      }
      mid /= Math.max(1, s.p.length / 2);
      this.effects.circle(s.x + Math.cos(mid) * 24, s.y + Math.sin(mid) * 24, 9 * a + 3).fill({ color: s.gold ? 0xffc23a : 0xffd23a, alpha: a });
      return true;
    });

    if (!world) return;
    this.loot.forEach((c, i) => {
      c.visible = !world.lootTaken[i];
      if (!c.visible) return;
      c.children[1].rotation = Math.sin(time * 1.5 + i) * 0.15;
      c.children[0].alpha = 0.35 + 0.25 * Math.sin(time * 3 + i);
    });
    this.gens.clear();
    world.gens.forEach((g, i) => {
      if (g.flags & GenFlag.Repaired || !(g.flags & GenFlag.Known) || g.progress <= 0.001) return;
      const d = this.map.generators[i];
      this.gens.circle(d.x, d.y - 46, 12).fill({ color: INK, alpha: 0.7 });
      this.gens.arc(d.x, d.y - 46, 10, -Math.PI / 2, -Math.PI / 2 + g.progress * Math.PI * 2).stroke({ width: 4, color: g.flags & GenFlag.Regressing ? 0xa02a20 : 0xc8c0a0 });
    });
    this.markers.clear();
    if (!this.viewerIsHunter) {
      world.hidingOccupied.forEach((occ, i) => {
        if (!occ) return;
        const h = this.map.hidingSpots[i];
        this.markers.circle(h.x, h.y - 26, 5).fill({ color: 0x8aa070 }).stroke({ width: 1.5, color: INK });
      });
    }
  }

  private drawSexton(e: InterpEntity, dt: number, time: number): void {
    if (!this.sexton) {
      const root = new Container();
      const legs = new Container();
      const legA = new Sprite(this.assets.getTexture('char.legs', 20));
      const legB = new Sprite(this.assets.getTexture('char.legs', 20));
      for (const l of [legA, legB]) {
        const [ax, ay] = this.assets.anchorOf('char.legs');
        l.anchor.set(ax, ay);
      }
      legs.addChild(legA, legB);
      const body = new Sprite(this.assets.getTexture('char.sexton'));
      body.anchor.set(30 / 64, 0.5);
      const dead = new Sprite(this.assets.getTexture('char.sextonDead'));
      dead.anchor.set(0.5);
      const fx = new Graphics();
      root.addChild(legs, body, dead, fx);
      this.root.addChild(root);
      this.sexton = { root, body, dead, walker: new Walker(), legs, legA, legB, fx };
    }
    const s = this.sexton;
    s.root.position.set(e.x, e.y);
    const dead = (e.state & SextonFlag.Dead) !== 0;
    s.dead.visible = dead;
    s.body.visible = !dead;
    s.legs.visible = !dead;
    if (dead) {
      s.dead.rotation = e.facing;
      return;
    }
    s.walker.update(e.x, e.y, dt, 34);
    const moving = s.walker.speed > 10;
    s.legs.rotation = moving ? s.walker.moveDir : e.facing;
    const st = moving ? Math.min(1, s.walker.speed / 150) * 8 : 0;
    const k = Math.sin(s.walker.phase);
    s.legA.position.set(-4 + k * st, -5.5);
    s.legB.position.set(-4 - k * st, 5.5);
    s.body.rotation = e.facing;
    const hurt = (e.state & SextonFlag.Hurt) !== 0;
    s.body.tint = hurt && Math.sin(time * 40) > 0 ? 0xff6a6a : 0xffffff;
    s.body.position.set(hurt ? Math.sin(time * 60) * 2 : 0, 0);
    // Self-defense: a hemp-green glow about him; stunned, stars.
    s.fx.clear();
    if (e.state & SextonFlag.Defending) s.fx.circle(0, 0, 24 + Math.sin(time * 5) * 3).stroke({ width: 2, color: 0x9dff8a, alpha: 0.45 });
    if (e.state & SextonFlag.Stunned) {
      for (let i = 0; i < 4; i++) {
        const a = time * 5 + (i * Math.PI) / 2;
        s.fx.circle(Math.cos(a) * 16, -22 + Math.sin(a) * 5, 3).fill({ color: 0xc8b890 }).stroke({ width: 1, color: INK });
      }
    }
  }

  /**
   * Chris Zelley: paramedic greens. A pulsing red cross while he runs to a patient, a progress
   * ring while he works, and wings (rising into a white glow) once he's done.
   */
  private drawChris(e: InterpEntity, dt: number, time: number): void {
    if (!this.chris) {
      const root = new Container();
      const legs = new Container();
      const legA = new Sprite(this.assets.getTexture('char.legs', 31));
      const legB = new Sprite(this.assets.getTexture('char.legs', 31));
      const [ax, ay] = this.assets.anchorOf('char.legs');
      for (const l of [legA, legB]) l.anchor.set(ax, ay);
      legs.addChild(legA, legB);
      const body = new Sprite(this.assets.getTexture('char.chris'));
      body.anchor.set(30 / 64, 0.5);
      const dead = new Sprite(this.assets.getTexture('char.chrisDead'));
      dead.anchor.set(0.5);
      const halo = new Sprite(this.assets.getTexture('fx.glow'));
      halo.anchor.set(0.5);
      halo.tint = 0xfff6d8;
      halo.blendMode = 'add';
      halo.visible = false;
      const wings = new Graphics();
      const mark = new Graphics();
      const shadow = new Graphics().ellipse(4, 6, 16, 15).fill({ color: 0x000000, alpha: 0.28 });
      root.addChild(halo, shadow, wings, legs, body, dead, mark);
      this.root.addChild(root);
      this.chris = { root, body, dead, walker: new Walker(), legs, legA, legB, wings, halo, mark };
    }
    const c = this.chris;
    const st = e.state;
    const dead = (st & ChrisFlag.Dead) !== 0;
    const ascending = (st & ChrisFlag.Ascending) !== 0;
    c.dead.visible = dead;
    c.body.visible = !dead;
    c.legs.visible = !dead && !ascending;
    c.root.position.set(e.x, e.y);
    c.root.scale.set(1);
    c.root.alpha = 1;
    c.mark.clear();
    c.wings.clear();
    c.halo.visible = false;
    if (dead) {
      c.dead.rotation = e.facing;
      return;
    }
    c.body.rotation = e.facing;
    if (ascending) {
      // Wings unfold and flap; he rises toward the camera into a white glow and is gone.
      const k = e.action / 255;
      const spread = Math.min(1, k * 3);
      const flap = 0.85 + 0.15 * Math.sin(time * 14);
      c.wings.rotation = e.facing;
      drawWing(c.wings, -1, spread * flap);
      drawWing(c.wings, 1, spread * flap);
      c.root.position.set(e.x, e.y - k * 50);
      c.root.scale.set(1 + k * 1.3);
      c.root.alpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      c.halo.visible = true;
      c.halo.scale.set(0.8 + k * 2.5);
      c.halo.alpha = 0.3 + 0.5 * k;
      return;
    }
    c.walker.update(e.x, e.y, dt, 34);
    const moving = c.walker.speed > 10;
    c.legs.rotation = moving ? c.walker.moveDir : e.facing;
    const stride = moving ? Math.min(1, c.walker.speed / 150) * 8 : 0;
    const k = Math.sin(c.walker.phase);
    c.legA.position.set(-4 + k * stride, -5.5);
    c.legB.position.set(-4 - k * stride, 5.5);
    const hurt = (st & ChrisFlag.Hurt) !== 0;
    c.body.tint = hurt && Math.sin(time * 40) > 0 ? 0xff6a6a : 0xffffff;
    if (st & ChrisFlag.Working) {
      const p = e.action / 255;
      c.mark.circle(0, -30, 11).fill({ color: INK, alpha: 0.7 });
      c.mark.arc(0, -30, 9, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2).stroke({ width: 4, color: 0x5ad07a });
    } else if (st & ChrisFlag.Rescuing) {
      const pulse = 1 + 0.2 * Math.sin(time * 10);
      const a = 3 * pulse;
      const b = 9 * pulse;
      const y = -30;
      c.mark
        .poly([-a, y - b, a, y - b, a, y - a, b, y - a, b, y + a, a, y + a, a, y + b, -a, y + b, -a, y + a, -b, y + a, -b, y - a, -a, y - a])
        .fill({ color: 0xd8262e })
        .stroke({ width: 1.5, color: INK });
    }
  }

  /** Marc Cortez: a plain guy in a flannel who flinches when hit. */
  private drawMarc(e: InterpEntity, dt: number, time: number): void {
    this.marc ??= new NpcSprite(this.assets, 'char.marc', 21, this.root);
    const m = this.marc;
    m.step(e, dt);
    m.fx.clear();
    const hurt = (e.state & MarcFlag.Hurt) !== 0;
    m.body.tint = hurt && Math.sin(time * 40) > 0 ? 0xff7a6a : 0xffffff;
    m.body.position.set(hurt ? Math.sin(time * 60) * 2 : 0, 0);
  }

  /**
   * Plasma.TTV: a regular guy, or (GAMER RAGE) a hulking beast wreathed in RGB glow. The
   * transformation swells and shakes over two seconds; punches lunge the body forward.
   */
  private drawPlasma(e: InterpEntity, dt: number, time: number): void {
    if (!this.plasma) {
      const man = new NpcSprite(this.assets, 'char.plasma', 22, this.root);
      const beast = new Sprite(this.assets.getTexture('char.plasmaBeast'));
      beast.anchor.set(0.45, 0.5);
      const aura = new Graphics();
      aura.blendMode = 'add';
      man.root.addChildAt(aura, 0);
      man.root.addChild(beast);
      this.plasma = { man, beast, aura };
    }
    const { man, beast, aura } = this.plasma;
    const st = e.state;
    const raging = (st & PlasmaFlag.Raging) !== 0;
    const transforming = (st & PlasmaFlag.Transforming) !== 0;
    const reverting = (st & PlasmaFlag.Reverting) !== 0;
    const k = e.action / 255;
    // How far into beast form (0 man, 1 beast).
    const b = raging ? 1 : transforming ? k : reverting ? 1 - k : 0;
    man.step(e, dt, raging ? 48 : 34, raging ? 240 : 150);
    man.fx.clear();
    aura.clear();
    const shake = transforming || reverting ? Math.sin(time * 70) * 3 * (transforming ? k : 1 - k) : 0;
    man.body.visible = b < 0.5;
    beast.visible = b >= 0.5;
    man.legs.visible = b < 0.5;
    const punch = (st & PlasmaFlag.Punching) !== 0 ? 10 : 0;
    const scale = b < 0.5 ? 1 + b * 0.8 : 0.75 + (b - 0.5) * 0.5;
    man.body.scale.set(scale);
    beast.scale.set(scale);
    beast.rotation = e.facing;
    const ox = Math.cos(e.facing) * punch + shake;
    const oy = Math.sin(e.facing) * punch;
    man.body.position.set(ox, oy);
    beast.position.set(ox, oy);
    const hurt = (st & PlasmaFlag.Hurt) !== 0 && Math.sin(time * 40) > 0;
    man.body.tint = hurt ? 0xff7a6a : 0xffffff;
    beast.tint = hurt ? 0xff9a8a : 0xffffff;
    if (b > 0) {
      // Gamer RGB: a rotating rainbow glow.
      const hue = (time * 0.6) % 1;
      const col = (h: number): number => {
        const f = (n: number): number => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((h * 6 + n) % 6) - 3) - 1)));
        return (f(0) << 16) | (f(4) << 8) | f(2);
      };
      for (let i = 0; i < 3; i++) aura.circle(ox, oy, (20 + i * 9) * (0.6 + b * 0.6)).fill({ color: col(hue + i * 0.33), alpha: 0.12 * b });
      if (transforming) for (let i = 0; i < 6; i++) {
        const a = time * 8 + i;
        aura.circle(Math.cos(a) * 30 * k, Math.sin(a) * 30 * k, 3).fill({ color: col(hue + i / 6), alpha: 0.7 });
      }
    }
    if (st & PlasmaFlag.Stunned) man.stars(time, 26);
    if (st & PlasmaFlag.Blind) {
      for (let i = 0; i < 5; i++) {
        const a = time * 2 + i * 1.3;
        man.fx.circle(Math.cos(a) * 26, Math.sin(a * 1.3) * 22 - 4, 3 + (i % 2)).fill({ color: i % 2 ? 0xd06aff : 0x6a8aff, alpha: 0.8 });
      }
    }
  }

  /** Sexton's Hemp Beam: a white-hot line with a soft glow that sparks where it hits. */
  private drawBeam(e: InterpEntity, time: number): void {
    const g = this.beam;
    const len = e.extra * 8;
    const fade = Math.min(1, (e.action / 255) * 12) * Math.min(1, (1 - e.action / 255) * 10 + 0.15);
    const dx = Math.cos(e.facing);
    const dy = Math.sin(e.facing);
    const sx = e.x + dx * 14;
    const sy = e.y + dy * 14;
    const ex = e.x + dx * len;
    const ey = e.y + dy * len;
    const flick = 0.85 + 0.15 * Math.sin(time * 40);
    g.moveTo(sx, sy).lineTo(ex, ey).stroke({ width: 22, color: 0xd8ffd0, alpha: 0.1 * fade, cap: 'round' });
    g.moveTo(sx, sy).lineTo(ex, ey).stroke({ width: 10, color: 0xeaffe4, alpha: 0.28 * fade * flick, cap: 'round' });
    g.moveTo(sx, sy).lineTo(ex, ey).stroke({ width: 3.5, color: 0xffffff, alpha: 0.95 * fade, cap: 'round' });
    // Where it strikes: a flare and scattering sparks.
    g.circle(ex, ey, 14 + Math.sin(time * 30) * 3).fill({ color: 0xf0fff0, alpha: 0.35 * fade });
    for (let i = 0; i < 7; i++) {
      const a = e.facing + Math.PI + Math.sin(time * 23 + i * 2.1) * 1.3;
      const r = 8 + ((time * 90 + i * 17) % 22);
      g.circle(ex + Math.cos(a) * r, ey + Math.sin(a) * r, 1.6).fill({ color: 0xffffff, alpha: 0.8 * fade });
    }
  }

  /** Shane Jeans: double denim; a "!" over his head while he's chasing someone. */
  private drawShane(e: InterpEntity, dt: number, time: number): void {
    if (!this.shane) {
      const root = new Container();
      const legs = new Container();
      const legA = new Sprite(this.assets.getTexture('char.legs', 30));
      const legB = new Sprite(this.assets.getTexture('char.legs', 30));
      const [ax, ay] = this.assets.anchorOf('char.legs');
      for (const l of [legA, legB]) l.anchor.set(ax, ay);
      legs.addChild(legA, legB);
      const body = new Sprite(this.assets.getTexture('char.shane'));
      body.anchor.set(30 / 64, 0.5);
      const mark = new Text({ text: '!', style: { fontFamily: 'Oswald, Impact, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xb3121b, stroke: { color: 0x000000, width: 3 } } });
      mark.anchor.set(0.5, 1);
      mark.position.set(0, -24);
      const shadow = new Graphics().ellipse(4, 6, 16, 15).fill({ color: 0x000000, alpha: 0.28 });
      root.addChild(shadow, legs, body, mark);
      this.root.addChild(root);
      this.shane = { root, body, walker: new Walker(), legs, legA, legB, mark };
    }
    const s = this.shane;
    s.root.position.set(e.x, e.y);
    s.walker.update(e.x, e.y, dt, 34);
    const moving = s.walker.speed > 10;
    s.legs.rotation = moving ? s.walker.moveDir : e.facing;
    const st = moving ? Math.min(1, s.walker.speed / 150) * 8 : 0;
    const k = Math.sin(s.walker.phase);
    s.legA.position.set(-4 + k * st, -5.5);
    s.legB.position.set(-4 - k * st, 5.5);
    s.body.rotation = e.facing;
    const chasing = (e.state & ShaneFlag.Chasing) !== 0;
    s.mark.visible = chasing;
    if (chasing) s.mark.scale.set(1 + 0.15 * Math.sin(time * 10));
  }

  private drawThing(e: InterpEntity, time: number): void {
    let c = this.things.get(e.id);
    if (!c) {
      c = new Container();
      if (e.kind === EntityKind.Bottle) {
        const s = new Sprite(this.assets.getTexture('item.bottle'));
        s.anchor.set(0.5);
        s.scale.set(0.6);
        c.addChild(s);
      } else if (e.kind === EntityKind.Trap) {
        const ring = new Graphics();
        const s = new Sprite(this.assets.getTexture('item.trap'));
        s.anchor.set(0.5);
        s.scale.set(0.7);
        c.addChild(ring, s);
      } else if (e.kind === EntityKind.Gas) {
        const colors = [0x9a4aff, 0xff5ad8, 0x4a8aff, 0xc86aff, 0x6a5aff];
        for (let i = 0; i < 16; i++) {
          const p = new Sprite(this.assets.getTexture('fx.puff', i % 3));
          p.anchor.set(0.5);
          p.tint = colors[i % colors.length];
          p.blendMode = 'add';
          c.addChild(p);
        }
        const stars = new Graphics();
        c.addChild(stars);
      } else if (e.kind === EntityKind.Drop) {
        const glow = new Sprite(this.assets.getTexture('fx.glow'));
        glow.anchor.set(0.5);
        glow.scale.set(0.55);
        glow.tint = e.extra & 8 ? 0xffd86a : 0xb09a60;
        glow.blendMode = 'add';
        const kind = e.extra & 7;
        const s = new Sprite(this.assets.getTexture(kind === ItemKind.Shotgun && e.extra & 8 ? 'item.goldenPump' : ITEM_TEX[kind]));
        s.anchor.set(0.5);
        s.scale.set(0.8);
        c.addChild(glow, s);
      } else if (e.kind === EntityKind.Hemp) {
        const glow = new Sprite(this.assets.getTexture('fx.glow'));
        glow.anchor.set(0.5);
        glow.tint = 0x6dff6a;
        glow.blendMode = 'add';
        glow.scale.set(0.9);
        const s = new Sprite(this.assets.getTexture('item.hemp'));
        s.anchor.set(0.5);
        c.addChild(glow, s);
      }
      this.things.set(e.id, c);
      this.root.addChildAt(c, 1);
    }
    c.position.set(e.x, e.y);
    if (e.kind === EntityKind.Bottle) {
      // extra = distance flown / 4: it rises off the hand, then flies level until it hits.
      const lift = 18 * Math.min(1, (e.extra * 4) / 80);
      c.children[0].position.set(0, -lift);
      c.children[0].rotation = time * 14;
      c.children[0].scale.set(0.6 + lift / 90);
    } else if (e.kind === EntityKind.Trap) {
      const armed = (e.state & 1) === 1;
      // Semi-hidden: faint to Zach.
      c.alpha = this.viewerIsHunter ? 0.35 : 1;
      const ring = c.children[0] as Graphics;
      ring.clear();
      if (!this.viewerIsHunter) {
        ring.circle(0, 0, 16).stroke({ width: 2, color: armed ? 0xc86aff : 0x8a8a9a, alpha: 0.6 + 0.3 * Math.sin(time * 5) });
      }
    } else if (e.kind === EntityKind.Gas) {
      // Disperses over half a second, swirls, then thins out.
      const T = BALANCE.items.trap;
      const age = (e.extra / 255) * T.gasTime;
      const spread = Math.min(1, age / T.spreadTime);
      const ease = 1 - Math.pow(1 - spread, 3);
      const fade = Math.min(1, (T.gasTime - age) / 1.2);
      const R = T.gasRadius * ease;
      const kids = c.children;
      for (let i = 0; i < 16; i++) {
        const p = kids[i] as Sprite;
        const a = (i / 16) * Math.PI * 2 + time * 0.35 * (i % 2 ? 1 : -1);
        const d = R * (i < 5 ? 0.25 : i < 10 ? 0.55 : 0.82);
        p.position.set(Math.cos(a) * d, Math.sin(a) * d);
        p.scale.set((R / 96) * 1.1 + 0.3);
        p.alpha = 0.5 * fade;
      }
      const stars = kids[16] as Graphics;
      stars.clear();
      for (let i = 0; i < 14; i++) {
        const a = i * 2.39996 + time * 0.3;
        const d = R * ((i * 0.37) % 1);
        stars.circle(Math.cos(a) * d, Math.sin(a) * d, 1.5 + (i % 3) * 0.5).fill({ color: 0xffffff, alpha: fade * (0.5 + 0.5 * Math.sin(time * 6 + i)) });
      }
    } else if (e.kind === EntityKind.Drop) {
      c.children[0].alpha = 0.35 + 0.25 * Math.sin(time * 3 + e.id);
      c.children[1].rotation = Math.sin(time * 1.5 + e.id) * 0.15;
    } else if (e.kind === EntityKind.Hemp) {
      c.children[0].alpha = 0.5 + 0.3 * Math.sin(time * 4);
      c.children[1].rotation = Math.sin(time * 2) * 0.2;
    }
  }
}
