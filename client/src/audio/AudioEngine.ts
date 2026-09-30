import type { AssetManager } from '../assets/AssetManager';

export interface LoopOptions {
  x: number;
  y: number;
  volume?: number;
  /** Silent past this distance (world units). */
  radius: number;
  /** Full volume within this distance. */
  near: number;
  /**
   * Loudness falls off as ((radius - d) / (radius - near)) ^ curve instead of linearly: a high
   * curve is barely audible far out and swells very gradually to full volume close in.
   */
  curve?: number;
}

interface Loop {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode;
}

/**
 * Soft, quick footsteps (a pitter-patter) as a 2 s loop: 12 light steps, each a short burst
 * of filtered noise over a faint low thump, alternating feet.
 */
function pitterPatter(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 2);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const at = Math.floor(((i + (i % 2 ? 0.06 : 0)) / steps) * len);
    const amp = (i % 2 ? 0.75 : 1) * (0.85 + rnd() * 0.3);
    const n = Math.floor(rate * 0.07);
    let lp = 0;
    for (let k = 0; k < n && at + k < len; k++) {
      const t = k / rate;
      // Dull noise (one-pole low-pass) for the scuff, a decaying 110 Hz sine for the thump.
      lp += ((rnd() * 2 - 1) - lp) * 0.18;
      const scuff = lp * Math.exp(-t / 0.018) * 0.9;
      const thump = Math.sin(2 * Math.PI * (110 + (i % 2) * 14) * t) * Math.exp(-t / 0.025) * 0.55;
      d[at + k] += (scuff + thump) * amp * 0.5;
    }
  }
  return buf;
}

const SOUND_GENERATORS: Record<string, (ctx: BaseAudioContext) => AudioBuffer> = { pitterPatter };

/**
 * The game's sounds: the custom audio files in assets/manifest.json (a short fading GMajor
 * snippet that only Zach hears when he fires a Soundcloud Burst, and Sexton Science's
 * positional reel), Shane Jeans's synthesized pitter-patter while he's alerted, and two spoken
 * announcements (JARVIS and the Hemp Battery).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private clipBus!: GainNode;
  private loopBus!: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Set<string>();
  private volumes = { master: 0.8, sfx: 0.9, ambience: 0.7 };
  private readonly loops = new Map<string, Loop>();
  private clip: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private clips = 0;

  constructor(readonly assets: AssetManager) {}

  /** Creates or resumes the AudioContext (must follow a user gesture). */
  resume(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.clipBus = this.ctx.createGain();
      this.loopBus = this.ctx.createGain();
      this.clipBus.connect(this.master);
      this.loopBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      const l = this.ctx.listener;
      if (l.forwardZ) {
        l.forwardZ.value = -1;
        l.upY.value = 1;
      } else {
        l.setOrientation(0, 0, -1, 0, 1, 0);
      }
      for (const id of ['burst', 'sexton.reel']) this.getSound(id);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.clipBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.loopBus.gain.setTargetAtTime(this.volumes.ambience, t, 0.05);
  }

  setVolumes(v: { master: number; sfx: number; ambience: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  /** The decoded file for a manifest sound id, or null while it loads (or before audio starts). */
  getSound(id: string): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const entry = this.assets.soundEntry(id);
    const gen = entry && !entry.file ? SOUND_GENERATORS[entry.procedural ?? ''] : undefined;
    if (gen) {
      const b = gen(ctx);
      this.buffers.set(id, b);
      return b;
    }
    if (entry?.file && !this.loading.has(id)) {
      this.loading.add(id);
      fetch(this.assets.resolveUrl(entry.file))
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((b) => void this.buffers.set(id, b))
        .catch(() => console.warn(`[audio] could not load ${entry.file}`));
    }
    return null;
  }

  private listenerX = 0;
  private listenerY = 0;

  /** Gain for a loop at (x,y) with a custom falloff curve (1 when it has none). */
  private falloff(o: LoopOptions): number {
    if (!o.curve) return 1;
    const d = Math.hypot(o.x - this.listenerX, o.y - this.listenerY);
    const k = Math.max(0, Math.min(1, (o.radius - d) / Math.max(1, o.radius - o.near)));
    return Math.pow(k, o.curve);
  }

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionZ.value = y;
    } else {
      l.setPosition(x, 0, y);
    }
  }

  /**
   * Plays a section of a file for the manifest's `duration`, fading out over its last
   * `fadeOut` seconds: from its `offset`, or from a random point when the entry sets
   * `"random": true`. Restarts if already playing.
   */
  playClip(id: string, o: { fadeOut?: number; fadeIn?: number; volume?: number; duration?: number } = {}): boolean {
    const fadeOut = o.fadeOut ?? 1.4;
    const fadeIn = o.fadeIn ?? 0.04;
    const vol = o.volume ?? 1;
    const ctx = this.ctx;
    if (!ctx) return false;
    const b = this.getSound(id);
    if (!b) return false;
    this.clip?.src.stop();
    const entry = this.assets.soundEntry(id);
    const want = Math.min(o.duration ?? entry?.duration ?? b.duration, b.duration);
    const from = entry?.random ? Math.random() * Math.max(0, b.duration - want) : (entry?.offset ?? 0);
    const offset = Math.min(Math.max(0, from), Math.max(0, b.duration - 0.1));
    const dur = Math.min(want, b.duration - offset);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + fadeIn);
    gain.gain.setValueAtTime(vol, t + Math.max(fadeIn + 0.01, dur - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(gain).connect(this.clipBus);
    src.start(t, offset, dur + 0.05);
    this.clip = { src, gain };
    this.clips++;
    src.onended = () => {
      if (this.clip?.src === src) this.clip = null;
    };
    return true;
  }

  /** Starts, moves or (with id null) stops a named positional looping file. */
  loop(key: string, id: string | null, o?: LoopOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cur = this.loops.get(key);
    const t = ctx.currentTime;
    if (!id || !o) {
      if (cur) {
        cur.gain.gain.setTargetAtTime(0, t, 0.2);
        cur.src.stop(t + 1);
        this.loops.delete(key);
      }
      return;
    }
    if (cur && cur.id === id) {
      cur.gain.gain.setTargetAtTime((o.volume ?? 1) * this.falloff(o), t, 0.1);
      if (cur.panner.positionX) {
        cur.panner.positionX.setTargetAtTime(o.x, t, 0.05);
        cur.panner.positionZ.setTargetAtTime(o.y, t, 0.05);
      } else cur.panner.setPosition(o.x, 0, o.y);
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
    gain.gain.setTargetAtTime((o.volume ?? 1) * this.falloff(o), t, 0.3);
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.refDistance = o.near;
    p.maxDistance = Math.max(o.near + 20, o.radius);
    // With a custom curve the panner only pans; the gain does the distance falloff.
    if (o.curve) p.rolloffFactor = 0;
    if (p.positionX) {
      p.positionX.value = o.x;
      p.positionZ.value = o.y;
    } else p.setPosition(o.x, 0, o.y);
    src.connect(gain).connect(p).connect(this.loopBus);
    // A long track keeps playing "continuously": join it where a clock started at 0 would be.
    src.start(t, t % b.duration);
    this.loops.set(key, { id, src, gain, panner: p });
  }

  /** A robot voice announcement (speech synthesis, pitched down). */
  announce(text: string): void {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    this.lastAnnouncement = text;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.1;
      u.rate = 0.85;
      u.volume = Math.min(1, this.volumes.master * 1.1);
      const voices = synth.getVoices();
      const pick = voices.find((v) => /en/i.test(v.lang) && /male|david|daniel|fred|google uk/i.test(v.name)) ?? voices.find((v) => /^en/i.test(v.lang));
      if (pick) u.voice = pick;
      synth.cancel();
      synth.speak(u);
    } catch {
      // Speech isn't available (some headless browsers): the on-screen text still shows.
    }
  }

  lastAnnouncement = '';

  /** Diagnostics for tests and the debug overlay. */
  stats(): { state: string; buffers: number; loops: string[]; clip: boolean; clips: number; loaded: string[]; announced: string } {
    return {
      state: this.ctx?.state ?? 'none',
      buffers: this.buffers.size,
      loops: [...this.loops.keys()],
      clip: this.clip !== null,
      clips: this.clips,
      loaded: [...this.buffers.keys()],
      announced: this.lastAnnouncement,
    };
  }

  stopAllLoops(): void {
    for (const key of [...this.loops.keys()]) this.loop(key, null);
    this.clip?.src.stop();
    this.clip = null;
  }
}
