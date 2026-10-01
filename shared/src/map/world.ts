import { Geometry, type CircleDef, type SegmentDef } from '../geometry';
import { SURFACES, type MapData, type Rect, type Surface } from './types';

export const GENERATOR_RADIUS = 26;
export const BARREL_RADIUS = 18;
export const CAMPFIRE_RADIUS = 18;

export function buildGeometry(data: MapData): Geometry {
  const segments: SegmentDef[] = data.walls.map((w) => ({ ax: w.ax, ay: w.ay, bx: w.bx, by: w.by, vision: w.vision, move: w.move, window: w.kind === 'window' }));
  const circles: CircleDef[] = [];
  for (const t of data.trees) circles.push({ x: t.x, y: t.y, r: t.r, vision: true, move: true });
  for (const r of data.rocks) circles.push({ x: r.x, y: r.y, r: r.r, vision: true, move: true });
  for (const g of data.generators) circles.push({ x: g.x, y: g.y, r: GENERATOR_RADIUS, vision: false, move: true });
  for (const h of data.hidingSpots) if (h.kind === 'barrel') circles.push({ x: h.x, y: h.y, r: BARREL_RADIUS, vision: false, move: true });
  for (const l of data.lights) if (l.kind === 'campfire') circles.push({ x: l.x, y: l.y, r: CAMPFIRE_RADIUS, vision: false, move: true });
  const geo = new Geometry(
    data.width,
    data.height,
    segments,
    circles,
    data.dynamicSegments.map((d) => ({ ...d })),
  );
  geo.setWater(data.lake, data.dock);
  return geo;
}

export function inRect(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x - pad && y >= r.y - pad && x <= r.x + r.w + pad && y <= r.y + r.h + pad;
}

/** Runtime view of a generated map: collision/vision geometry plus lookups. */
export class MapWorld {
  readonly geo: Geometry;

  constructor(readonly data: MapData) {
    this.geo = buildGeometry(data);
  }

  surfaceAt(x: number, y: number): Surface {
    const d = this.data;
    const cols = Math.ceil(d.width / d.surfaceCell);
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / d.surfaceCell)));
    const cy = Math.min(cols - 1, Math.max(0, Math.floor(y / d.surfaceCell)));
    return SURFACES[d.surface[cy * cols + cx]] ?? 'forest';
  }

  inExitZone(x: number, y: number): boolean {
    return inRect(this.data.exitZone, x, y);
  }

  inWarehouse(x: number, y: number): boolean {
    return inRect(this.data.warehouse, x, y);
  }
}
