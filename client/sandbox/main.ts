import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { BALANCE, DEG, Geometry, VisibilityComputer, moveCircle, type ViewCone } from '@manhunt/shared';
import { AssetManager } from '../src/assets/AssetManager';
import { CHARACTER_TINTS } from '../src/assets/procedural/textures';
import { VisionRenderer, type MaskPolygon } from '../src/render/vision/VisionRenderer';
import { Input } from '../src/input/Input';
import { buildArena } from './arena';

/**
 * Standalone vision sandbox: a controllable player, walls, a dense forest, a loot item and an
 * "enemy" that vanishes outside the vision cone, 6 lights, and an FPS counter.
 */
async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ background: '#000000', resizeTo: window, preference: 'webgl', antialias: false, resolution: 1 });
  document.getElementById('game')!.appendChild(app.canvas);
  const assets = await AssetManager.load(new URL('../assets/manifest.json', document.baseURI).href);

  const arena = buildArena();
  const geo = new Geometry(arena.width, arena.height, arena.segments, arena.trees);
  const vis = new VisibilityComputer(geo);

  const viewport = new Container();
  const terrain = new Container();
  const entityViewport = new Container();
  const entities = new Container();
  app.stage.addChild(viewport);
  viewport.addChild(terrain, entityViewport);
  entityViewport.addChild(entities);

  // Terrain (always drawn; greyscale outside vision).
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
  const glows: { sprite: Sprite; seed: number; kind: string }[] = [];
  for (const [i, l] of arena.lights.entries()) {
    const sp = new Sprite(assets.getTexture(l.kind === 'campfire' ? 'obj.campfire' : 'obj.lamp'));
    sp.anchor.set(0.5);
    sp.position.set(l.x, l.y);
    terrain.addChild(sp);
    const glow = new Sprite(assets.getTexture('fx.glow'));
    glow.anchor.set(0.5);
    glow.position.set(l.x, l.y);
    glow.tint = l.kind === 'campfire' ? 0xff8a3a : 0xffe0a0;
    glow.blendMode = 'add';
    glow.alpha = 0.35;
    glow.scale.set((l.radius * 1.4) / 128);
    terrain.addChild(glow);
    glows.push({ sprite: glow, seed: i * 17.3, kind: l.kind });
  }
  const debugPolys = new Graphics();
  debugPolys.visible = false;
  terrain.addChild(debugPolys);

  // Entities (culled outside the vision mask).
  const loot = new Sprite(assets.getTexture('loot.fuel'));
  loot.anchor.set(0.5);
  loot.position.set(arena.loot.x, arena.loot.y);
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
  maskDebug.position.set(8, 60);
  app.stage.addChild(maskDebug);

  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText =
    'position:fixed;top:8px;left:8px;color:#cfc8b8;font:12px/1.4 monospace;background:rgba(0,0,0,.55);padding:6px 8px;pointer-events:none;white-space:pre';
  document.body.appendChild(hud);

  const input = new Input(app.canvas);
  const pos = { x: arena.spawn.x, y: arena.spawn.y };
  let facing = 0;
  let enemyIdx = 0;
  const enemyPos = { x: arena.enemyPath[0][0], y: arena.enemyPath[0][1] };
  let enemyPaused = false;
  const sv = BALANCE.survivor;

  // Static light polygons never change: compute once, draw at most 6 per frame.
  const lightPolys = arena.lights.map((l) => ({
    ...l,
    poly: vis.compute({ x: l.x, y: l.y, dir: 0, halfAngle: Math.PI, range: l.radius }),
  }));

  let time = 0;
  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let visMs = 0;
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
    freezeEffects: false,
  };
  let manualAim = false;
  (window as unknown as { __sandbox: typeof state }).__sandbox = state;

  let cpuMs = 0;
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

    // Player movement and aim.
    const ax = input.axis();
    const speed = input.isDown('ShiftLeft') ? sv.run : input.isDown('KeyC') ? sv.crouch : sv.walk;
    if (ax.x || ax.y) {
      manualAim = false;
      moveCircle(geo, pos, sv.radius, ax.x * speed * dt, ax.y * speed * dt);
    }
    const camX = Math.round(pos.x - app.screen.width / 2);
    const camY = Math.round(pos.y - app.screen.height / 2);
    if (!manualAim) facing = Math.atan2(input.mouseY + camY - pos.y, input.mouseX + camX - pos.x);
    if (input.wasPressed('KeyB')) maskDebug.visible = !maskDebug.visible;
    if (input.wasPressed('KeyV')) debugPolys.visible = !debugPolys.visible;
    input.endFrame();

    // Enemy wanders a loop.
    if (!enemyPaused) {
      const [tx, ty] = arena.enemyPath[enemyIdx];
      const dx = tx - enemyPos.x;
      const dy = ty - enemyPos.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) enemyIdx = (enemyIdx + 1) % arena.enemyPath.length;
      else {
        moveCircle(geo, enemyPos, BALANCE.hunter.radius, (dx / d) * 110 * dt, (dy / d) * 110 * dt);
        enemy.rotation = Math.atan2(dy, dx);
      }
    }
    enemy.position.set(enemyPos.x, enemyPos.y);
    player.position.set(pos.x, pos.y);
    player.rotation = facing;
    loot.rotation = Math.sin(time) * 0.1;

    // Vision polygons.
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
    const viewR = Math.hypot(app.screen.width, app.screen.height) / 2;
    const lights: MaskPolygon[] = lightPolys
      .filter((l) => Math.hypot(l.x - pos.x, l.y - pos.y) < viewR + l.radius)
      .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))
      .slice(0, BALANCE.lights.maxPolygonsPerFrame)
      .map((l, i) => ({
        poly: l.poly,
        ox: l.x,
        oy: l.y,
        range: l.radius,
        intensity: l.kind === 'campfire' ? 0.85 + 0.15 * Math.sin(time * BALANCE.lights.flickerSpeed + i * 2.1) * Math.sin(time * 3.1 + i) : 0.9,
      }));
    lightsDrawn = lights.length;
    visMs = visMs * 0.9 + (performance.now() - t0) * 0.1;

    for (const g of glows) {
      g.sprite.alpha = g.kind === 'campfire' ? 0.3 + 0.08 * Math.sin(time * 9 + g.seed) : 0.3;
    }

    if (debugPolys.visible) {
      debugPolys.clear();
      debugPolys.poly(conePoly).stroke({ width: 2, color: 0x44aaff });
      debugPolys.poly(proxPoly).stroke({ width: 1, color: 0x44ffaa });
      for (const l of lights) debugPolys.poly(l.poly).stroke({ width: 1, color: 0xff8844 });
    }

    terrain.position.set(-camX, -camY);
    entityViewport.position.set(0, 0);
    entities.position.set(-camX, -camY);
    vision.renderMask(app.renderer, camX, camY, { own, los: losPoly, lights });
    const flicker = state.freezeEffects ? 1 : 0.96 + 0.04 * Math.sin(time * 2.3) * Math.sin(time * 5.7);
    vision.setEffects({ time: state.freezeEffects ? 0 : time, terror: 0, flicker, blind: 0, damage: 0 });

    hud.textContent =
      `MANHUNT vision sandbox\n` +
      `FPS ${fps.toFixed(0)}   vision ${visMs.toFixed(2)} ms   cone rays ${rays}   lights ${lightsDrawn}/${arena.lights.length}\n` +
      `cpu ${cpuMs.toFixed(2)} ms/frame   trees ${arena.trees.length}   walls ${arena.segments.length}\n` +
      `WASD move · Shift run · C crouch · mouse aim · V polygons · B mask`;
    cpuMs = cpuMs * 0.9 + (performance.now() - frameStart) * 0.1;
  });
}

void boot();
