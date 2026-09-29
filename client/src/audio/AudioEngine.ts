import type { AssetManager } from '../assets/AssetManager';
import { SOUND_GENERATORS } from '../assets/procedural/sounds';

export interface PlayOptions {
  x?: number;
  y?: number;
  volume?: number;
  rate?: number;
  /** A wall is between the listener and the source: muffle it. */
  occluded?: boolean;
  /** Audible radius in world units (defaults to 900). */
  radius?: number;
}

/** Default mapping from sound ids to procedural generators (the manifest can override). */
const DEFAULT_SOUNDS: Record<string, string> = {
  'step.forest': 'footstepForest',
  'step.dirt': 'footstepDirt',
  'step.grass': 'footstepGrass',
  'step.concrete': 'footstepConcrete',
  'step.wood': 'footstepWood',
  'step.water': 'footstepWater',
  'step.heavy': 'footstepHeavy',
  heartbeat: 'heartbeat',
  stinger: 'stinger',
  chase: 'chase',
  'amb.wind': 'wind',
  'amb.crickets': 'crickets',
  'amb.owl': 'owl',
  'amb.branch': 'branchSnap',
  'amb.indoor': 'indoorHum',
  'amb.drip': 'drip',
  'amb.creak': 'creak',
  'gen.hum': 'genHum',
  'gen.repair': 'genRepair',
  'gen.done': 'genDone',
  gen_done: 'genDone',
  gen_explode: 'genExplode',
  gen_kick: 'genKick',
  hit: 'hit',
  'hit.self': 'hitSelf',
  scream: 'scream',
  'stun.hit': 'stunHit',
  'stun.blind': 'stunBlind',
  barricade: 'barricade',
  vault: 'vault',
  locker: 'locker',
  rustle: 'rustle',
  glass: 'glass',
  flare: 'flare',
  swing: 'swing',
  stake: 'stake',
  gasp: 'gasp',
  breath: 'breath',
  pulse: 'pulse',
  sniff: 'sniff',
  smash: 'smash',
  gate: 'gateAlarm',
  gate_open: 'gateOpen',
  'gate.powered': 'gatePowered',
  'gate.open': 'gateOpen',
  'skill.warn': 'skillWarn',
  'skill.good': 'skillGood',
  'skill.fail': 'skillFail',
  grunt: 'grunt',
  install: 'install',
  eliminated: 'eliminated',
  search: 'search',
};

export const SOUND_IDS = Object.keys(DEFAULT_SOUNDS);

interface Loop {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode | null;
}

const MAX_VOICES = 40;

/**
 * Procedural positional audio on WebAudio. Sources are PannerNodes in a top-down plane
 * (world x -> audio x, world y -> audio z), muffled by a low-pass filter when a wall is in
 * the way. Every sound id has a slot in assets/manifest.json: a file there replaces the
 * procedural version.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Set<string>();
  private volumes = { master: 0.8, sfx: 0.9, ambience: 0.7 };
  private readonly listener = { x: 0, y: 0 };
  private readonly loops = new Map<string, Loop>();
  private heartbeat = 0;
  private nextBeat = 0;
  private indoors = false;
  private ambienceOn = false;
  private nextAmbient = 0;
  private voices = 0;
  private seed = 1;

  constructor(readonly assets: AssetManager) {}

  private rnd = (): number => {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  /** Creates or resumes the AudioContext (must follow a user gesture). */
  resume(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.amb = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.amb.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      const l = this.ctx.listener;
      if (l.forwardZ) {
        l.forwardX.value = 0;
        l.forwardY.value = 0;
        l.forwardZ.value = -1;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        l.setOrientation(0, 0, -1, 0, 1, 0);
      }
      // Warm the buffers used constantly.
      for (const id of ['step.forest', 'step.dirt', 'heartbeat', 'amb.wind', 'amb.indoor']) this.getSound(id);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.volumes.ambience * 0.8, t, 0.05);
  }

  setVolumes(v: { master: number; sfx: number; ambience: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  /**
   * getSound(id): the file named in assets/manifest.json once it has loaded, otherwise the
   * procedural version (the counterpart of AssetManager.getTexture). Null before the audio
   * context exists (browsers need a user gesture first).
   */
  getSound(id: string): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const entry = this.assets.soundEntry(id);
    if (entry?.file && !this.loading.has(id)) {
      this.loading.add(id);
      fetch(this.assets.resolveUrl(entry.file))
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((b) => void this.buffers.set(id, b))
        .catch(() => console.warn(`[audio] could not load ${entry.file}, using procedural ${id}`));
    }
    const genName = entry?.procedural ?? DEFAULT_SOUNDS[id];
    const gen = genName ? SOUND_GENERATORS[genName] : undefined;
    if (!gen) return null;
    const data = gen(ctx.sampleRate, this.rnd);
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    // A file may have arrived meanwhile; don't overwrite it.
    if (!this.buffers.has(id)) this.buffers.set(id, b);
    return this.buffers.get(id)!;
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = 0;
      l.positionZ.value = y;
    } else {
      l.setPosition(x, 0, y);
    }
  }

  private makePanner(x: number, y: number, radius: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.refDistance = 60;
    p.maxDistance = Math.max(80, radius);
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = 0;
      p.positionZ.value = y;
    } else {
      p.setPosition(x, 0, y);
    }
    return p;
  }

  /** Plays a one-shot. Positional if x/y are given. */
  play(id: string, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    if (o.x !== undefined && o.y !== undefined) {
      const d = Math.hypot(o.x - this.listener.x, o.y - this.listener.y);
      if (d > (o.radius ?? 1400)) return;
    }
    const b = this.getSound(id);
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = o.rate ?? 0.93 + this.rnd() * 0.14;
    const gain = ctx.createGain();
    gain.gain.value = o.volume ?? 1;
    let node: AudioNode = src;
    node.connect(gain);
    node = gain;
    if (o.occluded) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 650;
      node.connect(f);
      node = f;
    }
    if (o.x !== undefined && o.y !== undefined) {
      const p = this.makePanner(o.x, o.y, o.radius ?? 1400);
      node.connect(p);
      node = p;
    }
    node.connect(this.sfx);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
    };
    src.start();
  }

  /** Starts, updates or (with id null) stops a named looping sound. */
  loop(key: string, id: string | null, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cur = this.loops.get(key);
    if (!id) {
      if (cur) {
        const t = ctx.currentTime;
        cur.gain.gain.setTargetAtTime(0, t, 0.2);
        cur.src.stop(t + 1);
        this.loops.delete(key);
      }
      return;
    }
    const t = ctx.currentTime;
    if (cur && cur.id === id) {
      cur.gain.gain.setTargetAtTime(o.volume ?? 1, t, 0.1);
      cur.filter.frequency.setTargetAtTime(o.occluded ? 650 : 18000, t, 0.1);
      if (cur.panner && o.x !== undefined && o.y !== undefined) {
        if (cur.panner.positionX) {
          cur.panner.positionX.setTargetAtTime(o.x, t, 0.05);
          cur.panner.positionZ.setTargetAtTime(o.y, t, 0.05);
        } else cur.panner.setPosition(o.x, 0, o.y);
      }
      return;
    }
    if (cur) this.loop(key, null);
    const b = this.getSound(id);
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(o.volume ?? 1, t, 0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.occluded ? 650 : 18000;
    src.connect(gain).connect(filter);
    let panner: PannerNode | null = null;
    const bus = key.startsWith('amb') ? this.amb : this.sfx;
    if (o.x !== undefined && o.y !== undefined) {
      panner = this.makePanner(o.x, o.y, o.radius ?? 900);
      filter.connect(panner).connect(bus);
    } else {
      filter.connect(bus);
    }
    src.start(t, this.rnd() * b.duration);
    this.loops.set(key, { id, src, gain, filter, panner });
  }

  /** Diagnostics for tests and the debug overlay. */
  stats(): { state: string; buffers: number; loops: string[]; voices: number } {
    return { state: this.ctx?.state ?? 'none', buffers: this.buffers.size, loops: [...this.loops.keys()], voices: this.voices };
  }

  hasLoop(key: string): boolean {
    return this.loops.has(key);
  }

  loopKeys(): string[] {
    return [...this.loops.keys()];
  }

  stopAllLoops(): void {
    for (const key of [...this.loops.keys()]) if (!key.startsWith('amb')) this.loop(key, null);
  }

  /** Heartbeat intensity from the terror radius (0 = calm, 1 = Zach is right there). */
  setHeartbeat(intensity: number): void {
    this.heartbeat = Math.max(0, Math.min(1, intensity));
  }

  setAmbience(indoors: boolean, enabled: boolean): void {
    this.indoors = indoors;
    this.ambienceOn = enabled;
  }

  update(_dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // Heartbeat, faster and louder as the terror radius tightens.
    if (this.heartbeat > 0.02 && t >= this.nextBeat) {
      this.play('heartbeat', { volume: 0.25 + 0.75 * this.heartbeat, rate: 1 });
      this.nextBeat = t + 1.3 - 0.85 * this.heartbeat;
    }
    // Ambience beds crossfade between the woods and the warehouse.
    const outdoorVol = this.ambienceOn ? (this.indoors ? 0.12 : 0.55) : 0;
    const indoorVol = this.ambienceOn ? (this.indoors ? 0.6 : 0) : 0;
    this.loop('amb.outdoor', outdoorVol > 0 ? 'amb.wind' : null, { volume: outdoorVol });
    this.loop('amb.indoor', indoorVol > 0 ? 'amb.indoor' : null, { volume: indoorVol });
    if (this.ambienceOn && t >= this.nextAmbient) {
      const a = this.rnd() * Math.PI * 2;
      const d = 250 + this.rnd() * 700;
      const x = this.listener.x + Math.cos(a) * d;
      const y = this.listener.y + Math.sin(a) * d;
      const roll = this.rnd();
      if (this.indoors) this.play(roll < 0.6 ? 'amb.drip' : 'amb.creak', { x, y, volume: 0.35 });
      else if (roll < 0.7) this.play('amb.crickets', { x, y, volume: 0.25 });
      else if (roll < 0.85) this.play('amb.branch', { x, y, volume: 0.4 });
      else this.play('amb.owl', { x, y, volume: 0.35 });
      this.nextAmbient = t + 0.8 + this.rnd() * (this.indoors ? 4 : 2.5);
    }
  }
}
