import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BALANCE, DEG, EF, EntityKind, GenFlag, Health, type MapData, type MatchPlayerInfo, type WorldState } from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import { CHARACTER_TINTS } from '../assets/procedural/textures';
import type { InterpEntity } from '../net/GameClient';

export interface RenderPlayer {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: number;
  action: number;
  extra: number;
}

class PlayerSprite {
  readonly root = new Container();
  readonly body: Sprite;
  readonly carried: Sprite;
  readonly beam = new Graphics();
  readonly fx = new Graphics();
  readonly label: Text;
  private shake = 0;

  constructor(
    private readonly assets: AssetManager,
    readonly info: MatchPlayerInfo,
    showLabel: boolean,
  ) {
    this.beam.blendMode = 'add';
    this.body = new Sprite(assets.getTexture(info.role === 'hunter' ? 'char.hunter' : 'char.survivor'));
    this.body.anchor.set(0.5);
    if (info.role !== 'hunter') this.body.tint = CHARACTER_TINTS[info.tint % CHARACTER_TINTS.length];
    this.carried = new Sprite(assets.getTexture('char.survivorDowned'));
    this.carried.anchor.set(0.5);
    this.carried.scale.set(0.75);
    this.carried.visible = false;
    this.label = new Text({ text: info.name, style: { fontFamily: 'Courier New, monospace', fontSize: 11, fill: 0xcfc6ae } });
    this.label.anchor.set(0.5, 0);
    this.label.alpha = 0.7;
    this.label.visible = showLabel;
    this.root.addChild(this.beam, this.body, this.carried, this.fx, this.label);
  }

  set(p: RenderPlayer, time: number, stakePos: { x: number; y: number } | null): void {
    const health = p.state & EF.HealthMask;
    const hunter = (p.state & EF.Hunter) !== 0;
    this.root.position.set(p.x, p.y);
    this.label.position.set(0, hunter ? 26 : 20);
    if (!hunter) {
      const downed = health === Health.Downed;
      this.body.texture = this.assets.getTexture(downed ? 'char.survivorDowned' : 'char.survivor');
      if (health === Health.Staked && stakePos) {
        this.shake += 0.5;
        this.root.position.set(stakePos.x + Math.sin(this.shake) * 1.5, stakePos.y);
        this.body.rotation = -Math.PI / 2;
        this.body.tint = 0xb07070;
      } else {
        this.body.rotation = p.facing;
        this.body.tint = health === Health.Wounded ? 0xc08a80 : CHARACTER_TINTS[this.info.tint % CHARACTER_TINTS.length];
      }
    } else {
      this.body.rotation = p.facing;
      this.carried.visible = (p.state & EF.Carrying) !== 0;
      if (this.carried.visible) {
        this.carried.position.set(Math.cos(p.facing + Math.PI * 0.6) * 12, Math.sin(p.facing + Math.PI * 0.6) * 12);
        this.carried.rotation = p.facing + Math.PI / 2;
      }
    }
    const vaulting = (p.state & EF.Vaulting) !== 0;
    const lunging = (p.state & EF.Lunging) !== 0;
    this.body.scale.set(vaulting ? 1.12 : 1, lunging ? 0.92 : 1);

    this.beam.clear();
    if (p.state & EF.FlashBeam) {
      const r = BALANCE.tools.flash.range;
      const a = BALANCE.tools.flash.halfAngleDeg * DEG;
      this.beam
        .moveTo(0, 0)
        .lineTo(Math.cos(p.facing - a) * r, Math.sin(p.facing - a) * r)
        .lineTo(Math.cos(p.facing + a) * r, Math.sin(p.facing + a) * r)
        .closePath()
        .fill({ color: 0xfff2c0, alpha: 0.18 + 0.05 * Math.sin(time * 30) });
    }
    this.fx.clear();
    if (p.state & EF.Attacking) {
      const arc = BALANCE.hunter.attack.arcDeg * DEG * 0.5;
      this.fx.arc(0, 0, BALANCE.hunter.attack.range, p.facing - arc, p.facing + arc).stroke({ width: 3, color: 0xd0d0c8, alpha: 0.5 });
    }
    if (p.state & EF.Stunned) {
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        this.fx.circle(Math.cos(a) * 14, -24 + Math.sin(a) * 5, 2.5).fill({ color: 0xf0e0a0 });
      }
    }
    if (p.state & EF.Blinded) this.fx.circle(0, 0, 26).fill({ color: 0xffffff, alpha: 0.25 + 0.1 * Math.sin(time * 20) });
  }
}

/**
 * Dynamic things drawn on the entity layer, which the entity-occlusion filter hides outside
 * the vision mask: players, flares, thrown bottles, loot, generator progress, hiding markers.
 */
export class EntityLayer {
  readonly root = new Container();
  private readonly players = new Map<number, PlayerSprite>();
  private readonly flares = new Map<number, Container>();
  private readonly bottles = new Map<number, Sprite>();
  private readonly loot: Sprite[] = [];
  private readonly markers = new Graphics();
  private readonly gens = new Graphics();

  constructor(
    private readonly assets: AssetManager,
    private readonly map: MapData,
    private readonly roster: Map<number, MatchPlayerInfo>,
    private readonly viewerIsHunter: boolean,
  ) {
    for (const l of map.loot) {
      const s = new Sprite(assets.getTexture(`loot.${l.item}`));
      s.anchor.set(0.5);
      s.position.set(l.x, l.y);
      this.loot.push(s);
      this.root.addChild(s);
    }
    this.root.addChild(this.gens, this.markers);
  }

  update(ents: InterpEntity[], self: RenderPlayer | null, world: WorldState | null, time: number): void {
    const seen = new Set<number>();
    const stakeOf = new Map<number, { x: number; y: number }>();
    if (world) world.stakes.forEach((occ, i) => occ && stakeOf.set(occ, this.map.stakes[i]));

    const draw = (p: RenderPlayer): void => {
      const info = this.roster.get(p.id);
      if (!info) return;
      let s = this.players.get(p.id);
      if (!s) {
        const label = info.role === 'survivor' && !this.viewerIsHunter;
        s = new PlayerSprite(this.assets, info, label && p.id !== self?.id);
        this.players.set(p.id, s);
        this.root.addChild(s.root);
      }
      s.root.visible = true;
      s.set(p, time, stakeOf.get(p.id) ?? null);
      seen.add(p.id);
    };

    for (const e of ents) {
      if (e.kind === EntityKind.Player) {
        if (self && e.id === self.id) continue;
        draw(e);
      } else if (e.kind === EntityKind.Flare) {
        let f = this.flares.get(e.id);
        if (!f) {
          f = new Container();
          const glow = new Sprite(this.assets.getTexture('fx.glow'));
          glow.anchor.set(0.5);
          glow.tint = 0xff4a2a;
          glow.blendMode = 'add';
          glow.scale.set(3.2);
          const stick = new Sprite(this.assets.getTexture('loot.flare'));
          stick.anchor.set(0.5);
          f.addChild(glow, stick);
          this.flares.set(e.id, f);
          this.root.addChild(f);
        }
        f.position.set(e.x, e.y);
        f.children[0].alpha = 0.55 + 0.25 * Math.sin(time * 23 + e.id) * Math.sin(time * 7);
        seen.add(e.id);
      } else if (e.kind === EntityKind.Bottle) {
        let b = this.bottles.get(e.id);
        if (!b) {
          b = new Sprite(this.assets.getTexture('loot.bottle'));
          b.anchor.set(0.5);
          this.bottles.set(e.id, b);
          this.root.addChild(b);
        }
        const lift = (e.extra / 255) * 40;
        b.position.set(e.x, e.y - lift);
        b.rotation = time * 12;
        b.scale.set(1 + lift / 80);
        seen.add(e.id);
      }
    }
    if (self) draw(self);

    for (const [id, s] of this.players) {
      if (!seen.has(id)) s.root.visible = false;
    }
    for (const [id, f] of this.flares) {
      if (!seen.has(id)) {
        f.destroy({ children: true });
        this.flares.delete(id);
      }
    }
    for (const [id, b] of this.bottles) {
      if (!seen.has(id)) {
        b.destroy();
        this.bottles.delete(id);
      }
    }

    if (!world) return;
    this.loot.forEach((s, i) => {
      s.visible = !world.lootTaken[i];
      if (s.visible) s.rotation = Math.sin(time * 1.5 + i) * 0.12;
    });
    this.gens.clear();
    world.gens.forEach((g, i) => {
      if (g.flags & GenFlag.Repaired || !(g.flags & GenFlag.Known) || g.progress <= 0.001) return;
      const d = this.map.generators[i];
      this.gens.arc(d.x, d.y - 44, 10, -Math.PI / 2, -Math.PI / 2 + g.progress * Math.PI * 2).stroke({ width: 3, color: g.flags & GenFlag.Regressing ? 0xd23a2e : 0xd9a441 });
    });
    this.markers.clear();
    if (!this.viewerIsHunter) {
      world.hidingOccupied.forEach((occ, i) => {
        if (!occ) return;
        const h = this.map.hidingSpots[i];
        this.markers.circle(h.x, h.y - 26, 4).fill({ color: 0x9fc08c, alpha: 0.8 });
      });
    }
  }
}
