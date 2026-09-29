import { Container, Sprite } from 'pixi.js';
import type { AssetManager } from '../assets/AssetManager';

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

/** Tiny pooled particle system: sparks from exploding generators, burning flares, glass. */
export class Particles {
  readonly root = new Container();
  private readonly live: Particle[] = [];
  private readonly pool: Sprite[] = [];

  constructor(private readonly assets: AssetManager) {
    this.root.blendMode = 'add';
  }

  burst(x: number, y: number, count: number, opts: { speed?: number; life?: number; tint?: number; size?: number } = {}): void {
    for (let i = 0; i < count && this.live.length < 400; i++) {
      const s = this.pool.pop() ?? new Sprite(this.assets.getTexture('fx.spark'));
      s.anchor.set(0.5);
      s.tint = opts.tint ?? 0xffc070;
      s.scale.set((opts.size ?? 1) * (0.6 + Math.random() * 0.8));
      s.position.set(x, y);
      s.visible = true;
      if (!s.parent) this.root.addChild(s);
      const a = Math.random() * Math.PI * 2;
      const v = (opts.speed ?? 180) * (0.3 + Math.random());
      const life = (opts.life ?? 0.6) * (0.5 + Math.random());
      this.live.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life });
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.alpha = p.life / p.max;
    }
  }
}
