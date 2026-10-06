import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, DEG, DIZZY_BIT, EntityKind, Health, ItemKind } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, parkChris, parkSexton, parkShane, place } from './worldHelpers';
import { buildView, visionFor } from '../src/sim/view';
import { vapeCoverage, vapeExtent } from '../src/sim/vape';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const V = BALANCE.hunter.vape;

/** Zach at the lane's centre facing +x, two survivors parked far away, NPCs out of the way. */
function lane(): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; m: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  for (const n of [w.marc, w.plasma, w.jaden, w.waz]) {
    n.x = 60;
    n.y = w.map.height - 60;
  }
  const c = clearLane(w, 450);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  const m = w.players.get(3)!;
  place(h, c.x - 300, c.y);
  place(s, 5800, 5800);
  place(m, 5800, 200);
  h.viewReach = 700;
  return { w, d: new Driver(w), h, s, m, c };
}

const vape = (d: Driver, h: SimPlayer, aim = 0): void => d.tap(h.id, Btn.Vape, { aim });

describe('Penjamin', () => {
  it('reaches 1.1x the distance to the corner of his screen, growing out over 0.6 s, with two charges and a 25 s cooldown', () => {
    const { w, d, h } = lane();
    vape(d, h);
    expect(w.vapes.length).toBe(1);
    const v = w.vapes[0];
    expect(v.range).toBeCloseTo(700 * V.reachMul, 5);
    expect(vapeExtent(v, v.t0 + 0.3)).toBeLessThan(v.range);
    expect(vapeExtent(v, v.t0 + 0.3)).toBeGreaterThan(v.range * 0.5);
    expect(vapeExtent(v, v.t0 + V.growTime)).toBeCloseTo(v.range, 5);
    expect(h.vapeCd).toBeGreaterThan(V.cooldown - 0.2);
    expect(h.vapeCharges).toBe(1);
    vape(d, h);
    expect(w.vapes.length).toBe(2);
    expect(h.vapeCharges).toBe(0);
    vape(d, h);
    expect(w.vapes.length).toBe(2);
    d.run(secs(V.cooldown + 0.5));
    expect(h.vapeCharges).toBe(1);
    expect(w.events.some((e) => e.e.k === 'vape' && e.to.includes(h.id))).toBe(true);
  });

  it('close up: slowed 20%, losing 5% of health a second, dizzy, and the light narrows by 60%', () => {
    const { w, d, h, s } = lane();
    place(s, h.move.x + 60, h.move.y);
    const cone = visionFor(w, s).cone.halfAngle;
    vape(d, h);
    d.run(secs(1));
    expect(s.vapeT).toBeGreaterThan(0);
    expect(s.vapeSlow).toBeGreaterThan(0.18);
    expect(s.vapeDps).toBeGreaterThan(0.045);
    expect(s.move.slowMul).toBeCloseTo(1 - s.vapeSlow, 5);
    expect(1 - s.hp).toBeGreaterThan(0.04);
    expect(1 - s.hp).toBeLessThan(0.07);
    expect(buildView(w, h).entities.find((e) => e.id === s.id)!.aux & DIZZY_BIT).toBe(DIZZY_BIT);
    expect(visionFor(w, s).cone.halfAngle).toBeCloseTo(cone * (1 - V.coneCut), 5);
  });

  it('at the far end it is only 1%; it lasts 2 s after you leave the gas, the darkness 6 s', () => {
    const { d, h, s } = lane();
    h.viewReach = 1000;
    place(s, h.move.x + 1100 * 0.98, h.move.y);
    vape(d, h);
    d.run(secs(1));
    expect(s.vapeSlow).toBeCloseTo(V.slowFar, 1);
    expect(s.vapeDps).toBeLessThan(0.015);
    // Walk out of it (well off to the side).
    place(s, h.move.x + 400, h.move.y + 600);
    d.run(secs(V.afterTime - 0.3));
    expect(s.vapeT).toBeGreaterThan(0);
    d.run(secs(0.5));
    expect(s.vapeT).toBe(0);
    expect(s.darkT).toBeGreaterThan(V.darkAfter - V.afterTime - 0.5);
    d.run(secs(V.darkAfter - V.afterTime + 0.2));
    expect(s.darkT).toBe(0);
  });

  it('only counts you when at least half your body is in the gas', () => {
    const { w, d, h } = lane();
    vape(d, h);
    d.run(secs(1));
    const v = w.vapes[0];
    const ext = vapeExtent(v, w.time);
    const dist = 400;
    const edge = Math.tan(V.halfAngleDeg * DEG) * dist;
    const r = BALANCE.survivor.radius;
    expect(vapeCoverage(v, ext, h.move.x + dist, h.move.y, r)).toBe(1);
    expect(vapeCoverage(v, ext, h.move.x + dist, h.move.y + edge, r)).toBeGreaterThanOrEqual(0.4);
    expect(vapeCoverage(v, ext, h.move.x + dist, h.move.y + edge + r * 0.6, r)).toBeLessThan(V.coverage);
  });

  it("sets off NPCs who react to attacks without hurting them; Plasma rages and Jaden turns on Zach", () => {
    const { w, d, h } = lane();
    w.plasma.x = h.move.x + 150;
    w.plasma.y = h.move.y;
    w.jaden.x = h.move.x + 250;
    w.jaden.y = h.move.y;
    vape(d, h);
    d.run(secs(0.7));
    expect(w.plasma.raging).toBe(true);
    expect(w.plasma.zachHits + w.plasma.survivorHits).toBe(0);
    expect(w.jaden.chasing).toBe(true);
    expect(w.jaden.target).toBe(h.id);
    expect(w.jaden.alive).toBe(true);
  });
});

describe('Jaden, provoked by anyone', () => {
  it("Zach's machete sets him on Zach, and he shoots him", () => {
    const { w, d, h } = lane();
    w.jaden.x = h.move.x + 80;
    w.jaden.y = h.move.y;
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(secs(0.5), (p) => (p === h ? { aim: 0 } : undefined));
    expect(w.jaden.chasing).toBe(true);
    expect(w.jaden.target).toBe(h.id);
    place(h, w.jaden.x - 200, w.jaden.y);
    const before = h.hp;
    d.run(secs(3));
    expect(h.hp).toBeLessThan(before);
  });

  it("a survivor's item stuns him and sets him on that survivor", () => {
    const { w, s, c } = lane();
    place(s, c.x, c.y);
    w.jaden.x = c.x + 200;
    w.jaden.y = c.y;
    w.jaden.itemHit(s, 'bottle');
    expect(w.jaden.stunT).toBeGreaterThan(1);
    expect(w.jaden.target).toBe(s.id);
  });
});

describe('Plasma.TTV can be slain in beast form', () => {
  function rage(w: World, by: SimPlayer): void {
    w.plasma.x = 4000;
    w.plasma.y = 4000;
    if (!w.plasma.beast) w.plasma.itemHit(by, 'bottle');
    for (let i = 0; i < secs(BALANCE.plasma.transformTime + 1) && w.plasma.mode !== 'rage'; i++) w.step();
    expect(w.plasma.mode).toBe('rage');
  }

  it('six survivor item hits (only in beast form) and he drops a golden pump', () => {
    const { w, s } = lane();
    w.plasma.itemHit(s, 'bottle');
    expect(w.plasma.survivorHits).toBe(0);
    // Still changing: no damage yet.
    w.plasma.itemHit(s, 'bottle');
    expect(w.plasma.survivorHits).toBe(0);
    rage(w, s);
    for (let i = 0; i < 5; i++) w.plasma.itemHit(s, 'bottle');
    expect(w.plasma.alive).toBe(true);
    expect(w.plasma.survivorHits).toBe(5);
    w.plasma.itemHit(s, 'shot');
    expect(w.plasma.alive).toBe(false);
    expect(w.plasma.solid).toBe(false);
    const pump = w.drops.find((dr) => dr.kind === ItemKind.Shotgun);
    expect(pump?.golden).toBe(true);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Plasma)).toBe(true);
  });

  it("Zach: 6 light swings or 3 heavy; Zach's and survivors' hits are counted apart, and they stay", () => {
    const { w, h, s } = lane();
    rage(w, s);
    w.plasma.itemHit(s, 'bottle');
    w.plasma.slashHit(h, 2);
    w.plasma.slashHit(h, 2);
    expect(w.plasma.zachHits).toBe(4);
    expect(w.plasma.survivorHits).toBe(1);
    // He calms down: the damage stays.
    w.plasma['calmDown']();
    for (let i = 0; i < 40; i++) w.step();
    expect(w.plasma.beast).toBe(false);
    expect(w.plasma.zachHits).toBe(4);
    rage(w, s);
    w.plasma.slashHit(h, 2);
    expect(w.plasma.alive).toBe(false);
    expect(s.health).toBe(Health.Healthy);
  });
});
