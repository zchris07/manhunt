import { Health, generateMap, hashString, mapParamsFor, resolveBalance, type InputCmd, type MatchPlayerInfo } from '@manhunt/shared';
import { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

export function makeWorld(opts: { hunters?: number; survivors?: number; seed?: string; lagMs?: number; testMode?: boolean } = {}): World {
  const H = opts.hunters ?? 1;
  const S = opts.survivors ?? 2;
  const rb = resolveBalance({ hunters: H, survivors: S, difficulty: 1 });
  const map = generateMap(mapParamsFor(hashString(opts.seed ?? 'rules'), rb));
  const players: MatchPlayerInfo[] = [];
  for (let i = 0; i < H; i++) players.push({ id: i + 1, name: `Zach${i + 1}`, role: 'hunter', tint: 0 });
  for (let i = 0; i < S; i++) players.push({ id: H + i + 1, name: `Surv${i + 1}`, role: 'survivor', tint: i });
  return new World({ map, balance: rb, players, seed: 7, viewLagMs: () => opts.lagMs ?? 0, testMode: opts.testMode });
}

/** Feeds one input per tick per player, like a client would. */
export class Driver {
  private seq = new Map<number, number>();
  constructor(readonly w: World) {}

  input(id: number, cmd: Partial<Omit<InputCmd, 'seq'>>): void {
    const s = (this.seq.get(id) ?? 0) + 1;
    this.seq.set(id, s);
    this.w.enqueueInputs(id, [{ seq: s, buttons: 0, moveX: 0, moveY: 0, aim: 0, aimDist: 100, item: 0, ...cmd }]);
  }

  /** Runs n ticks, giving every player the input `each(id)` returns (idle by default). */
  run(n: number, each?: (p: SimPlayer, tick: number) => Partial<Omit<InputCmd, 'seq'>> | undefined): void {
    for (let t = 0; t < n; t++) {
      for (const p of this.w.order) this.input(p.id, each?.(p, t) ?? {});
      this.w.step();
    }
  }

  /** Presses buttons for one tick (then releases). */
  tap(id: number, buttons: number, extra: Partial<Omit<InputCmd, 'seq'>> = {}): void {
    this.run(1, (p) => (p.id === id ? { buttons, ...extra } : undefined));
    this.run(1);
  }

  /** Holds buttons for `sec` seconds. */
  hold(id: number, buttons: number, sec: number, extra: Partial<Omit<InputCmd, 'seq'>> = {}): void {
    this.run(Math.ceil(sec * 30), (p) => (p.id === id ? { buttons, ...extra } : undefined));
  }
}

export function place(p: SimPlayer, x: number, y: number): void {
  p.move.x = x;
  p.move.y = y;
  for (let i = 0; i < p.history.length; i += 2) {
    p.history[i] = x;
    p.history[i + 1] = y;
  }
}

/** A spot in the open woods (a clearing centre) where nothing blocks movement or sight. */
export function openSpot(w: World, index = 1): { x: number; y: number } {
  const c = w.map.clearings[index % w.map.clearings.length];
  return { x: c.x, y: c.y };
}

export const alive = (p: SimPlayer): boolean => p.health === Health.Healthy || p.health === Health.Wounded;

/** Keeps Sexton Science out of the way (far corner) so he doesn't wander into a test. */
export function parkSexton(w: World): void {
  w.sexton.x = 60;
  w.sexton.y = w.map.height - 60;
}

/** A spot with a clear, straight east-west lane of `half` units either side (no trees or walls). */
export function clearLane(w: World, half = 450): { x: number; y: number } {
  for (const c of w.map.clearings) {
    for (let oy = -120; oy <= 120; oy += 40) {
      const x = c.x;
      const y = c.y + oy;
      if (x - half < 50 || x + half > w.map.width - 50) continue;
      let ok = true;
      for (const dy of [-28, 0, 28]) if (!w.geo.hasLineOfSight(x - half, y + dy, x + half, y + dy)) ok = false;
      if (ok) return { x, y };
    }
  }
  throw new Error('no clear lane on this map');
}

/** Keeps Shane Jeans out of the way (far corner) so he doesn't tail anyone in a test. */
export function parkShane(w: World): void {
  w.shane.x = w.map.width - 60;
  w.shane.y = 60;
}
