import { Assets, Texture } from 'pixi.js';
import { TEXTURE_GENERATORS } from './procedural/textures';

export interface AssetEntry {
  procedural?: string;
  file?: string;
  variants?: number;
}

export interface AssetManifest {
  textures: Record<string, AssetEntry>;
  sounds: Record<string, AssetEntry>;
}

/**
 * Resolves asset ids to textures (and, via the audio engine, sounds). Every id has a slot in
 * `assets/manifest.json`. A slot with `file` loads that file; otherwise (or if loading fails)
 * the named procedural generator draws it. Swapping in real art only means editing the manifest.
 */
export class AssetManager {
  private readonly textures = new Map<string, Texture>();

  private constructor(
    readonly manifest: AssetManifest,
    private readonly baseUrl: string,
  ) {}

  static async load(manifestUrl = new URL('assets/manifest.json', document.baseURI).href): Promise<AssetManager> {
    let manifest: AssetManifest = { textures: {}, sounds: {} };
    try {
      const res = await fetch(manifestUrl);
      if (res.ok) manifest = (await res.json()) as AssetManifest;
    } catch {
      // Fall back to procedural defaults below.
    }
    manifest.textures ??= {};
    manifest.sounds ??= {};
    const mgr = new AssetManager(manifest, new URL('.', manifestUrl).href);
    await mgr.preloadTextures();
    return mgr;
  }

  private async preloadTextures(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [id, entry] of Object.entries(this.manifest.textures)) {
      const variants = Math.max(1, entry.variants ?? 1);
      for (let v = 0; v < variants; v++) {
        const key = `${id}#${v}`;
        if (entry.file) {
          const url = new URL(entry.file.replace('{v}', String(v)), this.baseUrl).href;
          jobs.push(
            Assets.load<Texture>(url)
              .then((tex) => void this.textures.set(key, tex))
              .catch(() => void this.textures.set(key, this.generate(id, entry, v))),
          );
        } else {
          this.textures.set(key, this.generate(id, entry, v));
        }
      }
    }
    await Promise.all(jobs);
  }

  private generate(id: string, entry: AssetEntry, variant: number): Texture {
    const gen = TEXTURE_GENERATORS[entry.procedural ?? ''];
    if (!gen) {
      console.warn(`[assets] no generator for ${id}`);
      return Texture.WHITE;
    }
    const tex = Texture.from(gen(variant));
    tex.source.scaleMode = 'linear';
    return tex;
  }

  /** Returns the texture for an id (and variant), falling back to the procedural version. */
  getTexture(id: string, variant = 0): Texture {
    const entry = this.manifest.textures[id];
    const variants = Math.max(1, entry?.variants ?? 1);
    const key = `${id}#${((variant % variants) + variants) % variants}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = entry ? this.generate(id, entry, variant) : Texture.WHITE;
      this.textures.set(key, tex);
    }
    return tex;
  }

  variantCount(id: string): number {
    return Math.max(1, this.manifest.textures[id]?.variants ?? 1);
  }

  soundEntry(id: string): AssetEntry | undefined {
    return this.manifest.sounds[id];
  }

  resolveUrl(file: string): string {
    return new URL(file, this.baseUrl).href;
  }
}
