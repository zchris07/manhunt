import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, Health, ItemKind } from '@manhunt/shared';
import { clearLane, Driver, makeWorld, parkChris, parkSexton, parkShane, place, setCount } from './worldHelpers';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const A = BALANCE.hunter.attack;

function lane(): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  const c = clearLane(w, 450);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  place(w.players.get(3)!, 5800, 200);
  place(h, c.x - 300, c.y);
  place(s, 5800, 400);
  h.facing = 0;
  return { w, d: new Driver(w), h, s, c };
}

describe('machete timing', () => {
  it('a whiff recovers in 0.2 s; a landed hit locks the machete for 0.8 s', () => {
    const { d, h, s } = lane();
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(secs(A.windup));
    expect(A.missCooldown).toBe(0.2);
    expect(h.attackCd).toBeGreaterThan(0);
    expect(h.attackCd).toBeLessThanOrEqual(0.2);
    d.run(secs(0.2));
    expect(h.attackCd).toBe(0);

    place(s, h.move.x + 60, h.move.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(5, (p) => (p === h ? { aim: 0 } : undefined));
    expect(s.hp).toBeCloseTo(2 / 3, 3);
    expect(A.hitCooldown).toBe(0.8);
    expect(h.attackCd).toBeGreaterThan(0.5);
    // Too soon: nothing happens.
    place(s, h.move.x + 60, h.move.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(5, (p) => (p === h ? { aim: 0 } : undefined));
    expect(s.hp).toBeCloseTo(2 / 3, 3);
    d.run(secs(0.8));
    place(s, h.move.x + 60, h.move.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(6, (p) => (p === h ? { aim: 0 } : undefined));
    expect(s.hp).toBeCloseTo(1 / 3, 3);
  });
});

describe('slash + lunge combo', () => {
  it('clicking mid-lunge starts a swipe', () => {
    const { d, h } = lane();
    d.tap(h.id, Btn.Lunge, { aim: 0 });
    expect(h.move.lungeT).toBeGreaterThan(0);
    d.run(1, (p) => (p === h ? { buttons: Btn.Primary, aim: 0 } : undefined));
    expect(h.move.lungeT).toBeGreaterThan(0);
    expect(h.chargeT).toBeGreaterThanOrEqual(0);
  });

  it('charge fully, lunge in, release: the lunge (a third) and the heavy swipe (two thirds) both land', () => {
    const { d, h, s } = lane();
    place(s, h.move.x + 200, h.move.y);
    // Charge fully, lunge while holding, keep holding a moment, release.
    d.hold(h.id, Btn.Primary, A.charge.max, { aim: 0 });
    d.run(1, (p) => (p === h ? { buttons: Btn.Primary | Btn.Lunge, aim: 0 } : undefined));
    d.hold(h.id, Btn.Primary, 0.25, { aim: 0 });
    expect(s.health).toBe(Health.Wounded);
    expect(s.hp).toBeCloseTo(2 / 3, 3);
    expect(h.chargeT).toBeGreaterThanOrEqual(0);
    d.run(secs(0.4), (p) => (p === h ? { aim: 0 } : undefined));
    expect(s.health).toBe(Health.Downed);
  });
});

describe('bottles', () => {
  it('fly on until they hit something: a short aim still reaches Zach far down the lane', () => {
    const { w, d, h, s, c } = lane();
    place(s, c.x - 420, c.y);
    place(h, c.x + 420, c.y);
    setCount(s, ItemKind.Bottle, 1);
    d.tap(s.id, Btn.Primary, { aim: 0, aimDist: 80, item: ItemKind.Bottle });
    expect(w.bottles.length).toBe(1);
    d.run(secs(1.6), (p) => (p === s ? { aim: 0, item: ItemKind.Bottle } : undefined));
    expect(h.stunT > 0 || h.immuneT > 0).toBe(true);
    expect(w.bottles.length).toBe(0);
  });

  it('shatter on the first wall or tree in their way', () => {
    const { w, d, s, c } = lane();
    place(s, c.x, c.y);
    setCount(s, ItemKind.Bottle, 1);
    // Straight up or down from the lane there's always something eventually (the map edge at worst).
    d.tap(s.id, Btn.Primary, { aim: -Math.PI / 2, aimDist: 80, item: ItemKind.Bottle });
    const b = w.bottles[0];
    const maxT = Math.ceil(Math.hypot(w.map.width, w.map.height) / BALANCE.items.bottle.speed) + 1;
    for (let t = 0; t < secs(maxT) && w.bottles.length; t++) d.run(1);
    expect(w.bottles.length).toBe(0);
    const wall = w.geo.raycastVision(c.x, c.y - s.radius - 4, -Math.PI / 2, 9000);
    expect(b.travelled).toBeGreaterThan(Math.min(460, wall - 40));
    expect(Math.abs(b.travelled - wall)).toBeLessThan(40);
  });
});
