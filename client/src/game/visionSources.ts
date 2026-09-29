import { BALANCE, DEG, type HidingSpotDef, type MapData, type VisibilityComputer } from '@manhunt/shared';
import type { MaskPolygon, MaskSources } from '../render/vision/VisionRenderer';

export interface ViewerInfo {
  x: number;
  y: number;
  facing: number;
  hunter: boolean;
  blind: boolean;
  downed: boolean;
  hidden: HidingSpotDef | null;
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
 * Builds the three mask channels for a viewer: own vision (cone + proximity, or a slatted
 * peek from a hiding spot), 360-degree line of sight, and up to 6 nearby light polygons.
 * Mirrors the host's visibility rules so what you see matches what you are sent.
 */
export class VisionSources {
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly vis: VisibilityComputer,
    private readonly map: MapData,
  ) {}

  build(v: ViewerInfo, lights: LightInfo[], viewRadius: number): MaskSources {
    const own: MaskPolygon[] = [];
    if (v.hidden) {
      const grass = v.hidden.kind === 'grass';
      const pk = grass ? BALANCE.hiding.grassPeek : BALANCE.hiding.peek;
      if (grass) {
        own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: pk.range }, []), ox: v.x, oy: v.y, range: pk.range, intensity: 0.8 });
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
      const k = v.blind ? BALANCE.tools.flare.visionMul : v.downed ? 0.6 : 1;
      const range = cfg.range * k;
      own.push({
        poly: this.vis.compute({ x: v.x, y: v.y, dir: v.facing, halfAngle: cfg.coneHalfAngleDeg * DEG, range }, []),
        ox: v.x,
        oy: v.y,
        range,
      });
      const prox = cfg.proximity * (v.blind ? 0.5 : 1);
      own.push({ poly: this.vis.compute({ x: v.x, y: v.y, dir: 0, halfAngle: Math.PI, range: prox }, []), ox: v.x, oy: v.y, range: prox, intensity: 0.8 });
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
    return { own, los, lights: lightPolys };
  }

  get mapData(): MapData {
    return this.map;
  }
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
