import { Container, Graphics, type Application } from 'pixi.js';
import {
  Action,
  BALANCE,
  Btn,
  EF,
  EntityKind,
  GOLDEN_BIT,
  Gait,
  Health,
  INV_SLOTS,
  JadenFlag,
  SextonFlag,
  ShaneFlag,
  TICK_DT,
  VisibilityComputer,
  type GameEvent,
  type InputCmd,
  type SelfState,
  type WorldState,
} from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import type { AudioEngine } from '../audio/AudioEngine';
import type { GameClient, InterpEntity } from '../net/GameClient';
import type { Input } from '../input/Input';
import { MapRenderer, type BarricadeVisual } from '../render/MapRenderer';
import { VisionRenderer } from '../render/vision/VisionRenderer';
import { Hud, Inventory, SkillCheck } from '../ui/hud';
import { EntityLayer, type RenderPlayer } from './EntityLayer';
import { Overlays } from './Overlays';
import { VisionSources, type LightInfo, type ViewerInfo } from './visionSources';
import { FogLayer } from './FogLayer';
import { Particles } from './Particles';
import { MiniMap } from './MiniMap';
import { lightFlicker } from '../render/flicker';

const STEP_MS = TICK_DT * 1000;
const HEMP_ZOOM = 1 / BALANCE.hunter.hemp.zoomOut;

export interface GameViewOptions {
  app: Application;
  assets: AssetManager;
  audio: AudioEngine;
  client: GameClient;
  uiRoot: HTMLElement;
  input: Input;
  /** The shared inventory layout (kept across role switches). */
  inventory: Inventory;
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
  readonly minimap: MiniMap;
  private readonly skill: SkillCheck;
  private latch = new Set<string>();
  private stepTimer = 0;
  private lastStepAt = 0;
  private time = 0;
  private damage = 0;
  private barricadeState: number[] = [];
  private doorState: boolean[] = [];
  private windowState: boolean[] = [];
  private gateOpen = false;
  private repaired: boolean[] = [];
  private lastAim = -Math.PI / 2;
  private lastAimDist = 0;
  private renderPos = { x: 0, y: 0 };
  private readonly particles: Particles;
  private shake = 0;
  private zoomK = 0;
  private xrayK = 0;
  private lastReveal = 0;
  private doorVersion = -1;
  private swingUntil = 0;
  /** Zach: when the current swing charge started (0 = not charging), and its strength 0..1. */
  private chargeStart = 0;
  private charge = 0;
  private chargeLock = false;
  /** Zach: an arrow toward Shane Jeans while he's chasing someone. */
  private readonly shaneArrow = new Graphics();
  private readonly resize = (w: number, h: number): void => this.vision.resize(w, h);
  private readonly teleport = (x: number, y: number): void => this.o.client.send({ t: 'teleport', x: Math.round(x), y: Math.round(y) });
  readonly roleIsHunter: boolean;

  constructor(private readonly o: GameViewOptions) {
    const m = o.client.match!;
    this.roleIsHunter = m.role === 'hunter';
    this.mapRenderer = new MapRenderer(m.map, o.assets);
    this.overlays = new Overlays(o.assets, m.map.width, m.map.height);
    this.fog = new FogLayer(o.assets, m.map.width, m.map.height);
    this.entities = new EntityLayer(o.assets, m.map, m.players, this.roleIsHunter);
    this.world.addChild(this.mapRenderer.root, this.overlays.decals, this.fog.root);
    this.particles = new Particles(o.assets);
    this.entityWorld.addChild(this.overlays.scentRoot, this.entities.root, this.particles.root);
    this.entityViewport.addChild(this.entityWorld);
    this.viewport.addChild(this.world, this.entityViewport);
    this.senses.addChild(this.overlays.senses, this.entities.overlay, this.shaneArrow);
    this.entities.bubbleCheck = (x, y) => Math.hypot(x - this.renderPos.x, y - this.renderPos.y) < 360 && m.mw.geo.hasLineOfSight(this.renderPos.x, this.renderPos.y, x, y);
    o.app.stage.addChild(this.viewport, this.senses);

    this.vision = new VisionRenderer(o.app.screen.width, o.app.screen.height);
    this.vision.attach(this.viewport, this.entityViewport);
    o.app.renderer.on('resize', this.resize);
    this.vis = new VisibilityComputer(m.mw.geo);
    this.sources = new VisionSources(this.vis, m.map);

    this.hud = new Hud(o.uiRoot, o.client, o.assets, o.inventory);
    this.minimap = new MiniMap(this.hud.root, m.map, this.roleIsHunter);
    this.hud.topRight.insertBefore(this.minimap.root, this.hud.topRight.firstChild);

    this.skill = new SkillCheck(this.hud.root, (id, result) => o.client.send({ t: 'skill', id, result }));
    this.barricadeState = m.map.barricades.map(() => 0);
    this.doorState = m.map.doors.map((d) => !m.map.dynamicSegments[d.dyn].active);
    this.repaired = m.map.generators.map(() => false);
    o.audio.stopAllLoops();
    this.hud.center(this.roleIsHunter ? 'Hunt them' : m.role === 'spectator' ? 'Spectating' : 'Start the generators', 4500);

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
    c.pushInput(this.spectating() ? { buttons: 0, moveX: 0, moveY: 0, aim: this.lastAim, aimDist: 0, item: 0 } : this.buildCmd());
    this.lastStepAt = at;
  }

  destroy(): void {
    clearInterval(this.stepTimer);
    this.o.app.renderer.off('resize', this.resize);
    this.hud.destroy();
    this.minimap.destroy();
    this.skill.destroy();
    this.viewport.filters = null;
    this.entityViewport.filters = null;
    this.viewport.destroy({ children: true });
    this.senses.destroy({ children: true });
    this.vision.destroy();
    this.o.audio.stopAllLoops();
  }

  private get self(): SelfState | null {
    return this.o.client.self;
  }

  private spectating(): boolean {
    const s = this.self;
    return !!s && (s.spectating > 0 || s.role === 2);
  }

  /** Camera zoom: the Hemp Battery zooms out, and Waz's field of view change shows more (or less). */
  private get zoom(): number {
    const e = this.zoomK * this.zoomK * (3 - 2 * this.zoomK);
    const s = this.self;
    const fov = s && !this.spectating() ? s.fovMul || 1 : 1;
    return (1 + (HEMP_ZOOM - 1) * e) / fov;
  }

  private buildCmd(): Omit<InputCmd, 'seq'> {
    const inp = this.o.input;
    const ax = inp.axis();
    const L = (code: string): boolean => this.latch.has(code);
    const menus = this.hud.editorOpen || this.minimap.isOpen;
    let b = 0;
    if (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) b |= Btn.Run;
    if (inp.isDown('KeyE') || L('KeyE')) b |= Btn.Interact;
    if (inp.isDown('KeyQ') || L('KeyQ')) b |= Btn.Ability;
    if (!menus && (inp.buttons[0] || L('Mouse0'))) b |= Btn.Primary;
    if (this.roleIsHunter) {
      // Right click lunges; F fires the Soundcloud Burst.
      if (!menus && (inp.buttons[2] || L('Mouse2'))) b |= Btn.Lunge;
      if (inp.isDown('KeyF') || L('KeyF')) b |= Btn.Secondary;
      // Hold left click to charge the swipe, release to strike.
      const s = this.self;
      const now = performance.now();
      const C = BALANCE.hunter.attack.charge;
      // With the golden pump there's no machete to charge.
      const ready = !!s && s.pump <= 0 && s.attackCd <= 0 && !s.carrying && s.stunT <= 0 && s.action === Action.None && now >= this.swingUntil;
      if (!inp.buttons[0]) this.chargeLock = false;
      if (this.chargeStart && now - this.chargeStart >= C.autoRelease * 1000) {
        // Held too long: the swing goes off by itself; let go to charge again.
        this.charge = 1;
        this.chargeStart = 0;
        this.chargeLock = true;
        this.swingUntil = now + (BALANCE.hunter.attack.swingTime + BALANCE.hunter.attack.windup) * 1000;
      } else if (b & Btn.Primary && inp.buttons[0]) {
        if (!this.chargeStart && ready && !this.chargeLock) this.chargeStart = now;
      } else if (this.chargeStart) {
        this.charge = Math.min(1, (now - this.chargeStart) / 1000 / C.max);
        this.chargeStart = 0;
        if (ready) this.swingUntil = now + (BALANCE.hunter.attack.swingTime + BALANCE.hunter.attack.windup) * 1000;
      } else if (b & Btn.Primary && ready) {
        // A click shorter than one input step.
        this.charge = 0;
        this.swingUntil = now + (BALANCE.hunter.attack.swingTime + BALANCE.hunter.attack.windup) * 1000;
      }
      if (!s || s.stunT > 0 || s.carrying) this.chargeStart = 0;
    } else {
      if (inp.isDown('KeyC') || inp.isDown('ControlLeft')) b |= Btn.Crouch;
      if (inp.isDown('KeyG') || L('KeyG')) b |= Btn.Drop;
      const spaceHeld = inp.isDown('Space') && !this.skill.isActive;
      if (spaceHeld || L('Space')) b |= Btn.Space;
    }
    const sw = this.o.app.screen.width;
    const sh = this.o.app.screen.height;
    const cam = this.camera(sw, sh);
    const z = this.zoom;
    const mx = inp.mouseX / z + cam.x;
    const my = inp.mouseY / z + cam.y;
    const dx = mx - this.renderPos.x;
    const dy = my - this.renderPos.y;
    if (Math.hypot(dx, dy) > 4 && !menus) {
      this.lastAim = Math.atan2(dy, dx);
      this.lastAimDist = Math.hypot(dx, dy);
    }
    const item = this.roleIsHunter || !this.self ? 0 : this.o.inventory.held(this.self.slots);
    return { buttons: b, moveX: ax.x, moveY: ax.y, aim: this.lastAim, aimDist: this.lastAimDist, item };
  }

  private camera(sw: number, sh: number): { x: number; y: number } {
    const z = this.zoom;
    const look = this.spectating() ? 0 : Math.min(this.lastAimDist, 260) * 0.22;
    return {
      x: Math.round(this.renderPos.x + Math.cos(this.lastAim) * look - sw / (2 * z)),
      y: Math.round(this.renderPos.y + Math.sin(this.lastAim) * look - sh / (2 * z)),
    };
  }

  private handleEvents(now: number): void {
    for (const e of this.o.client.drainEvents()) this.onEvent(e, now);
  }

  private onEvent(e: GameEvent, now: number): void {
    const me = this.o.client.you;
    const a = this.o.audio;
    const name = (id: number): string => this.o.client.match?.players.get(id)?.name ?? 'Someone';
    const near = (x: number, y: number, r: number): number => Math.max(0, 1 - Math.hypot(x - this.renderPos.x, y - this.renderPos.y) / r);
    switch (e.k) {
      case 'feed':
      case 'item':
        this.hud.feed(e.text);
        break;
      case 'health':
        this.hud.setRosterHealth(e.id, e.h);
        break;
      case 'hit':
        this.entities.flinch(e.victim, e.by);
        if (e.w === 'beam') {
          this.particles.burst(e.x, e.y, 14, { speed: 220, life: 0.45, tint: 0xf0fff0, size: 1.2 });
        } else {
          this.overlays.addBlood(e.x, e.y);
          if (e.w !== 'pellet') this.overlays.addBlood(e.x, e.y);
          this.particles.burst(e.x, e.y, e.w === 'pellet' ? 6 : 16, { speed: 200, life: 0.5, tint: 0x7a0c14, size: 1.4 });
        }
        if (e.victim === me) {
          this.damage = 1;
          this.shake = Math.max(this.shake, 14);
        } else this.shake = Math.max(this.shake, 6 * near(e.x, e.y, 300));
        break;
      case 'down':
        if (e.victim === me) this.hud.center('You are down', 4000);
        break;
      case 'stun':
        if (e.target === me) {
          if (e.kind === 'down') this.hud.center('DOWN', BALANCE.hunter.health.downTime * 1000);
          else this.hud.center('STUNNED', 1500);
          this.shake = Math.max(this.shake, 10);
        }
        break;
      case 'staked':
        if (e.victim === me) this.hud.center(e.stage >= 2 ? 'Sacrificed.' : 'Staked', 4000);
        else this.hud.feed(`${name(e.victim)} ${e.stage >= 2 ? 'was sacrificed' : 'is on a stake'}`);
        break;
      case 'eliminated':
        if (e.victim === me) this.hud.center('Sacrificed', 5000);
        break;
      case 'escaped':
        if (e.victim === me) this.hud.center('Escaped', 5000);
        break;
      case 'gatePowered':
        this.hud.center('The exit gate has power', 4000);
        break;
      case 'gateOpen':
        this.hud.center('THE GATE IS OPEN', 4000);
        break;
      case 'skill':
        this.skill.begin(e.id, e.delayMs, e.needleMs, e.zone, e.size, e.great, now);
        break;
      case 'trail':
        this.overlays.addScent(e.pts, now);
        break;
      case 'breath':
        this.overlays.addBreath(e.x, e.y, now);
        break;
      case 'noise':
        if (e.s === 'gen_explode' || e.s === 'gen_kick') this.particles.burst(e.x, e.y - 10, 40, { speed: 260, life: 0.7 });
        else if (e.s === 'glass') this.particles.burst(e.x, e.y, 22, { speed: 170, life: 0.45, tint: 0xb8c8c8, size: 0.8 });
        else if (e.s === 'smash' || e.s === 'barricade' || e.s === 'door_smash') this.particles.burst(e.x, e.y, e.s === 'door_smash' ? 30 : 16, { speed: 150, life: 0.55, tint: 0x6e5840, size: 1.3 });
        if (e.s === 'gen_explode' || e.s === 'barricade' || e.s === 'smash' || e.s === 'door_smash') this.shake = Math.max(this.shake, 7 * near(e.x, e.y, 450));
        break;
      case 'shot': {
        this.entities.shot(e.x, e.y, e.p, e.gold);
        this.shake = Math.max(this.shake, 9 * near(e.x, e.y, 500));
        // Sparks where each pellet stops.
        for (let i = 0; i + 1 < e.p.length; i += 2) {
          const ang = e.p[i] / 1000;
          this.particles.burst(e.x + Math.cos(ang) * e.p[i + 1], e.y + Math.sin(ang) * e.p[i + 1], 3, { speed: 140, life: 0.3, tint: e.gold ? 0xffd86a : 0xffc23a, size: 0.7 });
        }
        break;
      }
      case 'burst':
        // Everyone sees the wave; only Zach hears it go out. A survivor hears it only if it hits them (the scare).
        this.overlays.addBurst(e.x, e.y, e.a, now);
        if (this.roleIsHunter) a.playClip('burst', { volume: BALANCE.hunter.burst.zachVolume });
        break;
      case 'scare': {
        // 2.5 s: the image and a snippet of the song both fade in and out.
        const S = BALANCE.hunter.burst;
        this.hud.jumpScare(S.scareTime * 1000);
        a.playClip('burst', { volume: S.scareVolume, fadeIn: S.scareFade, fadeOut: S.scareFade, duration: S.scareTime });
        break;
      }
      case 'book': {
        // The Grapes of Wrath hit Zach: a picture over his whole screen.
        const B = BALANCE.items.book;
        this.hud.flashImage(`ui.book.${e.img}`, B.blindTime * 1000, 200, 'book');
        this.shake = Math.max(this.shake, 16);
        break;
      }
      case 'boom':
        a.oneShot('boom', Math.max(0.15, near(e.x, e.y, 1400)));
        this.particles.burst(e.x, e.y, 18, { speed: 160, life: 0.5, tint: 0xe8dcc0, size: 1.1 });
        break;
      case 'wazSlain':
        this.hud.flashImage('ui.wazSlain', BALANCE.waz.slainFlash * 1000, 180);
        break;
      case 'jarvis':
        if (e.by === me) {
          this.hud.big('JARVIS ONLINE', 'jarvis');
          this.minimap.revealAll();
          this.minimap.widenView(BALANCE.sexton.jarvisMinimapMul);
        } else this.hud.big('JARVIS ONLINE', 'jarvis');
        this.hud.feed(`${name(e.by)} used JARVIS`);
        a.announce('Jarvis online');
        break;
      case 'shane':
        if (e.alerted) this.hud.center('SHANE JEANS HAS BEEN ALERTED', 3000);
        break;
      case 'hemp':
        if (e.by === me) this.hud.big('HEMP BATTERY ACTIVATED', 'hemp');
        else this.hud.feed('Zach used a Hemp Battery');
        a.announce('Hemp battery activated');
        break;
      case 'sexton':
        this.entities.say(e.say, this.time, 'sexton');
        break;
      case 'chris':
        this.entities.say(e.say, this.time, 'chris');
        break;
      case 'npc':
        this.entities.say(e.say, this.time, e.who);
        break;
      case 'tablet':
        this.entities.handTablet(e.x, e.y, e.to);
        break;
      case 'gas':
        this.particles.burst(e.x, e.y, 40, { speed: 320, life: 0.6, tint: 0xc86aff, size: 1.6 });
        break;
      case 'barricadeHit':
        this.mapRenderer.damageBarricade(e.id, e.hits);
        break;
      case 'roles': {
        const m = this.o.client.match;
        if (m) this.entities.setRoster(m.players, this.roleIsHunter);
        break;
      }
    }
  }

  private syncProps(ws: WorldState): void {
    const mr = this.mapRenderer;
    ws.barricades.forEach((b, i) => {
      if (this.barricadeState[i] === b) return;
      this.barricadeState[i] = b;
      mr.setBarricade(i, (['up', 'down', 'broken'] as BarricadeVisual[])[b] ?? 'up');
    });
    ws.doors.forEach((open, i) => {
      if (this.doorState[i] === open) return;
      this.doorState[i] = open;
      mr.setDoor(i, open, ws.doorsBroken[i] === true);
    });
    ws.windowsBroken.forEach((b, i) => {
      if (this.windowState[i] === b) return;
      this.windowState[i] = b;
      mr.setWindowBroken(i, b);
    });
    if (ws.gateOpen !== this.gateOpen) {
      this.gateOpen = ws.gateOpen;
      mr.setGateOpen(ws.gateOpen);
    }
    ws.gens.forEach((g, i) => {
      const r = (g.flags & 1) !== 0;
      if (r !== this.repaired[i]) {
        this.repaired[i] = r;
        this.entities.setGenerator(i, r);
      }
    });
  }

  private selfRender(s: SelfState): RenderPlayer | null {
    const c = this.o.client;
    if (s.spectating || s.role === 2) return null;
    if (s.hideState === 2 || s.health === Health.Carried || s.health === Health.Escaped || s.health === Health.Eliminated) return null;
    const p = c.predicted;
    let state = s.health & EF.HealthMask;
    if (s.role === 1) state |= EF.Hunter;
    if (s.carrying) state |= EF.Carrying;
    if (s.stunT > 0) state |= EF.Stunned;
    if ((p?.lungeT ?? 0) > 0) state |= EF.Lunging;
    if (s.gogglesOn) state |= EF.Goggles;
    if (s.hempT > 0) state |= EF.Hemp;
    if (s.gassed) state |= EF.Gassed;
    if (performance.now() < this.swingUntil) state |= EF.Attacking;
    const charging = this.chargeStart ? Math.min(1, (performance.now() - this.chargeStart) / 1000 / BALANCE.hunter.attack.charge.max) : 0;
    const locked = (p?.staminaLock ?? s.staminaLock) > 0;
    if (locked) state |= EF.StaminaLock;
    if (p?.sprinting) state |= EF.Sprinting;
    state |= (Gait.Walk & 3) << EF.GaitShift;
    // Zach's aux is his swing charge (0-255); a survivor's is the item in hand.
    const held = this.o.inventory.heldSlot(s.slots);
    const aux =
      s.role === 1
        ? s.pump > 0
          ? 255
          : Math.round((charging || (performance.now() < this.swingUntil ? this.charge : 0)) * 254)
        : held
          ? held.kind | (held.golden ? GOLDEN_BIT : 0)
          : 0;
    return { id: s.id, x: this.renderPos.x, y: this.renderPos.y, facing: this.lastAim, state, action: s.action, extra: 0, aux, hp: s.hp * 255 };
  }

  /** Positional sounds: Sexton's reel and Shane's pitter-patter while he's alerted. */
  private updateSounds(ents: InterpEntity[]): void {
    const a = this.o.audio;
    const lx = this.renderPos.x;
    const ly = this.renderPos.y;
    const sx = ents.find((e) => e.kind === EntityKind.Sexton && (e.state & SextonFlag.Dead) === 0);
    const X = BALANCE.sexton.audio;
    if (sx && Math.hypot(sx.x - lx, sx.y - ly) < X.far + 100) a.loop('sexton', 'sexton.reel', { x: sx.x, y: sx.y, volume: 1, radius: X.far, near: X.near, curve: X.curve });
    else a.loop('sexton', null);
    const sh = ents.find((e) => (e.kind === EntityKind.Shane || e.kind === EntityKind.Jaden) && (e.state & ShaneFlag.Chasing) !== 0 && (e.state & JadenFlag.Dead) === 0);
    const P = BALANCE.shane.steps;
    if (sh && Math.hypot(sh.x - lx, sh.y - ly) < P.far + 100) a.loop('shane', 'shane.steps', { x: sh.x, y: sh.y, volume: P.volume, radius: P.far, near: P.near });
    else a.loop('shane', null);
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
    const s0 = this.self;
    if (inp.wasPressed('KeyM')) this.minimap.toggle();
    if (inp.wasPressed('KeyT') && s0?.testMode) c.send({ t: 'switchRole' });
    if (!this.roleIsHunter && s0 && !this.spectating()) {
      if (inp.wasPressed('Tab')) this.hud.toggleEditor(s0);
      for (let i = 0; i < INV_SLOTS; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.o.inventory.select(i);
      const wheel = inp.takeWheel();
      if (wheel !== 0 && !this.hud.editorOpen) this.o.inventory.scroll(wheel > 0 ? 1 : -1, s0.slots);
    } else inp.takeWheel();
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
    let xrayOn = false;
    let hemp = false;
    if (spect) {
      const t = ents.find((e) => e.id === s.spectating);
      const tx = t ? t.x : s.x;
      const ty = t ? t.y : s.y;
      this.renderPos.x += (tx - this.renderPos.x) * Math.min(1, dt * 12);
      this.renderPos.y += (ty - this.renderPos.y) * Math.min(1, dt * 12);
      const info = c.match!.players.get(s.spectating);
      const goggles = t ? (t.state & EF.Goggles) !== 0 : false;
      hemp = t ? (t.state & EF.Hemp) !== 0 : false;
      xrayOn = goggles || hemp;
      viewer = {
        x: this.renderPos.x,
        y: this.renderPos.y,
        facing: t?.facing ?? 0,
        hunter: info?.role === 'hunter',
        downed: t ? (t.state & EF.HealthMask) === Health.Downed : false,
        hidden: null,
        coneMul: goggles ? BALANCE.items.goggles.coneMul : 1,
        proxMul: 1,
        xray: 0,
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
      hemp = s.hempT > 0;
      xrayOn = s.gogglesOn === 1 || hemp;
      viewer = {
        x: this.renderPos.x,
        y: this.renderPos.y,
        facing: this.lastAim,
        hunter: this.roleIsHunter,
        downed: s.health === Health.Downed,
        hidden: s.hideState === 2 && s.hideSpot >= 0 ? c.match!.map.hidingSpots[s.hideSpot] : null,
        coneMul: (s.gogglesOn ? BALANCE.items.goggles.coneMul : 1) * (s.fovMul || 1),
        proxMul: s.fovMul || 1,
        xray: 0,
      };
    }
    // See-through light fades in over 0.75 s and out in 1/6 s; the Hemp Battery zooms out over 1 s.
    this.xrayK = xrayOn ? Math.min(1, this.xrayK + dt / BALANCE.xray.fadeIn) : Math.max(0, this.xrayK - dt / BALANCE.xray.fadeOut);
    viewer.xray = this.xrayK;
    this.zoomK = hemp && viewer.hunter ? Math.min(1, this.zoomK + dt) : Math.max(0, this.zoomK - dt);

    const ws = snap.worldState;
    this.syncProps(ws);
    if (c.doorVersion !== this.doorVersion) {
      this.doorVersion = c.doorVersion;
      this.sources.invalidate();
    }
    this.entities.update(ents, this.selfRender(s), ws, this.time);

    const sw = this.o.app.screen.width;
    const sh = this.o.app.screen.height;
    const z = this.zoom;
    const cam = this.camera(sw, sh);
    this.shake = Math.max(0, this.shake - dt * 30);
    if (this.shake > 0.3) {
      cam.x += Math.round((Math.random() - 0.5) * this.shake);
      cam.y += Math.round((Math.random() - 0.5) * this.shake);
    }
    for (const layer of [this.world, this.entityWorld, this.senses]) {
      layer.scale.set(z);
      layer.position.set(-cam.x * z, -cam.y * z);
    }
    const vw = sw / z;
    const vh = sh / z;
    this.mapRenderer.update(cam.x, cam.y, vw, vh, this.time, dt);
    this.fog.update(this.time, cam.x, cam.y, vw, vh);

    // Lights: map lights and running generators.
    const map = c.match!.map;
    const lights: LightInfo[] = map.lights.map((l, i) => ({
      key: `l${i}`,
      x: l.x,
      y: l.y,
      radius: l.radius,
      intensity: lightFlicker(l.kind, this.time, i),
      static: true,
    }));
    ws.gens.forEach((g, i) => {
      if (g.flags & 1) lights.push({ key: `g${i}`, x: map.generators[i].x, y: map.generators[i].y, radius: BALANCE.lights.generatorRadius, intensity: 0.95, static: true });
    });
    // Shane Jeans carries a faint light wherever he goes.
    const jeans = ents.find((e) => e.kind === EntityKind.Shane);
    if (jeans) lights.push({ key: 'shane', x: jeans.x, y: jeans.y, radius: BALANCE.shane.light.radius, intensity: BALANCE.shane.light.intensity, static: false });
    // Jaden Nguyen carries one too.
    const jaden = ents.find((e) => e.kind === EntityKind.Jaden && (e.state & JadenFlag.Dead) === 0);
    if (jaden) lights.push({ key: 'jaden', x: jaden.x, y: jaden.y, radius: BALANCE.jaden.light.radius, intensity: BALANCE.jaden.light.intensity, static: false });
    // Marc Cortez's very faint light; Sexton's Hemp Beam lights its whole length.
    const marc = ents.find((e) => e.kind === EntityKind.Marc);
    if (marc) lights.push({ key: 'marc', x: marc.x, y: marc.y, radius: BALANCE.marc.light.radius, intensity: BALANCE.marc.light.intensity, static: false });
    const beam = ents.find((e) => e.kind === EntityKind.Beam);
    if (beam) {
      const BL = BALANCE.sexton.defense.light;
      const len = beam.extra * 8;
      for (const f of [0.15, 0.55, 0.97]) {
        lights.push({ key: `beam${f}`, x: beam.x + Math.cos(beam.facing) * len * f, y: beam.y + Math.sin(beam.facing) * len * f, radius: BL.radius, intensity: BL.intensity, static: false });
      }
    }
    // Sexton, Chris, Plasma and Waz carry a faint light too.
    for (const [key, kind, cfg] of [
      ['sexton', EntityKind.Sexton, BALANCE.sexton.light],
      ['chris', EntityKind.Chris, BALANCE.chris.light],
      ['plasma', EntityKind.Plasma, BALANCE.plasma.light],
      ['waz', EntityKind.Waz, BALANCE.npcLight],
    ] as const) {
      const n = ents.find((e) => e.kind === kind);
      if (n) lights.push({ key, x: n.x, y: n.y, radius: cfg.radius, intensity: cfg.intensity, static: false });
    }
    // Chris Zelley's ambulance glows faintly on both sides (he carries his own faint light too).
    const amb = map.ambulance;
    const AL = BALANCE.chris.ambulance;
    for (const side of [-1, 1]) {
      const off = side * (amb.width / 2 + 12);
      lights.push({
        key: `amb${side}`,
        x: amb.x - Math.sin(amb.angle) * off,
        y: amb.y + Math.cos(amb.angle) * off,
        radius: AL.lightRadius,
        intensity: AL.lightIntensity * (0.9 + 0.1 * Math.sin(this.time * 3.1 + side)),
        static: true,
      });
    }
    const sources = this.sources.build(viewer, lights, Math.hypot(vw, vh) / 2);
    sources.reveal = ws.reveal;
    this.vision.renderMask(this.o.app.renderer, cam.x, cam.y, sources, z);

    // Your map fills in with what you actually see.
    if (!spect && now - this.lastReveal > 120) {
      this.lastReveal = now;
      const own = sources.own.map((p) => p.poly);
      if (sources.xray) own.push(sources.xray.poly);
      this.minimap.reveal(own, sources.lights.map((l) => l.poly), sources.los);
    }

    // Screen effects.
    this.damage = Math.max(0, this.damage - dt * 1.4);
    const flicker = 0.975 + 0.025 * Math.sin(this.time * 2.3) * Math.sin(this.time * 5.7);
    this.vision.setEffects({ time: this.time, flicker, damage: this.damage + (s.health === Health.Downed && !spect ? 0.3 : 0) });

    // Senses overlay.
    const auras: { x: number; y: number }[] = [];
    if (!this.roleIsHunter) ws.stakes.forEach((occ, i) => occ && occ !== c.you && auras.push(map.stakes[i]));
    this.overlays.update(now, auras, { x: cam.x, y: cam.y, w: vw, h: vh });

    // Zach sees which way Shane Jeans is (never where exactly) while he's chasing someone.
    const arrow = this.shaneArrow;
    arrow.clear();
    if (ws.shaneDir !== null) {
      const a = ws.shaneDir;
      const r = 70 + Math.sin(this.time * 6) * 4;
      const cx = this.renderPos.x + Math.cos(a) * r;
      const cy = this.renderPos.y + Math.sin(a) * r;
      const pt = (f: number, s: number): [number, number] => [cx + Math.cos(a) * f - Math.sin(a) * s, cy + Math.sin(a) * f + Math.cos(a) * s];
      arrow.poly([...pt(16, 0), ...pt(-8, 11), ...pt(-3, 0), ...pt(-8, -11)]).fill({ color: 0x4a6a9a, alpha: 0.9 }).stroke({ width: 2, color: 0xd9d3c1, alpha: 0.9 });
    }
    this.skill.draw(now);
    if (this.skill.isActive && s.action !== Action.Repair) this.skill.cancel();
    this.hud.update(s, ws);
    // Testing mode: click the full map to teleport.
    this.minimap.setTeleport(s.testMode && !spect ? this.teleport : null);
    this.minimap.update({ x: this.renderPos.x, y: this.renderPos.y, facing: spect ? viewer.facing : this.lastAim, world: ws, now });

    this.particles.update(dt);

    // Audio: listener and Sexton's reel.
    const a = this.o.audio;
    a.setListener(this.renderPos.x, this.renderPos.y);
    this.updateSounds(ents);
  }
}
