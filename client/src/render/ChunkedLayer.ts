import { Container } from 'pixi.js';

/** Splits static display objects into spatial chunks and hides chunks outside the camera. */
export class ChunkedLayer {
  readonly root = new Container();
  private readonly chunks: Container[] = [];
  private readonly cols: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly chunkSize = 750,
  ) {
    this.cols = Math.ceil(width / chunkSize);
    const rows = Math.ceil(height / chunkSize);
    for (let i = 0; i < this.cols * rows; i++) {
      const c = new Container();
      this.chunks.push(c);
      this.root.addChild(c);
    }
  }

  add(obj: Container, x: number, y: number): void {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.chunkSize)));
    const cy = Math.min(this.chunks.length / this.cols - 1, Math.max(0, Math.floor(y / this.chunkSize)));
    this.chunks[cy * this.cols + cx].addChild(obj);
  }

  /** Shows only chunks overlapping the view rectangle (plus a margin for large sprites). */
  cull(x: number, y: number, w: number, h: number, margin = 200): void {
    const rows = this.chunks.length / this.cols;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x0 = cx * this.chunkSize - margin;
        const y0 = cy * this.chunkSize - margin;
        const x1 = x0 + this.chunkSize + margin * 2;
        const y1 = y0 + this.chunkSize + margin * 2;
        this.chunks[cy * this.cols + cx].visible = x1 > x && x0 < x + w && y1 > y && y0 < y + h;
      }
    }
  }

  showAll(): void {
    for (const c of this.chunks) c.visible = true;
  }
}
