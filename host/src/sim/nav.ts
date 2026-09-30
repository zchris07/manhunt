import { NavGrid } from '@manhunt/shared';
import type { World } from './World';

/** Walkable grid for NPCs that open doors on the way: every door counts as passable. */
export function doorlessNav(w: World, radius: number): NavGrid {
  const key = Math.round(radius);
  const cached = navCache.get(w)?.get(key);
  if (cached) return cached;
  const geo = w.geo;
  const doors = w.map.doors;
  const was = doors.map((d) => geo.isDynamicActive(d.dyn));
  for (const d of doors) geo.setDynamicActive(d.dyn, false);
  const nav = new NavGrid(geo, 25, radius);
  doors.forEach((d, i) => geo.setDynamicActive(d.dyn, was[i]));
  let m = navCache.get(w);
  if (!m) {
    m = new Map();
    navCache.set(w, m);
  }
  m.set(key, nav);
  return nav;
}

const navCache = new WeakMap<World, Map<number, NavGrid>>();

/**
 * Chases a moving point: along a walkable path (refreshed every second), straight at it only
 * for the last stretch when nothing is in the way.
 */
export class Chaser {
  private path: number[] = [];
  private pathT = 0;

  constructor(
    private readonly w: World,
    private readonly radius: number,
  ) {}

  reset(): void {
    this.path = [];
    this.pathT = 0;
  }

  heading(x: number, y: number, tx: number, ty: number, dt: number, stuck: boolean): number {
    const w = this.w;
    if (Math.hypot(tx - x, ty - y) < 110 && w.geo.hasLineOfSight(x, y, tx, ty) && !stuck) {
      this.path = [];
      return Math.atan2(ty - y, tx - x);
    }
    this.pathT -= dt;
    if (this.pathT <= 0 || this.path.length < 2) {
      this.pathT = 1;
      this.path = doorlessNav(w, this.radius).findPath(x, y, tx, ty, 40000) ?? [tx, ty];
    }
    while (this.path.length > 2 && Math.hypot(this.path[0] - x, this.path[1] - y) < 20) this.path.splice(0, 2);
    return Math.atan2(this.path[1] - y, this.path[0] - x);
  }
}
