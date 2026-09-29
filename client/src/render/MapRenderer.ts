import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { MapData, WallSeg } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import { ChunkedLayer } from './ChunkedLayer';
import { lightFlicker } from './flicker';

export type BarricadeVisual = 'up' | 'down' | 'broken';

function repeatTex(tex: Texture): Texture {
  tex.source.addressMode = 'repeat';
  return tex;
}

/**
 * Draws the static map: ground, paths, lake, buildings, walls, trees, props, lights. Dynamic
 * props (generator lights, barricades, gate) are kept here too with setters for their state.
 */
export class MapRenderer {
  readonly root = new Container();
  private readonly low: ChunkedLayer;
  private readonly high: ChunkedLayer;
  private readonly generatorSprites: Sprite[] = [];
  private readonly generatorGlows: Sprite[] = [];
  private readonly barricadeSprites: Sprite[] = [];
  private readonly gateSprite: Sprite;
  private readonly glows: { sprite: Sprite; index: number; kind: string; base: number }[] = [];

  constructor(
    readonly map: MapData,
    private readonly assets: AssetManager,
  ) {
    this.low = new ChunkedLayer(map.width, map.height);
    this.high = new ChunkedLayer(map.width, map.height);
    const ground = this.buildGround();
    this.buildLowProps();
    const walls = this.buildWalls();
    const props = new Container();
    this.gateSprite = this.buildDynamicProps(props);
    this.buildHighProps();
    this.root.addChild(ground, this.low.root, walls, props, this.high.root);
  }

  private tex(id: string, variant = 0): Texture {
    return this.assets.getTexture(id, variant);
  }

  private sprite(id: string, variant: number, x: number, y: number, scale = 1, rotation = 0): Sprite {
    const s = new Sprite(this.tex(id, variant));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(scale);
    s.rotation = rotation;
    return s;
  }

  private buildGround(): Container {
    const m = this.map;
    const c = new Container();
    c.addChild(new TilingSprite({ texture: this.tex('ground.forest'), width: m.width, height: m.height }));
    const g = new Graphics();
    const dirt = repeatTex(this.tex('ground.path'));
    for (const cl of m.clearings) {
      g.circle(cl.x, cl.y, cl.r * 0.95).fill({ texture: dirt, alpha: 0.35 });
      g.circle(cl.x, cl.y, cl.r * 0.75).fill({ texture: dirt, alpha: 0.6 });
    }
    for (const p of m.paths) {
      g.poly(p.points, false).stroke({ width: p.width + 16, texture: dirt, alpha: 0.35, cap: 'round', join: 'round' });
      g.poly(p.points, false).stroke({ width: p.width - 10, texture: dirt, alpha: 0.85, cap: 'round', join: 'round' });
    }
    for (const gp of m.grassPatches) g.circle(gp.x, gp.y, gp.r).fill({ color: 0x2b3a1e, alpha: 0.55 });
    g.poly(m.lake).fill({ texture: repeatTex(this.tex('ground.water')) });
    g.poly(m.lake).stroke({ width: 10, color: 0x1c2016, alpha: 0.9 });
    const concrete = repeatTex(this.tex('ground.concrete'));
    const wood = repeatTex(this.tex('ground.wood'));
    g.poly(m.dock).fill({ texture: wood });
    g.poly(m.dock).stroke({ width: 3, color: 0x20160e });
    const wh = m.warehouse;
    g.rect(wh.x - 8, wh.y - 8, wh.w + 16, wh.h + 16).fill({ color: 0x151412 });
    g.rect(wh.x, wh.y, wh.w, wh.h).fill({ texture: concrete });
    const ez = m.exitZone;
    g.rect(ez.x - 10, ez.y - 10, ez.w + 20, ez.h + 80).fill({ texture: concrete, alpha: 0.9 });
    g.rect(ez.x + ez.w / 2 - 55, ez.y + 8, 110, 150).fill({ color: 0x2c3438 });
    g.rect(ez.x + ez.w / 2 - 50, ez.y + 12, 100, 44).fill({ color: 0x3e4a50 });
    for (const cab of m.cabins) g.rect(cab.x, cab.y, cab.w, cab.h).fill({ texture: wood });
    c.addChild(g);
    return c;
  }

  private buildLowProps(): void {
    const m = this.map;
    for (const b of m.bushes) this.low.add(this.sprite('prop.bush', b.variant, b.x, b.y, b.r / 40, b.x % 6.28), b.x, b.y);
    for (const gp of m.grassPatches) {
      const n = Math.max(3, Math.round((gp.r * gp.r) / 2400));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + gp.x;
        const r = i === 0 ? 0 : gp.r * 0.55 * ((i % 3) / 3 + 0.4);
        const x = gp.x + Math.cos(a) * r;
        const y = gp.y + Math.sin(a) * r;
        this.low.add(this.sprite('grass.tall', i, x, y, 0.9 + (i % 3) * 0.15, a), x, y);
      }
    }
    for (const l of m.logs) this.low.add(this.sprite('prop.log', 0, l.x, l.y, l.length / 144, l.angle), l.x, l.y);
    for (const r of m.racks) {
      const g = new Graphics();
      g.rect(r.x + 4, r.y + 5, r.w, r.h).fill({ color: 0x000000, alpha: 0.45 });
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x3b3b39 });
      const horizontal = r.w > r.h;
      const len = horizontal ? r.w : r.h;
      for (let k = 6; k < len - 20; k += 26) {
        const bx = horizontal ? r.x + k : r.x + 5;
        const by = horizontal ? r.y + 5 : r.y + k;
        g.rect(bx, by, horizontal ? 20 : r.w - 10, horizontal ? r.h - 10 : 20).fill({ color: k % 52 === 6 ? 0x5a4630 : 0x4c3c28 });
      }
      g.rect(r.x, r.y, r.w, r.h).stroke({ width: 2, color: 0x1c1c1a });
      this.low.add(g, r.x + r.w / 2, r.y + r.h / 2);
    }
    for (const w of m.wrecks) {
      const g = new Graphics();
      g.roundRect(w.x + 5, w.y + 6, w.w, w.h, 14).fill({ color: 0x000000, alpha: 0.5 });
      g.roundRect(w.x, w.y, w.w, w.h, 14).fill({ color: 0x4a2e20 });
      const horizontal = w.w > w.h;
      if (horizontal) {
        g.roundRect(w.x + w.w * 0.3, w.y + 8, w.w * 0.4, w.h - 16, 6).fill({ color: 0x1e2426 });
        g.rect(w.x + 10, w.y + 6, 18, w.h - 12).fill({ color: 0x5e3a26 });
      } else {
        g.roundRect(w.x + 8, w.y + w.h * 0.3, w.w - 16, w.h * 0.4, 6).fill({ color: 0x1e2426 });
      }
      g.circle(w.x + w.w * 0.7, w.y + w.h * 0.5, 9).fill({ color: 0x6a3c22, alpha: 0.7 });
      this.low.add(g, w.x + w.w / 2, w.y + w.h / 2);
    }
    for (const h of m.hidingSpots) {
      if (h.kind === 'grass') continue;
      const id = h.kind === 'locker' ? 'obj.locker' : h.kind === 'wardrobe' ? 'obj.wardrobe' : h.kind === 'bed' ? 'obj.bed' : 'obj.barrel';
      const rot = h.kind === 'bed' ? 0 : h.facing;
      const s = this.sprite(id, 0, h.x, h.y, h.kind === 'barrel' ? 0.85 : 1, rot);
      this.low.add(s, h.x, h.y);
    }
    for (const st of m.stakes) this.low.add(this.sprite('obj.stake', 0, st.x, st.y, 1, (st.x + st.y) % 6.28), st.x, st.y);
    for (const w of m.windows) this.low.add(this.sprite('obj.window', 0, w.x, w.y, w.length / 80, w.angle), w.x, w.y);
  }

  private buildWalls(): Graphics {
    const g = new Graphics();
    const style: Partial<Record<WallSeg['kind'], [number, number, number, number]>> = {
      warehouse: [20, 0x1a1917, 11, 0x46423c],
      cabin: [15, 0x22170e, 8, 0x5a4028],
      shack: [13, 0x241a12, 7, 0x50402c],
      fence: [5, 0x2c2218, 3, 0x4c3a28],
      yard: [3, 0x5a5a56, 1, 0x9a9a94],
    };
    const passes: (0 | 1)[] = [0, 1];
    for (const pass of passes) {
      for (const w of this.map.walls) {
        const st = style[w.kind];
        if (!st) continue;
        g.moveTo(w.ax, w.ay)
          .lineTo(w.bx, w.by)
          .stroke({ width: pass === 0 ? st[0] : st[2], color: pass === 0 ? st[1] : st[3], cap: w.kind === 'fence' || w.kind === 'yard' ? 'butt' : 'square' });
      }
    }
    for (const w of this.map.walls) {
      if (w.kind !== 'fence' && w.kind !== 'yard') continue;
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      for (let t = 0; t <= len; t += 40) {
        const x = w.ax + ((w.bx - w.ax) * t) / len;
        const y = w.ay + ((w.by - w.ay) * t) / len;
        g.rect(x - 3, y - 3, 6, 6).fill({ color: w.kind === 'yard' ? 0x6a6a64 : 0x3a2c1e });
      }
    }
    return g;
  }

  private buildDynamicProps(props: Container): Sprite {
    const m = this.map;
    for (const gen of m.generators) {
      const glow = this.sprite('fx.glow', 0, gen.x, gen.y, 2.6);
      glow.tint = 0xffd890;
      glow.blendMode = 'add';
      glow.visible = false;
      props.addChild(glow);
      this.generatorGlows.push(glow);
      const s = this.sprite('obj.generator', 0, gen.x, gen.y, 1, gen.angle);
      props.addChild(s);
      this.generatorSprites.push(s);
    }
    for (const b of m.barricades) {
      const s = this.sprite('obj.barricade', 0, 0, 0, b.length / 96, b.angle);
      props.addChild(s);
      this.barricadeSprites.push(s);
      this.setBarricade(b.id, 'up');
    }
    const gate = this.sprite('obj.gate', 0, m.gate.x, m.gate.y, m.gate.length / 150, m.gate.angle);
    props.addChild(gate);
    const lever = new Graphics();
    lever.rect(m.gate.leverX - 8, m.gate.leverY - 12, 16, 24).fill({ color: 0x3a3a36 }).stroke({ width: 2, color: 0x1a1a18 });
    lever.rect(m.gate.leverX - 3, m.gate.leverY - 16, 6, 10).fill({ color: 0x8a2a20 });
    props.addChild(lever);
    return gate;
  }

  private buildHighProps(): void {
    const m = this.map;
    for (const t of m.trees) {
      const id = t.kind === 'pine' ? 'tree.pine' : 'tree.dead';
      const scale = t.kind === 'pine' ? 0.55 + t.r / 40 : t.r / 15;
      this.high.add(this.sprite(id, t.variant, t.x, t.y, scale, (t.x * 13.1 + t.y * 7.7) % 6.28), t.x, t.y);
    }
    for (const r of m.rocks) this.high.add(this.sprite('prop.boulder', r.variant, r.x, r.y, r.r / 40, (r.x + r.y) % 6.28), r.x, r.y);
    m.lights.forEach((l, i) => {
      const id = l.kind === 'campfire' ? 'obj.campfire' : 'obj.lamp';
      this.high.add(this.sprite(id, 0, l.x, l.y), l.x, l.y);
      const glow = this.sprite('fx.glow', 0, l.x, l.y, (l.radius * 1.3) / 128);
      glow.tint = l.kind === 'campfire' ? 0xff8a3a : 0xffe2a8;
      glow.blendMode = 'add';
      glow.alpha = 0.3;
      this.high.add(glow, l.x, l.y);
      this.glows.push({ sprite: glow, index: i, kind: l.kind, base: 0.3 });
    });
  }

  setGenerator(id: number, repaired: boolean): void {
    const s = this.generatorSprites[id];
    if (!s) return;
    s.texture = this.tex('obj.generator', repaired ? 1 : 0);
    this.generatorGlows[id].visible = repaired;
  }

  setBarricade(id: number, state: BarricadeVisual): void {
    const b = this.map.barricades[id];
    const s = this.barricadeSprites[id];
    if (!b || !s) return;
    s.visible = state !== 'broken';
    if (state === 'down') {
      s.texture = this.tex('obj.barricade', 1);
      s.position.set(b.x, b.y);
      s.alpha = 1;
    } else {
      // Standing barricade leans beside the gap.
      s.texture = this.tex('obj.barricade', 0);
      const nx = -Math.sin(b.angle);
      const ny = Math.cos(b.angle);
      s.position.set(b.x + nx * 22, b.y + ny * 22);
      s.alpha = 0.95;
    }
  }

  setGateOpen(open: boolean): void {
    this.gateSprite.texture = this.tex('obj.gate', open ? 1 : 0);
  }

  update(camX: number, camY: number, w: number, h: number, time: number): void {
    this.low.cull(camX, camY, w, h);
    this.high.cull(camX, camY, w, h);
    for (const g of this.glows) g.sprite.alpha = g.base * lightFlicker(g.kind, time, g.index) * 1.1;
  }

  showAll(): void {
    this.low.showAll();
    this.high.showAll();
  }
}
