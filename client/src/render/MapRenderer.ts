import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { MapData, WallSeg } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import { ChunkedLayer } from './ChunkedLayer';
import { lightFlicker } from './flicker';

export type BarricadeVisual = 'up' | 'down' | 'broken';

const INK = 0x181024;

function repeatTex(tex: Texture): Texture {
  tex.source.addressMode = 'repeat';
  return tex;
}

interface DoorSprite {
  sprite: Sprite;
  closed: number;
  open: number;
  /** Current openness 0..1 (animated toward the target). */
  k: number;
  target: number;
}

/**
 * Draws the static map: ground, paths, lake, buildings, walls, trees, props, lights. Dynamic
 * props (generator lights, barricades, doors, gate) are kept here too with setters for their
 * state; doors swing open and shut smoothly.
 */
export class MapRenderer {
  readonly root = new Container();
  private readonly low: ChunkedLayer;
  private readonly high: ChunkedLayer;
  private readonly generatorSprites: Sprite[] = [];
  private readonly generatorGlows: Sprite[] = [];
  private readonly barricadeSprites: Sprite[] = [];
  private readonly doors: DoorSprite[] = [];
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
    this.root.addChild(ground, this.low.root, props, walls, this.high.root);
  }

  private tex(id: string, variant = 0): Texture {
    return this.assets.getTexture(id, variant);
  }

  private sprite(id: string, variant: number, x: number, y: number, scale = 1, rotation = 0): Sprite {
    const s = new Sprite(this.tex(id, variant));
    const [ax, ay] = this.assets.anchorOf(id);
    s.anchor.set(ax, ay);
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
      g.circle(cl.x, cl.y, cl.r * 0.75).fill({ texture: dirt, alpha: 0.7 });
    }
    for (const p of m.paths) {
      g.poly(p.points, false).stroke({ width: p.width + 16, texture: dirt, alpha: 0.35, cap: 'round', join: 'round' });
      g.poly(p.points, false).stroke({ width: p.width - 10, texture: dirt, alpha: 0.95, cap: 'round', join: 'round' });
    }
    for (const gp of m.grassPatches) g.circle(gp.x, gp.y, gp.r).fill({ color: 0x2f7a2c, alpha: 0.6 });
    g.poly(m.lake).fill({ texture: repeatTex(this.tex('ground.water')) });
    g.poly(m.lake).stroke({ width: 14, color: 0xd8c08a, alpha: 0.9 });
    g.poly(m.lake).stroke({ width: 3, color: INK, alpha: 0.9 });
    const concrete = repeatTex(this.tex('ground.concrete'));
    const wood = repeatTex(this.tex('ground.wood'));
    g.poly(m.dock).fill({ texture: wood });
    g.poly(m.dock).stroke({ width: 2.5, color: INK });
    const wh = m.warehouse;
    g.rect(wh.x - 8, wh.y - 8, wh.w + 16, wh.h + 16).fill({ color: 0x3a3a48 });
    g.rect(wh.x, wh.y, wh.w, wh.h).fill({ texture: concrete });
    const ez = m.exitZone;
    g.rect(ez.x - 10, ez.y - 10, ez.w + 20, ez.h + 80).fill({ texture: concrete, alpha: 0.95 });
    // Painted exit markings.
    for (let i = 0; i < 6; i++) g.rect(ez.x + 8 + i * ((ez.w - 16) / 6), ez.y + ez.h - 14, (ez.w - 16) / 12, 10).fill({ color: 0xf2b632 });
    g.roundRect(ez.x + ez.w / 2 - 55, ez.y + 8, 110, 44, 6).fill({ color: 0x2fc05a }).stroke({ width: 2, color: INK });
    for (const cab of m.cabins) {
      g.rect(cab.x, cab.y, cab.w, cab.h).fill({ texture: wood });
      g.rect(cab.x + 40, cab.y + 50, cab.w - 80, cab.h - 100).fill({ color: 0xc0392b, alpha: 0.55 });
    }
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
    const boxes = [0xe8453c, 0xf2b632, 0x2fc0a8, 0x2d6fe8, 0x8e4ae8];
    for (const r of m.racks) {
      const g = new Graphics();
      g.rect(r.x + 5, r.y + 6, r.w, r.h).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x3f5f8f }).stroke({ width: 2, color: INK });
      const horizontal = r.w > r.h;
      const len = horizontal ? r.w : r.h;
      let k = 6;
      let i = 0;
      while (k < len - 18) {
        const bx = horizontal ? r.x + k : r.x + 5;
        const by = horizontal ? r.y + 5 : r.y + k;
        g.rect(bx, by, horizontal ? 20 : r.w - 10, horizontal ? r.h - 10 : 20)
          .fill({ color: boxes[(i + Math.round(r.x)) % boxes.length] })
          .stroke({ width: 1.2, color: INK });
        k += 26;
        i++;
      }
      this.low.add(g, r.x + r.w / 2, r.y + r.h / 2);
    }
    for (const w of m.wrecks) {
      const g = new Graphics();
      g.roundRect(w.x + 5, w.y + 6, w.w, w.h, 14).fill({ color: 0x000000, alpha: 0.3 });
      g.roundRect(w.x, w.y, w.w, w.h, 14).fill({ color: 0xc0452e }).stroke({ width: 2, color: INK });
      const horizontal = w.w > w.h;
      if (horizontal) {
        g.roundRect(w.x + w.w * 0.3, w.y + 8, w.w * 0.4, w.h - 16, 6).fill({ color: 0x5ad0e0 }).stroke({ width: 1.5, color: INK });
        g.rect(w.x + 10, w.y + 6, 18, w.h - 12).fill({ color: 0xe06a4a });
      } else {
        g.roundRect(w.x + 8, w.y + w.h * 0.3, w.w - 16, w.h * 0.4, 6).fill({ color: 0x5ad0e0 }).stroke({ width: 1.5, color: INK });
      }
      g.circle(w.x + w.w * 0.72, w.y + w.h * 0.5, 9).fill({ color: 0x7a2a18, alpha: 0.7 });
      this.low.add(g, w.x + w.w / 2, w.y + w.h / 2);
    }
    for (const h of m.hidingSpots) {
      if (h.kind === 'grass') continue;
      const id = h.kind === 'locker' ? 'obj.locker' : h.kind === 'wardrobe' ? 'obj.wardrobe' : h.kind === 'bed' ? 'obj.bed' : 'obj.barrel';
      const rot = h.kind === 'bed' ? 0 : h.facing;
      this.low.add(this.sprite(id, 0, h.x, h.y, h.kind === 'barrel' ? 0.85 : 1, rot), h.x, h.y);
    }
    for (const st of m.stakes) this.low.add(this.sprite('obj.stake', 0, st.x, st.y, 1, (st.x + st.y) % 6.28), st.x, st.y);
  }

  private buildWalls(): Graphics {
    const g = new Graphics();
    // [width, fill, highlight]
    const style: Partial<Record<WallSeg['kind'], [number, number, number]>> = {
      warehouse: [16, 0x7c8298, 0xaab0c6],
      cabin: [13, 0x8a5530, 0xc07a42],
      shack: [11, 0x4f7ca8, 0x86b2dc],
      fence: [5, 0xa0703c, 0xd09a5c],
      yard: [3, 0xa8b0bc, 0xd8dee8],
      rack: [0, 0, 0],
    };
    const kinds = this.map.walls.filter((w) => style[w.kind] && style[w.kind]![0] > 0);
    // Ink outline, then the wall body, then a lit top edge.
    for (const pass of [0, 1, 2] as const) {
      for (const w of kinds) {
        const [width, fill, hi] = style[w.kind]!;
        const cap = w.kind === 'fence' || w.kind === 'yard' ? 'butt' : 'square';
        if (pass === 0) g.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width: width + 3, color: INK, cap });
        else if (pass === 1) g.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width, color: fill, cap });
        else if (width > 6) g.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width: width * 0.3, color: hi, cap, alpha: 0.9 });
      }
    }
    for (const w of this.map.walls) {
      if (w.kind !== 'fence' && w.kind !== 'yard') continue;
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      for (let t = 0; t <= len; t += 40) {
        const x = w.ax + ((w.bx - w.ax) * t) / len;
        const y = w.ay + ((w.by - w.ay) * t) / len;
        g.rect(x - 3.5, y - 3.5, 7, 7).fill({ color: w.kind === 'yard' ? 0xc9d2dc : 0x8a5530 }).stroke({ width: 1.2, color: INK });
      }
    }
    return g;
  }

  private buildDynamicProps(props: Container): Sprite {
    const m = this.map;
    for (const gen of m.generators) {
      const glow = this.sprite('fx.glow', 0, gen.x, gen.y, 2.6);
      glow.tint = 0xffe07a;
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
    const whDoor = (x: number, y: number): boolean => x >= m.warehouse.x - 2 && y >= m.warehouse.y - 2 && x <= m.warehouse.x + m.warehouse.w + 2 && y <= m.warehouse.y + m.warehouse.h + 2;
    for (const d of m.doors) {
      const s = this.sprite('obj.door', whDoor(d.hx, d.hy) ? 1 : 0, d.hx, d.hy, 1, d.angle);
      s.scale.set(d.length / 76, 1);
      const open = d.angle + (d.swing * Math.PI) / 2;
      const k = m.dynamicSegments[d.dyn].active ? 0 : 1;
      s.rotation = d.angle + (open - d.angle) * k;
      props.addChild(s);
      this.doors.push({ sprite: s, closed: d.angle, open, k, target: k });
    }
    const gate = this.sprite('obj.gate', 0, m.gate.x, m.gate.y, m.gate.length / 150, m.gate.angle);
    props.addChild(gate);
    const lever = new Graphics();
    lever.roundRect(m.gate.leverX - 9, m.gate.leverY - 13, 18, 26, 3).fill({ color: 0xf2b632 }).stroke({ width: 1.6, color: INK });
    lever.roundRect(m.gate.leverX - 3, m.gate.leverY - 18, 6, 12, 2).fill({ color: 0xe8453c }).stroke({ width: 1.4, color: INK });
    props.addChild(lever);
    return gate;
  }

  private buildHighProps(): void {
    const m = this.map;
    for (const t of m.trees) {
      const id = t.kind === 'pine' ? 'tree.pine' : t.kind === 'oak' ? 'tree.oak' : 'tree.dead';
      const base = t.kind === 'pine' ? 0.6 : t.kind === 'oak' ? 0.62 : 0.7;
      const s = this.sprite(id, t.variant, t.x, t.y, base + t.r / 45);
      // Mirror some trees for variety; they stay upright on their trunks.
      if ((Math.floor(t.x * 7 + t.y * 3) & 1) === 1) s.scale.x *= -1;
      this.high.add(s, t.x, t.y);
    }
    for (const r of m.rocks) this.high.add(this.sprite('prop.boulder', r.variant, r.x, r.y, r.r / 40, (r.x + r.y) % 6.28), r.x, r.y);
    m.lights.forEach((l, i) => {
      const id = l.kind === 'campfire' ? 'obj.campfire' : 'obj.lamp';
      this.high.add(this.sprite(id, 0, l.x, l.y), l.x, l.y);
      const glow = this.sprite('fx.glow', 0, l.x, l.y, (l.radius * 1.3) / 128);
      glow.tint = l.kind === 'campfire' ? 0xff9a3a : 0xffe7a8;
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
    s.tint = 0xffffff;
    if (state === 'down') {
      s.texture = this.tex('obj.barricade', 1);
      s.position.set(b.x, b.y);
      s.rotation = b.angle;
    } else {
      // Standing barricade leans beside the gap.
      s.texture = this.tex('obj.barricade', 0);
      const nx = -Math.sin(b.angle);
      const ny = Math.cos(b.angle);
      s.position.set(b.x + nx * 22, b.y + ny * 22);
      s.rotation = b.angle;
    }
  }

  /** A dropped barricade took a hit: it cracks and twists. */
  damageBarricade(id: number, hits: number): void {
    const s = this.barricadeSprites[id];
    const b = this.map.barricades[id];
    if (!s || !b) return;
    s.tint = hits > 0 ? 0xd8a080 : 0xffffff;
    s.rotation = b.angle + (hits > 0 ? 0.06 : 0);
  }

  setDoor(id: number, open: boolean): void {
    const d = this.doors[id];
    if (d) d.target = open ? 1 : 0;
  }

  setGateOpen(open: boolean): void {
    this.gateSprite.texture = this.tex('obj.gate', open ? 1 : 0);
  }

  update(camX: number, camY: number, w: number, h: number, time: number, dt = 1 / 60): void {
    this.low.cull(camX, camY, w, h);
    this.high.cull(camX, camY, w, h);
    for (const g of this.glows) g.sprite.alpha = g.base * lightFlicker(g.kind, time, g.index) * 1.1;
    // Doors swing with an ease-out over about a third of a second.
    for (const d of this.doors) {
      if (d.k === d.target) continue;
      const step = dt / 0.32;
      d.k = d.target > d.k ? Math.min(d.target, d.k + step) : Math.max(d.target, d.k - step);
      const e = d.k * d.k * (3 - 2 * d.k);
      d.sprite.rotation = d.closed + (d.open - d.closed) * e;
    }
  }

  showAll(): void {
    this.low.showAll();
    this.high.showAll();
  }
}
