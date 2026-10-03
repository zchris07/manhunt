import { BALANCE, DEG, type HidingSpotDef, type MapData, type VisibilityComputer } from '@manhunt/shared';
import type { MaskPolygon, MaskSources } from '../render/vision/VisionRenderer';

export interface ViewerInfo {
  x: number;
  y: number;
  facing: number;
  hunter: boolean;
  downed: boolean;
  hidden: HidingSpotDef | null;
  /** Night vision goggles (and Waz) widen the flashlight cone. */
  coneMul: number;
  /** Waz widens (or narrows) the circle you always see around you. */
  proxMul: number;
  /** See-through light fading in (0..1), or 0 when off. */
  xray: number;
}

export interface LightInfo {
  key: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  /** Static lights cache their polygon. */
  static: boolean;
}

const SLATS = 7;

/**
 * Builds the mask channels for a viewer: own vision (cone + proximity, or a slatted peek
 * from a hiding spot), 360-degree line of sight, up to 6 nearby light polygons, and the
 * see-through cone of goggles or the Hemp Battery. Mirrors the host's visibility rules so
 * what you see matches what you are sent.
 */
export class VisionSources {
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly vis: VisibilityComputer,
    private readonly map: MapData,
  ) {}

  /** Doors opened or closed: cached light polygons are stale. */
  invalidate(): void {
    this.cache.clear();
  }

  build(v: ViewerInfo, lights: LightInfo[], viewRadius: number): MaskSources {
    const own: MaskPolygon[] = [];
    let xray: MaskSources['xray'] = null;
    if (v.hidden) {
      const grass = v.hidden.kind === 'grass';
      const pk = grass ? BALANCE.hiding.grassPeek : BALANCE.hiding.peek;
      if (grass) {
        own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: pk.range }, []), ox: v.x, oy: v.y, range: pk.range, intensity: 0.85 });
      } else {
        // Looking out through slats: the peek cone is split into thin wedges.
        const half = pk.coneHalfAngleDeg * DEG;
        const dir = v.hidden.facing + Math.max(-half, Math.min(half, angleDelta(v.facing, v.hidden.facing))) * 0.5;
        const step = (half * 2) / SLATS;
        for (let i = 0; i < SLATS; i++) {
          const a = dir - half + step * (i + 0.5);
          own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: a, halfAngle: step * 0.22, range: pk.range }, []), ox: v.x, oy: v.y, range: pk.range, intensity: 1 });
        }
        own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: pk.proximity }, []), ox: v.x, oy: v.y, range: pk.proximity, intensity: 0.5 });
      }
    } else {
      const cfg = v.hunter ? BALANCE.hunter.vision : BALANCE.survivor.vision;
      const k = v.downed ? BALANCE.survivor.downedVisionMul : 1;
      // The beam runs until it hits something; past the edge of the screen it can't be seen.
      const range = Math.min(cfg.range * k, viewRadius * 1.05);
      const half = cfg.coneHalfAngleDeg * DEG * v.coneMul;
      own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: v.facing, halfAngle: half, range }, []), ox: v.x, oy: v.y, range });
      const prox = cfg.proximity * v.proxMul;
      own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: prox }, []), ox: v.x, oy: v.y, range: prox, intensity: 0.9 });
      if (v.xray > 0) {
        // Light that ignores walls; it grows out of the torch while it fades in.
        const ease = 1 - (1 - v.xray) * (1 - v.xray);
        const xr = Math.min(range, BALANCE.xray.range);
        xray = { poly: conePolygon(v.x, v.y, v.facing, half, xr * (0.35 + 0.65 * ease)), fade: ease };
      }
    }

    const los = this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: BALANCE.lights.losRange }, []);
    const near = lights
      .map((l) => ({ l, d: Math.hypot(l.x - v.x, l.y - v.y) }))
      .filter(({ l, d }) => d < viewRadius + l.radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, BALANCE.lights.maxPolygonsPerFrame);
    const lightPolys: MaskPolygon[] = near.map(({ l }) => {
      let poly = l.static ? this.cache.get(l.key) : undefined;
      if (!poly) {
        poly = this.vis.compute({ x: l.x, y: l.y, dir: 0, halfAngle: Math.PI, range: l.radius }, []);
        if (l.static) this.cache.set(l.key, poly);
      }
      return { poly, ox: l.x, oy: l.y, range: l.radius, intensity: l.intensity };
    });
    return { own, los, lights: lightPolys, xray };
  }

  get mapData(): MapData {
    return this.map;
  }
}

/** An unoccluded cone polygon (origin first). */
function conePolygon(x: number, y: number, dir: number, half: number, range: number): number[] {
  const out = [x, y];
  const n = Math.max(8, Math.ceil((half * 2) / (4 * DEG)));
  for (let i = 0; i <= n; i++) {
    const a = dir - half + (half * 2 * i) / n;
    out.push(x + Math.cos(a) * range, y + Math.sin(a) * range);
  }
  return out;
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
