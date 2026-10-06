import { GenFlag, NPC_NAMES, type MapData, type WorldState } from '@manhunt/shared';
import { el } from '../ui/dom';

/** World units per pixel of the exploration mask. */
const EXPLORE_CELL = 25;
/** Pixels per world unit of the painted map. */
const ART_SCALE = 0.15;
/** How far (world units) the minimap shows around you. */
const MINI_RADIUS = 950;
const MINI_PX = 196;

const ITEM_COLORS: Record<string, string> = {
  bottle: '#4cff6a',
  goggles: '#5cff9a',
  confit: '#ffb04a',
  shotgun: '#ff6a4a',
  energy: '#d8283a',
  book: '#a86ac8',
  beastbar: '#8a5a2a',
  shield: '#3aa8ff',
  sniper: '#ff2a2a',
  trap: '#d06aff',
};

export interface MiniMapState {
  x: number;
  y: number;
  facing: number;
  world: WorldState;
  now: number;
}

/**
 * Minimap and full map (M). Each player's map starts black and is revealed only where they
 * have actually seen (drawn from their own vision polygons). Nothing is shared between
 * players. Zach starts with the whole map and every stake revealed; JARVIS reveals the
 * whole map for its user and shows Zach as a red dot for 10 seconds. Items appear as
 * glowing dots once seen.
 */
export class MiniMap {
  readonly root: HTMLElement;
  private readonly art: HTMLCanvasElement;
  private readonly explored: HTMLCanvasElement;
  private readonly exCtx: CanvasRenderingContext2D;
  private readonly composed: HTMLCanvasElement;
  private readonly mini: HTMLCanvasElement;
  private readonly full: HTMLCanvasElement;
  private readonly fullWrap: HTMLElement;
  private dirty = true;
  private lastCompose = 0;
  private lastScan = 0;
  private revealedAll = false;
  private readonly seenLoot = new Set<number>();
  private readonly seenGens = new Set<number>();
  private readonly seenStakes = new Set<number>();
  private open = false;
  /** World units the minimap shows around you (JARVIS widens it for good). */
  private radius = MINI_RADIUS;
  /** Testing mode: clicking the full map teleports you there (world coordinates). */
  onTeleport: ((x: number, y: number) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly map: MapData,
    private readonly hunter: boolean,
  ) {
    this.root = el('div', 'minimap');
    this.mini = el('canvas');
    this.mini.width = MINI_PX;
    this.mini.height = MINI_PX;
    this.root.appendChild(this.mini);
    this.root.insertAdjacentHTML('beforeend', '<div class="mm-hint">M · map</div>');
    parent.appendChild(this.root);

    this.fullWrap = el('div', 'fullmap', '<div class="fm-title">MAP</div>');
    this.full = el('canvas');
    this.fullWrap.appendChild(this.full);
    this.fullWrap.insertAdjacentHTML(
      'beforeend',
      `<div class="fm-legend"><span><i style="background:#ffe88c"></i>you</span><span><i style="background:#ffd23a"></i>generator</span><span><i style="background:#4cff6a"></i>item</span>${
        hunter ? '<span><i style="background:#ff3a5a"></i>stake</span>' : '<span><i style="background:#ff3a5a"></i>Zach (JARVIS)</span>'
      }</div>`,
    );
    this.fullWrap.style.display = 'none';
    parent.appendChild(this.fullWrap);
    this.full.addEventListener('pointerdown', (e) => {
      if (!this.onTeleport) return;
      const r = this.full.getBoundingClientRect();
      this.onTeleport(((e.clientX - r.left) / r.width) * map.width, ((e.clientY - r.top) / r.height) * map.height);
    });

    const size = Math.ceil(map.width * ART_SCALE);
    this.art = paintMap(map, ART_SCALE);
    this.explored = el('canvas');
    this.explored.width = Math.ceil(map.width / EXPLORE_CELL);
    this.explored.height = Math.ceil(map.height / EXPLORE_CELL);
    this.exCtx = this.explored.getContext('2d', { willReadFrequently: true })!;
    this.composed = el('canvas');
    this.composed.width = size;
    this.composed.height = size;
    if (hunter) this.revealAll();
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.fullWrap.style.display = this.open ? 'flex' : 'none';
  }

  /** JARVIS: the minimap's view widens (it stays wider for the rest of the match). */
  widenView(mul: number): void {
    this.radius = MINI_RADIUS * mul;
  }

  /** Shows the "click to teleport" hint (testing mode). */
  setTeleport(fn: ((x: number, y: number) => void) | null): void {
    if (this.onTeleport === fn) return;
    this.onTeleport = fn;
    this.fullWrap.classList.toggle('teleport', !!fn);
  }

  /** Reveals the whole map (Zach from the start, survivors with JARVIS). */
  revealAll(): void {
    this.revealedAll = true;
    this.exCtx.fillStyle = '#fff';
    this.exCtx.fillRect(0, 0, this.explored.width, this.explored.height);
    this.dirty = true;
    if (this.hunter) this.map.stakes.forEach((s) => this.seenStakes.add(s.id));
  }

  /** Marks what the player sees right now: their own vision polygons and lit areas in view. */
  reveal(own: number[][], lit: number[][], los: number[] | null): void {
    if (this.revealedAll) return;
    const c = this.exCtx;
    const k = 1 / EXPLORE_CELL;
    const path = (poly: number[]): void => {
      c.beginPath();
      for (let i = 0; i < poly.length; i += 2) {
        if (i === 0) c.moveTo(poly[i] * k, poly[i + 1] * k);
        else c.lineTo(poly[i] * k, poly[i + 1] * k);
      }
      c.closePath();
    };
    c.fillStyle = '#fff';
    for (const p of own) {
      if (p.length < 6) continue;
      path(p);
      c.fill();
    }
    if (lit.length && los && los.length >= 6) {
      // Lit areas only count where you have line of sight to them.
      c.save();
      path(los);
      c.clip();
      for (const p of lit) {
        if (p.length < 6) continue;
        path(p);
        c.fill();
      }
      c.restore();
    }
    this.dirty = true;
  }

  private compose(now: number): void {
    if (!this.dirty || now - this.lastCompose < 200) return;
    this.lastCompose = now;
    this.dirty = false;
    const c = this.composed.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.composed.width, this.composed.height);
    c.drawImage(this.art, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.imageSmoothingEnabled = true;
    c.drawImage(this.explored, 0, 0, this.composed.width, this.composed.height);
    c.globalCompositeOperation = 'source-over';
  }

  /** Every half second: which items, generators and stakes are now in explored areas. */
  private scan(now: number): void {
    if (now - this.lastScan < 500) return;
    this.lastScan = now;
    const w = this.explored.width;
    const data = this.exCtx.getImageData(0, 0, w, this.explored.height).data;
    const seen = (x: number, y: number): boolean => {
      const cx = Math.min(w - 1, Math.max(0, Math.floor(x / EXPLORE_CELL)));
      const cy = Math.min(this.explored.height - 1, Math.max(0, Math.floor(y / EXPLORE_CELL)));
      return data[(cy * w + cx) * 4 + 3] > 120;
    };
    this.map.loot.forEach((l, i) => !this.seenLoot.has(i) && seen(l.x, l.y) && this.seenLoot.add(i));
    this.map.generators.forEach((g, i) => !this.seenGens.has(i) && seen(g.x, g.y) && this.seenGens.add(i));
    this.map.stakes.forEach((s, i) => !this.seenStakes.has(i) && seen(s.x, s.y) && this.seenStakes.add(i));
  }

  update(s: MiniMapState): void {
    this.compose(s.now);
    this.scan(s.now);
    this.drawView(this.mini, s, false);
    if (this.open) {
      const size = Math.floor(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.8));
      if (this.full.width !== size) {
        this.full.width = size;
        this.full.height = size;
      }
      this.drawView(this.full, s, true);
    }
  }

  private drawView(cv: HTMLCanvasElement, s: MiniMapState, whole: boolean): void {
    const c = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    c.clearRect(0, 0, W, H);
    // World -> canvas transform.
    const span = whole ? this.map.width : this.radius * 2;
    const scale = W / span;
    const ox = whole ? 0 : s.x - this.radius;
    const oy = whole ? 0 : s.y - this.radius;
    const tx = (x: number): number => (x - ox) * scale;
    const ty = (y: number): number => (y - oy) * scale;
    c.save();
    c.fillStyle = '#07060c';
    c.fillRect(0, 0, W, H);
    const a = ART_SCALE;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.composed, ox * a, oy * a, span * a, span * a, 0, 0, W, H);

    const dot = (x: number, y: number, r: number, color: string, glow = 0): void => {
      const px = tx(x);
      const py = ty(y);
      if (px < -10 || py < -10 || px > W + 10 || py > H + 10) return;
      if (glow) {
        const g = c.createRadialGradient(px, py, 0, px, py, r + glow);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(px, py, r + glow, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = color;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = '#140c22';
      c.stroke();
    };
    const k = whole ? Math.max(1, W / 700) : 1;
    const pulse = 0.5 + 0.5 * Math.sin(s.now / 250);
    // Generators (yellow; green once running).
    this.map.generators.forEach((g, i) => {
      if (!this.seenGens.has(i)) return;
      const on = (s.world.gens[i]?.flags ?? 0) & GenFlag.Repaired;
      const px = tx(g.x);
      const py = ty(g.y);
      c.fillStyle = on ? '#4cff6a' : '#ffd23a';
      c.strokeStyle = '#140c22';
      c.lineWidth = 1.5;
      c.fillRect(px - 4 * k, py - 4 * k, 8 * k, 8 * k);
      c.strokeRect(px - 4 * k, py - 4 * k, 8 * k, 8 * k);
    });
    // Stakes: Zach knows them all; survivors once seen.
    this.map.stakes.forEach((st, i) => {
      if (!this.seenStakes.has(i)) return;
      const px = tx(st.x);
      const py = ty(st.y);
      c.strokeStyle = this.hunter ? '#ff3a5a' : '#c88a9a';
      c.lineWidth = 2.2 * k;
      const r = 4 * k;
      c.beginPath();
      c.moveTo(px - r, py - r);
      c.lineTo(px + r, py + r);
      c.moveTo(px + r, py - r);
      c.lineTo(px - r, py + r);
      c.stroke();
    });
    // Items you've seen and nobody has taken yet.
    if (!this.hunter) {
      this.map.loot.forEach((l, i) => {
        if (!this.seenLoot.has(i) || s.world.lootTaken[i]) return;
        dot(l.x, l.y, 2.6 * k, ITEM_COLORS[l.item] ?? '#4cff6a', (3 + pulse * 3) * k);
      });
    }
    // Exit gate.
    const gt = this.map.gate;
    if (this.revealedAll || this.seenAny(gt.x, gt.y)) {
      c.fillStyle = s.world.gateOpen ? '#4cff6a' : s.world.gatePowered ? '#ffd23a' : '#8a8aa0';
      c.fillRect(tx(gt.x) - 7 * k, ty(gt.y) - 2.5 * k, 14 * k, 5 * k);
    }
    // JARVIS radar: Zach as a red dot.
    for (const r of s.world.radar) {
      if (!whole && (Math.abs(r.x - s.x) > this.radius || Math.abs(r.y - s.y) > this.radius)) continue;
      dot(r.x, r.y, 4.5 * k, '#ff2a3a', (4 + pulse * 5) * k);
    }
    // Testing mode: every NPC on the map, named on the full map.
    for (const n of s.world.npcs) {
      if (!whole && (Math.abs(n.x - s.x) > this.radius || Math.abs(n.y - s.y) > this.radius)) continue;
      dot(n.x, n.y, 3.5 * k, '#b48aff', (3 + pulse * 3) * k);
      if (whole) {
        c.font = `700 ${Math.round(11 * k)}px "Special Elite", monospace`;
        c.textAlign = 'center';
        c.fillStyle = '#000';
        c.fillText(NPC_NAMES[n.k] ?? '', tx(n.x) + 1, ty(n.y) - 8 * k + 1);
        c.fillStyle = '#d8c8ff';
        c.fillText(NPC_NAMES[n.k] ?? '', tx(n.x), ty(n.y) - 8 * k);
      }
    }
    // You: on the full map a big pulsing marker with a label, so you're easy to find.
    const px = tx(s.x);
    const py = ty(s.y);
    if (whole) {
      const R = (14 + pulse * 10) * k;
      const g = c.createRadialGradient(px, py, 0, px, py, R * 1.6);
      g.addColorStop(0, 'rgba(255,230,120,0.55)');
      g.addColorStop(1, 'rgba(255,230,120,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, R * 1.6, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 2.5 * k;
      c.strokeStyle = `rgba(255,232,140,${0.9 - pulse * 0.5})`;
      c.beginPath();
      c.arc(px, py, R, 0, Math.PI * 2);
      c.stroke();
      c.font = `700 ${Math.round(12 * k)}px "Special Elite", monospace`;
      c.textAlign = 'center';
      c.fillStyle = '#000';
      c.fillText('YOU', px + 1, py - R - 5 * k + 1);
      c.fillStyle = '#ffe88c';
      c.fillText('YOU', px, py - R - 5 * k);
    }
    const kk = whole ? k * 2.2 : k;
    c.save();
    c.translate(px, py);
    c.rotate(s.facing);
    c.beginPath();
    c.moveTo(8 * kk, 0);
    c.lineTo(-5 * kk, 5 * kk);
    c.lineTo(-2 * kk, 0);
    c.lineTo(-5 * kk, -5 * kk);
    c.closePath();
    c.fillStyle = whole ? '#ffe88c' : '#ffffff';
    c.fill();
    c.lineWidth = whole ? 2.5 : 1.5;
    c.strokeStyle = '#000';
    c.stroke();
    c.restore();
    c.restore();
    if (!whole) {
      // A square frame.
      c.lineWidth = 4;
      c.strokeStyle = '#0a0a08';
      c.strokeRect(2, 2, W - 4, H - 4);
      c.lineWidth = 1.5;
      c.strokeStyle = 'rgba(217,211,193,0.6)';
      c.strokeRect(2, 2, W - 4, H - 4);
    }
  }

  private seenAny(x: number, y: number): boolean {
    const cx = Math.floor(x / EXPLORE_CELL);
    const cy = Math.floor(y / EXPLORE_CELL);
    const d = this.exCtx.getImageData(Math.max(0, cx - 1), Math.max(0, cy - 1), 3, 3).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 120) return true;
    return false;
  }

  destroy(): void {
    this.root.remove();
    this.fullWrap.remove();
  }
}

/** Paints a dim, desaturated recon map of the map (the parts you've explored are shown). */
function paintMap(m: MapData, s: number): HTMLCanvasElement {
  const cv = el('canvas');
  cv.width = Math.ceil(m.width * s);
  cv.height = Math.ceil(m.height * s);
  const c = cv.getContext('2d')!;
  c.scale(s, s);
  c.fillStyle = '#1b1e19';
  c.fillRect(0, 0, m.width, m.height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const cl of m.clearings) {
    c.fillStyle = '#2a2c24';
    c.beginPath();
    c.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = '#4a4336';
  for (const p of m.paths) {
    c.lineWidth = p.width;
    c.beginPath();
    for (let i = 0; i < p.points.length; i += 2) {
      if (i === 0) c.moveTo(p.points[i], p.points[i + 1]);
      else c.lineTo(p.points[i], p.points[i + 1]);
    }
    c.stroke();
  }
  c.fillStyle = '#15222a';
  c.beginPath();
  for (let i = 0; i < m.lake.length; i += 2) {
    if (i === 0) c.moveTo(m.lake[i], m.lake[i + 1]);
    else c.lineTo(m.lake[i], m.lake[i + 1]);
  }
  c.closePath();
  c.fill();
  c.fillStyle = '#0f130e';
  for (const t of m.trees) {
    c.beginPath();
    c.arc(t.x, t.y, t.r * 1.6, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#4a4a46';
  for (const r of m.rocks) {
    c.beginPath();
    c.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    c.fill();
  }
  const wh = m.warehouse;
  c.fillStyle = '#3c3d3b';
  c.fillRect(wh.x, wh.y, wh.w, wh.h);
  c.fillStyle = '#3c3d3b';
  const ez = m.exitZone;
  c.fillRect(ez.x - 10, ez.y - 10, ez.w + 20, ez.h + 80);
  c.fillStyle = '#3e3226';
  for (const cab of m.cabins) c.fillRect(cab.x, cab.y, cab.w, cab.h);
  // The ambulance: a white box with a red cross.
  const amb = m.ambulance;
  c.save();
  c.translate(amb.x, amb.y);
  c.rotate(amb.angle);
  c.fillStyle = '#d8d6ce';
  c.fillRect(-amb.length / 2, -amb.width / 2, amb.length, amb.width);
  c.fillStyle = '#c8262e';
  c.fillRect(-18, -50, 36, 100);
  c.fillRect(-50, -18, 100, 36);
  c.restore();
  for (const w of m.walls) {
    if (w.kind === 'boundary' || w.kind === 'shore' || w.kind === 'log' || w.kind === 'ambulance') continue;
    c.strokeStyle = w.kind === 'window' ? '#6f8a8c' : w.kind === 'fence' || w.kind === 'yard' ? '#6a6456' : '#a8a498';
    c.lineWidth = w.kind === 'warehouse' ? 16 : w.kind === 'fence' || w.kind === 'yard' ? 5 : 12;
    c.beginPath();
    c.moveTo(w.ax, w.ay);
    c.lineTo(w.bx, w.by);
    c.stroke();
  }
  c.strokeStyle = '#8a6a44';
  c.lineWidth = 10;
  for (const d of m.doors) {
    c.beginPath();
    c.moveTo(d.hx, d.hy);
    c.lineTo(d.hx + Math.cos(d.angle) * d.length, d.hy + Math.sin(d.angle) * d.length);
    c.stroke();
  }
  return cv;
}
