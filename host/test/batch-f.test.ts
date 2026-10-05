import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, Health, Prompt, hunterStakeMul } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, parkChris, parkSexton, parkShane, place } from './worldHelpers';
import { buildView } from '../src/sim/view';
import { stakeSurvivor } from '../src/sim/combat';
import { playTestFx } from '../src/sim/testFx';
import { stunHunter } from '../src/sim/items';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);

function quiet(w: World): void {
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  for (const n of [w.marc, w.plasma, w.jaden, w.waz]) {
    n.x = 60;
    n.y = w.map.height - 60;
  }
}

const seen = (w: World, viewer: SimPlayer, who: SimPlayer): boolean =>
  buildView(w, viewer).entities.some((e) => e.kind === EntityKind.Player && e.id === who.id);

describe('Hemp Battery is held, not toggled', () => {
  it('drains only while Q is held and its buffs are on only then', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    h.hemp = 1;
    h.hempLeft = BALANCE.hunter.hemp.duration;
    expect(BALANCE.hunter.hemp.duration).toBe(16);
    d.hold(h.id, Btn.Ability, 2);
    expect(h.move.hempT).toBeGreaterThan(0);
    expect(h.hempLeft).toBeCloseTo(14, 0);
    d.run(2);
    expect(h.move.hempT).toBe(0);
    const left = h.hempLeft;
    d.run(secs(3));
    expect(h.hempLeft).toBe(left);
    d.hold(h.id, Btn.Ability, 20);
    expect(h.hemp).toBe(0);
    expect(h.hempLeft).toBe(0);
  });
});

describe('testing mode', () => {
  it("Zach's abilities never cool down", () => {
    const w = makeWorld({ survivors: 1, testMode: true });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    d.tap(h.id, Btn.Vape, { aim: 0 });
    d.tap(h.id, Btn.Secondary, { aim: 0 });
    d.run(3);
    expect(h.vapeCd).toBe(0);
    expect(h.burstCd).toBe(0);
    d.tap(h.id, Btn.Vape, { aim: 0 });
    expect(w.vapes.length).toBe(2);
  });

  it('the Penjamin effect button rolls a visible cloud at a survivor', () => {
    const w = makeWorld({ survivors: 1, testMode: true });
    quiet(w);
    const s = w.players.get(2)!;
    playTestFx(w, s, 'vape');
    expect(w.vapes.length).toBe(1);
    expect(w.events.some((e) => e.e.k === 'vape' && e.to.includes(s.id))).toBe(true);
  });
});

describe('items', () => {
  it('a shotgun stuns Zach 1.5 times as long as a bottle', () => {
    expect(BALANCE.items.shotgun.stun).toBeCloseTo(BALANCE.items.bottle.stun * 1.5, 6);
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const h = w.players.get(1)!;
    stunHunter(w, h, BALANCE.items.bottle.stun, 'bottle');
    const bottle = h.stunT;
    h.stunT = 0;
    h.immuneT = 0;
    stunHunter(w, h, BALANCE.items.shotgun.stun, 'shotgun');
    expect(h.stunT / bottle).toBeCloseTo(1.5, 2);
  });
});

describe('teammates glow', () => {
  function pair(): { w: World; d: Driver; a: SimPlayer; b: SimPlayer } {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const c = clearLane(w, 450);
    const [h, a, b] = [w.players.get(1)!, w.players.get(2)!, w.players.get(3)!];
    place(h, 300, 300);
    place(a, c.x - 200, c.y);
    // b stands well outside a's cone and proximity circle, in the clear.
    place(b, c.x + 150, c.y);
    a.facing = Math.PI;
    a.viewReach = 700;
    return { w, d: new Driver(w), a, b };
  }

  it('a survivor on your screen with a clear line to you is seen even outside your light', () => {
    const { w, a, b } = pair();
    expect(seen(w, a, b)).toBe(true);
    a.viewReach = 500;
    place(b, a.move.x + 650, a.move.y);
    // Out of reach of a's screen (650 px away) and out of its cone: not seen.
    expect(seen(w, a, b)).toBe(false);
  });

  it('a downed survivor sees teammates nearby, with their flashlight cones', () => {
    const { w, a, b } = pair();
    a.viewReach = 500;
    place(b, a.move.x + 650, a.move.y);
    expect(seen(w, a, b)).toBe(false);
    a.health = Health.Downed;
    expect(seen(w, a, b)).toBe(true);
    expect(BALANCE.survivor.allyLight.coneAlpha).toBeGreaterThan(0);
  });

  it('Zach is not helped by it', () => {
    const { w, b } = pair();
    const h = w.players.get(1)!;
    place(h, b.move.x - 700, b.move.y);
    h.facing = Math.PI;
    expect(seen(w, h, b)).toBe(false);
  });
});

describe('staking buffs Zach', () => {
  it('each stake is +5% move speed and field of view for good', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const h = w.players.get(1)!;
    const a = w.players.get(2)!;
    const fov = h.fovMul;
    stakeSurvivor(w, h, a, 0);
    expect(h.stakeBuff).toBe(1);
    expect(h.fovMul).toBeCloseTo(fov * 1.05, 6);
    expect(hunterStakeMul(h.stakeBuff)).toBeCloseTo(1.05, 6);
    stakeSurvivor(w, h, w.players.get(3)!, 1);
    expect(h.stakeBuff).toBe(2);
    expect(hunterStakeMul(2)).toBeCloseTo(1.1, 6);
  });

  it('his health takes 6 minutes to fully recover', () => {
    expect(BALANCE.hunter.health.regenTime).toBe(360);
  });
});

describe('notes', () => {
  it('four of them lie on the map, each readable by Zach and survivors, and they stay put', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    expect(w.map.notes.length).toBe(BALANCE.notes.count);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const n = w.map.notes[2];
    for (const p of [h, s]) {
      place(p, n.x + 20, n.y);
      d.run(3);
      expect(p.prompt).toBe(Prompt.ReadNote);
      d.tap(p.id, Btn.Interact);
      expect(w.events.some((e) => e.e.k === 'note' && e.e.n === 2 && e.to.includes(p.id))).toBe(true);
    }
    expect(w.map.notes.length).toBe(BALANCE.notes.count);
  });
});
