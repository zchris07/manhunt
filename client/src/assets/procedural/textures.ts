import { Rng } from '@manhunt/shared';
import { noise1D, tileFbm } from './noise';

/**
 * Procedural texture generators. Each returns a canvas. The look follows Darkwood: dark,
 * desaturated, realistic top-down art where everything is seen from straight above and
 * casts a soft shadow down and to the right, so the flat sprites read like a 3D scene.
 * Characters face +x (right). Colours are graded down by AssetManager (see gradeCanvas).
 */

export type CanvasGen = (variant: number) => HTMLCanvasElement;

/** Soft dark edge on sprites (no comic outlines). */
const INK = 'rgba(6,6,6,0.5)';
const INK_W = 1;

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
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, a * 1.6)})`;
  ellipse(ctx, x + 3, y + 4, rx, ry);
  ctx.fill();
  ctx.restore();
}

/** Fills a tile from a noise field mapped between two colours, with extra grain. */
function noiseTile(size: number, period: number, seed: number, dark: RGB, light: RGB, grain = 10): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [c, ctx] = canvas(size);
  const n = tileFbm(size, period, 4, seed);
  const img = ctx.createImageData(size, size);
  const rng = new Rng(seed ^ 0xabcdef);
  for (let i = 0; i < n.length; i++) {
    const col = mix(dark, light, n[i]);
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
// Ground (Darkwood-like: murky, low-contrast, realistic detail)
// ---------------------------------------------------------------------------------------

/** Scatters small marks over a seamless tile. */
function scatter(size: number, n: number, rng: Rng, draw: (x: number, y: number, i: number) => void, r = 12): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    wrapDraw(size, x, y, r, (px, py) => draw(px, py, i));
  }
}

export const groundForest: CanvasGen = () => {
  const size = 512;
  const [c, ctx] = noiseTile(size, 6, 11, [30, 32, 27], [56, 55, 44], 9);
  const rng = new Rng(12);
  // Mossy and muddy patches.
  const moss = tileFbm(size, 4, 3, 13);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < moss.length; i++) {
    const m = Math.max(0, moss[i] - 0.55) * 1.8;
    img.data[i * 4] -= m * 10;
    img.data[i * 4 + 1] += m * 6;
    img.data[i * 4 + 2] -= m * 8;
  }
  ctx.putImageData(img, 0, 0);
  // Leaf litter.
  const leaves: RGB[] = [
    [74, 60, 42],
    [58, 50, 38],
    [44, 48, 34],
    [82, 70, 50],
    [36, 34, 28],
  ];
  scatter(size, 2600, rng, (x, y, i) => {
    const col = leaves[i % leaves.length];
    ctx.fillStyle = rgb(col[0], col[1], col[2], 0.55);
    ellipse(ctx, x, y, 2 + (i % 3), 1 + (i % 2), (i * 1.7) % Math.PI);
    ctx.fill();
  });
  // Twigs and needles.
  scatter(size, 220, rng, (x, y, i) => {
    const a = (i * 2.4) % Math.PI;
    const l = 6 + (i % 5) * 3;
    ctx.strokeStyle = i % 3 ? 'rgba(30,24,18,0.55)' : 'rgba(92,80,60,0.45)';
    ctx.lineWidth = i % 4 ? 0.8 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }, 30);
  // Pebbles.
  scatter(size, 90, rng, (x, y, i) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ellipse(ctx, x + 1, y + 1.5, 2.5 + (i % 3), 2 + (i % 2));
    ctx.fill();
    ctx.fillStyle = `rgba(${96 + (i % 4) * 6},${94 + (i % 4) * 6},${86 + (i % 4) * 6},0.8)`;
    ellipse(ctx, x, y, 2.5 + (i % 3), 2 + (i % 2));
    ctx.fill();
  });
  return c;
};

export const groundPath: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 5, 21, [50, 44, 36], [78, 70, 56], 12);
  const rng = new Rng(22);
  scatter(size, 30, rng, (x, y, i) => {
    ctx.fillStyle = 'rgba(20,18,14,0.22)';
    ellipse(ctx, x, y, 10 + (i % 4) * 5, 6 + (i % 3) * 3, i);
    ctx.fill();
  }, 30);
  scatter(size, 220, rng, (x, y, i) => {
    ctx.fillStyle = `rgba(${110 + (i % 5) * 8},${104 + (i % 5) * 7},${92 + (i % 5) * 6},0.55)`;
    ellipse(ctx, x, y, 1.2 + (i % 3) * 0.6, 1 + (i % 2) * 0.6);
    ctx.fill();
  });
  return c;
};

export const groundConcrete: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 7, 31, [58, 58, 56], [86, 85, 80], 14);
  const rng = new Rng(32);
  // Water stains and oil.
  scatter(size, 14, rng, (x, y, i) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + (i % 4) * 10);
    g.addColorStop(0, 'rgba(20,20,18,0.3)');
    g.addColorStop(1, 'rgba(20,20,18,0)');
    ctx.fillStyle = g;
    circle(ctx, x, y, 20 + (i % 4) * 10);
    ctx.fill();
  }, 60);
  // Slab seams.
  ctx.fillStyle = 'rgba(18,18,16,0.45)';
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
  // Cracks.
  ctx.strokeStyle = 'rgba(16,16,14,0.5)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    let x = rng.range(10, size - 10);
    let y = rng.range(10, size - 10);
    let a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a) * 7;
      y += Math.sin(a) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
};

export const groundWood: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(41);
  const H = 32;
  for (let y = 0; y < size; y += H) {
    const base = 58 + rng.range(-6, 8);
    ctx.fillStyle = rgb(base + 14, base, base - 14);
    ctx.fillRect(0, y, size, H);
    // Grain.
    for (let k = 0; k < 9; k++) {
      ctx.strokeStyle = `rgba(30,20,12,${rng.range(0.12, 0.3)})`;
      ctx.lineWidth = rng.range(0.6, 1.4);
      const gy = y + rng.range(3, H - 3);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= size; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.05 + k) * 1.2);
      ctx.stroke();
    }
    // Gaps and butt joints.
    ctx.fillStyle = 'rgba(10,8,6,0.75)';
    ctx.fillRect(0, y, size, 2);
    const jx = rng.range(20, size - 20);
    ctx.fillRect(jx, y, 2, H);
    ctx.fillStyle = 'rgba(20,16,12,0.8)';
    circle(ctx, jx - 5, y + 6, 1.2);
    ctx.fill();
    circle(ctx, jx + 7, y + H - 6, 1.2);
    ctx.fill();
  }
  return c;
};

export const groundWater: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 4, 51, [14, 20, 22], [30, 40, 42], 5);
  ctx.strokeStyle = 'rgba(120,140,140,0.08)';
  ctx.lineWidth = 1;
  const rng = new Rng(52);
  scatter(size, 24, rng, (x, y, i) => {
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + (i % 4) * 6, 3 + (i % 3), 0, 0, Math.PI * 2);
    ctx.stroke();
  }, 40);
  return c;
};

/** Tall grass tuft seen from straight above: blades radiating from the root. */
export const tallGrass: CanvasGen = (variant) => {
  const size = 128;
  const [c, ctx] = canvas(size);
  const rng = new Rng(300 + variant);
  softShadow(ctx, () => {
    circle(ctx, 70, 72, 40);
    ctx.fill();
  }, 0.45, 10);
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(18, 52);
    const bend = rng.range(-0.5, 0.5);
    const t = rng.next();
    ctx.strokeStyle = rgb(44 + t * 40, 52 + t * 38, 30 + t * 20, 0.9);
    ctx.lineWidth = rng.range(1.2, 2.6);
    ctx.beginPath();
    const x0 = 64 + rng.range(-6, 6);
    const y0 = 64 + rng.range(-6, 6);
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + Math.cos(a) * l * 0.6, y0 + Math.sin(a) * l * 0.6, x0 + Math.cos(a + bend) * l, y0 + Math.sin(a + bend) * l);
    ctx.stroke();
  }
  return c;
};

// ---------------------------------------------------------------------------------------
// Trees and props: seen from straight above (no trunks), with soft cast shadows
// ---------------------------------------------------------------------------------------

/** Draws `shape` as a blurred shadow offset down and to the right. */
function softShadow(ctx: CanvasRenderingContext2D, shape: () => void, alpha = 0.6, blur = 14, dx = 10, dy = 14): void {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx + 4000;
  ctx.shadowOffsetY = dy;
  ctx.translate(-4000, 0);
  ctx.fillStyle = '#000';
  shape();
  ctx.restore();
}

/** Canopy radius (px) in the tree textures; MapRenderer scales trees from it. */
export const CANOPY_PX = 100;

function leafSpecks(ctx: CanvasRenderingContext2D, rng: Rng, cx: number, cy: number, r: number, n: number, light: RGB, dark: RGB): void {
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    // Lighter toward the upper left, darker toward the lower right.
    const lit = Math.max(0, Math.min(1, 0.5 - ((x - cx) + (y - cy)) / (r * 2.6)));
    const col = mix(dark, light, lit * rng.range(0.6, 1));
    ctx.fillStyle = rgb(col[0], col[1], col[2], 0.85);
    ellipse(ctx, x, y, rng.range(1.5, 3.6), rng.range(1, 2.2), rng.range(0, Math.PI));
    ctx.fill();
  }
}

/** Conifer from above: layered rings of needle spikes around the crown. */
export const treePine: CanvasGen = (variant) => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(340 + variant);
  const cx = 120;
  const cy = 118;
  const R = CANOPY_PX * rng.range(0.88, 1);
  const star = (r: number, spikes: number, depth: number, rot: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = rot + (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * (1 - depth) * rng.range(0.9, 1.08);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  softShadow(ctx, () => {
    circle(ctx, cx, cy, R * 0.92);
    ctx.fill();
  }, 0.75, 22, 16, 22);
  const layers = 4;
  for (let k = 0; k < layers; k++) {
    const r = R * (1 - k * 0.21);
    const t = k / (layers - 1);
    const col = mix([20, 28, 22], [44, 56, 40], t);
    star(r, 16 + k * 2, 0.3, rng.range(0, 1));
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, rgb(col[0] + 14, col[1] + 16, col[2] + 10));
    g.addColorStop(1, rgb(col[0] - 6, col[1] - 6, col[2] - 6));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,8,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Needles along the spikes.
    ctx.strokeStyle = rgb(col[0] + 20, col[1] + 24, col[2] + 14, 0.45);
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d0 = r * rng.range(0.3, 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
      ctx.lineTo(cx + Math.cos(a) * (d0 + r * 0.22), cy + Math.sin(a) * (d0 + r * 0.22));
      ctx.stroke();
    }
  }
  circle(ctx, cx, cy, 4);
  ctx.fillStyle = 'rgba(70,84,60,0.9)';
  ctx.fill();
  return c;
};

/** Broadleaf from above: overlapping leaf clumps, lit from the upper left. */
export const treeOak: CanvasGen = (variant) => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(420 + variant);
  const cx = 120;
  const cy = 118;
  const R = CANOPY_PX * rng.range(0.85, 1);
  const clumps: [number, number, number][] = [];
  const n = 8 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = R * rng.range(0.38, 0.55);
    clumps.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rng.range(0.38, 0.5)]);
  }
  clumps.push([cx, cy, R * 0.55]);
  softShadow(ctx, () => {
    for (const [x, y, r] of clumps) {
      circle(ctx, x, y, r);
      ctx.fill();
    }
  }, 0.75, 22, 16, 22);
  const n1 = noise1D(variant * 13 + 5);
  for (const [x, y, r] of clumps) {
    blob(ctx, x, y, r, n1, 7, 0.12, x);
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgb(64,70,44)');
    g.addColorStop(0.6, 'rgb(40,46,30)');
    g.addColorStop(1, 'rgb(24,28,20)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,6,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    leafSpecks(ctx, rng, x, y, r * 0.9, 90, [86, 90, 58], [26, 30, 20]);
  }
  return c;
};

/** Dead tree from above: a bare crown of branches forking out from the trunk top. */
export const treeDead: CanvasGen = (variant) => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(510 + variant);
  const cx = 120;
  const cy = 118;
  const R = CANOPY_PX * 0.9;
  const segs: [number, number, number, number, number][] = [];
  const grow = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    segs.push([x, y, ex, ey, w]);
    if (depth <= 0) return;
    const forks = depth > 2 ? 2 : rng.int(1, 2);
    for (let i = 0; i < forks; i++) grow(ex, ey, a + rng.range(-0.6, 0.6), len * rng.range(0.55, 0.75), w * 0.62, depth - 1);
  };
  const main = 6 + (variant % 3);
  for (let i = 0; i < main; i++) grow(cx, cy, (i / main) * Math.PI * 2 + rng.range(-0.2, 0.2), R * rng.range(0.32, 0.42), 7, 3);
  const stroke = (col: string, dx: number, dy: number, wMul: number): void => {
    ctx.strokeStyle = col;
    for (const [x0, y0, x1, y1, w] of segs) {
      ctx.lineWidth = Math.max(0.7, w * wMul);
      ctx.beginPath();
      ctx.moveTo(x0 + dx, y0 + dy);
      ctx.lineTo(x1 + dx, y1 + dy);
      ctx.stroke();
    }
  };
  ctx.save();
  ctx.filter = 'blur(3px)';
  stroke('rgba(0,0,0,0.55)', 12, 17, 1.1);
  ctx.restore();
  stroke('rgb(40,34,28)', 0, 0, 1);
  stroke('rgba(104,94,80,0.55)', -0.8, -0.8, 0.45);
  circle(ctx, cx, cy, 8);
  ctx.fillStyle = 'rgb(52,44,36)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,16,12,0.8)';
  ctx.lineWidth = 1;
  circle(ctx, cx, cy, 5);
  ctx.stroke();
  return c;
};

export const boulder: CanvasGen = (variant) => {
  const size = 112;
  const [c, ctx] = canvas(size);
  const rng = new Rng(560 + variant);
  const n = noise1D(variant * 7 + 3);
  const cx = 52;
  const cy = 52;
  softShadow(ctx, () => {
    blob(ctx, cx, cy, 38, n, 5, 0.18, variant);
    ctx.fill();
  }, 0.7, 12, 8, 11);
  blob(ctx, cx, cy, 38, n, 5, 0.18, variant);
  const g = ctx.createRadialGradient(cx - 14, cy - 16, 4, cx, cy, 44);
  g.addColorStop(0, 'rgb(112,110,102)');
  g.addColorStop(0.55, 'rgb(76,75,70)');
  g.addColorStop(1, 'rgb(42,42,40)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Facets, cracks and moss.
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(20,20,18,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = cx + rng.range(-25, 25);
    let y = cy + rng.range(-25, 25);
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rng.range(-9, 9);
      y += rng.range(-9, 9);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  leafSpecks(ctx, rng, cx + 10, cy + 12, 22, 60, [70, 82, 50], [38, 46, 30]);
  ctx.restore();
  return c;
};

export const logProp: CanvasGen = () => {
  const [c, ctx] = canvas(160, 48);
  const rng = new Rng(598);
  softShadow(ctx, () => {
    roundRect(ctx, 8, 12, 144, 24, 12);
    ctx.fill();
  }, 0.7, 10, 6, 9);
  roundRect(ctx, 8, 12, 144, 24, 12);
  const g = ctx.createLinearGradient(0, 12, 0, 36);
  g.addColorStop(0, 'rgb(96,82,64)');
  g.addColorStop(0.45, 'rgb(66,54,42)');
  g.addColorStop(1, 'rgb(30,24,18)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,10,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const y = rng.range(15, 33);
    const x = rng.range(14, 120);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(10, 26), y + rng.range(-1, 1));
    ctx.stroke();
  }
  // Cut end with rings.
  ellipse(ctx, 148, 24, 6, 11.5);
  ctx.fillStyle = 'rgb(120,102,78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,46,32,0.7)';
  for (const r of [3, 6, 9]) {
    ellipse(ctx, 148, 24, r * 0.5, r);
    ctx.stroke();
  }
  return c;
};

export const bush: CanvasGen = (variant) => {
  const size = 104;
  const [c, ctx] = canvas(size);
  const rng = new Rng(630 + variant);
  const clumps: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) clumps.push([48 + rng.range(-16, 16), 48 + rng.range(-16, 16), rng.range(13, 22)]);
  softShadow(ctx, () => {
    for (const [x, y, r] of clumps) {
      circle(ctx, x, y, r);
      ctx.fill();
    }
  }, 0.65, 10, 7, 10);
  const n = noise1D(variant * 5 + 1);
  for (const [x, y, r] of clumps) {
    blob(ctx, x, y, r, n, 6, 0.15, x);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 1, x, y, r);
    g.addColorStop(0, 'rgb(62,68,42)');
    g.addColorStop(1, 'rgb(24,30,20)');
    ctx.fillStyle = g;
    ctx.fill();
    leafSpecks(ctx, rng, x, y, r * 0.85, 30, [80, 86, 54], [26, 30, 20]);
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
/** Shane Jeans: double denim. */
const SHANE_LOOK: Look = { skin: '#e0b890', hair: '#3a2a1c', style: 'long', shirt: '#d8d0c0', pants: '#3a5a8a', shoes: '#2a2622', jacket: '#4a6a9a' };
/** Chris Zelley: paramedic greens with hi-vis stripes. */
const CHRIS_LOOK: Look = { skin: '#d7a67c', hair: '#2a1e16', style: 'buzz', shirt: '#e8ecee', pants: '#1f3a2a', shoes: '#1a1a1a', jacket: '#2f7a4a' };
/** Marc Cortez: a red flannel over a white tee, jeans. */
const MARC_LOOK: Look = { skin: '#c68a5e', hair: '#1e1612', style: 'short', shirt: '#e8e4dc', pants: '#3c4a6a', shoes: '#4a3424', jacket: '#9a2a24' };
/** Plasma.TTV: black gaming hoodie, headset. */
const PLASMA_LOOK: Look = { skin: '#e8c0a0', hair: '#2a1e1a', style: 'curly', shirt: '#2a2a30', pants: '#26262c', shoes: '#e8e8ec', jacket: '#1c1c22' };
/** Jaden Nguyen: backwards cap, olive bomber over a white tee. */
const JADEN_LOOK: Look = { skin: '#d8b08a', hair: '#121010', style: 'cap', hat: '#1e1e22', shirt: '#eeeeee', pants: '#2a2a30', shoes: '#e8e8e8', jacket: '#4e5a36' };
const WAZ_LOOK: Look = { skin: '#8a5a38', hair: '#0e0c0c', style: 'short', shirt: '#2f8a3a', pants: '#2e3442', shoes: '#1c1c1e' };
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

export const survivorLegs: CanvasGen = (variant) => legCanvas(variant >= 31 ? CHRIS_LOOK : variant >= 30 ? SHANE_LOOK : variant === 21 ? MARC_LOOK : variant === 22 ? PLASMA_LOOK : variant === 23 ? JADEN_LOOK : variant === 24 ? WAZ_LOOK : variant >= 20 ? SEXTON_LOOK : variant >= 10 ? HUNTER_LOOK : SURVIVOR_LOOKS[variant % SURVIVOR_LOOKS.length], variant >= 10 && variant < 20 ? 1.3 : 1);

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

export const shane: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, SHANE_LOOK, 30, 32, 1);
  return c;
};

/** A slain NPC lying face down in a pool of blood. */
function corpse(look: Look): HTMLCanvasElement {
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
}

export const sextonDead: CanvasGen = () => corpse(SEXTON_LOOK);

/** Chris Zelley: paramedic, with hi-vis shoulder stripes and a star of life on his back. */
export const chris: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, CHRIS_LOOK, 30, 32, 1);
  ctx.strokeStyle = '#e8e24a';
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(24, 32 + side * 10);
    ctx.lineTo(34, 32 + side * 12);
    ctx.stroke();
  }
  circle(ctx, 24, 32, 4.2);
  fillInk(ctx, '#f4f4f4', 1);
  ctx.fillStyle = '#2d6fe8';
  ctx.fillRect(22.9, 29.2, 2.2, 5.6);
  ctx.fillRect(21.2, 30.9, 5.6, 2.2);
  return c;
};

export const chrisDead: CanvasGen = () => corpse(CHRIS_LOOK);

/** Jaden Nguyen. */
export const jaden: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, JADEN_LOOK, 30, 32, 1);
  return c;
};

/** Waz: brown skin, black hair, a green shirt. */
export const waz: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, WAZ_LOOK, 30, 32, 1);
  return c;
};

/** Marc Cortez: red flannel with a check pattern on the shoulders. */
export const marc: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, MARC_LOOK, 30, 32, 1);
  ctx.strokeStyle = 'rgba(20,10,10,0.45)';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(22 + i * 4, 32 + side * 9);
      ctx.lineTo(24 + i * 4, 32 + side * 15);
      ctx.stroke();
    }
  }
  return c;
};

/** Plasma.TTV in human form: a guy in a black hoodie with a gaming headset. */
export const plasma: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  person(ctx, PLASMA_LOOK, 30, 32, 1);
  // Headset band over the head and cups at the ears.
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(31, 23);
  ctx.lineTo(31, 41);
  ctx.stroke();
  for (const y of [22.5, 41.5]) {
    roundRect(ctx, 28, y - 3, 7, 6, 2);
    fillInk(ctx, '#1a1a1a', 1);
    ctx.fillStyle = y < 32 ? '#ff2a8a' : '#2af0ff';
    ctx.fillRect(29.5, y - 1, 4, 2);
  }
  return c;
};

/** Plasma.TTV in GAMER RAGE: a hulking brute, huge fists forward, torn hoodie, glowing eyes. */
export const plasmaBeast: CanvasGen = () => {
  const [c, ctx] = canvas(110, 96);
  const cx = 46;
  const cy = 48;
  shadow(ctx, cx + 4, cy + 5, 34, 40, 0.35);
  // Arms: thick, reaching forward to big fists.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + side * 26);
    ctx.quadraticCurveTo(cx + 20, cy + side * 34, cx + 40, cy + side * 18);
    ctx.lineWidth = 19;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#6a4a8a';
    ctx.stroke();
    circle(ctx, cx + 42, cy + side * 17, 11);
    fillInk(ctx, '#8a5aa8', 2);
    ctx.strokeStyle = 'rgba(20,0,30,0.5)';
    ctx.lineWidth = 1.5;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(cx + 47, cy + side * 17 + k * 4);
      ctx.lineTo(cx + 52, cy + side * 17 + k * 4);
      ctx.stroke();
    }
  }
  // Hunched torso in a torn black hoodie; bulging shoulders.
  ellipse(ctx, cx, cy, 24, 33);
  fillInk(ctx, '#1c1c22', 2.2);
  for (const side of [-1, 1]) {
    ellipse(ctx, cx + 2, cy + side * 22, 13, 12);
    fillInk(ctx, '#7a52a0', 2);
  }
  ctx.strokeStyle = '#8a5aa8';
  ctx.lineWidth = 2;
  for (const [x, y] of [
    [cx - 10, cy - 8],
    [cx - 4, cy + 10],
    [cx - 14, cy + 4],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 7, y + 3);
    ctx.lineTo(x + 3, y + 7);
    ctx.stroke();
  }
  // Small head sunk between the shoulders, glowing eyes, a snapped headset.
  circle(ctx, cx + 14, cy, 11);
  fillInk(ctx, '#8a5aa8', 2);
  ctx.fillStyle = '#2a1e1a';
  ellipse(ctx, cx + 10, cy, 8, 10);
  ctx.fill();
  ctx.fillStyle = '#ff2a2a';
  for (const y of [-4, 4]) {
    circle(ctx, cx + 21, cy + y, 2.2);
    ctx.fill();
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + 10, cy - 12);
  ctx.lineTo(cx + 6, cy - 20);
  ctx.stroke();
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

/** Doctor Pepper: a deep red can with a white oval and a dark red "23" swoosh. */
export const itemEnergy = itemCanvas((ctx) => {
  roundRect(ctx, 12, 6, 16, 28, 4);
  fillInk(ctx, '#a3122a');
  ctx.fillStyle = '#d8d8e0';
  ctx.fillRect(13, 6, 14, 3);
  ctx.fillRect(13, 31, 14, 2);
  // The white oval label.
  ellipse(ctx, 20, 19, 6, 7.5);
  fillInk(ctx, '#f4f0ea', 1);
  ctx.strokeStyle = '#6a0a18';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(16.5, 21);
  ctx.quadraticCurveTo(20, 14, 23.5, 17);
  ctx.stroke();
  ctx.fillStyle = '#6a0a18';
  ctx.fillRect(17, 22, 6, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(14, 10, 2.5, 18);
});

/** The Grapes of Wrath: a worn hardback, grape-purple cover and a gold title band. */
export const itemBook = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(20, 20);
  ctx.rotate(-0.2);
  roundRect(ctx, -12, -15, 24, 30, 2);
  fillInk(ctx, '#f0e8d0', 1.4);
  roundRect(ctx, -13, -16, 24, 30, 2);
  fillInk(ctx, '#5a2a6a');
  ctx.fillStyle = '#3e1a4a';
  ctx.fillRect(-13, -16, 4, 30);
  ctx.fillStyle = '#d8b04a';
  ctx.fillRect(-7, -9, 16, 3);
  ctx.fillRect(-7, -4, 12, 1.5);
  // A small bunch of grapes.
  ctx.fillStyle = '#9a5ab8';
  for (const [x, y] of [
    [1, 4],
    [5, 4],
    [3, 7],
    [-1, 7],
    [1, 10],
  ]) {
    circle(ctx, x, y, 2);
    ctx.fill();
  }
  ctx.restore();
});

/** Mr Beast bar: a chocolate bar half out of its bright blue wrapper. */
export const itemBeastBar = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(20, 20);
  ctx.rotate(-0.35);
  // Chocolate, in squares.
  roundRect(ctx, -16, -8, 18, 16, 1.5);
  fillInk(ctx, '#5a3218');
  ctx.strokeStyle = '#3a1e0c';
  ctx.lineWidth = 1;
  for (const x of [-10, -4]) {
    ctx.beginPath();
    ctx.moveTo(x, -8);
    ctx.lineTo(x, 8);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(2, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,220,180,0.25)';
  ctx.fillRect(-15, -7, 16, 2);
  // Wrapper.
  roundRect(ctx, 0, -9, 17, 18, 2);
  fillInk(ctx, '#2a8cff');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BEAST', 8.5, 2);
  ctx.fillStyle = '#ffd23a';
  ctx.fillRect(1, 5, 15, 2);
  ctx.restore();
});

/** Mini shield: a small round flask of glowing blue liquid with a stopper, Fortnite style. */
export const itemShield = itemCanvas((ctx) => {
  // Glow.
  const g = ctx.createRadialGradient(20, 24, 2, 20, 24, 16);
  g.addColorStop(0, 'rgba(90,190,255,0.55)');
  g.addColorStop(1, 'rgba(90,190,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 40, 40);
  // Neck and stopper.
  roundRect(ctx, 17, 8, 6, 8, 1.5);
  fillInk(ctx, '#d8eefc', 1.2);
  roundRect(ctx, 16, 5, 8, 5, 1.5);
  fillInk(ctx, '#9a6a3a', 1.2);
  // Round flask.
  circle(ctx, 20, 25, 10);
  fillInk(ctx, '#bfe4ff', 1.4);
  ctx.save();
  circle(ctx, 20, 25, 9);
  ctx.clip();
  ctx.fillStyle = '#2e9cff';
  ctx.fillRect(9, 23, 22, 14);
  ctx.fillStyle = '#7fd0ff';
  ctx.fillRect(9, 23, 22, 2);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ellipse(ctx, 16, 21, 2, 3.5, -0.4);
  ctx.fill();
});

/** Jaden's P250: a compact black handgun. */
export const itemPistol = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(20, 20);
  ctx.rotate(-0.3);
  roundRect(ctx, -12, -6, 26, 7, 1.5);
  fillInk(ctx, '#2a2a2e');
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 12);
  ctx.lineTo(-12, 12);
  ctx.closePath();
  fillInk(ctx, '#1c1c20');
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(-1, 3, 3, 0, Math.PI);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-10, -5, 20, 1.5);
  ctx.restore();
});

/**
 * Galaxy gas trap: a Galaxy Gas-style nitrous canister (a big whippit tank): a stout
 * cylinder wrapped in a colourful galaxy label, a silver shoulder and a valve on top.
 */
export const itemTrap = itemCanvas((ctx) => {
  // Body with the galaxy wrap.
  roundRect(ctx, 11, 12, 18, 25, 5);
  fillInk(ctx, '#1a1030', 1.6);
  ctx.save();
  roundRect(ctx, 11, 12, 18, 25, 5);
  ctx.clip();
  const g = ctx.createLinearGradient(11, 12, 29, 37);
  g.addColorStop(0, '#2a1a6a');
  g.addColorStop(0.35, '#b03ad8');
  g.addColorStop(0.6, '#ff5ab0');
  g.addColorStop(0.85, '#3a6aff');
  g.addColorStop(1, '#1a1030');
  ctx.fillStyle = g;
  ctx.fillRect(11, 16, 18, 17);
  // Stars.
  ctx.fillStyle = '#ffffff';
  for (const [x, y, r] of [
    [14, 19, 0.9],
    [25, 22, 1.1],
    [18, 29, 0.8],
    [23, 31, 0.7],
    [16, 24, 0.6],
  ]) {
    circle(ctx, x, y, r);
    ctx.fill();
  }
  // Label band and a highlight down the side.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(11, 25, 18, 1.2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(13, 12, 3, 25);
  ctx.restore();
  // Silver shoulder, neck and valve.
  ctx.beginPath();
  ctx.moveTo(11.5, 14);
  ctx.quadraticCurveTo(20, 4, 28.5, 14);
  ctx.closePath();
  fillInk(ctx, '#c9d2dc', 1.4);
  roundRect(ctx, 17, 4, 6, 5, 1.5);
  fillInk(ctx, '#9aa4b0', 1.2);
  roundRect(ctx, 15, 2, 10, 3, 1.5);
  fillInk(ctx, '#1a1a1a', 1);
  roundRect(ctx, 22, 5, 6, 2.4, 1);
  fillInk(ctx, '#7a8490', 1);
});

/** Plasma's golden pump: a gold tactical shotgun (the legendary drop). */
export const itemGoldenPump = itemCanvas((ctx) => {
  ctx.save();
  ctx.translate(24, 22);
  ctx.rotate(-0.3);
  // Stock.
  ctx.beginPath();
  ctx.moveTo(-22, -3);
  ctx.lineTo(-9, -4);
  ctx.lineTo(-7, 3);
  ctx.lineTo(-20, 6);
  ctx.closePath();
  fillInk(ctx, '#b8862a');
  // Receiver.
  roundRect(ctx, -10, -5, 16, 8, 2);
  fillInk(ctx, '#f0c040', 1.4);
  ctx.fillStyle = '#fff0a0';
  ctx.fillRect(-8, -4, 12, 1.5);
  // Barrel and magazine tube.
  roundRect(ctx, 4, -4.5, 20, 3.4, 1);
  fillInk(ctx, '#d8a830', 1.2);
  roundRect(ctx, 4, -0.8, 17, 2.6, 1);
  fillInk(ctx, '#a07820', 1.1);
  // Pump grip.
  roundRect(ctx, 8, -1.6, 9, 4.6, 1.5);
  fillInk(ctx, '#2a2218', 1.1);
  // Grip.
  roundRect(ctx, -9, 2, 4, 6, 1.5);
  fillInk(ctx, '#b8862a', 1.1);
  ctx.restore();
}, 48);

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
  shane,
  chris,
  chrisDead,
  marc,
  jaden,
  waz,
  plasma,
  plasmaBeast,
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
  itemBook,
  itemPistol,
  itemBeastBar,
  itemShield,
  itemTrap,
  itemGoldenPump,
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
 * Default anchor (pivot) per generator: trees and rocks pivot on their crown (the canvas has
 * extra room for the cast shadow). Everything else is centred. The manifest may override it.
 */

/**
 * Darkwood grade: pulls every sprite toward flat, desaturated, dim colours. Ground tiles are
 * already painted in that palette; effects (glows, gas, blood) keep their colour.
 */
export function gradeCanvas(c: HTMLCanvasElement, saturation = 0.5, brightness = 0.86): HTMLCanvasElement {
  const ctx = c.getContext('2d');
  if (!ctx || !c.width || !c.height) return c;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    // A faint warm-olive cast, like the screenshots.
    d[i] = (l + (d[i] - l) * saturation) * brightness * 1.02;
    d[i + 1] = (l + (d[i + 1] - l) * saturation) * brightness;
    d[i + 2] = (l + (d[i + 2] - l) * saturation) * brightness * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
export const TEXTURE_ANCHORS: Record<string, [number, number]> = {
  treePine: [120 / 256, 118 / 256],
  treeOak: [120 / 256, 118 / 256],
  treeDead: [120 / 256, 118 / 256],
  boulder: [52 / 112, 52 / 112],
  machete: [0.06, 0.5],
  survivorLegs: [0.12, 0.5],
  door: [0.05, 0.5],
};
