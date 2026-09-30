import { Container, Graphics, Sprite } from 'pixi.js';
import { BALANCE, burstSag } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';

interface Mark {
  x: number;
  y: number;
  born: number;
}

interface ScentMark extends Mark {
  kind: number;
  seed: number;
}

interface Wave {
  x: number;
  y: number;
  a: number;
  born: number;
}

const SCENT_LIFE = BALANCE.trails.maxAgeSec * 1000;

/**
 * Supernatural senses drawn above the vision filter (so they show in the dark): the red
 * scent trail (Zach; survivors see their own in testing mode), the Soundcloud Burst wave
 * racing across the map, breathing ripples and teammate stake auras. Blood decals go on the
 * ground layer and are subject to vision.
 */
export class Overlays {
  readonly senses = new Container();
  readonly decals = new Container();
  private readonly scentLayer = new Container();
  private readonly g = new Graphics();
  private readonly rings = new Graphics();
  private scent: ScentMark[] = [];
  private readonly scentSprites: Sprite[] = [];
  private breaths: Mark[] = [];
  private bursts: Wave[] = [];

  constructor(
    private readonly assets: AssetManager,
    private readonly mapW = 6000,
    private readonly mapH = 6000,
  ) {
    this.rings.blendMode = 'add';
    this.senses.addChild(this.scentLayer, this.g, this.rings);
  }

  /** New scent points: x, y, kind (0 scent, 1 blood), age in tenths of a second. */
  addScent(pts: number[], now: number): void {
    for (let i = 0; i + 3 < pts.length; i += 4) {
      this.scent.push({ x: pts[i], y: pts[i + 1], kind: pts[i + 2], born: now - pts[i + 3] * 100, seed: (pts[i] * 13 + pts[i + 1] * 7) % 997 });
    }
    if (this.scent.length > 600) this.scent.splice(0, this.scent.length - 600);
  }

  addBreath(x: number, y: number, now: number): void {
    this.breaths.push({ x, y, born: now });
  }

  addBurst(x: number, y: number, a: number, now: number): void {
    this.bursts.push({ x, y, a, born: now });
  }

  addBlood(x: number, y: number): void {
    const s = new Sprite(this.assets.getTexture('fx.blood', Math.floor(Math.random() * 3)));
    s.anchor.set(0.5);
    s.position.set(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16);
    s.rotation = Math.random() * Math.PI * 2;
    s.scale.set(0.8 + Math.random() * 0.6);
    this.decals.addChild(s);
    while (this.decals.children.length > 150) this.decals.children[0].destroy();
  }

  update(now: number, auras: { x: number; y: number }[], view: { x: number; y: number; w: number; h: number }): void {
    const g = this.g;
    g.clear();
    this.breaths = this.breaths.filter((b) => now - b.born < 1400);
    for (const b of this.breaths) {
      const k = (now - b.born) / 1400;
      g.circle(b.x, b.y, 10 + k * 40).stroke({ width: 2.5, color: 0xd8f0ff, alpha: (1 - k) * 0.7 });
    }
    for (const a of auras) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      g.circle(a.x, a.y, 22 + pulse * 6).stroke({ width: 3, color: 0xff3a5a, alpha: 0.55 + pulse * 0.3 });
    }

    // Scent: red gas puffs that swell, drift and slowly fade away.
    this.scent = this.scent.filter((s) => now - s.born < SCENT_LIFE);
    while (this.scentSprites.length < this.scent.length) {
      const sp = new Sprite(this.assets.getTexture('fx.puff', this.scentSprites.length % 3));
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      this.scentLayer.addChild(sp);
      this.scentSprites.push(sp);
    }
    const margin = 120;
    this.scentSprites.forEach((sp, i) => {
      const s = this.scent[i];
      if (!s || s.x < view.x - margin || s.y < view.y - margin || s.x > view.x + view.w + margin || s.y > view.y + view.h + margin) {
        sp.visible = false;
        return;
      }
      sp.visible = true;
      const age = (now - s.born) / SCENT_LIFE;
      const t = (now - s.born) / 1000;
      sp.tint = s.kind === 1 ? 0xd0101e : 0xff2a3a;
      sp.alpha = Math.max(0, 0.62 * Math.pow(1 - age, 1.3));
      sp.scale.set(0.42 + age * 0.45 + 0.04 * Math.sin(t * 2 + s.seed));
      sp.position.set(s.x + Math.sin(t * 0.9 + s.seed) * (4 + age * 10), s.y + Math.cos(t * 0.7 + s.seed) * (4 + age * 10) - age * 8);
      sp.rotation = t * 0.3 + s.seed;
    });

    // Soundcloud Burst: a purple, slightly concave lens of fixed width flying straight on.
    const B = BALANCE.hunter.burst;
    const r = this.rings;
    r.clear();
    const maxD = Math.hypot(this.mapW, this.mapH) + B.width;
    this.bursts = this.bursts.filter((b) => {
      const front = (B.speed * (now - b.born)) / 1000;
      if (front - B.thickness > maxD) return false;
      const dx = Math.cos(b.a);
      const dy = Math.sin(b.a);
      const half = B.width / 2;
      const N = 16;
      const at = (along: number, side: number): [number, number] => [b.x + dx * along - dy * side, b.y + dy * along + dx * side];
      // The lens: front face and back face both bow out toward the edges.
      const lens = (depth: number, grow: number): number[] => {
        const pts: number[] = [];
        for (let i = 0; i <= N; i++) {
          const sd = -half + (B.width * i) / N;
          pts.push(...at(front + burstSag(sd) + grow, sd));
        }
        for (let i = N; i >= 0; i--) {
          const sd = -half + (B.width * i) / N;
          pts.push(...at(front - depth - burstSag(sd) - grow, sd));
        }
        return pts;
      };
      // Fading echoes trail behind, then a soft glow and the bright core.
      for (let k = 1; k <= 4; k++) r.poly(lens(B.thickness * 0.6, 0).map((v, i) => v - (i % 2 === 0 ? dx : dy) * k * 30)).fill({ color: 0x5a1ab8, alpha: 0.14 / k });
      r.poly(lens(B.thickness, 10)).fill({ color: 0x5a2ab0, alpha: 0.25 });
      r.poly(lens(B.thickness, 0)).fill({ color: 0x7a3ae0, alpha: 0.4 });
      r.poly(lens(B.thickness * 0.35, -4)).fill({ color: 0xa070f0, alpha: 0.35 });
      return true;
    });
  }
}
