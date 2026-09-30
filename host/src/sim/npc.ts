import type { SimPlayer } from './player';

export type ItemHit = 'bottle' | 'shot';

/** An NPC that thrown bottles and shotgun pellets can hit. */
export interface NpcTarget {
  readonly x: number;
  readonly y: number;
  readonly hitRadius: number;
  /** On the map and in the way (the dead and the departed let things pass). */
  readonly solid: boolean;
  itemHit(by: SimPlayer, kind: ItemHit): void;
}
