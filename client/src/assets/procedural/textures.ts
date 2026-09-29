import { Rng } from '@manhunt/shared';
import { noise1D, tileFbm } from './noise';

/**
 * Procedural texture generators. Each returns a canvas. Everything is drawn top-down,
 * facing +x (right) where orientation matters, in a desaturated, murky palette. The
 * lighting shader carries most of the look, so these stay dark and low-contrast.
 */

export type CanvasGen = (variant: number) => HTMLCanvasElement;

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hex(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

type RGB = readonly [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Fills a tile from a noise field mapped between two colours, with extra grain. */
function noiseTile(size: number, period: number, seed: number, dark: RGB, light: RGB, grain = 10): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [c, ctx] = canvas(size);
  const n = tileFbm(size, period, 4, seed);
  const img = ctx.createImageData(size, size);
  const rng = new Rng(seed ^ 0xabcdef);
  for (let i = 0; i < n.length; i++) {
    const t = n[i];
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

export const groundForest: CanvasGen = () => {
  const size = 512;
  const [c, ctx] = noiseTile(size, 6, 11, [22, 24, 16], [52, 48, 32], 14);
  const rng = new Rng(77);
  // Moss patches.
  const moss = tileFbm(size, 4, 3, 99);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < moss.length; i++) {
    const m = Math.max(0, moss[i] - 0.55) * 2.2;
    img.data[i * 4] = img.data[i * 4] * (1 - m) + 40 * m;
    img.data[i * 4 + 1] = img.data[i * 4 + 1] * (1 - m) + 50 * m;
    img.data[i * 4 + 2] = img.data[i * 4 + 2] * (1 - m) + 28 * m;
  }
  ctx.putImageData(img, 0, 0);
  // Leaf litter and twigs.
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(2, 7);
    const shade = rng.range(0, 1);
    ctx.fillStyle = shade < 0.5 ? hex(58, 44, 28) : hex(34, 30, 20);
    wrapDraw(size, x, y, 8, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.strokeStyle = hex(30, 26, 18);
  ctx.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(6, 18);
    wrapDraw(size, x, y, 20, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
  // Grass tufts.
  for (let i = 0; i < 500; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.strokeStyle = rng.chance(0.5) ? hex(52, 60, 34) : hex(40, 46, 28);
    wrapDraw(size, x, y, 6, (px, py) => {
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + rng.range(-0.8, 0.8);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * 5, py + Math.sin(a) * 5);
        ctx.stroke();
      }
    });
  }
  return c;
};

export const groundPath: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 8, 21, [44, 36, 26], [74, 60, 42], 16);
  const rng = new Rng(5);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rng.chance(0.5) ? hex(60, 52, 42) : hex(36, 30, 22);
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(1, 3);
    wrapDraw(size, x, y, 4, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return c;
};

export const groundConcrete: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = noiseTile(size, 8, 31, [52, 52, 48], [76, 75, 70], 12);
  const stains = tileFbm(size, 4, 3, 32);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < stains.length; i++) {
    const s = Math.max(0, stains[i] - 0.5) * 1.6;
    img.data[i * 4] *= 1 - s * 0.5;
    img.data[i * 4 + 1] *= 1 - s * 0.5;
    img.data[i * 4 + 2] *= 1 - s * 0.55;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(20,20,18,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  const rng = new Rng(8);
  ctx.strokeStyle = 'rgba(25,25,22,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rng.range(10, size - 10);
    let y = rng.range(10, size - 10);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
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
  const [c, ctx] = noiseTile(size, 16, 41, [46, 34, 22], [72, 54, 34], 10);
  const plank = 32;
  for (let y = 0; y < size; y += plank) {
    ctx.fillStyle = 'rgba(18,12,8,0.8)';
    ctx.fillRect(0, y, size, 2);
    const off = ((y / plank) % 2) * 96;
    ctx.fillRect((off + 60) % size, y, 2, plank);
    ctx.fillRect((off + 188) % size, y, 2, plank);
  }
  const rng = new Rng(3);
  ctx.strokeStyle = 'rgba(30,20,12,0.4)';
  for (let i = 0; i < 80; i++) {
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
  const [c, ctx] = noiseTile(size, 4, 51, [14, 22, 26], [30, 44, 48], 6);
  const rng = new Rng(6);
  ctx.strokeStyle = 'rgba(70,90,92,0.18)';
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    wrapDraw(size, x, y, 30, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, rng.range(8, 26), rng.range(2, 5), 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  return c;
};

export const tallGrass: CanvasGen = (variant) => {
  const size = 128;
  const [c, ctx] = canvas(size);
  const rng = new Rng(600 + variant);
  for (let i = 0; i < 260; i++) {
    const x = rng.range(10, size - 10);
    const y = rng.range(10, size - 10);
    const d = Math.hypot(x - size / 2, y - size / 2);
    if (d > size / 2 - 6) continue;
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(6, 16);
    const g = rng.range(0, 1);
    ctx.strokeStyle = hex(38 + g * 30, 46 + g * 34, 24 + g * 14);
    ctx.lineWidth = rng.range(1, 2.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return c;
};

/** Pine seen from above: layered star of needle clusters, dark core. */
export const treePine: CanvasGen = (variant) => {
  const size = 160;
  const [c, ctx] = canvas(size);
  const rng = new Rng(100 + variant);
  const cx = size / 2;
  const cy = size / 2;
  // Ground shadow, offset.
  const shadow = ctx.createRadialGradient(cx + 10, cy + 12, 10, cx + 10, cy + 12, 74);
  shadow.addColorStop(0, 'rgba(0,0,0,0.55)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);
  const layers = 4;
  for (let l = 0; l < layers; l++) {
    const rad = 64 - l * 13;
    const spikes = 11 + l * 2;
    const n = noise1D(variant * 13 + l);
    const shade = 22 + l * 9;
    ctx.fillStyle = hex(shade * 0.85, shade * 1.15, shade * 0.75);
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + l * 0.3;
      const r = i % 2 === 0 ? rad * (0.85 + n(i * 0.7) * 0.25) : rad * 0.55;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // Needle strokes.
    ctx.strokeStyle = hex(shade * 1.2, shade * 1.5, shade);
    ctx.lineWidth = 1;
    for (let k = 0; k < 40; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r0 = rng.range(0, rad * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + 6), cy + Math.sin(a) * (r0 + 6));
      ctx.stroke();
    }
  }
  ctx.fillStyle = hex(36, 28, 20);
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

/** Dead tree seen from above: trunk with gnarled radiating branches. */
export const treeDead: CanvasGen = (variant) => {
  const size = 160;
  const [c, ctx] = canvas(size);
  const rng = new Rng(200 + variant);
  const cx = size / 2;
  const cy = size / 2;
  const shadow = ctx.createRadialGradient(cx + 8, cy + 10, 6, cx + 8, cy + 10, 60);
  shadow.addColorStop(0, 'rgba(0,0,0,0.45)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    if (depth === 0 || len < 4) return;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    ctx.strokeStyle = hex(40 + depth * 3, 33 + depth * 2, 25 + depth);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, ex, ey);
    ctx.stroke();
    const kids = rng.int(1, 3);
    for (let k = 0; k < kids; k++) branch(ex, ey, a + rng.range(-0.7, 0.7), len * rng.range(0.55, 0.75), w * 0.65, depth - 1);
  };
  const count = rng.int(5, 8);
  for (let i = 0; i < count; i++) {
    branch(cx, cy, (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3), rng.range(22, 34), 6, 4);
  }
  const bark = ctx.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, 16);
  bark.addColorStop(0, hex(74, 60, 44));
  bark.addColorStop(1, hex(34, 26, 18));
  ctx.fillStyle = bark;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,10,0.7)';
  ctx.lineWidth = 1;
  for (let r = 4; r < 14; r += 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
};

export const boulder: CanvasGen = (variant) => {
  const size = 128;
  const [c, ctx] = canvas(size);
  const n = noise1D(300 + variant);
  const cx = size / 2;
  const cy = size / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 44 * (0.8 + n(i * 0.5) * 0.3);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 7, y + 8) : ctx.moveTo(x + 7, y + 8)));
  ctx.fill();
  const g = ctx.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, 50);
  g.addColorStop(0, hex(96, 94, 86));
  g.addColorStop(1, hex(46, 45, 42));
  ctx.fillStyle = g;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,28,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const rng = new Rng(variant + 9);
  ctx.fillStyle = 'rgba(52,64,40,0.5)';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(cx + rng.range(-25, 25), cy + rng.range(-25, 25), rng.range(2, 7), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
};

export const logProp: CanvasGen = () => {
  const [c, ctx] = canvas(160, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(10, 16, 146, 26);
  const g = ctx.createLinearGradient(0, 8, 0, 38);
  g.addColorStop(0, hex(78, 60, 40));
  g.addColorStop(0.5, hex(56, 42, 28));
  g.addColorStop(1, hex(30, 22, 14));
  ctx.fillStyle = g;
  ctx.fillRect(8, 9, 144, 28);
  ctx.strokeStyle = 'rgba(24,16,10,0.6)';
  for (let x = 14; x < 150; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x + 5, 36);
    ctx.stroke();
  }
  ctx.fillStyle = hex(92, 74, 50);
  ctx.beginPath();
  ctx.ellipse(152, 23, 5, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

export const bush: CanvasGen = (variant) => {
  const size = 96;
  const [c, ctx] = canvas(size);
  const rng = new Rng(400 + variant);
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 26);
    const s = rng.range(10, 18);
    const shade = rng.range(20, 40);
    ctx.fillStyle = hex(shade, shade * 1.25, shade * 0.8);
    ctx.beginPath();
    ctx.arc(48 + Math.cos(a) * r, 48 + Math.sin(a) * r, s, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
};

export const CHARACTER_TINTS = [
  0x8a7a58, 0x5d7282, 0x8a5656, 0x677f5b, 0x76628a, 0x8c8062, 0x55726f, 0x857070, 0x6e7c90, 0x7f6a4a,
] as const;

/** Survivor seen from above, facing +x, holding a flashlight. Greyscale body, tinted at runtime. */
export const survivor: CanvasGen = () => {
  const size = 64;
  const [c, ctx] = canvas(size);
  const cx = 32;
  const cy = 32;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 4, 17, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  // Arms reaching forward.
  ctx.fillStyle = hex(190, 190, 190);
  ctx.beginPath();
  ctx.ellipse(cx + 10, cy - 8, 9, 4, 0.25, 0, Math.PI * 2);
  ctx.ellipse(cx + 10, cy + 8, 9, 4, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // Flashlight.
  ctx.fillStyle = hex(40, 40, 40);
  ctx.fillRect(cx + 15, cy - 3, 12, 6);
  ctx.fillStyle = hex(255, 240, 200);
  ctx.fillRect(cx + 26, cy - 3, 2, 6);
  // Torso / shoulders.
  const body = ctx.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, 16);
  body.addColorStop(0, hex(235, 235, 235));
  body.addColorStop(1, hex(150, 150, 150));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 10, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head.
  ctx.fillStyle = hex(120, 96, 78);
  ctx.beginPath();
  ctx.arc(cx + 1, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(60, 46, 36);
  ctx.beginPath();
  ctx.arc(cx - 1, cy, 6, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();
  return c;
};

export const survivorDowned: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = 'rgba(80,6,6,0.8)';
  ctx.beginPath();
  ctx.ellipse(30, 34, 22, 14, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(170, 170, 170);
  ctx.beginPath();
  ctx.ellipse(32, 32, 18, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(120, 96, 78);
  ctx.beginPath();
  ctx.arc(50, 32, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(170, 170, 170);
  ctx.fillRect(12, 22, 14, 4);
  ctx.fillRect(14, 40, 16, 4);
  return c;
};

/** Zach Branch: heavy build, hockey mask, machete, facing +x. */
export const hunter: CanvasGen = () => {
  const size = 80;
  const [c, ctx] = canvas(size);
  const cx = 38;
  const cy = 40;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 5, 23, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  // Machete arm (right side = +y in screen when facing +x).
  ctx.fillStyle = hex(44, 38, 32);
  ctx.beginPath();
  ctx.ellipse(cx + 12, cy + 13, 11, 5, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(150, 150, 146);
  ctx.beginPath();
  ctx.moveTo(cx + 20, cy + 12);
  ctx.lineTo(cx + 40, cy + 8);
  ctx.lineTo(cx + 42, cy + 12);
  ctx.lineTo(cx + 22, cy + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(110,10,10,0.8)';
  ctx.fillRect(cx + 32, cy + 9, 7, 3);
  ctx.fillStyle = hex(44, 38, 32);
  ctx.beginPath();
  ctx.ellipse(cx + 10, cy - 13, 10, 5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Torso: dark worn jacket.
  const body = ctx.createRadialGradient(cx - 4, cy - 4, 3, cx, cy, 22);
  body.addColorStop(0, hex(66, 58, 50));
  body.addColorStop(1, hex(28, 24, 20));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 13, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hockey mask.
  ctx.fillStyle = hex(214, 208, 190);
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(20, 16, 14);
  for (const [dx, dy] of [
    [6, -3],
    [6, 3],
    [2, -5],
    [2, 5],
    [9, 0],
  ]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(140,16,16,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - 6);
  ctx.lineTo(cx + 8, cy - 4);
  ctx.moveTo(cx - 2, cy + 6);
  ctx.lineTo(cx + 8, cy + 4);
  ctx.stroke();
  return c;
};

export const generator: CanvasGen = (variant) => {
  const [c, ctx] = canvas(80, 64);
  const on = variant === 1;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(10, 12, 64, 48);
  ctx.fillStyle = hex(70, 64, 44);
  ctx.fillRect(6, 6, 64, 48);
  ctx.fillStyle = hex(92, 84, 58);
  ctx.fillRect(10, 10, 56, 18);
  ctx.fillStyle = hex(40, 38, 32);
  for (let x = 12; x < 64; x += 6) ctx.fillRect(x, 32, 3, 18);
  ctx.fillStyle = hex(30, 28, 24);
  ctx.beginPath();
  ctx.arc(56, 42, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = on ? hex(255, 214, 120) : hex(60, 20, 18);
  ctx.beginPath();
  ctx.arc(18, 18, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(28, 26, 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, 64, 48);
  return c;
};

export const locker: CanvasGen = () => {
  const [c, ctx] = canvas(48, 40);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(6, 6, 42, 34);
  ctx.fillStyle = hex(68, 76, 74);
  ctx.fillRect(2, 2, 40, 32);
  ctx.fillStyle = hex(40, 44, 42);
  for (let y = 6; y < 30; y += 5) ctx.fillRect(30, y, 9, 2);
  ctx.strokeStyle = hex(30, 32, 30);
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 40, 32);
  ctx.fillStyle = hex(120, 90, 50);
  ctx.fillRect(34, 16, 3, 4);
  return c;
};

export const wardrobe: CanvasGen = () => {
  const [c, ctx] = canvas(64, 44);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(6, 6, 58, 38);
  ctx.fillStyle = hex(62, 44, 30);
  ctx.fillRect(2, 2, 56, 36);
  ctx.strokeStyle = hex(32, 22, 14);
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 56, 36);
  ctx.beginPath();
  ctx.moveTo(30, 2);
  ctx.lineTo(30, 38);
  ctx.stroke();
  ctx.fillStyle = hex(30, 22, 16);
  for (let y = 8; y < 34; y += 5) ctx.fillRect(46, y, 8, 2);
  return c;
};

export const bed: CanvasGen = () => {
  const [c, ctx] = canvas(96, 56);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(6, 8, 88, 46);
  ctx.fillStyle = hex(58, 42, 30);
  ctx.fillRect(2, 4, 88, 46);
  ctx.fillStyle = hex(112, 104, 88);
  ctx.fillRect(6, 8, 80, 38);
  ctx.fillStyle = hex(140, 132, 116);
  ctx.fillRect(68, 12, 16, 30);
  ctx.fillStyle = 'rgba(90,20,18,0.5)';
  ctx.beginPath();
  ctx.ellipse(36, 30, 14, 9, 0.3, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

export const barrel: CanvasGen = () => {
  const [c, ctx] = canvas(56);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(31, 32, 23, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(22, 22, 3, 28, 28, 24);
  g.addColorStop(0, hex(96, 60, 36));
  g.addColorStop(1, hex(42, 26, 16));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(28, 28, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(30, 30, 30);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(28, 28, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = hex(26, 20, 16);
  ctx.beginPath();
  ctx.arc(28, 28, 5, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

export const stake: CanvasGen = () => {
  const [c, ctx] = canvas(72);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(40, 40, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(70, 54, 36);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(8, 36);
  ctx.lineTo(64, 36);
  ctx.moveTo(36, 12);
  ctx.lineTo(36, 60);
  ctx.stroke();
  // Straw and rags.
  const rng = new Rng(44);
  ctx.strokeStyle = hex(120, 104, 60);
  ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const x = rng.range(24, 48);
    const y = rng.range(24, 48);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-6, 6), y + rng.range(-6, 6));
    ctx.stroke();
  }
  ctx.fillStyle = hex(80, 20, 18);
  ctx.beginPath();
  ctx.arc(36, 36, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(110, 110, 110);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 36);
  ctx.quadraticCurveTo(46, 30, 50, 22);
  ctx.stroke();
  return c;
};

export const gate: CanvasGen = (variant) => {
  const open = variant === 1;
  const [c, ctx] = canvas(160, 24);
  ctx.fillStyle = hex(60, 58, 54);
  ctx.fillRect(0, 4, 10, 16);
  ctx.fillRect(150, 4, 10, 16);
  if (!open) {
    ctx.strokeStyle = hex(120, 120, 114);
    ctx.lineWidth = 1;
    for (let x = 10; x < 150; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x + 6, 18);
      ctx.moveTo(x + 6, 6);
      ctx.lineTo(x, 18);
      ctx.stroke();
    }
    ctx.fillStyle = hex(90, 88, 80);
    ctx.fillRect(10, 5, 140, 3);
    ctx.fillRect(10, 16, 140, 3);
  }
  return c;
};

export const barricade: CanvasGen = (variant) => {
  const down = variant === 1;
  const [c, ctx] = canvas(96, down ? 40 : 20);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(6, 6, 90, down ? 34 : 14);
  ctx.fillStyle = hex(84, 64, 40);
  if (down) {
    for (let y = 2; y < 36; y += 8) ctx.fillRect(2, y, 88, 6);
    ctx.fillStyle = hex(50, 38, 24);
    ctx.fillRect(10, 2, 6, 34);
    ctx.fillRect(74, 2, 6, 34);
  } else {
    ctx.fillRect(2, 4, 88, 10);
    ctx.fillStyle = hex(50, 38, 24);
    for (let x = 8; x < 88; x += 16) ctx.fillRect(x, 4, 3, 10);
  }
  return c;
};

export const windowFrame: CanvasGen = () => {
  const [c, ctx] = canvas(80, 16);
  ctx.fillStyle = hex(58, 46, 32);
  ctx.fillRect(0, 2, 80, 12);
  ctx.fillStyle = hex(26, 34, 36);
  ctx.fillRect(6, 5, 68, 6);
  ctx.fillStyle = 'rgba(160,180,180,0.35)';
  ctx.fillRect(10, 6, 20, 2);
  ctx.fillRect(46, 8, 12, 2);
  return c;
};

export const campfire: CanvasGen = () => {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = hex(40, 38, 36);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = hex(60, 40, 24);
  ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(32 - Math.cos(a) * 14, 32 - Math.sin(a) * 14);
    ctx.lineTo(32 + Math.cos(a) * 14, 32 + Math.sin(a) * 14);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 13);
  g.addColorStop(0, 'rgba(255,230,160,1)');
  g.addColorStop(0.5, 'rgba(240,120,40,0.9)');
  g.addColorStop(1, 'rgba(160,40,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 13, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

export const lamp: CanvasGen = () => {
  const [c, ctx] = canvas(32);
  ctx.fillStyle = hex(40, 40, 38);
  ctx.fillRect(10, 10, 12, 12);
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 8);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(16, 16, 8, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

function lootIcon(draw: (ctx: CanvasRenderingContext2D) => void): CanvasGen {
  return () => {
    const [c, ctx] = canvas(36);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(20, 21, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    draw(ctx);
    return c;
  };
}

export const lootFuel = lootIcon((ctx) => {
  ctx.fillStyle = hex(150, 30, 24);
  ctx.fillRect(8, 8, 18, 20);
  ctx.fillStyle = hex(40, 36, 30);
  ctx.fillRect(22, 5, 6, 5);
  ctx.strokeStyle = hex(200, 180, 90);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(24, 26);
  ctx.moveTo(24, 10);
  ctx.lineTo(10, 26);
  ctx.stroke();
});

export const lootWire = lootIcon((ctx) => {
  ctx.strokeStyle = hex(170, 100, 50);
  ctx.lineWidth = 2;
  for (let r = 4; r < 12; r += 2.5) {
    ctx.beginPath();
    ctx.arc(18, 18, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = hex(60, 60, 60);
  ctx.beginPath();
  ctx.arc(18, 18, 3, 0, Math.PI * 2);
  ctx.fill();
});

export const lootFlare = lootIcon((ctx) => {
  ctx.fillStyle = hex(190, 40, 30);
  ctx.save();
  ctx.translate(18, 18);
  ctx.rotate(-0.6);
  ctx.fillRect(-11, -3, 22, 6);
  ctx.fillStyle = hex(230, 210, 170);
  ctx.fillRect(9, -3, 4, 6);
  ctx.restore();
});

export const lootBottle = lootIcon((ctx) => {
  ctx.fillStyle = hex(60, 90, 60);
  ctx.save();
  ctx.translate(18, 18);
  ctx.rotate(0.5);
  ctx.beginPath();
  ctx.ellipse(-2, 0, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(5, -2, 9, 4);
  ctx.fillStyle = 'rgba(200,230,200,0.5)';
  ctx.fillRect(-6, -3, 5, 2);
  ctx.restore();
});

export const lootBattery = lootIcon((ctx) => {
  ctx.fillStyle = hex(50, 50, 48);
  ctx.fillRect(9, 11, 18, 12);
  ctx.fillStyle = hex(190, 150, 40);
  ctx.fillRect(9, 11, 7, 12);
  ctx.fillStyle = hex(160, 160, 150);
  ctx.fillRect(27, 15, 3, 4);
});

export const blood: CanvasGen = (variant) => {
  const [c, ctx] = canvas(48);
  const rng = new Rng(700 + variant);
  ctx.fillStyle = 'rgba(96,8,8,0.85)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(24 + rng.range(-12, 12), 24 + rng.range(-12, 12), rng.range(2, 8), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
};

export const footprint: CanvasGen = () => {
  const [c, ctx] = canvas(24);
  ctx.fillStyle = 'rgba(200,190,150,0.9)';
  ctx.beginPath();
  ctx.ellipse(12, 8, 4, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(12, 18, 3, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
};

/** Soft radial glow used for light halos, flares and echoes. */
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

export const fog: CanvasGen = () => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const n = tileFbm(size, 4, 4, 808);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(0, n[i] - 0.35) * 1.6;
    img.data[i * 4] = 200;
    img.data[i * 4 + 1] = 210;
    img.data[i * 4 + 2] = 205;
    img.data[i * 4 + 3] = Math.min(255, v * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

export const spark: CanvasGen = () => {
  const [c, ctx] = canvas(8);
  ctx.fillStyle = 'rgba(255,220,140,1)';
  ctx.fillRect(2, 2, 4, 4);
  return c;
};

export const dock: CanvasGen = () => groundWood(0);

export const TEXTURE_GENERATORS: Record<string, CanvasGen> = {
  groundForest,
  groundPath,
  groundConcrete,
  groundWood,
  groundWater,
  tallGrass,
  treePine,
  treeDead,
  boulder,
  logProp,
  bush,
  survivor,
  survivorDowned,
  hunter,
  generator,
  locker,
  wardrobe,
  bed,
  barrel,
  stake,
  gate,
  barricade,
  windowFrame,
  campfire,
  lamp,
  lootFuel,
  lootWire,
  lootFlare,
  lootBottle,
  lootBattery,
  blood,
  footprint,
  glow,
  fog,
  spark,
  dock,
};
