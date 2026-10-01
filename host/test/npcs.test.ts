import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, ItemKind, overlapsCollider } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, parkSexton, parkShane, place } from './worldHelpers';
import { buildView, canSee } from '../src/sim/view';
import type { World } from '../src/sim/World';

const secs = (s: number): number => Math.ceil(s * 30);
const S = BALANCE.shane;

/** Zach far away, Shane in a clear lane, one survivor near him. */
function shaneWorld(): { w: World; d: Driver; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
  const c = clearLane(w, 450);
  place(w.players.get(1)!, 60, 60);
  place(w.players.get(3)!, 5800, 5800);
  w.shane.x = c.x;
  w.shane.y = c.y;
  w.shane.mode = 'idle';
  return { w, d: new Driver(w), c };
}

describe('Shane Jeans', () => {
  it('there is exactly one, and he is sent to everyone nearby', () => {
    const { w, c } = shaneWorld();
    const s = w.players.get(2)!;
    place(s, c.x - 400, c.y);
    const ents = buildView(w, s).entities.filter((e) => e.kind === EntityKind.Shane);
    expect(ents.length).toBe(1);
  });

  it('coming too close alerts him; the whole server hears; he chases at Sexton flee speed', () => {
    const { w, d, c } = shaneWorld();
    const s = w.players.get(2)!;
    place(s, c.x - S.alertRadius + 10, c.y);
    d.run(1);
    expect(w.shane.chasing).toBe(true);
    expect(w.shane.target).toBe(s.id);
    expect(w.events.some((e) => e.e.k === 'shane' && e.e.alerted)).toBe(true);
    expect(w.events.some((e) => e.e.k === 'feed' && e.e.text === 'Shane Jeans has been alerted')).toBe(true);
    expect(S.chase).toBe(BALANCE.sexton.flee);
    // He follows as the survivor walks off, and sticks close.
    d.run(secs(2), (p) => (p === s ? { moveX: -1 } : undefined));
    expect(Math.hypot(w.shane.x - s.move.x, w.shane.y - s.move.y)).toBeLessThan(80);
  });

  it('a flashlight on him builds alert over 2 s, even on and off, and it slowly decays', () => {
    const { w, d, c } = shaneWorld();
    const s = w.players.get(2)!;
    place(s, c.x - 350, c.y);
    const on = { aim: 0 };
    const off = { aim: Math.PI };
    d.run(secs(1.2), (p) => (p === s ? on : undefined));
    expect(w.shane.chasing).toBe(false);
    d.run(secs(0.5), (p) => (p === s ? off : undefined));
    const kept = w.shane.meter.get(s.id)!;
    expect(kept).toBeGreaterThan(0.9);
    expect(kept).toBeLessThan(1.2);
    d.run(secs(1), (p) => (p === s ? on : undefined));
    expect(w.shane.chasing).toBe(true);
  });

  it('Zach never alerts him, and a chase ends when Zach comes close', () => {
    const { w, d, c } = shaneWorld();
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    place(s, 5700, 5800);
    place(h, c.x - 40, c.y);
    d.run(secs(3), () => ({ aim: 0 }));
    expect(w.shane.chasing).toBe(false);
    place(h, 60, 60);
    place(s, w.shane.x - 40, w.shane.y);
    d.run(1);
    expect(w.shane.chasing).toBe(true);
    // Zach sees only a direction to him, never a position; survivors don't get it.
    expect(buildView(w, h).world.shaneDir).not.toBeNull();
    expect(buildView(w, s).world.shaneDir).toBeNull();
    expect(buildView(w, h).entities.some((e) => e.kind === EntityKind.Shane)).toBe(false);
    place(h, w.shane.x + S.hunterBreakRadius - 20, w.shane.y);
    d.run(1);
    expect(w.shane.chasing).toBe(false);
    expect(w.events.some((e) => e.e.k === 'shane' && !e.e.alerted)).toBe(true);
    // Cooldown: can't be alerted again for 10 s.
    place(h, 60, 60);
    d.run(secs(2));
    expect(w.shane.chasing).toBe(false);
  });

  it('gives up after 20 s, or when the survivor gets too far', () => {
    const { w, d, c } = shaneWorld();
    const s = w.players.get(2)!;
    place(s, c.x - 40, c.y);
    d.run(1);
    expect(w.shane.chasing).toBe(true);
    d.run(secs(S.chaseTime) + 2);
    expect(w.shane.chasing).toBe(false);
    const b = shaneWorld();
    const s2 = b.w.players.get(2)!;
    place(s2, b.c.x - 40, b.c.y);
    b.d.run(1);
    place(s2, b.c.x - S.loseRadius - 200, b.c.y);
    b.d.run(1);
    expect(b.w.shane.chasing).toBe(false);
  });

  it('two bottles or one shotgun blast shake him off, and he runs for 4 s', () => {
    const { w, d, c } = shaneWorld();
    const s = w.players.get(2)!;
    place(s, c.x - 60, c.y);
    d.run(1);
    expect(w.shane.chasing).toBe(true);
    place(s, c.x - 200, c.y);
    w.shane.x = c.x;
    w.shane.y = c.y;
    s.inv[ItemKind.Bottle] = 2;
    s.selItem = ItemKind.Bottle;
    const throwAt = (): void => {
      d.tap(s.id, Btn.Primary, { item: ItemKind.Bottle, aim: Math.atan2(w.shane.y - s.move.y, w.shane.x - s.move.x), aimDist: Math.hypot(w.shane.x - s.move.x, w.shane.y - s.move.y) });
      d.run(10);
    };
    throwAt();
    expect(w.shane.chasing).toBe(true);
    throwAt();
    expect(w.shane.chasing).toBe(false);
    expect(w.shane.mode).toBe('flee');
    d.run(secs(S.fleeTime) + 2);
    expect(w.shane.mode).not.toBe('flee');

    const b = shaneWorld();
    const s2 = b.w.players.get(2)!;
    place(s2, b.c.x - 60, b.c.y);
    b.d.run(1);
    place(s2, b.c.x - 200, b.c.y);
    b.w.shane.x = b.c.x;
    b.w.shane.y = b.c.y;
    s2.inv[ItemKind.Shotgun] = 1;
    s2.shells = [3];
    b.d.tap(s2.id, Btn.Primary, { item: ItemKind.Shotgun, aim: 0 });
    expect(b.w.shane.mode).toBe('flee');
  });
});

describe('JARVIS, Sexton, windows, the machete', () => {
  it('JARVIS shows everything on screen to survivors for 10 s, never to Zach', () => {
    const w = makeWorld({ survivors: 2 });
    parkSexton(w);
    parkShane(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const mate = w.players.get(3)!;
    const c = clearLane(w, 450);
    place(s, c.x, c.y);
    place(h, c.x + 300, c.y);
    place(mate, c.x + 150, c.y);
    h.facing = 0;
    s.facing = Math.PI;
    mate.facing = Math.PI / 2;
    expect(canSee(w, h, s.move.x, s.move.y)).toBe(false);
    expect(canSee(w, mate, mate.move.x - 350, mate.move.y)).toBe(false);
    s.jarvis = 1;
    d.tap(s.id, Btn.Ability);
    expect(canSee(w, mate, mate.move.x - 350, mate.move.y)).toBe(true);
    expect(buildView(w, mate).world.reveal).toBe(true);
    expect(canSee(w, h, s.move.x, s.move.y)).toBe(false);
    expect(buildView(w, h).world.reveal).toBe(false);
    d.run(secs(BALANCE.sexton.jarvisRadarSec) + 2);
    expect(buildView(w, mate).world.reveal).toBe(false);
    mate.facing = Math.PI / 2;
    expect(canSee(w, mate, mate.move.x - 350, mate.move.y)).toBe(false);
  });

  it('Sexton never comes back once slain, even in testing mode', () => {
    const w = makeWorld({ testMode: true });
    const d = new Driver(w);
    w.sexton.alive = false;
    d.run(secs(15));
    expect(w.sexton.alive).toBe(false);
  });

  it('one swipe smashes a window; then Zach and survivors climb through slowly', () => {
    const w = makeWorld();
    parkSexton(w);
    parkShane(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    // A window with open ground on both sides.
    const wins = w.map.walls.filter((x) => x.kind === 'window');
    let i = -1;
    let n = { x: 0, y: 0 };
    let m = { x: 0, y: 0 };
    for (let k = 0; k < wins.length && i < 0; k++) {
      const wl = wins[k];
      const len = Math.hypot(wl.bx - wl.ax, wl.by - wl.ay);
      const nx = -(wl.by - wl.ay) / len;
      const ny = (wl.bx - wl.ax) / len;
      const mx = (wl.ax + wl.bx) / 2;
      const my = (wl.ay + wl.by) / 2;
      const free = (x: number, y: number): boolean => !overlapsCollider(w.geo, x, y, 25);
      if (free(mx + nx * 60, my + ny * 60) && free(mx - nx * 60, my - ny * 60)) {
        i = k;
        n = { x: nx, y: ny };
        m = { x: mx, y: my };
      }
    }
    expect(i).toBeGreaterThanOrEqual(0);
    for (const q of w.order) place(q, 60, 60 + q.id * 60);
    place(s, m.x + n.x * 40, m.y + n.y * 40);
    d.run(20, (p) => (p === s ? { moveX: -n.x, moveY: -n.y } : undefined));
    expect((s.move.x - m.x) * n.x + (s.move.y - m.y) * n.y).toBeGreaterThan(0);
    place(s, 5800, 5800);
    place(h, m.x + n.x * 45, m.y + n.y * 45);
    const aim = Math.atan2(-n.y, -n.x);
    d.run(30, (p) => (p === h ? { moveX: -n.x, moveY: -n.y, aim } : undefined));
    expect((h.move.x - m.x) * n.x + (h.move.y - m.y) * n.y).toBeGreaterThan(0);
    d.tap(h.id, Btn.Primary, { aim });
    d.run(10, (p) => (p === h ? { aim } : undefined));
    expect(w.windowsBroken[i]).toBe(true);
    expect(buildView(w, h).world.windowsBroken[i]).toBe(true);
    // Climbing: slow while in the frame, then through to the other side.
    let slowest = Infinity;
    for (let t = 0; t < secs(4); t++) {
      const x0 = h.move.x;
      const y0 = h.move.y;
      d.run(1, (p) => (p === h ? { moveX: -n.x, moveY: -n.y, aim } : undefined));
      if (w.geo.inBrokenWindow(h.move.x, h.move.y, h.radius)) slowest = Math.min(slowest, Math.hypot(h.move.x - x0, h.move.y - y0) * 30);
    }
    expect((h.move.x - m.x) * n.x + (h.move.y - m.y) * n.y).toBeLessThan(0);
    expect(slowest).toBeLessThan(BALANCE.hunter.walk * 0.5);
    // Survivors vault through a smashed window too (slowly).
    place(h, 60, 60);
    place(s, m.x + n.x * 40, m.y + n.y * 40);
    d.run(secs(4), (p) => (p === s ? { moveX: -n.x, moveY: -n.y } : undefined));
    expect((s.move.x - m.x) * n.x + (s.move.y - m.y) * n.y).toBeLessThan(0);
  });

  it('holding the charge for 3 s swings by itself', () => {
    const w = makeWorld();
    parkSexton(w);
    parkShane(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    for (const q of w.order) if (q !== h) place(q, 5800, 5800 - q.id * 40);
    d.run(1, (p) => (p === h ? { buttons: Btn.Primary } : undefined));
    d.run(secs(BALANCE.hunter.attack.charge.autoRelease - 0.3), (p) => (p === h ? { buttons: Btn.Primary } : undefined));
    expect(h.chargeT).toBeGreaterThanOrEqual(0);
    expect(w.events.some((e) => e.e.k === 'swing')).toBe(false);
    d.run(secs(0.6), (p) => (p === h ? { buttons: Btn.Primary } : undefined));
    expect(h.chargeT).toBe(-1);
    expect(w.events.some((e) => e.e.k === 'swing')).toBe(true);
    // Still holding: no new charge until the button is let go.
    d.run(secs(1), (p) => (p === h ? { buttons: Btn.Primary } : undefined));
    expect(h.chargeT).toBe(-1);
  });
});
