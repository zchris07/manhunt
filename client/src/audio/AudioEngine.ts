import type { AssetManager } from '../assets/AssetManager';

export interface PlayOptions {
  x?: number;
  y?: number;
  volume?: number;
  rate?: number;
  /** A wall is between the listener and the source: muffle it. */
  occluded?: boolean;
}

/**
 * Procedural positional audio (implemented in the horror-layer milestone). The game talks to
 * this interface only; every sound id has a slot in assets/manifest.json.
 */
export class AudioEngine {
  constructor(readonly assets: AssetManager) {}

  resume(): void {}
  setListener(_x: number, _y: number): void {}
  play(_id: string, _opts: PlayOptions = {}): void {}
  loop(_key: string, _id: string | null, _opts: PlayOptions = {}): void {}
  stopAllLoops(): void {}
  setHeartbeat(_intensity: number): void {}
  setAmbience(_indoors: boolean, _enabled: boolean): void {}
  setVolumes(_v: { master: number; sfx: number; ambience: number }): void {}
  update(_dt: number): void {}
}
