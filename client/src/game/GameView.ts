import { Container, type Application } from 'pixi.js';
import {
  Action,
  BALANCE,
  Btn,
  EF,
  Gait,
  Health,
  TICK_DT,
  VisibilityComputer,
  type GameEvent,
  type InputCmd,
  type SelfState,
  type WorldState,
} from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import type { AudioEngine } from '../audio/AudioEngine';
import type { GameClient } from '../net/GameClient';
import type { Input } from '../input/Input';
import { MapRenderer, type BarricadeVisual } from '../render/MapRenderer';
import { VisionRenderer } from '../render/vision/VisionRenderer';
import { Hud, SkillCheck } from '../ui/hud';
import { EntityLayer, type RenderPlayer } from './EntityLayer';
import { Overlays } from './Overlays';
import { VisionSources, type LightInfo, type ViewerInfo } from './visionSources';
import { FogLayer } from './FogLayer';

const STEP_MS = TICK_DT * 1000;

export interface GameViewOptions {
  app: Application;
  assets: AssetManager;
  audio: AudioEngine;
  client: GameClient;
  uiRoot: HTMLElement;
  input: Input;
}

/** Renders and drives one match: input sampling, prediction, vision, entities, HUD. */
export class GameView {
  private readonly viewport = new Container();
  private readonly world = new Container();
  private readonly entityViewport = new Container();
  private readonly entityWorld = new Container();
  private readonly senses = new Container();
  private readonly mapRenderer: MapRenderer;
  private readonly entities: EntityLayer;
  private readonly overlays: Overlays;
  private readonly fog: FogLayer;
  private readonly vision: VisionRenderer;
  private readonly sources: VisionSources;
  private readonly vis: VisibilityComputer;
  readonly hud: Hud;
  private readonly skill: SkillCheck;
  private latch = new Set<string>();
  private stepTimer = 0;
  private lastStepAt = 0;
  private time = 0;
  private damage = 0;
  private blindFx = 0;
  private bloodhoundUntil = 0;
  private barricadeState: number[] = [];
  private gateOpen = false;
  private repaired: boolean[] = [];
  private lastAim = -Math.PI / 2;
  private lastAimDist = 0;
  private renderPos = { x: 0, y: 0 };
  private readonly resize = (w: number, h: number): void => this.vision.resize(w, h);
  private readonly roleIsHunter: boolean;

  constructor(private readonly o: GameViewOptions) {
    const m = o.client.match!;
    this.roleIsHunter = m.role === 'hunter';
    this.mapRenderer = new MapRenderer(m.map, o.assets);
    this.overlays = new Overlays(o.assets);
    this.fog = new FogLayer(o.assets, m.map.width, m.map.height);
    this.entities = new EntityLayer(o.assets, m.map, m.players, this.roleIsHunter);
    this.world.addChild(this.mapRenderer.root, this.overlays.decals, this.fog.root);
    this.entityWorld.addChild(this.entities.root);
    this.entityViewport.addChild(this.entityWorld);
    this.viewport.addChild(this.world, this.entityViewport);
    this.senses.addChild(this.overlays.senses);
    o.app.stage.addChild(this.viewport, this.senses);

    this.vision = new VisionRenderer(o.app.screen.width, o.app.screen.height);
    this.vision.attach(this.viewport, this.entityViewport);
    o.app.renderer.on('resize', this.resize);
    this.vis = new VisibilityComputer(m.mw.geo);
    this.sources = new VisionSources(this.vis, m.map);

    this.hud = new Hud(o.uiRoot, o.client);
    this.skill = new SkillCheck(this.hud.root, (id, result) => {
      o.client.send({ t: 'skill', id, result });
      o.audio.play(result === 'miss' ? 'skill.fail' : 'skill.good');
    });
    this.barricadeState = m.map.barricades.map(() => 0);
    this.repaired = m.map.generators.map(() => false);
    o.audio.stopAllLoops();
    this.hud.center(this.roleIsHunter ? 'You are Zach Branch. Hunt them.' : m.role === 'spectator' ? 'Spectating' : 'Find fuel and wire. Stay quiet.', 4500);

    // Fixed 30 Hz input steps on their own timer, independent of the render frame rate.
    let next = performance.now();
    this.lastStepAt = next;
    this.stepTimer = window.setInterval(() => {
      const now = performance.now();
      let steps = 0;
      while (now >= next && steps < 4) {
        this.inputStep(next);
        next += STEP_MS;
        steps++;
      }
      if (now - next > 250) next = now;
    }, 5);
  }

  private inputStep(at: number): void {
    const c = this.o.client;
    this.latch = this.o.input.takeLatched();
    if (this.skill.isActive) this.latch.delete('Space');
    c.pushInput(this.spectating() ? { buttons: 0, moveX: 0, moveY: 0, aim: this.lastAim, aimDist: 0 } : this.buildCmd());
    this.lastStepAt = at;
  }

  destroy(): void {
    clearInterval(this.stepTimer);
    this.o.app.renderer.off('resize', this.resize);
    this.hud.destroy();
    this.skill.destroy();
    this.viewport.filters = null;
    this.entityViewport.filters = null;
    this.viewport.destroy({ children: true });
    this.senses.destroy({ children: true });
    this.vision.destroy();
    this.o.audio.stopAllLoops();
    this.o.audio.setHeartbeat(0);
  }

  private get self(): SelfState | null {
    return this.o.client.self;
  }

  private spectating(): boolean {
    const s = this.self;
    return !!s && (s.spectating > 0 || s.role === 2);
  }

  private buildCmd(): Omit<InputCmd, 'seq'> {
    const inp = this.o.input;
    const ax = inp.axis();
    const L = (code: string): boolean => this.latch.has(code);
    let b = 0;
    if (this.roleIsHunter) {
      if (inp.buttons[0] || L('Mouse0')) b |= Btn.Attack;
      if (inp.buttons[2] || L('Mouse2') || inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) b |= Btn.Lunge;
      if (inp.isDown('KeyQ') || L('KeyQ')) b |= Btn.Ability1;
      if (inp.isDown('KeyR') || L('KeyR')) b |= Btn.Ability2;
      if (inp.isDown('KeyF') || L('KeyF')) b |= Btn.Ability3;
      if (inp.isDown('KeyE') || L('KeyE')) b |= Btn.Interact;
      if (inp.isDown('Space') || L('Space')) b |= Btn.Vault;
    } else {
      const spaceHeld = inp.isDown('Space') && !this.skill.isActive;
      if (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) b |= Btn.Run;
      if (inp.isDown('KeyC') || inp.isDown('ControlLeft')) b |= Btn.Crouch;
      if (inp.isDown('KeyE') || L('KeyE')) b |= Btn.Interact;
      if (spaceHeld || L('Space')) b |= Btn.Vault | Btn.HoldBreath;
      if (inp.isDown('KeyF')) b |= Btn.Flash;
      if (inp.buttons[2] || L('Mouse2') || inp.isDown('KeyG') || L('KeyG')) b |= Btn.UseItem;
    }
    const sw = this.o.app.screen.width;
    const sh = this.o.app.screen.height;
    const cam = this.camera(sw, sh);
    const mx = inp.mouseX + cam.x;
    const my = inp.mouseY + cam.y;
    const dx = mx - this.renderPos.x;
    const dy = my - this.renderPos.y;
    if (Math.hypot(dx, dy) > 4) {
      this.lastAim = Math.atan2(dy, dx);
      this.lastAimDist = Math.hypot(dx, dy);
    }
    return { buttons: b, moveX: ax.x, moveY: ax.y, aim: this.lastAim, aimDist: this.lastAimDist };
  }

  private camera(sw: number, sh: number): { x: number; y: number } {
    const look = this.spectating() ? 0 : Math.min(this.lastAimDist, 260) * 0.22;
    return {
      x: Math.round(this.renderPos.x + Math.cos(this.lastAim) * look - sw / 2),
      y: Math.round(this.renderPos.y + Math.sin(this.lastAim) * look - sh / 2),
    };
  }

  private handleEvents(now: number): void {
    const me = this.o.client.you;
    const a = this.o.audio;
    const m = this.o.client.match!;
    for (const e of this.o.client.drainEvents()) this.onEvent(e, now, me, a, m.mw.geo);
  }

  private onEvent(e: GameEvent, now: number, me: number, a: AudioEngine, geo: { hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean }): void {
    const at = (x: number, y: number): { x: number; y: number; occluded: boolean } => ({ x, y, occluded: !geo.hasLineOfSight(this.renderPos.x, this.renderPos.y, x, y) });
    const name = (id: number): string => this.o.client.match?.players.get(id)?.name ?? 'Someone';
    switch (e.k) {
      case 'feed':
      case 'item':
        this.hud.feed(e.text);
        break;
      case 'health':
        this.hud.setRosterHealth(e.id, e.h);
        break;
      case 'hit':
        this.overlays.addBlood(e.x, e.y);
        this.overlays.addBlood(e.x, e.y);
        if (e.victim === me) {
          this.damage = 1;
          a.play('hit.self');
        } else a.play('hit', at(e.x, e.y));
        break;
      case 'down':
        if (e.victim === me) this.hud.center('You are down. Crawl, and wait for help.', 4000);
        break;
      case 'stun':
        if (e.target === me) this.hud.center(e.kind === 'flash' || e.kind === 'flare' ? 'BLINDED' : 'STUNNED', 1500);
        a.play(e.kind === 'flash' || e.kind === 'flare' ? 'stun.blind' : 'stun.hit');
        break;
      case 'staked':
        if (e.victim === me) this.hud.center(e.stage >= 2 ? 'Sacrificed.' : 'Staked. Your team has 60 seconds.', 4000);
        else this.hud.feed(`${name(e.victim)} ${e.stage >= 2 ? 'was sacrificed' : 'is on a stake'}`);
        a.play('stake');
        break;
      case 'unstaked':
        break;
      case 'eliminated':
        if (e.victim === me) this.hud.center('You were sacrificed. Spectating.', 5000);
        a.play('eliminated');
        break;
      case 'escaped':
        if (e.victim === me) this.hud.center('You escaped the woods.', 5000);
        break;
      case 'genDone':
        a.play('gen.done');
        break;
      case 'gatePowered':
        this.hud.center('The exit gate has power', 4000);
        a.play('gate.powered');
        break;
      case 'gateOpen':
        this.hud.center('THE GATE IS OPEN', 4000);
        a.play('gate.open');
        break;
      case 'chase':
        if (e.on && !this.roleIsHunter) a.play('stinger');
        break;
      case 'skill':
        this.skill.begin(e.id, e.delayMs, e.needleMs, e.zone, e.size, e.great, now);
        a.play('skill.warn');
        break;
      case 'skillResult':
        break;
      case 'pulse':
        this.overlays.addEchoes(e.echoes, now);
        a.play('pulse');
        break;
      case 'trail':
        this.overlays.setTrail(e.pts, now);
        this.bloodhoundUntil = now + Math.max(600, (this.self?.bloodhoundT ?? 0) * 1000 + 100);
        break;
      case 'breath':
        this.overlays.addBreath(e.x, e.y, now);
        a.play('breath', at(e.x, e.y));
        break;
      case 'noise':
        a.play(e.s, at(e.x, e.y));
        break;
    }
  }

  private syncProps(ws: WorldState): void {
    const mr = this.mapRenderer;
    ws.barricades.forEach((b, i) => {
      if (this.barricadeState[i] === b) return;
      this.barricadeState[i] = b;
      mr.setBarricade(i, (['up', 'down', 'broken'] as BarricadeVisual[])[b] ?? 'up');
    });
    if (ws.gateOpen !== this.gateOpen) {
      this.gateOpen = ws.gateOpen;
      mr.setGateOpen(ws.gateOpen);
    }
    ws.gens.forEach((g, i) => {
      const r = (g.flags & 1) !== 0;
      if (r !== this.repaired[i]) {
        this.repaired[i] = r;
        mr.setGenerator(i, r);
      }
    });
  }

  private selfRender(s: SelfState): RenderPlayer | null {
    const c = this.o.client;
    if (s.spectating || s.role === 2) return null;
    if (s.hideState === 2 || s.health === Health.Carried || s.health === Health.Escaped || s.health === Health.Eliminated) return null;
    let state = s.health & EF.HealthMask;
    if (s.role === 1) state |= EF.Hunter;
    if (s.carrying) state |= EF.Carrying;
    if (s.stunT > 0) state |= EF.Stunned;
    if ((c.predicted?.lungeT ?? 0) > 0) state |= EF.Lunging;
    if (s.action === Action.FlashAim) state |= EF.FlashBeam;
    if (s.blindT > 0) state |= EF.Blinded;
    if (s.action === Action.Vault) state |= EF.Vaulting;
    state |= (Gait.Walk & 3) << EF.GaitShift;
    return { id: s.id, x: this.renderPos.x, y: this.renderPos.y, facing: this.lastAim, state, action: s.action, extra: 0 };
  }

  frame(dtMs: number, now: number): void {
    const c = this.o.client;
    const inp = this.o.input;
    const dt = Math.min(0.1, dtMs / 1000);
    this.time += dt;

    // Space answers skill checks before anything else.
    if (inp.wasPressed('Space') && this.skill.isActive) this.skill.press(now);
    if (this.spectating()) {
      if (inp.wasPressed('Mouse0') || inp.wasPressed('ArrowRight')) c.send({ t: 'spectate', dir: 1 });
      if (inp.wasPressed('ArrowLeft')) c.send({ t: 'spectate', dir: -1 });
    }
    inp.endFrame();
    c.decaySmoothing(dt);
    this.handleEvents(now);

    const s = this.self;
    const snap = c.latest;
    if (!s || !snap) return;
    const ents = c.interpolated(now);
    const spect = this.spectating();

    // Where the camera and vision come from.
    let viewer: ViewerInfo;
    if (spect) {
      const t = ents.find((e) => e.id === s.spectating);
      const tx = t ? t.x : s.x;
      const ty = t ? t.y : s.y;
      this.renderPos.x += (tx - this.renderPos.x) * Math.min(1, dt * 12);
      this.renderPos.y += (ty - this.renderPos.y) * Math.min(1, dt * 12);
      const info = c.match!.players.get(s.spectating);
      viewer = {
        x: this.renderPos.x,
        y: this.renderPos.y,
        facing: t?.facing ?? 0,
        hunter: info?.role === 'hunter',
        blind: t ? (t.state & EF.Blinded) !== 0 : false,
        downed: t ? (t.state & EF.HealthMask) === Health.Downed : false,
        hidden: null,
      };
    } else {
      const p = c.predicted;
      const prev = c.prevPredicted ?? p;
      if (p && prev && s.health !== Health.Carried) {
        const alpha = Math.min(1, (now - this.lastStepAt) / STEP_MS);
        this.renderPos.x = prev.x + (p.x - prev.x) * alpha + c.smooth.x;
        this.renderPos.y = prev.y + (p.y - prev.y) * alpha + c.smooth.y;
      } else {
        const carrier = ents.find((e) => e.id === s.carriedBy);
        this.renderPos.x = carrier ? carrier.x : s.x;
        this.renderPos.y = carrier ? carrier.y : s.y;
      }
      viewer = {
        x: this.renderPos.x,
        y: this.renderPos.y,
        facing: this.lastAim,
        hunter: this.roleIsHunter,
        blind: s.blindT > 0,
        downed: s.health === Health.Downed,
        hidden: s.hideState === 2 && s.hideSpot >= 0 ? c.match!.map.hidingSpots[s.hideSpot] : null,
      };
    }

    const ws = snap.worldState;
    this.syncProps(ws);
    this.entities.update(ents, this.selfRender(s), ws, this.time);

    const sw = this.o.app.screen.width;
    const sh = this.o.app.screen.height;
    const cam = this.camera(sw, sh);
    this.world.position.set(-cam.x, -cam.y);
    this.entityWorld.position.set(-cam.x, -cam.y);
    this.senses.position.set(-cam.x, -cam.y);
    this.mapRenderer.update(cam.x, cam.y, sw, sh, this.time);
    this.fog.update(this.time, cam.x, cam.y);

    // Lights: map lights, restored generators, burning flares.
    const map = c.match!.map;
    const lights: LightInfo[] = map.lights.map((l, i) => ({
      key: `l${i}`,
      x: l.x,
      y: l.y,
      radius: l.radius,
      intensity: l.kind === 'campfire' ? 0.85 + 0.15 * Math.sin(this.time * BALANCE.lights.flickerSpeed + i * 2.1) * Math.sin(this.time * 3.1 + i) : 0.9,
      static: true,
    }));
    ws.gens.forEach((g, i) => {
      if (g.flags & 1) lights.push({ key: `g${i}`, x: map.generators[i].x, y: map.generators[i].y, radius: BALANCE.lights.generatorRadius, intensity: 0.95, static: true });
    });
    for (const e of ents) {
      if (e.kind === 1) lights.push({ key: `f${e.id}`, x: e.x, y: e.y, radius: BALANCE.tools.flare.lightRadius, intensity: 0.8 + 0.2 * Math.sin(this.time * 25 + e.id), static: false });
    }
    const sources = this.sources.build(viewer, lights, Math.hypot(sw, sh) / 2);
    this.vision.renderMask(this.o.app.renderer, cam.x, cam.y, sources);

    // Screen effects.
    this.damage = Math.max(0, this.damage - dt * 1.4);
    const blindTarget = viewer.blind ? 0.8 : 0;
    this.blindFx += (blindTarget - this.blindFx) * Math.min(1, dt * (blindTarget > this.blindFx ? 12 : 1.5));
    const terror = this.roleIsHunter && !spect ? 0 : s.terror;
    const flicker = 0.965 + 0.035 * Math.sin(this.time * 2.3) * Math.sin(this.time * 5.7) - terror * 0.08 * Math.max(0, Math.sin(this.time * 17) * Math.sin(this.time * 3.3));
    this.vision.setEffects({ time: this.time, terror, flicker, blind: this.blindFx, damage: this.damage + (s.health === Health.Downed && !spect ? 0.35 : 0) });

    // Senses overlay.
    const auras: { x: number; y: number }[] = [];
    if (!this.roleIsHunter) ws.stakes.forEach((occ, i) => occ && occ !== c.you && auras.push(map.stakes[i]));
    this.overlays.update(now, auras, this.bloodhoundUntil);

    this.skill.draw(now);
    if (this.skill.isActive && s.action !== Action.Repair) this.skill.cancel();
    this.hud.update(s, ws);

    // Audio listener, heartbeat, ambience.
    const a = this.o.audio;
    a.setListener(this.renderPos.x, this.renderPos.y);
    a.setHeartbeat(this.roleIsHunter && !spect ? 0 : s.terror);
    a.setAmbience(c.match!.mw.inWarehouse(this.renderPos.x, this.renderPos.y), true);
    a.update(dt);
  }
}
