import { Container, Graphics, Sprite } from 'pixi.js';
import { BALANCE } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';

interface Echo {
  x: number;
  y: number;
  born: number;
}

interface TrailMark {
  x: number;
  y: number;
  kind: number;
  born: number;
}

/**
 * Supernatural senses drawn above the vision filter (so they show outside your cone):
 * Stalker's Pulse echoes, Bloodhound trails, breathing ripples and teammate stake auras.
 * Blood decals go on the ground layer and are subject to the vision filter like terrain.
 */
export class Overlays {
  readonly senses = new Container();
  readonly decals = new Container();
  private readonly g = new Graphics();
  private readonly trailLayer = new Container();
  private echoes: Echo[] = [];
  private trail: TrailMark[] = [];
  private trailSprites: Sprite[] = [];
  private breaths: Echo[] = [];

  constructor(private readonly assets: AssetManager) {
    this.senses.addChild(this.trailLayer, this.g);
  }

  addEchoes(pts: number[], now: number): void {
    for (let i = 0; i + 2 < pts.length; i += 3) this.echoes.push({ x: pts[i], y: pts[i + 1], born: now - pts[i + 2] * 100 });
  }

  setTrail(pts: number[], now: number): void {
    this.trail = [];
    for (let i = 0; i + 3 < pts.length; i += 4) this.trail.push({ x: pts[i], y: pts[i + 1], kind: pts[i + 2], born: now - pts[i + 3] * 100 });
  }

  addBreath(x: number, y: number, now: number): void {
    this.breaths.push({ x, y, born: now });
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

  update(now: number, auras: { x: number; y: number }[], bloodhoundUntil: number): void {
    const g = this.g;
    g.clear();
    const echoLife = BALANCE.hunter.pulse.echoDuration * 1000;
    this.echoes = this.echoes.filter((e) => now - e.born < echoLife + 800);
    for (const e of this.echoes) {
      const age = (now - e.born) / echoLife;
      const a = Math.max(0, 1 - age);
      const r = 18 + ((now / 25) % 30);
      g.circle(e.x, e.y, r).stroke({ width: 2, color: 0xd23a2e, alpha: a * 0.8 });
      g.circle(e.x, e.y, 6).fill({ color: 0xd23a2e, alpha: a * 0.6 });
    }
    this.breaths = this.breaths.filter((b) => now - b.born < 1400);
    for (const b of this.breaths) {
      const k = (now - b.born) / 1400;
      g.circle(b.x, b.y, 10 + k * 40).stroke({ width: 2, color: 0xe0e0d0, alpha: (1 - k) * 0.6 });
    }
    for (const a of auras) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      g.circle(a.x, a.y, 22 + pulse * 6).stroke({ width: 3, color: 0xd23a2e, alpha: 0.5 + pulse * 0.3 });
    }

    // Bloodhound trail marks (only while active).
    const showTrail = now < bloodhoundUntil;
    while (this.trailSprites.length < (showTrail ? this.trail.length : 0)) {
      const s = new Sprite(this.assets.getTexture('fx.footprint'));
      s.anchor.set(0.5);
      this.trailLayer.addChild(s);
      this.trailSprites.push(s);
    }
    this.trailSprites.forEach((s, i) => {
      const t = this.trail[i];
      if (!showTrail || !t) {
        s.visible = false;
        return;
      }
      s.visible = true;
      const age = (now - t.born) / (BALANCE.hunter.bloodhound.trailHistorySec * 1000);
      s.texture = this.assets.getTexture(t.kind === 1 ? 'fx.blood' : 'fx.footprint', i % 3);
      s.tint = t.kind === 1 ? 0xff3020 : 0xff6040;
      s.alpha = Math.max(0.1, 0.9 - age * 0.8);
      s.scale.set(t.kind === 1 ? 0.5 : 0.8);
      s.position.set(t.x, t.y);
    });
  }
}
