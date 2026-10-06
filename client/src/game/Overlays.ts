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
  who: number;
}

interface Wave {
  x: number;
  y: number;
  a: number;
  born: number;
}

const SCENT_LIFE = BALANCE.trails.maxAgeSec * 1000;

/**
 * Supernatural senses drawn above the vision filter (so they show in the dark): the
 * Soundcloud Burst wave racing across the map, breathing ripples and teammate stake auras.
 * The red scent trail (Zach; survivors see their own in testing mode) and blood decals are
 * subject to vision: the scent only shows where his light falls.
 */
export class Overlays {
  readonly senses = new Container();
  readonly decals = new Container();
  /** The scent trail: goes on the entity layer, hidden outside the viewer's light. */
  readonly scentRoot = new Container();
  private readonly scentLayer = new Container();
  private readonly g = new Graphics();
  /** The scent: glowing red ribbons, drawn fresh each frame. */
  private readonly aurora = new Graphics();
  private readonly rings = new Graphics();
  private scent: ScentMark[] = [];
  private readonly scentSprites: Sprite[] = [];
  private breaths: Mark[] = [];
  private bursts: Wave[] = [];
  /** Penjamin clouds (drawn above the vision mask: Zach sees the gas run to the edge of his screen). */
  private readonly vapeG = new Graphics();
  /** Where teammates' torches point, for downed and staked survivors. */
  private readonly coneG = new Graphics();
  private readonly snipeG = new Graphics();
  private snipes: { x: number; y: number; a: number; born: number }[] = [];
  private readonly vapeLayer = new Container();
  private readonly vapeSprites: Sprite[] = [];
  private vapes: { x: number; y: number; a: number; r: number; born: number; nic: boolean }[] = [];

  constructor(
    private readonly assets: AssetManager,
    private readonly mapW = 6000,
    private readonly mapH = 6000,
  ) {
    this.rings.blendMode = 'add';
    this.aurora.blendMode = 'add';
    this.scentRoot.addChild(this.aurora, this.scentLayer);
    this.snipeG.blendMode = 'add';
    this.senses.addChild(this.coneG, this.snipeG, this.vapeLayer, this.vapeG, this.g, this.rings);
  }

  /** Teammates' flashlight cones (wall-clipped polygons, origin first): a soft glow, strongest near the torch. Empty clears. */
  setAllyCones(polys: number[][]): void {
    const g = this.coneG;
    g.clear();
    const A = BALANCE.survivor.allyLight.coneAlpha;
    for (const poly of polys) {
      if (poly.length < 6) continue;
      g.poly(poly).fill({ color: 0xffe9b0, alpha: A });
      const ox = poly[0];
      const oy = poly[1];
      for (const k of [0.6, 0.3]) {
        const inner: number[] = [];
        for (let i = 0; i < poly.length; i += 2) inner.push(ox + (poly[i] - ox) * k, oy + (poly[i + 1] - oy) * k);
        g.poly(inner).fill({ color: 0xffe9b0, alpha: A * 0.7 });
      }
    }
  }

  /** A 0.50 cal round: a bright streak flying out along `a` at the bullet's speed. */
  addSnipe(x: number, y: number, a: number, now: number): void {
    this.snipes.push({ x, y, a, born: now });
  }

  private drawSnipes(now: number): void {
    const g = this.snipeG;
    g.clear();
    const speed = BALANCE.items.sniper.speed;
    this.snipes = this.snipes.filter((s) => (now - s.born) / 1000 * speed < 9000);
    for (const s of this.snipes) {
      const front = ((now - s.born) / 1000) * speed;
      const tail = Math.max(0, front - 380);
      const dx = Math.cos(s.a);
      const dy = Math.sin(s.a);
      g.moveTo(s.x + dx * tail, s.y + dy * tail).lineTo(s.x + dx * front, s.y + dy * front).stroke({ width: 5, color: 0xff6a4a, alpha: 0.25, cap: 'round' });
      g.moveTo(s.x + dx * tail, s.y + dy * tail).lineTo(s.x + dx * front, s.y + dy * front).stroke({ width: 1.6, color: 0xfff2d0, alpha: 0.95, cap: 'round' });
    }
  }

  /** Penjamin: a cone of vape gas from (x,y) along `a`, reaching `r`. */
  addVape(x: number, y: number, a: number, r: number, now: number, nic = false): void {
    this.vapes.push({ x, y, a, r, born: now, nic });
  }

  /**
   * Penjamin's gas, built like the galaxy gas: soft lumpy puffs (the shared `fx.puff`
   * texture) billowing out along a narrow cone, each one swelling as the front reaches it,
   * curling and drifting on, bigger and thinner the farther out it is, with a warm glow layer
   * on top and a faint shimmer of droplets. It rolls out in 0.6 s, hangs, then fades away.
   */
  private drawVapes(now: number): void {
    const V = BALANCE.hunter.vape;
    const g = this.vapeG;
    g.clear();
    const life = (V.growTime + V.lingerTime + V.fadeTime) * 1000;
    this.vapes = this.vapes.filter((v) => now - v.born < life);
    const half = (V.halfAngleDeg * Math.PI) / 180;
    let used = 0;
    const puff = (variant: number, glow: boolean): Sprite => {
      let sp = this.vapeSprites[used];
      if (!sp) {
        sp = new Sprite(this.assets.getTexture('fx.puff', used % 3));
        sp.anchor.set(0.5);
        this.vapeSprites.push(sp);
        this.vapeLayer.addChild(sp);
      }
      used++;
      sp.texture = this.assets.getTexture('fx.puff', variant % 3);
      sp.blendMode = glow ? 'add' : 'normal';
      sp.visible = true;
      return sp;
    };
    for (const v of this.vapes) {
      const age = (now - v.born) / 1000;
      const k = Math.min(1, age / V.growTime);
      const ext = v.r * (1 - (1 - k) * (1 - k));
      const fade = Math.max(0, Math.min(1, (V.growTime + V.lingerTime + V.fadeTime - age) / V.fadeTime));
      const dx = Math.cos(v.a);
      const dy = Math.sin(v.a);
      // Puffs packed along the cone (more of them where it's wider).
      const n = Math.ceil(v.r / 16);
      for (let i = 0; i < n; i++) {
        const h1 = Math.sin(i * 12.9898 + v.born * 0.0013) * 43758.5453;
        const r1 = h1 - Math.floor(h1);
        const h2 = Math.sin(i * 78.233 + v.born * 0.0007) * 12345.6789;
        const r2 = h2 - Math.floor(h2);
        const u = Math.pow((i + r1 * 0.8) / n, 0.9);
        const base = u * v.r;
        if (base > ext) continue;
        // When the front passed this spot: the puff swells from there.
        const reached = V.growTime * (1 - Math.sqrt(Math.max(0, 1 - base / v.r)));
        const since = Math.max(0, age - reached);
        const grow = 1 - Math.exp(-since * 5);
        // It keeps rolling outward a little and curls side to side.
        const d = base + since * (14 + 18 * u);
        const width = Math.tan(half) * Math.max(d, 30);
        const side = (r2 * 2 - 1) * width * 0.7 + Math.sin(age * (0.8 + r1) + i * 1.9) * width * 0.22;
        const px = v.x + dx * d - dy * side;
        const py = v.y + dy * d + dx * side;
        const falloff = 1 - 0.7 * u;
        const size = ((14 + width * 0.9) / 48) * (0.55 + 0.45 * grow) * (1 + since * 0.05);
        const body = puff(i, false);
        body.position.set(px, py);
        body.scale.set(size);
        body.rotation = r1 * 6.28 + age * (r2 - 0.5) * 0.8;
        body.tint = v.nic ? (i % 4 === 0 ? 0xa6dcff : i % 3 === 0 ? 0x4a9ae0 : 0x72bcf0) : i % 4 === 0 ? 0xf2e6a0 : i % 3 === 0 ? 0xc8b040 : 0xdccb5a;
        body.alpha = 0.34 * falloff * fade * (0.4 + 0.6 * grow);
        if (i % 2 === 0) {
          const glow = puff(i + 1, true);
          glow.position.set(px + Math.sin(age * 1.7 + i) * 4, py + Math.cos(age * 1.3 + i) * 4);
          glow.scale.set(size * 0.7);
          glow.rotation = -body.rotation;
          glow.tint = v.nic ? 0xb8e6ff : 0xfff0a0;
          glow.alpha = 0.16 * falloff * fade * grow;
        }
      }
      // A faint shimmer of droplets catching the light.
      for (let i = 0; i < Math.ceil(v.r / 40); i++) {
        const h = Math.sin(i * 43.17 + v.born * 0.002) * 9631.7;
        const r = h - Math.floor(h);
        const d = ((i + 0.5) / Math.ceil(v.r / 40)) * v.r + age * 20;
        if (d > ext) continue;
        const side = (r * 2 - 1) * Math.tan(half) * d * 0.8;
        const tw = 0.5 + 0.5 * Math.sin(age * 6 + i * 2.3);
        g.circle(v.x + dx * d - dy * side, v.y + dy * d + dx * side, 1.2 + r).fill({ color: v.nic ? 0xd8f0ff : 0xfffbd0, alpha: 0.5 * tw * fade * (1 - d / v.r) });
      }
    }
    for (let i = used; i < this.vapeSprites.length; i++) this.vapeSprites[i].visible = false;
  }

  /** New scent points: x, y, kind (0 scent, 1 blood), age in tenths of a second, owner. */
  addScent(pts: number[], now: number): void {
    for (let i = 0; i + 4 < pts.length; i += 5) {
      this.scent.push({ x: pts[i], y: pts[i + 1], kind: pts[i + 2], born: now - pts[i + 3] * 100, who: pts[i + 4], seed: (pts[i] * 13 + pts[i + 1] * 7) % 997 });
    }
    if (this.scent.length > 1600) this.scent.splice(0, this.scent.length - 1600);
  }

  /**
   * Scent as wisps of smoke: each person's points join into one smooth trail of thin curling
   * strands in a faint haze, thinning unevenly and fading out from its old end.
   */
  private drawAurora(now: number, view: { x: number; y: number; w: number; h: number }): void {
    const g = this.aurora;
    g.clear();
    const byWho = new Map<number, ScentMark[]>();
    for (const s of this.scent) {
      if (s.kind !== 0) continue;
      let list = byWho.get(s.who);
      if (!list) byWho.set(s.who, (list = []));
      list.push(s);
    }
    const m = 200;
    for (const [who, list] of byWho) {
      list.sort((a, b) => a.born - b.born);
      // Split into runs where the trail really breaks (they stopped sprinting for a while).
      let run: ScentMark[] = [];
      const runs: ScentMark[][] = [run];
      for (let i = 0; i < list.length; i++) {
        const prev = list[i - 1];
        if (prev && (list[i].born - prev.born > 700 || Math.hypot(list[i].x - prev.x, list[i].y - prev.y) > 160)) runs.push((run = []));
        run.push(list[i]);
      }
      for (const r of runs) {
        if (r.length < 2) continue;
        if (!r.some((s) => s.x > view.x - m && s.y > view.y - m && s.x < view.x + view.w + m && s.y < view.y + view.h + m)) continue;
        // Catmull-Rom through the points, sampled finely.
        const pts: { x: number; y: number; nx: number; ny: number; a: number; d: number }[] = [];
        let dist = 0;
        for (let i = 0; i < r.length - 1; i++) {
          const p0 = r[Math.max(0, i - 1)];
          const p1 = r[i];
          const p2 = r[i + 1];
          const p3 = r[Math.min(r.length - 1, i + 2)];
          for (let k = 0; k < 4; k++) {
            const u = k / 4;
            const u2 = u * u;
            const u3 = u2 * u;
            const cr = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
            const x = cr(p0.x, p1.x, p2.x, p3.x);
            const y = cr(p0.y, p1.y, p2.y, p3.y);
            const age = (now - (p1.born + (p2.born - p1.born) * u)) / SCENT_LIFE;
            const last = pts[pts.length - 1];
            if (last) dist += Math.hypot(x - last.x, y - last.y);
            pts.push({ x, y, nx: 0, ny: 0, a: Math.max(0, 1 - age), d: dist });
          }
        }
        const endP = r[r.length - 1];
        pts.push({ x: endP.x, y: endP.y, nx: 0, ny: 0, a: Math.max(0, 1 - (now - endP.born) / SCENT_LIFE), d: dist + 1 });
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          pts[i].nx = -(b.y - a.y) / l;
          pts[i].ny = (b.x - a.x) / l;
        }
        // Wisps of smoke: several thin strands that braid, drift apart and thin out in patches,
        // wrapped in a soft haze. Shapes depend only on distance along the trail, so they hold still.
        const STRANDS = 6;
        for (let sIdx = 0; sIdx < STRANDS; sIdx++) {
          const ph = who * 3.1 + sIdx * 1.93;
          const spread = 5 + sIdx * 2.2;
          const at = (p: (typeof pts)[number]): [number, number] => {
            const swell = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.d * 0.0065 + ph * 1.7));
            const off = swell * spread * Math.sin(p.d * (0.021 + sIdx * 0.004) + ph) + 3 * Math.sin(p.d * 0.057 + ph * 2.1);
            return [p.x + p.nx * off, p.y + p.ny * off];
          };
          for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i];
            const q = pts[i + 1];
            // Each strand thins in and out so the trail looks broken into curling wisps.
            const patch = Math.max(0, Math.sin(p.d * 0.012 + ph * 2.7) * 0.9 + Math.sin(p.d * 0.031 + ph) * 0.4);
            const alpha = Math.pow(Math.min(p.a, q.a), 1.1) * patch;
            if (alpha < 0.03) continue;
            const [x1, y1] = at(p);
            const [x2, y2] = at(q);
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 9 + sIdx, color: 0xb01020, alpha: 0.06 * alpha, cap: 'round' });
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 3.2, color: 0xe0202e, alpha: 0.16 * alpha, cap: 'round' });
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 1.1, color: 0xff5a5a, alpha: 0.5 * alpha, cap: 'round' });
          }
        }
      }
    }
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

    this.drawVapes(now);
    this.drawSnipes(now);

    // Scent: smoke wisps. Blood: red puffs that swell, drift and slowly fade away.
    this.scent = this.scent.filter((s) => now - s.born < SCENT_LIFE);
    this.drawAurora(now, view);
    const blood = this.scent.filter((s) => s.kind === 1);
    while (this.scentSprites.length < blood.length) {
      const sp = new Sprite(this.assets.getTexture('fx.puff', this.scentSprites.length % 3));
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      this.scentLayer.addChild(sp);
      this.scentSprites.push(sp);
    }
    const margin = 120;
    this.scentSprites.forEach((sp, i) => {
      const s = blood[i];
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
