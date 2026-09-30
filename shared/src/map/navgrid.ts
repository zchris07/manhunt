import { overlapsCollider } from '../collision';
import type { Geometry } from '../geometry';

/**
 * Walkability grid built from movement colliders (inflated by a character radius). Used for
 * reachability validation, loop detection and bot pathfinding.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;

  constructor(
    geo: Geometry,
    readonly cell = 20,
    readonly radius = 15,
  ) {
    this.cols = Math.ceil(geo.width / cell);
    this.rows = Math.ceil(geo.height / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cx = (x + 0.5) * cell;
        const cy = (y + 0.5) * cell;
        this.blocked[y * this.cols + x] = overlapsCollider(geo, cx, cy, radius) ? 1 : 0;
      }
    }
  }

  index(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return cy * this.cols + cx;
  }

  centerOf(i: number): { x: number; y: number } {
    return { x: ((i % this.cols) + 0.5) * this.cell, y: (Math.floor(i / this.cols) + 0.5) * this.cell };
  }

  /** Nearest walkable cell to (x,y) within maxRadius cells, or -1. */
  nearestWalkable(x: number, y: number, maxRadius = 4): number {
    const i0 = this.index(x, y);
    if (!this.blocked[i0]) return i0;
    const cx = i0 % this.cols;
    const cy = Math.floor(i0 / this.cols);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const i = ny * this.cols + nx;
        if (this.blocked[i]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** 8-connected flood fill from a walkable cell; returns 1 for reachable cells. */
  flood(start: number): Uint8Array {
    const seen = new Uint8Array(this.cols * this.rows);
    if (start < 0 || this.blocked[start]) return seen;
    const queue = new Int32Array(this.cols * this.rows);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const { cols, rows, blocked } = this;
    while (head < tail) {
      const i = queue[head++];
      const x = i % cols;
      const y = (i - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (seen[j] || blocked[j]) continue;
          // No corner cutting through blocked diagonals.
          if (dx && dy && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    return seen;
  }

  /** A* path between world points; returns flat [x,y,...] waypoints or null. */
  findPath(ax: number, ay: number, bx: number, by: number, maxExpanded = 60000): number[] | null {
    const start = this.nearestWalkable(ax, ay);
    const goal = this.nearestWalkable(bx, by);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [bx, by];
    const { cols, rows, blocked } = this;
    const n = cols * rows;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gx = goal % cols;
    const gy = Math.floor(goal / cols);
    const hfn = (i: number): number => {
      const dx = Math.abs((i % cols) - gx);
      const dy = Math.abs(Math.floor(i / cols) - gy);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    g[start] = 0;
    heap.push(start, hfn(start));
    let expanded = 0;
    while (heap.size) {
      const i = heap.pop();
      if (i === goal) break;
      if (closed[i]) continue;
      closed[i] = 1;
      if (++expanded > maxExpanded) return null;
      const x = i % cols;
      const y = (i - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (blocked[j] || closed[j]) continue;
          if (dx && dy && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          const ng = g[i] + (dx && dy ? 1.414 : 1);
          if (ng < g[j]) {
            g[j] = ng;
            came[j] = i;
            heap.push(j, ng + hfn(j));
          }
        }
      }
    }
    if (came[goal] < 0) return null;
    const cells: number[] = [];
    for (let i = goal; i !== start && i >= 0; i = came[i]) cells.push(i);
    cells.reverse();
    const out: number[] = [];
    // Keep every 3rd waypoint (plus the last) to smooth steering.
    for (let k = 0; k < cells.length; k++) {
      if (k % 3 !== 2 && k !== cells.length - 1) continue;
      const c = this.centerOf(cells[k]);
      out.push(c.x, c.y);
    }
    out.push(bx, by);
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
