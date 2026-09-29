import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import {
  BALANCE,
  DEG,
  Geometry,
  MapWorld,
  VisibilityComputer,
  generateMap,
  mapParamsFor,
  moveCircle,
  resolveBalance,
  type ViewCone,
} from '@manhunt/shared';
import { AssetManager } from '../src/assets/AssetManager';
import { CHARACTER_TINTS } from '../src/assets/procedural/textures';
import { VisionRenderer, type MaskPolygon } from '../src/render/vision/VisionRenderer';
import { MapRenderer } from '../src/render/MapRenderer';
import { Input } from '../src/input/Input';
import { buildArena } from './arena';

interface Scene {
  geo: Geometry;
  width: number;
  height: number;
  terrain: Container;
  lights: { x: number; y: number; radius: number; kind: string }[];
  loot: { x: number; y: number };
  enemyPath: [number, number][];
  spawn: { x: number; y: number };
  label: string;
  update?(camX: number, camY: number, w: number, h: number, time: number): void;
  showAll?(): void;
}

function arenaScene(assets: AssetManager): Scene {
  const arena = buildArena();
  const terrain = new Container();
  terrain.addChild(new TilingSprite({ texture: assets.getTexture('ground.forest'), width: arena.width, height: arena.height }));
  const floor = new TilingSprite({ texture: assets.getTexture('ground.concrete'), width: 700, height: 700 });
  floor.position.set(200, 850);
  terrain.addChild(floor);
  const walls = new Graphics();
  for (const s of arena.segments) {
    walls.moveTo(s.ax, s.ay).lineTo(s.bx, s.by).stroke({ width: 16, color: 0x1c1a17, cap: 'square' });
    walls.moveTo(s.ax, s.ay).lineTo(s.bx, s.by).stroke({ width: 9, color: 0x3a352f, cap: 'square' });
  }
  terrain.addChild(walls);
  for (const t of arena.trees) {
    const id = t.kind === 'pine' ? 'tree.pine' : t.kind === 'dead' ? 'tree.dead' : 'prop.boulder';
    const sp = new Sprite(assets.getTexture(id, t.variant));
    sp.anchor.set(0.5);
    sp.position.set(t.x, t.y);
    sp.rotation = (t.x * 13.1 + t.y * 7.7) % 6.28;
    sp.scale.set(t.kind === 'boulder' ? t.r / 40 : t.kind === 'pine' ? 0.5 + t.r / 36 : t.r / 15);
    terrain.addChild(sp);
  }
  for (const l of arena.lights) {
    const sp = new Sprite(assets.getTexture(l.kind === 'campfire' ? 'obj.campfire' : 'obj.lamp'));
    sp.anchor.set(0.5);
    sp.position.set(l.x, l.y);
    const glow = new Sprite(assets.getTexture('fx.glow'));
    glow.anchor.set(0.5);
    glow.position.set(l.x, l.y);
    glow.tint = l.kind === 'campfire' ? 0xff8a3a : 0xffe0a0;
    glow.blendMode = 'add';
    glow.alpha = 0.32;
    glow.scale.set((l.radius * 1.4) / 128);
    terrain.addChild(sp, glow);
  }
  return {
    geo: new Geometry(arena.width, arena.height, arena.segments, arena.trees),
    width: arena.width,
    height: arena.height,
    terrain,
    lights: arena.lights,
    loot: arena.loot,
    enemyPath: arena.enemyPath,
    spawn: arena.spawn,
    label: 'test arena',
  };
}

function mapScene(assets: AssetManager, seed: number): Scene {
  const t0 = performance.now();
  const data = generateMap(mapParamsFor(seed, resolveBalance({ hunters: 1, survivors: 4, difficulty: 1 })));
  const genMs = performance.now() - t0;
  const world = new MapWorld(data);
  const mr = new MapRenderer(data, assets);
  const s = data.survivorSpawns[0];
  const loot = data.loot[0] ?? { x: s.x + 100, y: s.y };
  return {
    geo: world.geo,
    width: data.width,
    height: data.height,
    terrain: mr.root,
    lights: data.lights,
    loot,
    enemyPath: [
      [s.x + 250, s.y - 150],
      [s.x + 350, s.y - 350],
      [s.x - 50, s.y - 420],
      [s.x - 300, s.y - 200],
    ],
    spawn: { x: s.x, y: s.y },
    label: `map seed ${seed} (generated in ${genMs.toFixed(0)} ms) · trees ${data.trees.length} · walls ${data.walls.length} · gens ${data.generators.length}`,
    update: (x, y, w, h, t) => mr.update(x, y, w, h, t),
    showAll: () => mr.showAll(),
  };
}

/**
 * Standalone vision sandbox: a controllable player, walls, a dense forest, a loot item and an
 * "enemy" that vanishes outside the vision cone, lights, and an FPS counter. By default it
 * shows a generated map (?seed=N); ?arena=1 uses the small hand-built test arena.
 */
async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ background: '#000000', resizeTo: window, preference: 'webgl', antialias: false, resolution: 1 });
  document.getElementById('game')!.appendChild(app.canvas);
  const assets = await AssetManager.load(new URL('../assets/manifest.json', document.baseURI).href);

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 1e6));
  const scene = params.has('arena') ? arenaScene(assets) : mapScene(assets, seed);
  const geo = scene.geo;
  const vis = new VisibilityComputer(geo);

  const viewport = new Container();
  const world = new Container();
  const entityViewport = new Container();
  const entities = new Container();
  app.stage.addChild(viewport);
  viewport.addChild(world, entityViewport);
  world.addChild(scene.terrain);
  entityViewport.addChild(entities);
  const debugPolys = new Graphics();
  debugPolys.visible = false;
  world.addChild(debugPolys);

  const loot = new Sprite(assets.getTexture('loot.fuel'));
  loot.anchor.set(0.5);
  loot.position.set(scene.loot.x, scene.loot.y);
  const enemy = new Sprite(assets.getTexture('char.hunter'));
  enemy.anchor.set(0.5);
  const player = new Sprite(assets.getTexture('char.survivor'));
  player.anchor.set(0.5);
  player.tint = CHARACTER_TINTS[1];
  entities.addChild(loot, enemy, player);

  const vision = new VisionRenderer(app.screen.width, app.screen.height);
  vision.attach(viewport, entityViewport);
  app.renderer.on('resize', (w: number, h: number) => vision.resize(w, h));

  const maskDebug = new Sprite(vision.maskTexture);
  maskDebug.visible = false;
  maskDebug.scale.set(0.5);
  maskDebug.position.set(8, 80);
  app.stage.addChild(maskDebug);

  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText =
    'position:fixed;top:8px;left:8px;color:#cfc8b8;font:12px/1.4 monospace;background:rgba(0,0,0,.55);padding:6px 8px;pointer-events:none;white-space:pre';
  document.body.appendChild(hud);

  const input = new Input(app.canvas);
  const pos = { x: scene.spawn.x, y: scene.spawn.y };
  let facing = -Math.PI / 2;
  let enemyIdx = 0;
  const enemyPos = { x: scene.enemyPath[0][0], y: scene.enemyPath[0][1] };
  let enemyPaused = false;
  let overview = false;
  let manualAim = false;
  const sv = BALANCE.survivor;
  const lightPolys = new Map<number, number[]>();
  const lightPoly = (i: number): number[] => {
    let p = lightPolys.get(i);
    if (!p) {
      const l = scene.lights[i];
      p = vis.compute({ x: l.x, y: l.y, dir: 0, halfAngle: Math.PI, range: l.radius }, []);
      lightPolys.set(i, p);
    }
    return p;
  };

  let time = 0;
  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let visMs = 0;
  let cpuMs = 0;
  let rays = 0;
  let lightsDrawn = 0;

  const state = {
    get fps() {
      return fps;
    },
    get cpuMs() {
      return cpuMs;
    },
    get player() {
      return { ...pos, facing };
    },
    setPlayer(x: number, y: number, f: number) {
      pos.x = x;
      pos.y = y;
      facing = f;
      manualAim = true;
    },
    setEnemy(x: number, y: number) {
      enemyPos.x = x;
      enemyPos.y = y;
      enemyPaused = true;
    },
    setOverview(on: boolean) {
      overview = on;
    },
    freezeEffects: false,
  };
  (window as unknown as { __sandbox: typeof state }).__sandbox = state;

  app.ticker.add((ticker) => {
    const frameStart = performance.now();
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    time += dt;
    frames++;
    fpsAccum += ticker.deltaMS;
    if (fpsAccum >= 500) {
      fps = (frames * 1000) / fpsAccum;
      frames = 0;
      fpsAccum = 0;
    }
    const sw = app.screen.width;
    const sh = app.screen.height;

    const ax = input.axis();
    const speed = input.isDown('ShiftLeft') ? sv.run : input.isDown('KeyC') ? sv.crouch : sv.walk;
    if (ax.x || ax.y) {
      manualAim = false;
      moveCircle(geo, pos, sv.radius, ax.x * speed * dt, ax.y * speed * dt);
    }
    const camX = Math.round(pos.x - sw / 2);
    const camY = Math.round(pos.y - sh / 2);
    if (!manualAim) facing = Math.atan2(input.mouseY + camY - pos.y, input.mouseX + camX - pos.x);
    if (input.wasPressed('KeyB')) maskDebug.visible = !maskDebug.visible;
    if (input.wasPressed('KeyV')) debugPolys.visible = !debugPolys.visible;
    if (input.wasPressed('KeyM')) overview = !overview;
    if (input.wasPressed('KeyN')) location.search = `?seed=${Math.floor(Math.random() * 1e6)}`;
    input.endFrame();

    if (!enemyPaused) {
      const [tx, ty] = scene.enemyPath[enemyIdx];
      const dx = tx - enemyPos.x;
      const dy = ty - enemyPos.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) enemyIdx = (enemyIdx + 1) % scene.enemyPath.length;
      else {
        const before = { ...enemyPos };
        moveCircle(geo, enemyPos, BALANCE.hunter.radius, (dx / d) * 110 * dt, (dy / d) * 110 * dt);
        enemy.rotation = Math.atan2(dy, dx);
        if (Math.hypot(enemyPos.x - before.x, enemyPos.y - before.y) < 0.5) enemyIdx = (enemyIdx + 1) % scene.enemyPath.length;
      }
    }
    enemy.position.set(enemyPos.x, enemyPos.y);
    player.position.set(pos.x, pos.y);
    player.rotation = facing;
    loot.rotation = Math.sin(time) * 0.1;

    if (overview) {
      const s = Math.min(sw / scene.width, sh / scene.height);
      viewport.filters = null;
      entityViewport.filters = null;
      world.scale.set(s);
      entities.scale.set(s);
      world.position.set((sw - scene.width * s) / 2, (sh - scene.height * s) / 2);
      entities.position.copyFrom(world.position);
      scene.showAll?.();
      hud.textContent = `MANHUNT sandbox · overview\n${scene.label}\nM back · N new seed`;
      cpuMs = cpuMs * 0.9 + (performance.now() - frameStart) * 0.1;
      return;
    }
    if (!viewport.filters) vision.attach(viewport, entityViewport);
    world.scale.set(1);
    entities.scale.set(1);

    const t0 = performance.now();
    const cone: ViewCone = { x: pos.x, y: pos.y, dir: facing, halfAngle: sv.vision.coneHalfAngleDeg * DEG, range: sv.vision.range };
    const conePoly = vis.compute(cone, []);
    rays = vis.lastRayCount;
    const proxPoly = vis.compute({ x: pos.x, y: pos.y, dir: 0, halfAngle: Math.PI, range: sv.vision.proximity }, []);
    const losPoly = vis.compute({ x: pos.x, y: pos.y, dir: 0, halfAngle: Math.PI, range: BALANCE.lights.losRange }, []);
    const own: MaskPolygon[] = [
      { poly: conePoly, ox: pos.x, oy: pos.y, range: cone.range },
      { poly: proxPoly, ox: pos.x, oy: pos.y, range: sv.vision.proximity, intensity: 0.8 },
    ];
    const viewR = Math.hypot(sw, sh) / 2;
    const lights: MaskPolygon[] = scene.lights
      .map((l, i) => ({ l, i, d: Math.hypot(l.x - pos.x, l.y - pos.y) }))
      .filter(({ l, d }) => d < viewR + l.radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, BALANCE.lights.maxPolygonsPerFrame)
      .map(({ l, i }) => ({
        poly: lightPoly(i),
        ox: l.x,
        oy: l.y,
        range: l.radius,
        intensity: l.kind === 'campfire' ? 0.85 + 0.15 * Math.sin(time * BALANCE.lights.flickerSpeed + i * 2.1) * Math.sin(time * 3.1 + i) : 0.9,
      }));
    lightsDrawn = lights.length;
    visMs = visMs * 0.9 + (performance.now() - t0) * 0.1;

    if (debugPolys.visible) {
      debugPolys.clear();
      debugPolys.poly(conePoly).stroke({ width: 2, color: 0x44aaff });
      debugPolys.poly(proxPoly).stroke({ width: 1, color: 0x44ffaa });
      for (const l of lights) debugPolys.poly(l.poly).stroke({ width: 1, color: 0xff8844 });
    }

    world.position.set(-camX, -camY);
    entities.position.set(-camX, -camY);
    scene.update?.(camX, camY, sw, sh, time);
    vision.renderMask(app.renderer, camX, camY, { own, los: losPoly, lights });
    const flicker = state.freezeEffects ? 1 : 0.96 + 0.04 * Math.sin(time * 2.3) * Math.sin(time * 5.7);
    vision.setEffects({ time: state.freezeEffects ? 0 : time, terror: 0, flicker, blind: 0, damage: 0 });

    hud.textContent =
      `MANHUNT vision sandbox · ${scene.label}\n` +
      `FPS ${fps.toFixed(0)}   cpu ${cpuMs.toFixed(2)} ms/frame   vision ${visMs.toFixed(2)} ms   cone rays ${rays}   lights ${lightsDrawn}\n` +
      `WASD move · Shift run · C crouch · mouse aim · V polygons · B mask · M map · N new seed`;
    cpuMs = cpuMs * 0.9 + (performance.now() - frameStart) * 0.1;
  });
}

void boot();
