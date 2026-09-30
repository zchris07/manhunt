import type { AssetManager } from '../assets/AssetManager';

export interface LoopOptions {
  x: number;
  y: number;
  volume?: number;
  /** Silent past this distance (world units). */
  radius: number;
  /** Full volume within this distance. */
  near: number;
}

interface Loop {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode;
}

/**
 * The game's only sounds are the two custom audio files in assets/manifest.json: a fading
 * GMajor snippet when Zach fires a Soundcloud Burst (everyone hears it) and Sexton Science's
 * positional reel. There is no procedural or synthesized audio of any kind.
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

  setListener(x: number, y: number): void {
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
   * Plays a section of a file: from the manifest's `offset` for its `duration`, fading out
   * over its last `fadeOut` seconds. Restarts if already playing.
   */
  playClip(id: string, fadeOut = 1.4): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const b = this.getSound(id);
    if (!b) return false;
    this.clip?.src.stop();
    const entry = this.assets.soundEntry(id);
    const offset = Math.min(Math.max(0, entry?.offset ?? 0), Math.max(0, b.duration - 0.1));
    const dur = Math.min(entry?.duration ?? b.duration, b.duration - offset);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 0.04);
    gain.gain.setValueAtTime(1, t + Math.max(0.05, dur - fadeOut));
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
      cur.gain.gain.setTargetAtTime(o.volume ?? 1, t, 0.1);
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
    gain.gain.setTargetAtTime(o.volume ?? 1, t, 0.3);
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.refDistance = o.near;
    p.maxDistance = Math.max(o.near + 20, o.radius);
    if (p.positionX) {
      p.positionX.value = o.x;
      p.positionZ.value = o.y;
    } else p.setPosition(o.x, 0, o.y);
    src.connect(gain).connect(p).connect(this.loopBus);
    // A long track keeps playing "continuously": join it where a clock started at 0 would be.
    src.start(t, t % b.duration);
    this.loops.set(key, { id, src, gain, panner: p });
  }

  /** Diagnostics for tests and the debug overlay. */
  stats(): { state: string; buffers: number; loops: string[]; clip: boolean; clips: number; loaded: string[] } {
    return {
      state: this.ctx?.state ?? 'none',
      buffers: this.buffers.size,
      loops: [...this.loops.keys()],
      clip: this.clip !== null,
      clips: this.clips,
      loaded: [...this.buffers.keys()],
    };
  }

  stopAllLoops(): void {
    for (const key of [...this.loops.keys()]) this.loop(key, null);
    this.clip?.src.stop();
    this.clip = null;
  }
}
