import { Rng } from '@manhunt/shared';
import { noise1D, tileFbm } from './noise';

/**
 * Procedural texture generators. Each returns a canvas. The look is a bright, saturated
 * comic-book style: flat cel-shaded colours, a highlight tone and a thin dark outline.
 * Characters are drawn top-down facing +x (right); trees and props are drawn from above
 * with a hint of their side so they read at a glance. Darkness comes from the vision shader.
 */

export type CanvasGen = (variant: number) => HTMLCanvasElement;

/** Outline colour and width used by every sprite (thin, but always visible). */
const INK = 'rgba(24,16,36,0.95)';
const INK_W = 1.6;

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

type RGB = readonly [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A colour lightened (t > 0) or darkened (t < 0). */
function shade(hex: string, t: number): string {
  const c = hexRgb(hex);
  const target: RGB = t >= 0 ? [255, 255, 255] : [16, 10, 30];
  const m = mix(c, target, Math.abs(t));
  return rgb(m[0], m[1], m[2]);
}

function ink(ctx: CanvasRenderingContext2D, w = INK_W): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Fills the current path, then outlines it. */
function fillInk(ctx: CanvasRenderingContext2D, fill: string, w = INK_W): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ink(ctx, w);
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** An irregular blob path (leaf clumps, rocks). */
function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: (t: number) => number, bumps: number, amp: number, seed = 0): void {
  ctx.beginPath();
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 - amp + amp * 2 * n(seed + (i / steps) * bumps));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Soft drop shadow ellipse. */
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.35): void {
  ctx.fillStyle = `rgba(10,6,24,${a})`;
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
}

/** Fills a tile from a noise field mapped between two colours, with extra grain. */
function noiseTile(size: number, period: number, seed: number, dark: RGB, light: RGB, grain = 10): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [c, ctx] = canvas(size);
  const n = tileFbm(size, period, 4, seed);
  const img = ctx.createImageData(size, size);
  const rng = new Rng(seed ^ 0xabcdef);
  for (let i = 0; i < n.length; i++) {
    // Posterise a little for the flat, painted look.
    const t = Math.round(n[i] * 6) / 6;
    const col = mix(dark, light, t);
    const g = (rng.next() - 0.5) * grain;
    img.data[i * 4] = col[0] + g;
    img.data[i * 4 + 1] = col[1] + g;
    img.data[i * 4 + 2] = col[2] + g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return [c, ctx];
}

/** Draws something at (x,y) and at its wrapped copies so a tile stays seamless. */
function wrapDraw(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      draw(px, py);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------------------

export const groundForest: CanvasGen = () => {
  const size = 512;
  const [c, ctx] = noiseTile(size, 6, 11, [54, 112, 46], [92, 158, 64], 10);
  const rng = new Rng(77);
  // Darker moss hollows.
  const moss = tileFbm(size, 4, 3, 99);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < moss.length; i++) {
    const m = Math.max(0, moss[i] - 0.58) * 2.2;
    img.data[i * 4] = img.data[i * 4] * (1 - m) + 36 * m;
    img.data[i * 4 + 1] = img.data[i * 4 + 1] * (1 - m) + 88 * m;
    img.data[i * 4 + 2] = img.data[i * 4 + 2] * (1 - m) + 52 * m;
  }
  ctx.putImageData(img, 0, 0);
  // Leaf litter.
  const leaves = ['#c9782f', '#e0a33d', '#a8522a', '#7aa33a'];
  for (let i = 0; i < 420; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(2.5, 5);
    ctx.fillStyle = leaves[rng.int(0, leaves.length - 1)];
    wrapDraw(size, x, y, 8, (px, py) => {
      ellipse(ctx, px, py, l, l * 0.5, a);
      ctx.fill();
    });
  }
  // Grass tufts.
  for (let i = 0; i < 700; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.strokeStyle = rng.chance(0.5) ? '#8fcf55' : '#6fb048';
    ctx.lineWidth = 1.3;
    wrapDraw(size, x, y, 6, (px, py) => {
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + rng.range(-0.8, 0.8);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * 5.5, py + Math.sin(a) * 5.5);
        ctx.stroke();
      }
    });
  }
  // A few wildflowers.
  const petals = ['#ffd84a', '#ff7ab8', '#ffffff', '#9f8bff'];
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const col = petals[rng.int(0, petals.length - 1)];
    wrapDraw(size, x, y, 5, (px, py) => {
      ctx.fillStyle = col;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        circle(ctx, px + Math.cos(a) * 1.8, py + Math.sin(a) * 1.8, 1.4);
        ctx.fill();
      }
      ctx.fillStyle = '#f7a12a';
      circle(ctx, px, py, 1.1);
      ctx.fill();
    });
  }
  return c;
};

export const groundPath: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 8, 21, [170, 118, 66], [214, 164, 102], 12);
  const rng = new Rng(5);
  for (let i = 0; i < 140; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(1.5, 3.5);
    const light = rng.chance(0.5);
    wrapDraw(size, x, y, 5, (px, py) => {
      circle(ctx, px, py, r);
      ctx.fillStyle = light ? '#e6c48e' : '#9c6a3c';
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(70,40,20,0.6)';
      ctx.stroke();
    });
  }
  return c;
};

export const groundConcrete: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 8, 31, [138, 142, 152], [176, 180, 190], 8);
  const stains = tileFbm(size, 4, 3, 32);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < stains.length; i++) {
    const s = Math.max(0, stains[i] - 0.55) * 1.4;
    img.data[i * 4] *= 1 - s * 0.35;
    img.data[i * 4 + 1] *= 1 - s * 0.35;
    img.data[i * 4 + 2] *= 1 - s * 0.3;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(70,72,84,0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  // Hazard paint stripe fragments.
  const rng = new Rng(8);
  ctx.strokeStyle = 'rgba(80,80,92,0.5)';
  for (let i = 0; i < 5; i++) {
    let x = rng.range(10, size - 10);
    let y = rng.range(10, size - 10);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += rng.range(-14, 14);
      y += rng.range(-14, 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
};

export const groundWood: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 16, 41, [156, 94, 48], [204, 136, 74], 8);
  const plank = 32;
  for (let y = 0; y < size; y += plank) {
    ctx.fillStyle = 'rgba(70,34,14,0.85)';
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = 'rgba(255,220,170,0.25)';
    ctx.fillRect(0, y + 2, size, 1);
    const off = ((y / plank) % 2) * 96;
    ctx.fillStyle = 'rgba(70,34,14,0.85)';
    ctx.fillRect((off + 60) % size, y, 2, plank);
    ctx.fillRect((off + 188) % size, y, 2, plank);
  }
  const rng = new Rng(3);
  ctx.strokeStyle = 'rgba(110,56,24,0.45)';
  for (let i = 0; i < 70; i++) {
    const y = rng.range(0, size);
    const x = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(20, 60), y + rng.range(-1, 1));
    ctx.stroke();
  }
  return c;
};

export const groundWater: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 4, 51, [28, 100, 178], [64, 158, 228], 5);
  const rng = new Rng(6);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 34; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const w = rng.range(8, 22);
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.5)' : 'rgba(170,230,255,0.45)';
    wrapDraw(size, x, y, 30, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px - w, py);
      ctx.quadraticCurveTo(px - w / 2, py - 3, px, py);
      ctx.quadraticCurveTo(px + w / 2, py + 3, px + w, py);
      ctx.stroke();
    });
  }
  return c;
};

// ---------------------------------------------------------------------------------------
// Vegetation and rocks
// ---------------------------------------------------------------------------------------

export const tallGrass: CanvasGen = (variant) => {
  const size = 128;
  const [c, ctx] = canvas(size);
  const rng = new Rng(600 + variant);
  shadow(ctx, 66, 68, 50, 44, 0.25);
  const greens = ['#4f9e3a', '#67b845', '#86cc52', '#a3db62'];
  for (let i = 0; i < 230; i++) {
    const x = rng.range(14, size - 14);
    const y = rng.range(14, size - 14);
    if (Math.hypot(x - size / 2, y - size / 2) > size / 2 - 10) continue;
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(8, 18);
    ctx.strokeStyle = greens[rng.int(0, greens.length - 1)];
    ctx.lineWidth = rng.range(1.4, 2.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return c;
};

const LEAF_PALETTES: [string, string, string][] = [
  ['#2f7d3a', '#44a34a', '#7ed05c'],
  ['#2c7a4a', '#3f9e5c', '#78d17a'],
  ['#3a8a2e', '#5bb03a', '#a4dd55'],
  ['#2a6e44', '#3c9458', '#6fcf80'],
];

/** Pine seen from above: stacked, star-shaped tiers of needles around a visible trunk. */
export const treePine: CanvasGen = (variant) => {
  const W = 170;
  const Hh = 190;
  const [c, ctx] = canvas(W, Hh);
  const rng = new Rng(100 + variant);
  const pal = LEAF_PALETTES[variant % LEAF_PALETTES.length];
  const cx = W / 2;
  const base = 150; // trunk base (anchor)
  shadow(ctx, cx + 16, base - 22, 64, 40, 0.3);
  // Trunk and roots peeking out below the lowest tier.
  ctx.fillStyle = '#7a4a26';
  for (const [dx, a] of [
    [-10, 2.6],
    [10, 0.5],
    [0, 1.6],
  ] as const) {
    ellipse(ctx, cx + dx * 0.6, base + 2, 7, 3.5, a);
    fillInk(ctx, '#6b3f20');
  }
  roundRect(ctx, cx - 7, base - 34, 14, 36, 4);
  fillInk(ctx, '#8a552c');
  ctx.fillStyle = '#b07440';
  ctx.fillRect(cx - 4, base - 32, 3, 30);
  // Tiers, largest at the bottom, lighter toward the top.
  const tiers = [
    { y: base - 50, r: 70, pts: 11 },
    { y: base - 76, r: 56, pts: 10 },
    { y: base - 100, r: 42, pts: 9 },
    { y: base - 120, r: 27, pts: 7 },
  ];
  tiers.forEach((t, i) => {
    const n = noise1D(variant * 31 + i * 7);
    const star = (r: number, oy: number): void => {
      ctx.beginPath();
      for (let k = 0; k <= t.pts * 2; k++) {
        const a = (k / (t.pts * 2)) * Math.PI * 2 + i * 0.35;
        const rr = k % 2 === 0 ? r * (0.9 + n(k * 0.7) * 0.18) : r * 0.64;
        const x = cx + Math.cos(a) * rr;
        const y = t.y + oy + Math.sin(a) * rr * 0.72;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    star(t.r, 0);
    fillInk(ctx, i === 0 ? shade(pal[0], -0.15) : pal[0]);
    // Lit upper-left half.
    ctx.save();
    star(t.r, 0);
    ctx.clip();
    ctx.fillStyle = pal[1];
    ellipse(ctx, cx - t.r * 0.25, t.y - t.r * 0.28, t.r * 0.8, t.r * 0.55);
    ctx.fill();
    ctx.fillStyle = pal[2];
    ellipse(ctx, cx - t.r * 0.4, t.y - t.r * 0.42, t.r * 0.36, t.r * 0.2, -0.3);
    ctx.fill();
    // Needle strokes.
    ctx.strokeStyle = shade(pal[0], -0.3);
    ctx.lineWidth = 1;
    for (let k = 0; k < 18; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r0 = rng.range(t.r * 0.25, t.r * 0.85);
      const x = cx + Math.cos(a) * r0;
      const y = t.y + Math.sin(a) * r0 * 0.72;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 3.6);
      ctx.stroke();
    }
    ctx.restore();
  });
  // Tip.
  circle(ctx, cx - 2, base - 128, 4);
  fillInk(ctx, pal[2], 1.2);
  return c;
};

/** Broadleaf tree: a rounded canopy of leaf clumps above a short trunk and roots. */
export const treeOak: CanvasGen = (variant) => {
  const W = 180;
  const Hh = 190;
  const [c, ctx] = canvas(W, Hh);
  const rng = new Rng(150 + variant);
  const pal = LEAF_PALETTES[(variant + 2) % LEAF_PALETTES.length];
  const cx = W / 2;
  const base = 150;
  shadow(ctx, cx + 18, base - 26, 70, 44, 0.3);
  // Trunk with two forks and roots.
  for (const [dx, a] of [
    [-12, 2.8],
    [12, 0.3],
  ] as const) {
    ellipse(ctx, cx + dx * 0.7, base + 1, 8, 3.5, a);
    fillInk(ctx, '#6a3e1e');
  }
  ctx.beginPath();
  ctx.moveTo(cx - 9, base);
  ctx.lineTo(cx - 7, base - 40);
  ctx.lineTo(cx - 16, base - 58);
  ctx.lineTo(cx - 9, base - 60);
  ctx.lineTo(cx, base - 46);
  ctx.lineTo(cx + 10, base - 62);
  ctx.lineTo(cx + 16, base - 58);
  ctx.lineTo(cx + 7, base - 40);
  ctx.lineTo(cx + 9, base);
  ctx.closePath();
  fillInk(ctx, '#8d5a30');
  ctx.fillStyle = '#b37a46';
  ctx.fillRect(cx - 5, base - 38, 3, 36);
  // Canopy: overlapping clumps; one silhouette pass, then shading.
  const clumps: [number, number, number][] = [];
  const cy = base - 88;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + variant;
    const d = i === 0 ? 0 : rng.range(26, 40);
    clumps.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.78, rng.range(26, 34)]);
  }
  clumps.push([cx, cy, 40]);
  const path = (grow: number): void => {
    ctx.beginPath();
    for (const [x, y, r] of clumps) {
      ctx.moveTo(x + r + grow, y);
      ctx.arc(x, y, r + grow, 0, Math.PI * 2);
    }
  };
  path(1.2);
  ctx.fillStyle = INK;
  ctx.fill();
  path(0);
  ctx.fillStyle = pal[0];
  ctx.fill();
  // Each clump gets a lit cap toward the upper-left.
  for (const [x, y, r] of clumps) {
    ctx.fillStyle = pal[1];
    ellipse(ctx, x - r * 0.2, y - r * 0.22, r * 0.75, r * 0.62);
    ctx.fill();
  }
  for (const [x, y, r] of clumps) {
    ctx.fillStyle = pal[2];
    ellipse(ctx, x - r * 0.38, y - r * 0.4, r * 0.32, r * 0.2, -0.4);
    ctx.fill();
  }
  // Leaf flecks and inner shadows between clumps.
  ctx.strokeStyle = shade(pal[0], -0.35);
  ctx.lineWidth = 1.1;
  for (const [x, y, r] of clumps) {
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, r * 0.85, 0.2, 1.4);
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 60);
    ctx.fillStyle = rng.chance(0.5) ? shade(pal[2], 0.25) : shade(pal[0], -0.2);
    ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.78, 2.4, 1.3, a);
    ctx.fill();
  }
  // A few fruit or blossoms on some variants.
  if (variant % 2 === 1) {
    for (let i = 0; i < 7; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(10, 55);
      circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.78, 2.6);
      fillInk(ctx, variant % 4 === 1 ? '#ff5a4a' : '#ffd54a', 1);
    }
  }
  return c;
};

/** Dead tree: a gnarled trunk whose bare branches spread out from above. */
export const treeDead: CanvasGen = (variant) => {
  const W = 150;
  const Hh = 170;
  const [c, ctx] = canvas(W, Hh);
  const rng = new Rng(200 + variant);
  const cx = W / 2;
  const base = 140;
  shadow(ctx, cx + 12, base - 18, 46, 26, 0.25);
  const segs: [number, number, number, number, number][] = [];
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    if (depth === 0 || len < 5) return;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len * 0.8;
    segs.push([x, y, ex, ey, w]);
    const kids = rng.int(1, 3);
    for (let k = 0; k < kids; k++) branch(ex, ey, a + rng.range(-0.7, 0.7), len * rng.range(0.55, 0.75), w * 0.62, depth - 1);
  };
  // Trunk goes up; branches fan out from its top.
  const topY = base - 60;
  segs.push([cx, base, cx + rng.range(-4, 4), topY, 12]);
  const count = rng.int(4, 6);
  for (let i = 0; i < count; i++) branch(cx, topY, -Math.PI / 2 + ((i / (count - 1)) - 0.5) * 2.6 + rng.range(-0.2, 0.2), rng.range(22, 34), 7, 4);
  const stroke = (grow: number, color: string): void => {
    ctx.strokeStyle = color;
    for (const [x0, y0, x1, y1, w] of segs) {
      ctx.lineWidth = w + grow;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  };
  stroke(2.4, INK);
  stroke(0, '#8a7560');
  ctx.strokeStyle = '#b8a288';
  for (const [x0, y0, x1, y1, w] of segs) {
    if (w < 3) continue;
    ctx.lineWidth = w * 0.3;
    ctx.beginPath();
    ctx.moveTo(x0 - w * 0.2, y0);
    ctx.lineTo(x1 - w * 0.2, y1);
    ctx.stroke();
  }
  // Roots.
  for (const a of [2.7, 0.4, 1.6]) {
    ellipse(ctx, cx + Math.cos(a) * 8, base + 1, 7, 3, a);
    fillInk(ctx, '#7a6450');
  }
  return c;
};

export const boulder: CanvasGen = (variant) => {
  const size = 128;
  const [c, ctx] = canvas(size);
  const n = noise1D(300 + variant);
  const cx = size / 2;
  const cy = size / 2;
  shadow(ctx, cx + 8, cy + 10, 46, 38, 0.3);
  blob(ctx, cx, cy, 44, n, 6, 0.14);
  fillInk(ctx, '#7c8496', 2);
  ctx.save();
  blob(ctx, cx, cy, 44, n, 6, 0.14);
  ctx.clip();
  ctx.fillStyle = '#9aa3b6';
  blob(ctx, cx - 7, cy - 8, 36, n, 6, 0.14, 2);
  ctx.fill();
  ctx.fillStyle = '#c3cadb';
  ellipse(ctx, cx - 16, cy - 18, 14, 8, -0.5);
  ctx.fill();
  // Moss on the shaded side.
  const rng = new Rng(variant + 9);
  for (let i = 0; i < 8; i++) {
    circle(ctx, cx + rng.range(4, 30), cy + rng.range(6, 30), rng.range(3, 8));
    ctx.fillStyle = rng.chance(0.5) ? '#5caa42' : '#77c24e';
    ctx.fill();
  }
  // Cracks.
  ctx.strokeStyle = 'rgba(40,44,60,0.6)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 30);
  ctx.lineTo(cx - 2, cy - 12);
  ctx.lineTo(cx + 8, cy - 8);
  ctx.stroke();
  ctx.restore();
  return c;
};

export const logProp: CanvasGen = () => {
  const [c, ctx] = canvas(160, 48);
  shadow(ctx, 84, 30, 74, 14, 0.3);
  roundRect(ctx, 8, 9, 142, 28, 12);
  fillInk(ctx, '#8a5530');
  ctx.fillStyle = '#b3743e';
  ctx.fillRect(14, 12, 130, 8);
  ctx.strokeStyle = 'rgba(70,36,16,0.7)';
  ctx.lineWidth = 1.2;
  for (let x = 18; x < 142; x += 11) {
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.quadraticCurveTo(x + 4, 28, x + 2, 35);
    ctx.stroke();
  }
  ellipse(ctx, 149, 23, 6, 14);
  fillInk(ctx, '#e0b77a');
  ctx.strokeStyle = '#a0703c';
  ctx.lineWidth = 1;
  ellipse(ctx, 149, 23, 3, 8);
  ctx.stroke();
  // A mushroom or two.
  circle(ctx, 60, 10, 4);
  fillInk(ctx, '#ff5a4a', 1.2);
  ctx.fillStyle = '#fff';
  circle(ctx, 59, 9, 1);
  ctx.fill();
  return c;
};

export const bush: CanvasGen = (variant) => {
  const size = 96;
  const [c, ctx] = canvas(size);
  const rng = new Rng(400 + variant);
  const pal = LEAF_PALETTES[(variant + 1) % LEAF_PALETTES.length];
  shadow(ctx, 52, 54, 36, 30, 0.25);
  const clumps: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    clumps.push([48 + Math.cos(a) * 16, 48 + Math.sin(a) * 14, rng.range(13, 18)]);
  }
  clumps.push([48, 48, 18]);
  ctx.beginPath();
  for (const [x, y, r] of clumps) {
    ctx.moveTo(x + r + 1.2, y);
    ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
  }
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  for (const [x, y, r] of clumps) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = pal[0];
  ctx.fill();
  for (const [x, y, r] of clumps) {
    ctx.fillStyle = pal[1];
    ellipse(ctx, x - 3, y - 3, r * 0.7, r * 0.6);
    ctx.fill();
    ctx.fillStyle = pal[2];
    ellipse(ctx, x - 6, y - 6, r * 0.28, r * 0.18, -0.4);
    ctx.fill();
  }
  if (variant !== 1) {
    for (let i = 0; i < 6; i++) {
      circle(ctx, 48 + rng.range(-20, 20), 48 + rng.range(-18, 18), 2.4);
      fillInk(ctx, variant === 0 ? '#e0304a' : '#6a5cff', 1);
    }
  }
  return c;
};

// ---------------------------------------------------------------------------------------
// Characters (top-down, facing +x)
// ---------------------------------------------------------------------------------------

type HairStyle = 'short' | 'afro' | 'ponytail' | 'cap' | 'buzz' | 'long' | 'bun' | 'beanie' | 'mohawk' | 'curly';

interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  hat?: string;
  shirt: string;
  pants: string;
  shoes: string;
  /** Jacket over the shirt (drawn on the shoulders). */
  jacket?: string;
  backpack?: string;
}

/** Ten distinct survivor looks: one per lobby slot. */
export const SURVIVOR_LOOKS: readonly Look[] = [
  { skin: '#f2c5a0', hair: '#4a2a16', style: 'short', shirt: '#e8453c', pants: '#2f4a8a', shoes: '#f4f4f4', backpack: '#f2b632' },
  { skin: '#8d5a3b', hair: '#1a1210', style: 'afro', shirt: '#f2b632', pants: '#3a3a4a', shoes: '#e8453c' },
  { skin: '#f7d6bc', hair: '#f0c85a', style: 'ponytail', shirt: '#2fc0a8', pants: '#6a3fa8', shoes: '#ffffff' },
  { skin: '#c98f64', hair: '#5a2e14', style: 'cap', hat: '#2d6fe8', shirt: '#ffffff', pants: '#3c4a58', shoes: '#1f1f28', jacket: '#e84a8a' },
  { skin: '#5e3a28', hair: '#0e0a0a', style: 'buzz', shirt: '#8e4ae8', pants: '#2a2a32', shoes: '#f2b632' },
  { skin: '#f3c7a4', hair: '#c8401e', style: 'long', shirt: '#46b84e', pants: '#34507e', shoes: '#6a3a1e' },
  { skin: '#e2ad82', hair: '#26222a', style: 'bun', shirt: '#ff7a2f', pants: '#4a3326', shoes: '#2fc0a8' },
  { skin: '#9c6b46', hair: '#3a2a1a', style: 'beanie', hat: '#e0366a', shirt: '#2d9ae8', pants: '#2e2e3a', shoes: '#f4f4f4' },
  { skin: '#f6d8c2', hair: '#ff5fb0', style: 'mohawk', shirt: '#26262e', pants: '#3b5d96', shoes: '#e8453c', jacket: '#26262e' },
  { skin: '#b67a50', hair: '#4a2a14', style: 'curly', shirt: '#f0e05a', pants: '#6a3f25', shoes: '#2d6fe8', backpack: '#2fa860' },
];

const HUNTER_LOOK: Look = { skin: '#d9c9a8', hair: '#2a2420', style: 'short', shirt: '#3b3f2a', pants: '#23262e', shoes: '#1a1614', jacket: '#4a5236' };
const SEXTON_LOOK: Look = { skin: '#f4cfae', hair: '#f5d86a', style: 'short', shirt: '#2f86f0', pants: '#cdb57c', shoes: '#5a3a22' };

/** A leg + shoe, pointing +x from the hip (used in pairs for the walk cycle). */
function legCanvas(look: Look, scale = 1): HTMLCanvasElement {
  const [c, ctx] = canvas(Math.ceil(22 * scale), Math.ceil(12 * scale));
  ctx.scale(scale, scale);
  roundRect(ctx, 1.5, 2.5, 13, 7, 3.5);
  fillInk(ctx, look.pants, 1.3);
  ellipse(ctx, 15.5, 6, 5, 3.6);
  fillInk(ctx, look.shoes, 1.3);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ellipse(ctx, 16.5, 4.8, 2.2, 1.1);
  ctx.fill();
  return c;
}

function drawHair(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number, r: number): void {
  const h = look.hair;
  const clipHead = (): void => {
    circle(ctx, hx, hy, r);
  };
  switch (look.style) {
    case 'long':
      ellipse(ctx, hx - r * 0.7, hy, r * 1.05, r * 1.15);
      fillInk(ctx, h, 1.4);
      break;
    case 'ponytail':
      ellipse(ctx, hx - r * 1.35, hy + 1, r * 0.55, r * 0.35);
      fillInk(ctx, h, 1.3);
      break;
    case 'bun':
      circle(ctx, hx - r * 0.95, hy, r * 0.5);
      fillInk(ctx, h, 1.3);
      break;
    case 'afro':
      circle(ctx, hx - 1, hy, r * 1.35);
      fillInk(ctx, h, 1.4);
      break;
    default:
      break;
  }
  // Face/skin.
  clipHead();
  fillInk(ctx, look.skin, 1.4);
  // Hair covering the top/back of the head, face showing toward +x.
  ctx.save();
  clipHead();
  ctx.clip();
  const cover = look.style === 'buzz' ? 0.35 : look.style === 'mohawk' ? 0 : 0.62;
  if (cover > 0) {
    ctx.fillStyle = h;
    circle(ctx, hx - r * cover, hy, r * 1.05);
    ctx.fill();
  }
  if (look.style === 'buzz') {
    ctx.fillStyle = shade(look.skin, -0.25);
    circle(ctx, hx - r * 0.2, hy, r * 0.9);
    ctx.fill();
  }
  if (look.style === 'curly' || look.style === 'afro') {
    ctx.fillStyle = shade(h, 0.25);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      circle(ctx, hx - r * 0.35 + Math.cos(a) * r * 0.5, hy + Math.sin(a) * r * 0.5, r * 0.22);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ellipse(ctx, hx - r * 0.35, hy - r * 0.35, r * 0.4, r * 0.22, -0.5);
  ctx.fill();
  ctx.restore();
  if (look.style === 'mohawk') {
    roundRect(ctx, hx - r - 1, hy - 2.5, r * 1.6, 5, 2.5);
    fillInk(ctx, h, 1.2);
  }
  if (look.style === 'cap' && look.hat) {
    ctx.save();
    clipHead();
    ctx.clip();
    ctx.fillStyle = look.hat;
    circle(ctx, hx - r * 0.25, hy, r * 1.02);
    ctx.fill();
    ctx.restore();
    circle(ctx, hx, hy, r);
    ink(ctx, 1.4);
    ellipse(ctx, hx + r * 0.95, hy, r * 0.55, r * 0.75);
    fillInk(ctx, shade(look.hat, -0.2), 1.3);
    circle(ctx, hx - r * 0.2, hy, 1.5);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  if (look.style === 'beanie' && look.hat) {
    ctx.save();
    clipHead();
    ctx.clip();
    ctx.fillStyle = look.hat;
    circle(ctx, hx - r * 0.3, hy, r * 1.02);
    ctx.fill();
    ctx.strokeStyle = shade(look.hat, -0.3);
    ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(hx - r, hy + k * 3);
      ctx.lineTo(hx + r * 0.3, hy + k * 3);
      ctx.stroke();
    }
    ctx.restore();
    circle(ctx, hx, hy, r);
    ink(ctx, 1.4);
    circle(ctx, hx - r * 0.35, hy, 3);
    fillInk(ctx, '#ffffff', 1.2);
  }
  // Nose.
  ellipse(ctx, hx + r * 0.95, hy, 2, 1.6);
  fillInk(ctx, shade(look.skin, -0.1), 1);
}

/** Top-down person: shoulders, arms reaching forward, head. Size `s` scales the body. */
function person(ctx: CanvasRenderingContext2D, look: Look, cx: number, cy: number, s: number, opts: { armsForward?: boolean; glasses?: boolean } = {}): void {
  shadow(ctx, cx + 2, cy + 3, 13 * s, 17 * s, 0.3);
  if (look.backpack) {
    roundRect(ctx, cx - 16 * s, cy - 9 * s, 10 * s, 18 * s, 4 * s);
    fillInk(ctx, look.backpack);
  }
  // Arms first (under the torso), reaching forward to the hands.
  const armColor = look.jacket ?? look.shirt;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx - 2 * s, cy + side * 13 * s);
    ctx.quadraticCurveTo(cx + 8 * s, cy + side * 14 * s, cx + 15 * s, cy + side * (opts.armsForward ? 6 : 9) * s);
    ctx.lineWidth = 7.5 * s + 2.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 7.5 * s;
    ctx.strokeStyle = armColor;
    ctx.stroke();
    circle(ctx, cx + 16 * s, cy + side * (opts.armsForward ? 6 : 9) * s, 3.6 * s);
    fillInk(ctx, look.skin, 1.3);
  }
  // Torso.
  ellipse(ctx, cx, cy, 10.5 * s, 16 * s);
  fillInk(ctx, look.jacket ?? look.shirt);
  ctx.save();
  ellipse(ctx, cx, cy, 10.5 * s, 16 * s);
  ctx.clip();
  ctx.fillStyle = shade(look.jacket ?? look.shirt, -0.22);
  ellipse(ctx, cx + 5 * s, cy + 6 * s, 10 * s, 14 * s);
  ctx.fill();
  if (look.jacket) {
    ctx.fillStyle = look.shirt;
    ellipse(ctx, cx + 7 * s, cy, 5 * s, 6 * s);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ellipse(ctx, cx - 4 * s, cy - 8 * s, 5 * s, 4 * s, -0.4);
  ctx.fill();
  ctx.restore();
  drawHair(ctx, look, cx + 1 * s, cy, 8.2 * s);
  if (opts.glasses) {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + 6 * s, cy - 5 * s);
    ctx.lineTo(cx + 8.5 * s, cy - 3 * s);
    ctx.lineTo(cx + 8.5 * s, cy + 3 * s);
    ctx.lineTo(cx + 6 * s, cy + 5 * s);
    ctx.stroke();
    ctx.fillStyle = 'rgba(180,230,255,0.9)';
    ctx.fillRect(cx + 7.5 * s, cy - 4.5 * s, 2 * s, 3 * s);
    ctx.fillRect(cx + 7.5 * s, cy + 1.5 * s, 2 * s, 3 * s);
  }
}

export const survivor: CanvasGen = (variant) => {
  const [c, ctx] = canvas(64);
  person(ctx, SURVIVOR_LOOKS[variant % SURVIVOR_LOOKS.length], 30, 32, 1, { armsForward: true });
  return c;
};

export const survivorLegs: CanvasGen = (variant) => legCanvas(variant >= 20 ? SEXTON_LOOK : variant >= 10 ? HUNTER_LOOK : SURVIVOR_LOOKS[variant % SURVIVOR_LOOKS.length], variant >= 10 && variant < 20 ? 1.3 : 1);

/** Downed survivor lying stretched out, head toward +x, in a small pool of blood. */
export const survivorDowned: CanvasGen = (variant) => {
  const look = SURVIVOR_LOOKS[variant % SURVIVOR_LOOKS.length];
  const [c, ctx] = canvas(80, 64);
  ctx.fillStyle = 'rgba(190,20,30,0.75)';
  ellipse(ctx, 40, 36, 30, 16, 0.2);
  ctx.fill();
  // Legs.
  for (const side of [-1, 1]) {
    roundRect(ctx, 8, 32 + side * 6 - 4, 24, 8, 4);
    fillInk(ctx, look.pants, 1.4);
    ellipse(ctx, 8, 32 + side * 6, 4, 3.5);
    fillInk(ctx, look.shoes, 1.2);
  }
  // Arms flopped out.
  for (const side of [-1, 1]) {
    roundRect(ctx, 38, 32 + side * 12 - 3, 18, 6, 3);
    fillInk(ctx, look.jacket ?? look.shirt, 1.3);
    circle(ctx, 57, 32 + side * 12, 3.4);
    fillInk(ctx, look.skin, 1.2);
  }
  ellipse(ctx, 42, 32, 14, 10);
  fillInk(ctx, look.jacket ?? look.shirt);
  drawHair(ctx, look, 60, 32, 8);
  return c;
};

/** Zach Branch: heavy build, dark work jacket, white hockey mask with red chevrons. */
export const hunter: CanvasGen = () => {
  const [c, ctx] = canvas(84);
  const cx = 38;
  const cy = 42;
  shadow(ctx, cx + 3, cy + 4, 20, 24, 0.35);
  const look = HUNTER_LOOK;
  // Arms.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy + side * 17);
    ctx.quadraticCurveTo(cx + 10, cy + side * 19, cx + 20, cy + side * 11);
    ctx.lineWidth = 12.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.strokeStyle = look.jacket!;
    ctx.stroke();
    circle(ctx, cx + 21, cy + side * 11, 5);
    fillInk(ctx, '#3a2c22', 1.5);
  }
  // Torso.
  ellipse(ctx, cx, cy, 14, 21);
  fillInk(ctx, look.jacket!, 2);
  ctx.save();
  ellipse(ctx, cx, cy, 14, 21);
  ctx.clip();
  ctx.fillStyle = shade(look.jacket!, -0.3);
  ellipse(ctx, cx + 6, cy + 8, 13, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ellipse(ctx, cx - 5, cy - 10, 6, 5, -0.4);
  ctx.fill();
  // Torn collar and a blood splash.
  ctx.fillStyle = '#b01e22';
  ellipse(ctx, cx + 6, cy - 9, 4, 2.5, 0.6);
  ctx.fill();
  ctx.restore();
  // Head: dark hair at the back, hockey mask at the front.
  circle(ctx, cx + 1, cy, 10.5);
  fillInk(ctx, look.hair, 1.8);
  ctx.save();
  circle(ctx, cx + 1, cy, 10.5);
  ctx.clip();
  ctx.fillStyle = '#f2ecd8';
  ellipse(ctx, cx + 6, cy, 8.5, 9.5);
  ctx.fill();
  ctx.restore();
  ellipse(ctx, cx + 6, cy, 8.5, 9.5);
  ink(ctx, 1.4);
  ctx.fillStyle = '#16101a';
  for (const [dx, dy] of [
    [8, -3.5],
    [8, 3.5],
    [4, -6],
    [4, 6],
    [11, 0],
    [2, 0],
  ]) {
    circle(ctx, cx + dx, cy + dy, 1.1);
    ctx.fill();
  }
  ctx.strokeStyle = '#e02a2a';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx + 1, cy - 7);
  ctx.lineTo(cx + 6, cy - 3);
  ctx.lineTo(cx + 11, cy - 6);
  ctx.moveTo(cx + 1, cy + 7);
  ctx.lineTo(cx + 6, cy + 3);
  ctx.lineTo(cx + 11, cy + 6);
  ctx.stroke();
  return c;
};

/** Zach's machete, blade pointing +x from the grip (held in his right hand). */
export const machete: CanvasGen = () => {
  const [c, ctx] = canvas(64, 20);
  roundRect(ctx, 2, 7, 13, 6, 2);
  fillInk(ctx, '#5a3a22', 1.3);
  ctx.beginPath();
  ctx.moveTo(14, 5.5);
  ctx.lineTo(56, 4);
  ctx.quadraticCurveTo(62, 7, 58, 13);
  ctx.lineTo(14, 14);
  ctx.closePath();
  fillInk(ctx, '#c9d2dc', 1.4);
  ctx.fillStyle = '#eef3f8';
  ctx.fillRect(16, 6.5, 38, 2);
  ctx.fillStyle = 'rgba(200,20,30,0.9)';
  ellipse(ctx, 50, 10, 6, 3, 0.2);
  ctx.fill();
  return c;
};

/** Sexton Science: blonde hair, blue shirt, glasses. */
export const sexton: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, SEXTON_LOOK, 30, 32, 1, { glasses: true });
  return c;
};

export const sextonDead: CanvasGen = () => {
  const look = SEXTON_LOOK;
  const [c, ctx] = canvas(84, 64);
  ctx.fillStyle = 'rgba(190,20,30,0.8)';
  ellipse(ctx, 42, 34, 34, 18, -0.15);
  ctx.fill();
  for (const side of [-1, 1]) {
    roundRect(ctx, 8, 32 + side * 6 - 4, 24, 8, 4);
    fillInk(ctx, look.pants, 1.4);
  }
  for (const side of [-1, 1]) {
    roundRect(ctx, 38, 32 + side * 13 - 3, 20, 6, 3);
    fillInk(ctx, look.shirt, 1.3);
  }
  ellipse(ctx, 42, 32, 14, 10);
  fillInk(ctx, look.shirt);
  drawHair(ctx, look, 62, 32, 8);
  ctx.strokeStyle = '#16101a';
  ctx.lineWidth = 1.6;
  for (const dy of [-3, 3]) {
    ctx.beginPath();
    ctx.moveTo(66, 32 + dy - 1.5);
    ctx.lineTo(69, 32 + dy + 1.5);
    ctx.moveTo(69, 32 + dy - 1.5);
    ctx.lineTo(66, 32 + dy + 1.5);
    ctx.stroke();
  }
  return c;
};

// ---------------------------------------------------------------------------------------
// Objects and structures
// ---------------------------------------------------------------------------------------

export const generator: CanvasGen = (variant) => {
  const [c, ctx] = canvas(84, 68);
  const on = variant === 1;
  shadow(ctx, 44, 40, 38, 28, 0.35);
  roundRect(ctx, 6, 8, 66, 50, 6);
  fillInk(ctx, '#f2b632', 2);
  ctx.fillStyle = '#ffd35a';
  ctx.fillRect(10, 11, 58, 8);
  roundRect(ctx, 12, 24, 34, 28, 3);
  fillInk(ctx, '#3a3f4a', 1.4);
  ctx.fillStyle = '#586070';
  for (let x = 15; x < 44; x += 6) ctx.fillRect(x, 27, 3, 22);
  circle(ctx, 60, 40, 9);
  fillInk(ctx, '#e8453c', 1.5);
  ctx.fillStyle = '#ff8a7a';
  circle(ctx, 57, 37, 3);
  ctx.fill();
  roundRect(ctx, 52, 13, 14, 8, 2);
  fillInk(ctx, '#2a2a30', 1.2);
  circle(ctx, 59, 17, 2.6);
  ctx.fillStyle = on ? '#6dff6a' : '#6a1d1d';
  ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(120,255,120,0.45)';
    circle(ctx, 59, 17, 6);
    ctx.fill();
  }
  // Exhaust pipe.
  roundRect(ctx, 70, 20, 8, 6, 2);
  fillInk(ctx, '#6b6f7a', 1.2);
  return c;
};

export const locker: CanvasGen = () => {
  const [c, ctx] = canvas(48, 40);
  shadow(ctx, 26, 23, 22, 17, 0.35);
  roundRect(ctx, 3, 3, 40, 32, 3);
  fillInk(ctx, '#2fa6a0', 1.8);
  ctx.fillStyle = '#56cfc8';
  ctx.fillRect(6, 6, 34, 5);
  ctx.fillStyle = '#1d6e6a';
  for (let y = 14; y < 31; y += 4) ctx.fillRect(28, y, 11, 2);
  roundRect(ctx, 20, 18, 3, 7, 1.5);
  fillInk(ctx, '#f2b632', 1);
  return c;
};

export const wardrobe: CanvasGen = () => {
  const [c, ctx] = canvas(64, 44);
  shadow(ctx, 34, 25, 30, 19, 0.35);
  roundRect(ctx, 3, 3, 56, 36, 3);
  fillInk(ctx, '#a0582c', 1.8);
  ctx.fillStyle = '#c67a42';
  ctx.fillRect(6, 6, 50, 5);
  ctx.beginPath();
  ctx.moveTo(31, 4);
  ctx.lineTo(31, 38);
  ink(ctx, 1.4);
  ctx.fillStyle = '#6e3a1a';
  for (let y = 14; y < 34; y += 5) ctx.fillRect(40, y, 12, 2);
  circle(ctx, 28, 22, 1.8);
  fillInk(ctx, '#f2b632', 1);
  circle(ctx, 34, 22, 1.8);
  fillInk(ctx, '#f2b632', 1);
  return c;
};

export const bed: CanvasGen = () => {
  const [c, ctx] = canvas(96, 58);
  shadow(ctx, 50, 32, 46, 26, 0.35);
  roundRect(ctx, 3, 5, 88, 46, 4);
  fillInk(ctx, '#8a4a24', 1.8);
  roundRect(ctx, 7, 9, 80, 38, 3);
  fillInk(ctx, '#e8e2d2', 1.3);
  roundRect(ctx, 7, 9, 56, 38, 3);
  fillInk(ctx, '#4a7ae0', 1.3);
  ctx.strokeStyle = '#6a98f0';
  ctx.lineWidth = 2;
  for (let x = 14; x < 60; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x, 46);
    ctx.stroke();
  }
  roundRect(ctx, 68, 14, 16, 28, 5);
  fillInk(ctx, '#ffffff', 1.3);
  return c;
};

export const barrel: CanvasGen = () => {
  const [c, ctx] = canvas(56);
  shadow(ctx, 31, 32, 23, 23, 0.35);
  circle(ctx, 28, 28, 22);
  fillInk(ctx, '#d8402e', 2);
  ctx.fillStyle = '#f06a50';
  circle(ctx, 24, 24, 15);
  ctx.fill();
  ctx.strokeStyle = '#7a1e14';
  ctx.lineWidth = 3;
  circle(ctx, 28, 28, 16);
  ctx.stroke();
  circle(ctx, 28, 28, 5);
  fillInk(ctx, '#3a1a14', 1.3);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ellipse(ctx, 20, 17, 6, 3, -0.6);
  ctx.fill();
  return c;
};

export const stake: CanvasGen = () => {
  const [c, ctx] = canvas(76);
  shadow(ctx, 42, 42, 28, 18, 0.35);
  // Cross beams.
  roundRect(ctx, 8, 33, 60, 8, 3);
  fillInk(ctx, '#9a6436', 1.6);
  roundRect(ctx, 34, 10, 8, 56, 3);
  fillInk(ctx, '#9a6436', 1.6);
  ctx.fillStyle = '#c28650';
  ctx.fillRect(10, 34, 56, 2);
  // Straw.
  const rng = new Rng(44);
  ctx.strokeStyle = '#f2c84a';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 36; i++) {
    const x = rng.range(26, 50);
    const y = rng.range(26, 50);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-7, 7), y + rng.range(-7, 7));
    ctx.stroke();
  }
  // Hook.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(38, 37);
  ctx.quadraticCurveTo(50, 30, 53, 20);
  ctx.stroke();
  ctx.strokeStyle = '#c9d2dc';
  ctx.lineWidth = 2;
  ctx.stroke();
  circle(ctx, 38, 37, 5);
  fillInk(ctx, '#d0302a', 1.3);
  return c;
};

export const gate: CanvasGen = (variant) => {
  const open = variant === 1;
  const [c, ctx] = canvas(160, 26);
  for (const x of [0, 150]) {
    roundRect(ctx, x, 3, 10, 20, 2);
    fillInk(ctx, '#f2b632', 1.4);
    ctx.fillStyle = '#26262e';
    ctx.fillRect(x + 1, 10, 8, 4);
  }
  if (!open) {
    ctx.strokeStyle = '#b8c2cc';
    ctx.lineWidth = 1.2;
    for (let x = 10; x < 150; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x + 6, 20);
      ctx.moveTo(x + 6, 6);
      ctx.lineTo(x, 20);
      ctx.stroke();
    }
    roundRect(ctx, 10, 4, 140, 4, 1);
    fillInk(ctx, '#8a949e', 1.2);
    roundRect(ctx, 10, 18, 140, 4, 1);
    fillInk(ctx, '#8a949e', 1.2);
  }
  return c;
};

/** A pallet barricade: standing (0) or slammed down across a gap (1). */
export const barricade: CanvasGen = (variant) => {
  const down = variant === 1;
  const [c, ctx] = canvas(100, down ? 44 : 24);
  shadow(ctx, 52, down ? 26 : 16, 46, down ? 18 : 8, 0.3);
  if (down) {
    for (let y = 4; y < 38; y += 8) {
      roundRect(ctx, 3, y, 90, 6, 1.5);
      fillInk(ctx, '#c9894c', 1.3);
    }
    roundRect(ctx, 12, 2, 7, 38, 2);
    fillInk(ctx, '#8a5530', 1.3);
    roundRect(ctx, 76, 2, 7, 38, 2);
    fillInk(ctx, '#8a5530', 1.3);
  } else {
    roundRect(ctx, 3, 5, 90, 12, 2);
    fillInk(ctx, '#c9894c', 1.4);
    ctx.fillStyle = '#8a5530';
    for (let x = 9; x < 90; x += 16) ctx.fillRect(x, 6, 3, 10);
  }
  return c;
};

/** A wooden door panel (pointing +x from its hinge). */
export const door: CanvasGen = (variant) => {
  const [c, ctx] = canvas(80, 14);
  const metal = variant === 1;
  roundRect(ctx, 2, 3, 76, 8, 2);
  fillInk(ctx, metal ? '#5a86b8' : '#b8642e', 1.5);
  ctx.fillStyle = metal ? '#8fb6e0' : '#e08a48';
  ctx.fillRect(4, 4.5, 72, 2);
  ctx.fillStyle = metal ? '#3a5a80' : '#7a3a16';
  for (let x = 22; x < 76; x += 18) ctx.fillRect(x, 4, 1.5, 6);
  circle(ctx, 68, 7, 2.2);
  fillInk(ctx, '#f2c84a', 1);
  circle(ctx, 4, 7, 2.5);
  fillInk(ctx, '#3a3a42', 1);
  return c;
};

export const campfire: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    circle(ctx, 32 + Math.cos(a) * 21, 32 + Math.sin(a) * 21, 5.5);
    fillInk(ctx, i % 2 ? '#8a90a0' : '#a8aebc', 1.3);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(32 - Math.cos(a) * 15, 32 - Math.sin(a) * 15);
    ctx.lineTo(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15);
    ctx.lineWidth = 7.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#8a5530';
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 14);
  g.addColorStop(0, 'rgba(255,250,200,1)');
  g.addColorStop(0.45, 'rgba(255,170,40,0.95)');
  g.addColorStop(1, 'rgba(240,60,20,0)');
  ctx.fillStyle = g;
  circle(ctx, 32, 32, 14);
  ctx.fill();
  return c;
};

export const lamp: CanvasGen = () => {
  const [c, ctx] = canvas(32);
  roundRect(ctx, 9, 9, 14, 14, 3);
  fillInk(ctx, '#2a2a32', 1.4);
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 8);
  g.addColorStop(0, 'rgba(255,250,210,1)');
  g.addColorStop(1, 'rgba(255,210,120,0)');
  ctx.fillStyle = g;
  circle(ctx, 16, 16, 8);
  ctx.fill();
  return c;
};

// ---------------------------------------------------------------------------------------
// Items: the same art is used on the ground, in hands and in the HUD
// ---------------------------------------------------------------------------------------

function itemCanvas(draw: (ctx: CanvasRenderingContext2D) => void, size = 40): CanvasGen {
  return () => {
    const [c, ctx] = canvas(size);
    ctx.translate(size / 2 - 20, size / 2 - 20);
    draw(ctx);
    return c;
  };
}

export const itemBottle = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(20, 20);
  ctx.rotate(-0.6);
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(4, -6);
  ctx.quadraticCurveTo(8, -6, 9, -3);
  ctx.lineTo(15, -2.5);
  ctx.lineTo(15, 2.5);
  ctx.lineTo(9, 3);
  ctx.quadraticCurveTo(8, 6, 4, 6);
  ctx.lineTo(-14, 6);
  ctx.closePath();
  fillInk(ctx, '#2fb45a');
  ctx.fillStyle = '#f2e6c0';
  ctx.fillRect(-10, -5, 9, 10);
  ctx.fillStyle = '#e8453c';
  ctx.fillRect(-9, -2, 7, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-12, -4, 14, 2);
  roundRect(ctx, 14, -2.5, 3, 5, 1);
  fillInk(ctx, '#f2b632', 1);
  ctx.restore();
});

export const itemGoggles = itemCanvas((ctx) => {
  roundRect(ctx, 6, 14, 28, 12, 5);
  fillInk(ctx, '#2a2e36');
  for (const x of [12, 28]) {
    circle(ctx, x, 20, 6);
    fillInk(ctx, '#1a1a20', 1.4);
    circle(ctx, x, 20, 4.2);
    ctx.fillStyle = '#5cff6a';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    circle(ctx, x - 1.5, 18.5, 1.3);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(6, 20);
  ctx.lineTo(1, 22);
  ctx.moveTo(34, 20);
  ctx.lineTo(39, 22);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2a2e36';
  ctx.stroke();
});

export const itemShotgun = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(20, 20);
  ctx.rotate(-0.35);
  // Stock.
  ctx.beginPath();
  ctx.moveTo(-18, -2);
  ctx.lineTo(-6, -4);
  ctx.lineTo(-4, 3);
  ctx.lineTo(-18, 5);
  ctx.closePath();
  fillInk(ctx, '#9a5a2c');
  // Barrels.
  roundRect(ctx, -6, -4, 25, 3.2, 1);
  fillInk(ctx, '#5a6270', 1.2);
  roundRect(ctx, -6, -0.6, 25, 3.2, 1);
  fillInk(ctx, '#6b7482', 1.2);
  roundRect(ctx, -2, 2, 9, 4, 1.5);
  fillInk(ctx, '#7a4520', 1.2);
  ctx.restore();
}, 44);

export const itemEnergy = itemCanvas((ctx) => {
  roundRect(ctx, 12, 6, 16, 28, 4);
  fillInk(ctx, '#20d0ff');
  ctx.fillStyle = '#e8e8f0';
  ctx.fillRect(13, 6, 14, 3);
  ctx.fillRect(13, 31, 14, 2);
  // Lightning bolt.
  ctx.beginPath();
  ctx.moveTo(22, 11);
  ctx.lineTo(16, 21);
  ctx.lineTo(20, 21);
  ctx.lineTo(17, 30);
  ctx.lineTo(25, 18);
  ctx.lineTo(21, 18);
  ctx.closePath();
  fillInk(ctx, '#ffe63a', 1);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(14, 10, 3, 18);
});

export const itemTrap = itemCanvas((ctx) => {
  circle(ctx, 20, 21, 14);
  fillInk(ctx, '#3a2a6a');
  const g = ctx.createRadialGradient(17, 18, 1, 20, 21, 13);
  g.addColorStop(0, '#ff8af0');
  g.addColorStop(0.5, '#8a4aff');
  g.addColorStop(1, '#2a1a5a');
  ctx.fillStyle = g;
  circle(ctx, 20, 21, 11);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (const [x, y] of [
    [15, 17],
    [24, 24],
    [22, 15],
    [16, 26],
  ]) {
    circle(ctx, x, y, 1);
    ctx.fill();
  }
  roundRect(ctx, 16, 3, 8, 6, 2);
  fillInk(ctx, '#c9d2dc', 1.2);
});

export const itemConfit = itemCanvas((ctx) => {
  ellipse(ctx, 20, 24, 17, 10);
  fillInk(ctx, '#f4f4f4');
  ellipse(ctx, 20, 24, 12, 6.5);
  ctx.strokeStyle = '#c9c9d2';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Duck leg.
  ellipse(ctx, 17, 22, 9, 6.5, -0.3);
  fillInk(ctx, '#c8752e');
  ctx.fillStyle = '#e8a050';
  ellipse(ctx, 15, 20, 4, 2.5, -0.3);
  ctx.fill();
  roundRect(ctx, 24, 15, 9, 3.5, 1.5);
  fillInk(ctx, '#f2e6c0', 1.2);
  circle(ctx, 33, 16.5, 2.3);
  fillInk(ctx, '#f2e6c0', 1.1);
  // Garnish.
  ctx.fillStyle = '#3fae4f';
  ellipse(ctx, 26, 27, 3, 1.6, 0.4);
  ctx.fill();
});

export const itemTablet = itemCanvas((ctx) => {
  roundRect(ctx, 8, 6, 24, 30, 4);
  fillInk(ctx, '#22242c');
  const g = ctx.createLinearGradient(10, 8, 30, 34);
  g.addColorStop(0, '#7af8ff');
  g.addColorStop(1, '#2a8cff');
  ctx.fillStyle = g;
  ctx.fillRect(11, 9, 18, 23);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  circle(ctx, 20, 20, 5);
  ctx.stroke();
  circle(ctx, 20, 20, 2);
  ctx.stroke();
});

export const itemHemp = itemCanvas((ctx) => {
  roundRect(ctx, 6, 12, 26, 16, 3);
  fillInk(ctx, '#2a3a24');
  roundRect(ctx, 32, 16, 4, 8, 1);
  fillInk(ctx, '#c9d2dc', 1.2);
  ctx.fillStyle = '#6dff6a';
  ctx.fillRect(9, 15, 12, 10);
  // Leaf.
  ctx.fillStyle = '#2a3a24';
  for (let i = -2; i <= 2; i++) {
    const a = -Math.PI / 2 + i * 0.5;
    ellipse(ctx, 25 + Math.cos(a) * 3, 20 + Math.sin(a) * 3, 3.5, 1.2, a);
    ctx.fill();
  }
});

// ---------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------

export const blood: CanvasGen = (variant) => {
  const [c, ctx] = canvas(48);
  const rng = new Rng(700 + variant);
  ctx.fillStyle = 'rgba(200,20,36,0.9)';
  for (let i = 0; i < 7; i++) {
    circle(ctx, 24 + rng.range(-12, 12), 24 + rng.range(-12, 12), rng.range(2, 8));
    ctx.fill();
  }
  return c;
};

/** Soft radial glow used for light halos and pickups. */
export const glow: CanvasGen = () => {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
};

/** A soft, lumpy puff (scent gas, galaxy gas, smoke); tinted at runtime. */
export const puff: CanvasGen = (variant) => {
  const [c, ctx] = canvas(96);
  const rng = new Rng(900 + variant);
  for (let i = 0; i < 9; i++) {
    const x = 48 + rng.range(-16, 16);
    const y = 48 + rng.range(-16, 16);
    const r = rng.range(14, 26);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    circle(ctx, x, y, r);
    ctx.fill();
  }
  return c;
};

export const fog: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const n = tileFbm(size, 4, 4, 808);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(0, n[i] - 0.35) * 1.6;
    img.data[i * 4] = 210;
    img.data[i * 4 + 1] = 220;
    img.data[i * 4 + 2] = 240;
    img.data[i * 4 + 3] = Math.min(255, v * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

export const spark: CanvasGen = () => {
  const [c, ctx] = canvas(8);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(2, 2, 4, 4);
  return c;
};

export const TEXTURE_GENERATORS: Record<string, CanvasGen> = {
  groundForest,
  groundPath,
  groundConcrete,
  groundWood,
  groundWater,
  tallGrass,
  treePine,
  treeOak,
  treeDead,
  boulder,
  logProp,
  bush,
  survivor,
  survivorLegs,
  survivorDowned,
  hunter,
  machete,
  sexton,
  sextonDead,
  generator,
  locker,
  wardrobe,
  bed,
  barrel,
  stake,
  gate,
  barricade,
  door,
  campfire,
  lamp,
  itemBottle,
  itemGoggles,
  itemShotgun,
  itemEnergy,
  itemTrap,
  itemConfit,
  itemTablet,
  itemHemp,
  blood,
  glow,
  puff,
  fog,
  spark,
};

/**
 * Default anchor (pivot) per generator: trees stand on their trunk base, which sits below
 * the middle of the canvas. Everything else is centred. The manifest may override it.
 */
export const TEXTURE_ANCHORS: Record<string, [number, number]> = {
  treePine: [0.5, 150 / 190],
  treeOak: [0.5, 150 / 190],
  treeDead: [0.5, 140 / 170],
  machete: [0.06, 0.5],
  survivorLegs: [0.12, 0.5],
  door: [0.05, 0.5],
};
