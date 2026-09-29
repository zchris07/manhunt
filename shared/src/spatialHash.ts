/**
 * Uniform grid broad-phase. Items are integer ids with an axis-aligned bounding box.
 * Queries return each id at most once (deduplicated with a stamp array).
 */
export class GridIndex {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: number[][];
  private stamps: Uint32Array = new Uint32Array(256);
  private stamp = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  private cx(x: number): number {
    const c = Math.floor(x / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cy(y: number): number {
    const c = Math.floor(y / this.cellSize);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    if (id >= this.stamps.length) {
      const next = new Uint32Array(Math.max(id + 1, this.stamps.length * 2));
      next.set(this.stamps);
      this.stamps = next;
    }
    const x0 = this.cx(minX);
    const x1 = this.cx(maxX);
    const y0 = this.cy(minY);
    const y1 = this.cy(maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) this.cells[y * this.cols + x].push(id);
    }
  }

  remove(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const x0 = this.cx(minX);
    const x1 = this.cx(maxX);
    const y0 = this.cy(minY);
    const y1 = this.cy(maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = this.cells[y * this.cols + x];
        const i = cell.indexOf(id);
        if (i >= 0) cell.splice(i, 1);
      }
    }
  }

  /** Appends matching ids to out (which is cleared first) and returns it. */
  query(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number[] {
    out.length = 0;
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const s = this.stamp;
    const x0 = this.cx(minX);
    const x1 = this.cx(maxX);
    const y0 = this.cy(minY);
    const y1 = this.cy(maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = this.cells[y * this.cols + x];
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          if (this.stamps[id] !== s) {
            this.stamps[id] = s;
            out.push(id);
          }
        }
      }
    }
    return out;
  }
}
