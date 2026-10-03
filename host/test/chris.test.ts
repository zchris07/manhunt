import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, ChrisFlag, EntityKind, Health, Prompt, overlapsCollider } from '@manhunt/shared';
import { Driver, makeWorld, parkSexton, parkShane, place } from './worldHelpers';
import { buildView } from '../src/sim/view';
import { stakeSurvivor } from '../src/sim/combat';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const C = BALANCE.chris;

function chrisWorld(): { w: World; d: Driver; h: SimPlayer; a: SimPlayer; b: SimPlayer } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
  parkShane(w);
  const h = w.players.get(1)!;
  const a = w.players.get(2)!;
  const b = w.players.get(3)!;
  place(h, 60, 60);
  place(a, 5900, 3000);
  place(b, 5900, 3200);
  return { w, d: new Driver(w), h, a, b };
}

/** Puts survivor `p` right beside Chris, on the side away from the ambulance. */
function besideChris(w: World, p: SimPlayer): void {
  const amb = w.map.ambulance;
  const dx = w.chris.x - amb.x;
  const dy = w.chris.y - amb.y;
  const l = Math.hypot(dx, dy) || 1;
  place(p, w.chris.x + (dx / l) * 40, w.chris.y + (dy / l) * 40);
}

function activate(w: World, d: Driver, p: SimPlayer): void {
  besideChris(w, p);
  d.run(1);
  expect(p.prompt).toBe(Prompt.TalkChris);
  d.tap(p.id, Btn.Interact);
  expect(w.chris.active).toBe(true);
}

/** Open ground far from the ambulance (a clearing centre). */
function farClearing(w: World): { x: number; y: number } {
  const amb = w.map.ambulance;
  const cs = w.map.clearings.slice(1).filter((c) => !overlapsCollider(w.geo, c.x, c.y, 20));
  cs.sort((p, q) => Math.hypot(q.x - amb.x, q.y - amb.y) - Math.hypot(p.x - amb.x, p.y - amb.y));
  return cs[Math.floor(cs.length / 2)];
}

describe('Chris Zelley and the ambulance', () => {
  it('the ambulance is a 300 x 150 solid structure on every map', () => {
    for (const seed of ['rules', 'a', 'b', 'c']) {
      const w = makeWorld({ seed });
      const amb = w.map.ambulance;
      expect(amb.length).toBe(300);
      expect(amb.width).toBe(150);
      expect(w.map.walls.filter((s) => s.kind === 'ambulance').length).toBe(4);
      expect(overlapsCollider(w.geo, amb.x, amb.y, amb.width / 2 + 5)).toBe(true);
      expect(overlapsCollider(w.geo, amb.x, amb.y, amb.width / 2 - 5)).toBe(false);
    }
  });

  it('before anyone talks to him he paces around the ambulance and never leaves it', () => {
    const { w, d } = chrisWorld();
    const amb = w.map.ambulance;
    const far = Math.hypot(amb.length, amb.width) / 2 + C.pace + 20;
    let maxD = 0;
    let moved = 0;
    let last = { x: w.chris.x, y: w.chris.y };
    for (let i = 0; i < 60; i++) {
      d.run(secs(1));
      maxD = Math.max(maxD, Math.hypot(w.chris.x - amb.x, w.chris.y - amb.y));
      moved += Math.hypot(w.chris.x - last.x, w.chris.y - last.y);
      last = { x: w.chris.x, y: w.chris.y };
    }
    expect(maxD).toBeLessThan(far);
    expect(moved).toBeGreaterThan(300);
  });

  it('talking to him activates him once: "I\'ll be there when you need me."', () => {
    const { w, d, a, b } = chrisWorld();
    activate(w, d, a);
    expect(w.events.some((e) => e.e.k === 'chris' && e.e.say === "I'll be there when you need me.")).toBe(true);
    besideChris(w, b);
    d.run(1);
    expect(b.prompt).not.toBe(Prompt.TalkChris);
    const rec = buildView(w, b).entities.find((e) => e.kind === EntityKind.Chris)!;
    expect(rec.state & ChrisFlag.Active).toBeTruthy();
  });

  it('does not rescue a survivor Zach is carrying', () => {
    const { w, d, h, a, b } = chrisWorld();
    activate(w, d, a);
    place(a, 5900, 3000);
    const spot = farClearing(w);
    place(b, spot.x, spot.y);
    b.health = Health.Carried;
    b.carriedBy = h.id;
    h.carrying = b.id;
    d.run(secs(C.downedAfter + 6));
    expect(w.chris.mode === 'rescue' || w.chris.mode === 'work').toBe(false);
    expect(b.health).toBe(Health.Carried);
  });

  it('never activated, he ignores a survivor left downed', () => {
    const { w, d, b } = chrisWorld();
    const spot = farClearing(w);
    place(b, spot.x, spot.y);
    b.health = Health.Downed;
    d.run(secs(C.downedAfter + 8));
    expect(w.chris.mode === 'rescue' || w.chris.mode === 'work').toBe(false);
    expect(b.health).toBe(Health.Downed);
  });

  it('activated, he runs at Zach sprint speed to someone downed too long, revives them in survivor time, then flies to the heavens', () => {
    const { w, d, a, b } = chrisWorld();
    activate(w, d, a);
    place(a, 5900, 3000);
    const spot = farClearing(w);
    place(b, spot.x, spot.y);
    b.health = Health.Downed;
    d.run(secs(C.downedAfter - 1));
    expect(w.chris.mode).not.toBe('rescue');
    d.run(secs(1.2));
    expect(w.chris.mode).toBe('rescue');
    // Zach's old sprint speed (Zach himself is now 5% slower).
    expect(C.run).toBeCloseTo(BALANCE.survivor.run * 1.2);
    // Measure his running speed over a second.
    const x0 = w.chris.x;
    const y0 = w.chris.y;
    d.run(secs(1));
    const v = Math.hypot(w.chris.x - x0, w.chris.y - y0);
    expect(v).toBeGreaterThan(C.run * 0.6);
    expect(v).toBeLessThan(C.run * 1.05);
    let workStart = -1;
    for (let t = 0; t < secs(80) && b.health === Health.Downed; t++) {
      d.run(1);
      if (workStart < 0 && w.chris.mode === 'work') workStart = w.time;
    }
    expect(b.health).toBe(Health.Wounded);
    expect(workStart).toBeGreaterThan(0);
    expect(w.time - workStart).toBeGreaterThanOrEqual(BALANCE.survivor.reviveTime - 0.1);
    expect(w.chris.mode).toBe('ascend');
    expect(buildView(w, b).entities.find((e) => e.kind === EntityKind.Chris)!.state & ChrisFlag.Ascending).toBeTruthy();
    d.run(secs(C.ascendTime + 0.2));
    expect(w.chris.gone).toBe(true);
    expect(buildView(w, b).entities.some((e) => e.kind === EntityKind.Chris)).toBe(false);
    // Never again.
    b.health = Health.Downed;
    d.run(secs(C.downedAfter + 2));
    expect(b.health).toBe(Health.Downed);
  });

  it('he cuts down a survivor left on a stake', () => {
    const { w, d, h, a, b } = chrisWorld();
    activate(w, d, a);
    place(a, 5900, 3000);
    stakeSurvivor(w, h, b, 0);
    expect(b.health).toBe(Health.Staked);
    for (let t = 0; t < secs(58) && b.health === Health.Staked; t++) d.run(1);
    expect(b.health).toBe(Health.Wounded);
    expect(w.chris.mode).toBe('ascend');
  });

  it('Zach kills him in two hits; hit, he flees much slower than Sexton', () => {
    const { w, d, h } = chrisWorld();
    expect(C.flee).toBeLessThan(BALANCE.sexton.flee * 0.7);
    const amb = w.map.ambulance;
    const swipeAt = (): void => {
      const dx = w.chris.x - amb.x;
      const dy = w.chris.y - amb.y;
      const l = Math.hypot(dx, dy) || 1;
      place(h, w.chris.x + (dx / l) * 50, w.chris.y + (dy / l) * 50);
      const aim = Math.atan2(w.chris.y - h.move.y, w.chris.x - h.move.x);
      d.tap(h.id, Btn.Primary, { aim });
      d.run(6, (p) => (p === h ? { aim } : undefined));
    };
    swipeAt();
    expect(w.chris.hp).toBe(1);
    expect(w.chris.mode).toBe('flee');
    // Any landed hit locks the machete for 0.8 s.
    expect(h.attackCd).toBeGreaterThan(0.4);
    d.run(secs(BALANCE.hunter.attack.hitCooldown));
    swipeAt();
    expect(w.chris.alive).toBe(false);
    const rec = buildView(w, h).entities.find((e) => e.kind === EntityKind.Chris);
    if (rec) expect(rec.state & ChrisFlag.Dead).toBeTruthy();
    // Dead, he can't be talked to.
    const s = w.players.get(2)!;
    place(s, w.chris.x + 30, w.chris.y);
    d.run(1);
    expect(s.prompt).not.toBe(Prompt.TalkChris);
  });
});
