import { Container, TilingSprite } from 'pixi.js';
import type { AssetManager } from '../assets/AssetManager';

/** Slow-drifting ground fog over the whole map (two layers moving at different speeds). */
export class FogLayer {
  readonly root = new Container();
  private readonly a: TilingSprite;
  private readonly b: TilingSprite;

  constructor(assets: AssetManager, private readonly width: number, private readonly height: number) {
    const tex = assets.getTexture('fx.fog');
    this.a = new TilingSprite({ texture: tex, width: 1, height: 1 });
    this.b = new TilingSprite({ texture: tex, width: 1, height: 1 });
    this.a.alpha = 0.1;
    this.b.alpha = 0.07;
    this.a.tileScale.set(3.2);
    this.b.tileScale.set(2.1);
    this.root.addChild(this.a, this.b);
  }

  /** Covers only the visible area (plus margin) to keep fill cost low. */
  update(time: number, camX: number, camY: number, sw = 3000, sh = 2000): void {
    for (const t of [this.a, this.b]) {
      t.position.set(Math.max(0, camX - 200), Math.max(0, camY - 200));
      t.width = Math.min(this.width - t.x, sw + 400);
      t.height = Math.min(this.height - t.y, sh + 400);
    }
    this.a.tilePosition.set(time * 9 - this.a.x, time * 4 - this.a.y);
    this.b.tilePosition.set(-time * 6 - this.b.x, time * 7 - this.b.y);
  }
}
