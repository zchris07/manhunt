import { BlurFilter, Container, Filter, GlProgram, Graphics, Rectangle, RenderTexture, UniformGroup, type Renderer } from 'pixi.js';
import { BALANCE, clampPolygon } from '@manhunt/shared';
import { entityMaskFragment, screenVertex, visionFragment } from './shaders';

/** A polygon drawn into one mask channel, with stepped distance falloff from its origin. */
export interface MaskPolygon {
  poly: number[];
  ox: number;
  oy: number;
  range: number;
  intensity?: number;
}

export interface MaskSources {
  /** Viewer's own vision (B channel): flashlight cone, proximity circle, peek slits. */
  own: MaskPolygon[];
  /** Viewer's 360-degree line of sight (G channel). */
  los: number[] | null;
  /** Light sources (R channel). */
  lights: MaskPolygon[];
  /** See-through light (goggles / Hemp Battery): B at 70%, ignoring walls, fading in. */
  xray: { poly: number[]; fade: number } | null;
  /** JARVIS: the whole screen counts as your own light. */
  reveal?: boolean;
}

export interface VisionEffects {
  time: number;
  flicker: number;
  damage: number;
}

const MASK_SCALE = 0.5;
/**
 * Own light, by absolute distance (world units): the beam never ends before it hits
 * something, but it is brightest close up. [max distance, added intensity].
 */
const OWN_LAYERS: readonly [number, number][] = [
  [Infinity, 0.5],
  [900, 0.22],
  [420, 0.28],
];
/** Light sources, by fraction of their radius. */
const LIGHT_LAYERS: readonly [number, number][] = [
  [1.0, 0.55],
  [0.7, 0.2],
  [0.4, 0.18],
];
/** Warm, flat Darkwood grade for everything in light. */
const GRADE = { saturation: 0.72, tint: [1.1, 1.0, 0.8] as const };

/**
 * Owns the half-resolution visibility mask, the vision post-process filter (applied to the
 * whole world viewport) and the entity occlusion filter (applied to the entity viewport).
 */
export class VisionRenderer {
  readonly maskTexture: RenderTexture;
  readonly visionFilter: Filter;
  readonly entityFilter: Filter;
  private readonly maskRoot = new Container();
  private readonly gOwn = new Graphics();
  private readonly gLos = new Graphics();
  private readonly gLight = new Graphics();
  private readonly gXray = new Graphics();
  private readonly tmp: number[] = [];
  private readonly visionUniforms: UniformGroup;
  private readonly entityUniforms: UniformGroup;
  private screenW = 1;
  private screenH = 1;

  constructor(width: number, height: number) {
    this.screenW = width;
    this.screenH = height;
    this.maskTexture = RenderTexture.create({
      width: Math.ceil(width * MASK_SCALE),
      height: Math.ceil(height * MASK_SCALE),
      resolution: 1,
    });
    for (const g of [this.gLos, this.gLight, this.gOwn, this.gXray]) {
      g.blendMode = 'add';
      this.maskRoot.addChild(g);
    }
    this.maskRoot.filters = [new BlurFilter({ strength: 5, quality: 2 })];

    this.visionUniforms = new UniformGroup({
      uMaskScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uScreenSize: { value: new Float32Array([width, height]), type: 'vec2<f32>' },
      uTime: { value: 0, type: 'f32' },
      uGrain: { value: 0.025, type: 'f32' },
      uFlicker: { value: 1, type: 'f32' },
      uDamage: { value: 0, type: 'f32' },
      uSaturation: { value: GRADE.saturation, type: 'f32' },
      uFog: { value: 0.4, type: 'f32' },
      uTint: { value: new Float32Array(GRADE.tint), type: 'vec3<f32>' },
    });
    this.visionFilter = new Filter({
      glProgram: GlProgram.from({ vertex: screenVertex, fragment: visionFragment, name: 'mh-vision' }),
      resources: { visionUniforms: this.visionUniforms, uMask: this.maskTexture.source },
    });

    this.entityUniforms = new UniformGroup({
      uMaskScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uScreenSize: { value: new Float32Array([width, height]), type: 'vec2<f32>' },
      uThreshold: { value: 0.12, type: 'f32' },
      uSaturation: { value: GRADE.saturation, type: 'f32' },
      uTint: { value: new Float32Array(GRADE.tint), type: 'vec3<f32>' },
    });
    this.entityFilter = new Filter({
      glProgram: GlProgram.from({ vertex: screenVertex, fragment: entityMaskFragment, name: 'mh-entity-mask' }),
      resources: { entityUniforms: this.entityUniforms, uMask: this.maskTexture.source },
    });
    this.resize(width, height);
  }

  /** Attaches the filters. Both containers must be untransformed and cover the screen. */
  attach(viewport: Container, entityViewport: Container): void {
    viewport.filters = [this.visionFilter];
    entityViewport.filters = [this.entityFilter];
    this.applyFilterArea(viewport, entityViewport);
  }

  private viewport?: Container;
  private entityViewport?: Container;

  private applyFilterArea(viewport: Container, entityViewport: Container): void {
    this.viewport = viewport;
    this.entityViewport = entityViewport;
    viewport.filterArea = new Rectangle(0, 0, this.screenW, this.screenH);
    entityViewport.filterArea = new Rectangle(0, 0, this.screenW, this.screenH);
  }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
    const mw = Math.ceil(width * MASK_SCALE);
    const mh = Math.ceil(height * MASK_SCALE);
    this.maskTexture.resize(mw, mh);
    const sx = (width * MASK_SCALE) / mw;
    const sy = (height * MASK_SCALE) / mh;
    for (const u of [this.visionUniforms, this.entityUniforms]) {
      (u.uniforms.uMaskScale as Float32Array).set([sx, sy]);
      (u.uniforms.uScreenSize as Float32Array).set([width, height]);
    }
    if (this.viewport && this.entityViewport) this.applyFilterArea(this.viewport, this.entityViewport);
  }

  /**
   * Redraws the mask. camX/camY is the world position of the screen's top-left corner and
   * `zoom` the camera scale (screen pixels per world unit).
   */
  renderMask(renderer: Renderer, camX: number, camY: number, sources: MaskSources, zoom = 1): void {
    this.maskRoot.scale.set(MASK_SCALE * zoom);
    this.maskRoot.position.set(-camX * MASK_SCALE * zoom, -camY * MASK_SCALE * zoom);

    const gl = this.gLos;
    gl.clear();
    if (sources.los) {
      gl.poly(sources.los).fill({ color: 0x00ff00, alpha: 1 });
    } else {
      gl.rect(camX, camY, this.screenW / zoom, this.screenH / zoom).fill({ color: 0x00ff00, alpha: 1 });
    }

    this.drawLayered(this.gOwn, sources.own, 0x0000ff, OWN_LAYERS, true);
    if (sources.reveal) this.gOwn.rect(camX, camY, this.screenW / zoom, this.screenH / zoom).fill({ color: 0x0000ff, alpha: 0.85 });
    this.drawLayered(this.gLight, sources.lights, 0xff0000, LIGHT_LAYERS, false);

    const gx = this.gXray;
    gx.clear();
    if (sources.xray && sources.xray.poly.length >= 6 && sources.xray.fade > 0.001) {
      // Your own light at 70%, straight through walls.
      gx.poly(sources.xray.poly).fill({ color: Math.round(BALANCE.xray.brightness * 255), alpha: sources.xray.fade });
    }

    renderer.render({ container: this.maskRoot, target: this.maskTexture, clear: true, clearColor: [0, 0, 0, 0] });
  }

  private drawLayered(g: Graphics, polys: MaskPolygon[], color: number, layers: readonly [number, number][], absolute: boolean): void {
    g.clear();
    for (const p of polys) {
      if (p.poly.length < 6) continue;
      const intensity = p.intensity ?? 1;
      for (const [k, alpha] of layers) {
        const dist = absolute ? k : p.range * k;
        const pts = dist >= p.range ? p.poly : clampPolygon(p.poly, p.ox, p.oy, dist, this.tmp);
        g.poly(pts.slice()).fill({ color, alpha: alpha * intensity });
      }
    }
  }

  setEffects(fx: VisionEffects): void {
    const u = this.visionUniforms.uniforms;
    u.uTime = fx.time;
    u.uFlicker = fx.flicker;
    u.uDamage = fx.damage;
  }

  destroy(): void {
    this.maskTexture.destroy(true);
    this.maskRoot.destroy({ children: true });
  }
}
