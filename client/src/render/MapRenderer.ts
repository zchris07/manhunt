import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { MapData, WallSeg } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import { ChunkedLayer } from './ChunkedLayer';
import { lightFlicker } from './flicker';
import { CANOPY_PX } from '../assets/procedural/textures';

export type BarricadeVisual = 'up' | 'down' | 'broken';

/** Every cast shadow falls down and to the right, as if lit from the upper left. */
const SHADOW = { x: 7, y: 11 };

/** Wall looks: [thickness, side face, top face, top highlight, height offset]. */
type WallLook = [number, number, number, number, number];
const WALLS: Partial<Record<WallSeg['kind'], WallLook>> = {
  warehouse: [18, 0x1f201f, 0x4c4c48, 0x6a6a64, 7],
  cabin: [14, 0x1e1812, 0x4a3a2a, 0x66523c, 6],
  shack: [12, 0x1a1c1d, 0x42474a, 0x5c6266, 5],
  wreck: [0, 0, 0, 0, 0],
  fence: [6, 0x1c1610, 0x3e3226, 0x564634, 3],
  yard: [3, 0x202224, 0x55595c, 0x74787a, 1],
};

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
  broken: boolean;
}

/**
 * Draws the static map in a Darkwood-like style: murky ground, walls with a top face and a
 * soft cast shadow (so the flat map reads as a 3D scene seen from above), glass windows,
 * tree canopies from straight above, props and lights. Doors, barricades and the gate are
 * kept here too with setters for their state. Generators and the gate lever are objectives
 * and live on the entity layer, so they are hidden in the fog of war.
 */
export class MapRenderer {
  readonly root = new Container();
  private readonly low: ChunkedLayer;
  private readonly high: ChunkedLayer;
  private readonly barricadeSprites: Sprite[] = [];
  private readonly doors: DoorSprite[] = [];
  private readonly debris = new Graphics();
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
    this.root.addChild(ground, this.low.root, props, this.debris, walls, this.high.root);
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
    // Clearings and paths fade softly into the forest floor.
    for (const cl of m.clearings) {
      g.circle(cl.x, cl.y, cl.r * 1.0).fill({ texture: dirt, alpha: 0.18 });
      g.circle(cl.x, cl.y, cl.r * 0.85).fill({ texture: dirt, alpha: 0.3 });
      g.circle(cl.x, cl.y, cl.r * 0.68).fill({ texture: dirt, alpha: 0.5 });
    }
    for (const p of m.paths) {
      g.poly(p.points, false).stroke({ width: p.width + 30, texture: dirt, alpha: 0.2, cap: 'round', join: 'round' });
      g.poly(p.points, false).stroke({ width: p.width + 6, texture: dirt, alpha: 0.45, cap: 'round', join: 'round' });
      g.poly(p.points, false).stroke({ width: p.width - 18, texture: dirt, alpha: 0.7, cap: 'round', join: 'round' });
    }
    for (const gp of m.grassPatches) g.circle(gp.x, gp.y, gp.r * 1.1).fill({ color: 0x1c2214, alpha: 0.45 });
    // Lake: muddy bank, dark still water.
    g.poly(m.lake).stroke({ width: 40, color: 0x2a261e, alpha: 0.7 });
    g.poly(m.lake).fill({ texture: repeatTex(this.tex('ground.water')) });
    g.poly(m.lake).stroke({ width: 8, color: 0x16140f, alpha: 0.8 });
    const concrete = repeatTex(this.tex('ground.concrete'));
    const wood = repeatTex(this.tex('ground.wood'));
    // Dock: shadow on the water, then planks.
    g.poly(m.dock.map((v, i) => v + (i % 2 === 0 ? SHADOW.x : SHADOW.y))).fill({ color: 0x000000, alpha: 0.45 });
    g.poly(m.dock).fill({ texture: wood });
    const wh = m.warehouse;
    g.rect(wh.x - 14, wh.y - 14, wh.w + 28, wh.h + 28).fill({ color: 0x24241f, alpha: 0.8 });
    g.rect(wh.x, wh.y, wh.w, wh.h).fill({ texture: concrete });
    const ez = m.exitZone;
    g.rect(ez.x - 10, ez.y - 10, ez.w + 20, ez.h + 80).fill({ texture: concrete, alpha: 0.9 });
    // Worn hazard striping by the exit.
    for (let i = 0; i < 6; i++) g.rect(ez.x + 8 + i * ((ez.w - 16) / 6), ez.y + ez.h - 14, (ez.w - 16) / 12, 10).fill({ color: 0x8a7a3a, alpha: 0.55 });
    for (const cab of m.cabins) {
      g.rect(cab.x, cab.y, cab.w, cab.h).fill({ texture: wood });
      g.rect(cab.x + 40, cab.y + 50, cab.w - 80, cab.h - 100).fill({ color: 0x3a1c18, alpha: 0.55 });
    }
    c.addChild(g);
    return c;
  }

  /** A soft cast shadow for a rectangle-ish prop (three widening, fading layers). */
  private shadowRect(g: Graphics, x: number, y: number, w: number, h: number, r = 4): void {
    for (const [grow, a] of [
      [8, 0.12],
      [4, 0.18],
      [0, 0.28],
    ] as const) {
      g.roundRect(x + SHADOW.x - grow / 2, y + SHADOW.y - grow / 2, w + grow, h + grow, r + grow / 2).fill({ color: 0x000000, alpha: a });
    }
  }

  private buildLowProps(): void {
    const m = this.map;
    for (const b of m.bushes) this.low.add(this.sprite('prop.bush', b.variant, b.x, b.y, b.r / 40, b.x % 6.28), b.x, b.y);
    for (const gp of m.grassPatches) {
      const n = Math.max(4, Math.round((gp.r * gp.r) / 1800));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + gp.x;
        const r = i === 0 ? 0 : gp.r * 0.6 * ((i % 3) / 3 + 0.4);
        const x = gp.x + Math.cos(a) * r;
        const y = gp.y + Math.sin(a) * r;
        this.low.add(this.sprite('grass.tall', i, x, y, 1 + (i % 3) * 0.15, a), x, y);
      }
    }
    for (const l of m.logs) this.low.add(this.sprite('prop.log', 0, l.x, l.y, l.length / 144, l.angle), l.x, l.y);
    // Warehouse racks: metal shelving with dusty boxes.
    const boxes = [0x5a4a36, 0x4a3e30, 0x635240, 0x3e3a34];
    for (const r of m.racks) {
      const g = new Graphics();
      this.shadowRect(g, r.x, r.y, r.w, r.h, 2);
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x2c2e30 });
      g.rect(r.x, r.y, r.w, r.h).stroke({ width: 2, color: 0x4a4e52 });
      const horizontal = r.w > r.h;
      const len = horizontal ? r.w : r.h;
      let k = 6;
      let i = 0;
      while (k < len - 18) {
        const bx = horizontal ? r.x + k : r.x + 5;
        const by = horizontal ? r.y + 5 : r.y + k;
        const bw = horizontal ? 20 : r.w - 10;
        const bh = horizontal ? r.h - 10 : 20;
        g.rect(bx, by, bw, bh).fill({ color: boxes[(i + Math.round(r.x)) % boxes.length] });
        g.rect(bx, by, bw, 2).fill({ color: 0x7a6a54, alpha: 0.5 });
        g.moveTo(bx + bw / 2, by).lineTo(bx + bw / 2, by + bh).stroke({ width: 1.5, color: 0x2a2218, alpha: 0.6 });
        k += 26;
        i++;
      }
      this.low.add(g, r.x + r.w / 2, r.y + r.h / 2);
    }
    // Wrecked cars: rusted shells seen from above.
    for (const w of m.wrecks) {
      const g = new Graphics();
      this.shadowRect(g, w.x, w.y, w.w, w.h, 14);
      g.roundRect(w.x, w.y, w.w, w.h, 14).fill({ color: 0x3e2c22 });
      g.roundRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6, 12).stroke({ width: 2, color: 0x5a4030, alpha: 0.8 });
      const horizontal = w.w > w.h;
      if (horizontal) {
        g.roundRect(w.x + w.w * 0.3, w.y + 8, w.w * 0.4, w.h - 16, 6).fill({ color: 0x1a2224 });
        g.roundRect(w.x + w.w * 0.32, w.y + 10, w.w * 0.12, w.h - 20, 4).fill({ color: 0x3a4a4c, alpha: 0.5 });
      } else {
        g.roundRect(w.x + 8, w.y + w.h * 0.3, w.w - 16, w.h * 0.4, 6).fill({ color: 0x1a2224 });
      }
      g.circle(w.x + w.w * 0.72, w.y + w.h * 0.5, 9).fill({ color: 0x5a3a24, alpha: 0.6 });
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

  /**
   * Walls in three passes so they read as solid blocks seen from above: a soft cast shadow,
   * the dark side face, then the lit top face raised a few units up-left. Windows are panes
   * of dirty glass in a frame: you can see (and shine a light) through them.
   */
  private buildWalls(): Container {
    const c = new Container();
    const shadow = new Graphics();
    const body = new Graphics();
    const walls = this.map.walls.filter((w) => (WALLS[w.kind]?.[0] ?? 0) > 0);
    for (const w of walls) {
      const [width, , , , h] = WALLS[w.kind]!;
      const k = h / 7;
      for (const [grow, a] of [
        [16, 0.1],
        [8, 0.16],
        [2, 0.26],
      ] as const) {
        shadow.moveTo(w.ax + SHADOW.x * k, w.ay + SHADOW.y * k).lineTo(w.bx + SHADOW.x * k, w.by + SHADOW.y * k).stroke({ width: width + grow, color: 0x000000, alpha: a, cap: 'round' });
      }
    }
    for (const pass of [0, 1, 2] as const) {
      for (const w of walls) {
        const [width, side, top, hi, h] = WALLS[w.kind]!;
        const cap = w.kind === 'fence' || w.kind === 'yard' ? 'butt' : 'square';
        const ox = -h * 0.35;
        const oy = -h * 0.6;
        if (pass === 0) body.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width, color: side, cap });
        else if (pass === 1) body.moveTo(w.ax + ox, w.ay + oy).lineTo(w.bx + ox, w.by + oy).stroke({ width: width * 0.9, color: top, cap });
        else if (width > 6) body.moveTo(w.ax + ox - 1, w.ay + oy - 1).lineTo(w.bx + ox - 1, w.by + oy - 1).stroke({ width: width * 0.22, color: hi, cap, alpha: 0.7 });
      }
    }
    // Fence posts.
    for (const w of this.map.walls) {
      if (w.kind !== 'fence' && w.kind !== 'yard') continue;
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      for (let t = 0; t <= len; t += 40) {
        const x = w.ax + ((w.bx - w.ax) * t) / len;
        const y = w.ay + ((w.by - w.ay) * t) / len;
        shadow.rect(x - 3 + SHADOW.x * 0.5, y - 3 + SHADOW.y * 0.5, 6, 6).fill({ color: 0x000000, alpha: 0.3 });
        body.rect(x - 3.5, y - 5, 7, 7).fill({ color: w.kind === 'yard' ? 0x5a5e60 : 0x3a2e22 });
      }
    }
    // Windows: a frame on each end and a pane of grimy glass.
    for (const w of this.map.walls) {
      if (w.kind !== 'window') continue;
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay) || 1;
      const ux = (w.bx - w.ax) / len;
      const uy = (w.by - w.ay) / len;
      body.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width: 7, color: 0x1a1c1c, alpha: 0.9 });
      body.moveTo(w.ax, w.ay).lineTo(w.bx, w.by).stroke({ width: 4, color: 0x7a9094, alpha: 0.35 });
      body.moveTo(w.ax + ux * len * 0.15 - uy * 1, w.ay + uy * len * 0.15 + ux * 1).lineTo(w.ax + ux * len * 0.45, w.ay + uy * len * 0.45).stroke({ width: 1.2, color: 0xc8d8da, alpha: 0.35 });
      body.rect(w.ax + ux * len * 0.5 - 2.5, w.ay + uy * len * 0.5 - 2.5, 5, 5).fill({ color: 0x2a2620 });
      for (const [x, y] of [
        [w.ax, w.ay],
        [w.bx, w.by],
      ]) {
        body.rect(x - 5, y - 5, 10, 10).fill({ color: 0x2a2620 });
      }
    }
    c.addChild(shadow, body);
    return c;
  }

  private buildDynamicProps(props: Container): Sprite {
    const m = this.map;
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
      this.doors.push({ sprite: s, closed: d.angle, open, k, target: k, broken: false });
    }
    const gate = this.sprite('obj.gate', 0, m.gate.x, m.gate.y, m.gate.length / 150, m.gate.angle);
    props.addChild(gate);
    return gate;
  }

  private buildHighProps(): void {
    const m = this.map;
    // Canopies seen from straight above: no trunks, just the crown and its shadow.
    for (const t of m.trees) {
      const id = t.kind === 'pine' ? 'tree.pine' : t.kind === 'oak' ? 'tree.oak' : 'tree.dead';
      const crown = t.kind === 'pine' ? 3.4 : t.kind === 'oak' ? 3.8 : 3.2;
      // Not rotated, so the baked shadow always falls down and to the right.
      const s = this.sprite(id, t.variant, t.x, t.y, (t.r * crown) / CANOPY_PX);
      if ((Math.floor(t.x * 7 + t.y * 3) & 1) === 1) s.scale.y *= -1;
      this.high.add(s, t.x, t.y);
    }
    for (const r of m.rocks) this.high.add(this.sprite('prop.boulder', r.variant, r.x, r.y, r.r / 38), r.x, r.y);
    m.lights.forEach((l, i) => {
      const id = l.kind === 'campfire' ? 'obj.campfire' : 'obj.lamp';
      this.high.add(this.sprite(id, 0, l.x, l.y), l.x, l.y);
      const glow = this.sprite('fx.glow', 0, l.x, l.y, (l.radius * 1.1) / 128);
      glow.tint = l.kind === 'campfire' ? 0xd07030 : 0xd8b070;
      glow.blendMode = 'add';
      glow.alpha = 0.18;
      this.high.add(glow, l.x, l.y);
      this.glows.push({ sprite: glow, index: i, kind: l.kind, base: 0.18 });
    });
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

  /** Opens or closes a door; a smashed door is left as a splintered stub with debris. */
  setDoor(id: number, open: boolean, broken = false): void {
    const d = this.doors[id];
    if (!d) return;
    d.target = open ? 1 : 0;
    if (broken && !d.broken) {
      d.broken = true;
      d.sprite.scale.x *= 0.35;
      d.sprite.tint = 0x8a7a6a;
      const def = this.map.doors[id];
      const cx = def.hx + Math.cos(def.angle) * def.length * 0.5;
      const cy = def.hy + Math.sin(def.angle) * def.length * 0.5;
      for (let i = 0; i < 9; i++) {
        const a = def.angle + i * 1.9;
        const r = 8 + ((i * 13) % 24);
        this.debris
          .rect(cx + Math.cos(a) * r - 7, cy + Math.sin(a) * r - 2, 10 + (i % 3) * 4, 3)
          .fill({ color: i % 2 ? 0x4a3a2a : 0x2e241a });
      }
    }
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
