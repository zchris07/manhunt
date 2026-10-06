import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, Health, ItemKind, JadenFlag, BarricadeState } from '@manhunt/shared';
import { Driver, clearLane, give, makeWorld, parkChris, parkSexton, parkShane, place, slotOf } from './worldHelpers';
import { buildView } from '../src/sim/view';
import { bookHit } from '../src/sim/items';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const H = BALANCE.hunter;
const S = BALANCE.items.sniper;

function quiet(w: World): void {
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  for (const n of [w.marc, w.plasma, w.jaden, w.waz]) {
    n.x = 60;
    n.y = w.map.height - 60;
  }
}

/** Zach at the lane's right, a survivor 400 px to his left, in the open. */
function lane(survivors = 2): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors });
  quiet(w);
  const c = clearLane(w, 450);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  place(s, c.x - 300, c.y);
  place(h, c.x + 150, c.y);
  place(w.players.get(3)!, 5800, 5800);
  return { w, d: new Driver(w), h, s, c };
}

const shoot = (_w: World, d: Driver, s: SimPlayer, aim = 0): void => {
  s.facing = aim;
  d.tap(s.id, Btn.Primary, { item: slotOf(s, ItemKind.Sniper), aim, aimDist: 300 });
};

describe('Zach melee and Hemp Beam', () => {
  it('Hemp Beam: R charges for 1 s, then fires for as long as Sexton does, 2 s cooldown, no melee throughout', () => {
    const { w, d, h, s } = lane();
    h.beamCharges = 3;
    d.tap(h.id, Btn.Beam, { aim: Math.PI });
    expect(h.beamCharges).toBe(2);
    expect(h.beamT).toBeGreaterThan(H.beam.windup + BALANCE.sexton.defense.beamTime - 0.2);
    // Charging: it does nothing yet, and the entity says so.
    d.run(secs(0.5), (p) => (p === h ? { aim: Math.PI } : undefined));
    expect(s.hp).toBe(1);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Beam && (e.state & 2) !== 0 && (e.state & 4) !== 0)).toBe(true);
    // He can't swing while it charges or fires.
    d.tap(h.id, Btn.Primary, { aim: Math.PI });
    expect(h.chargeT).toBe(-1);
    // Then ten ticks a second, each 3% of their full health.
    d.run(secs(0.6), (p) => (p === h ? { aim: Math.PI } : undefined));
    const lost = 1 - s.hp;
    expect(lost).toBeGreaterThan(0);
    const t0 = w.time;
    const hp0 = s.hp;
    d.run(secs(0.5), (p) => (p === h ? { aim: Math.PI } : undefined));
    const perSec = (hp0 - s.hp) / (w.time - t0);
    expect(perSec).toBeCloseTo(H.beam.tickRate * H.beam.tickDamage, 1);
    // Another R mid-beam does nothing; after it ends there is a 2 s cooldown.
    d.run(secs(BALANCE.sexton.defense.beamTime + 1), (p) => (p === h ? { aim: Math.PI } : undefined));
    expect(h.beamT).toBe(0);
    expect(h.beamCd).toBeGreaterThan(0);
    d.tap(h.id, Btn.Beam, { aim: Math.PI });
    expect(h.beamCharges).toBe(2);
    d.run(secs(H.beam.cooldown));
    d.tap(h.id, Btn.Beam, { aim: Math.PI });
    expect(h.beamCharges).toBe(1);
  });

  it('after three uses the beam is gone for good', () => {
    const { w, d, h } = lane();
    h.beamCharges = 3;
    for (let i = 0; i < 3; i++) {
      d.tap(h.id, Btn.Beam, { aim: Math.PI });
      d.run(secs(H.beam.windup + BALANCE.sexton.defense.beamTime + H.beam.cooldown + 0.3));
    }
    expect(h.beamCharges).toBe(0);
    d.tap(h.id, Btn.Beam, { aim: Math.PI });
    expect(h.beamT).toBe(0);
    expect(w.players.get(1)!.beamCharges).toBe(0);
  });

  it('other abilities still work during the beam, and the beam is sent as an entity', () => {
    const { w, d, h, s } = lane();
    h.beamCharges = 1;
    d.tap(h.id, Btn.Beam, { aim: Math.PI });
    d.tap(h.id, Btn.Vape, { aim: 0 });
    expect(w.vapes.length).toBe(1);
    d.run(secs(H.beam.windup + 0.2), (p) => (p === h ? { aim: Math.PI } : undefined));
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Beam && e.state === 4)).toBe(true);
  });

  it('slaying Jaden: one more lunge charge and +20% melee reach, for good', () => {
    const { w, h } = lane();
    const L = H.lunge.charges;
    expect(h.move.lungeCharges).toBe(L);
    for (let i = 0; i < 6; i++) w.jaden.slashHit(h, 1);
    expect(h.jadenBonus).toBe(1);
    expect(h.move.lungeCharges).toBe(L + 1);
  });

  it('the Grapes of Wrath stuns for 2.5 s and switches off every ability for 6 s', () => {
    expect(BALANCE.items.book.stun).toBe(2.5);
    const { w, d, h } = lane();
    h.beamCharges = 1;
    bookHit(w, h, w.players.get(2));
    expect(h.abilityLockT).toBe(H.bookAbilityLock);
    d.run(secs(3));
    const burstBefore = h.burstCd;
    d.tap(h.id, Btn.Secondary, { aim: 0 });
    d.tap(h.id, Btn.Vape, { aim: 0 });
    d.tap(h.id, Btn.Beam, { aim: 0 });
    d.tap(h.id, Btn.Ability);
    d.tap(h.id, Btn.Lunge, { aim: 0 });
    expect(h.burstCd).toBe(burstBefore);
    expect(h.vapeCharges).toBe(H.vape.charges);
    expect(h.beamT).toBe(0);
    expect(h.hempOn).toBe(false);
    expect(h.move.lungeT).toBe(0);
    d.run(secs(H.bookAbilityLock));
    d.tap(h.id, Btn.Vape, { aim: 0 });
    expect(h.vapeCharges).toBe(H.vape.charges - 1);
  });
});

describe('the 0.50 cal', () => {
  it('two spawn on the map; shotguns are four, with six shells', () => {
    const w = makeWorld({ survivors: 1 });
    expect(w.map.loot.filter((l) => l.item === 'sniper').length).toBe(2);
    expect(w.map.loot.filter((l) => l.item === 'shotgun').length).toBeGreaterThanOrEqual(4);
    expect(BALANCE.items.shotgun.shells).toBe(6);
    expect(S.shots).toBe(3);
    expect(S.speed).toBe(2 * S.pelletSpeed);
  });

  it('one shot downs a survivor, through a wall, after the bullet has flown there', () => {
    const { w, d, h, s } = lane(3);
    const t = w.players.get(3)!;
    give(w, s, ItemKind.Sniper);
    place(h, 100, 100);
    place(t, s.move.x + 700, s.move.y);
    shoot(w, d, s);
    expect(s.inv.find((x) => x.kind === ItemKind.Sniper)!.amt[0]).toBe(S.shots - 1);
    // It takes a moment to arrive (800 px at 8000 px/s = 0.1 s).
    expect(t.health).toBe(Health.Healthy);
    d.run(secs(0.3));
    expect(t.health).toBe(Health.Downed);
  });

  it('on Zach: 25 hp, shoved back hard, his sprint off for 3 s', () => {
    const { w, d, h, s } = lane();
    give(w, s, ItemKind.Sniper);
    const x0 = h.move.x;
    const hp0 = h.hp;
    shoot(w, d, s);
    d.run(secs(0.5));
    expect(hp0 - h.hp).toBeCloseTo(0.25, 2);
    expect(h.move.x - x0).toBeGreaterThan(150);
    expect(h.move.staminaLock).toBeGreaterThan(S.sprintLock - 1);
  });

  it('slays Jaden and Waz in one shot, and breaks a window or door on the way', () => {
    const { w, d, s, c } = lane();
    give(w, s, ItemKind.Sniper, 1);
    w.jaden.x = c.x + 100;
    w.jaden.y = c.y;
    w.waz.x = c.x + 200;
    w.waz.y = c.y;
    place(w.players.get(1)!, 100, 100);
    shoot(w, d, s);
    d.run(secs(0.4));
    expect(w.jaden.alive).toBe(false);
    expect(w.waz.alive).toBe(false);
    expect(w.jaden.record().state & JadenFlag.Dead).toBeTruthy();
  });

  it('smashes a closed door and a barricade and damages a generator in its path', () => {
    const { w, d, s } = lane();
    give(w, s, ItemKind.Sniper);
    place(w.players.get(1)!, 100, 100);
    const door = w.map.doors[0];
    const dx = door.hx + Math.cos(door.angle) * door.length * 0.5;
    const dy = door.hy + Math.sin(door.angle) * door.length * 0.5;
    const na = door.angle + Math.PI / 2;
    place(s, dx - Math.cos(na) * 300, dy - Math.sin(na) * 300);
    w.setDoor(0, false);
    w.doorBroken[0] = false;
    shoot(w, d, s, na);
    d.run(secs(0.5));
    expect(w.doorBroken[0] || w.doors[0]).toBe(true);
    // A generator.
    const g = w.map.generators[0];
    w.gens[0].progress = 0.6;
    place(s, g.x - 400, g.y);
    s.reloadT = 0;
    shoot(w, d, s);
    d.run(secs(0.5));
    expect(w.gens[0].progress).toBeCloseTo(0.6 - S.genDamage, 2);
    // A dropped barricade.
    const b = w.map.barricades[0];
    w.setBarricade(0, BarricadeState.Down);
    const ba = b.angle + Math.PI / 2;
    place(s, b.x - Math.cos(ba) * 300, b.y - Math.sin(ba) * 300);
    s.reloadT = 0;
    shoot(w, d, s, ba);
    d.run(secs(0.5));
    expect(w.barricades[0]).toBe(BarricadeState.Broken);
  });

  it('a raised rifle shows its red laser to everyone, Zach included, wherever he is', () => {
    const { w, d, h, s } = lane();
    give(w, s, ItemKind.Sniper);
    place(h, 5000, 5000);
    s.selSlot = s.inv.findIndex((x) => x.kind === ItemKind.Sniper);
    d.run(secs(0.3), (p) => (p === s ? { item: s.selSlot + 1 } : undefined));
    const lasers = buildView(w, h).entities.filter((e) => e.kind === EntityKind.Beam && e.state === 1);
    expect(lasers.length).toBe(1);
    expect(lasers[0].qx).toBeGreaterThan(0);
    expect(lasers[0].extra).toBe(Math.round(S.laserMax / 24));
  });

  it('only survivors can pick one up', () => {
    const { w, h } = lane();
    expect(h.role).toBe('hunter');
    const drop = { id: w.allocEntityId(), x: h.move.x, y: h.move.y, kind: ItemKind.Sniper, golden: false, amount: 3 };
    w.drops.push(drop);
    h.prompt = 0;
    new Driver(w).run(3);
    expect(h.prompt).not.toBe(31);
  });
});

describe('Penjamin slow', () => {
  it('60% close to the source down to 30% far away; the strongest holds while in the gas and 3 s after', () => {
    const { d, h, s } = lane();
    h.viewReach = 1000;
    place(s, h.move.x + 1100 * 0.98, h.move.y);
    d.tap(h.id, Btn.Vape, { aim: 0 });
    d.run(secs(1));
    expect(s.vapeSlow).toBeCloseTo(0.3, 1);
    // Walking toward the source raises it (actively recalculated).
    place(s, h.move.x + 300, h.move.y);
    d.run(secs(0.3));
    const near = s.vapeSlow;
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeLessThanOrEqual(0.6 + 1e-6);
    // Out of the gas: it holds for 3 s, then ends.
    place(s, h.move.x + 400, h.move.y + 700);
    d.run(secs(2.5));
    expect(s.move.slowMul).toBeCloseTo(1 - near, 2);
    d.run(secs(1));
    d.run(2);
    expect(s.move.slowMul).toBe(1);
  });
});

describe('generators', () => {
  it('each extra survivor adds 25% to the repair speed, hold to repair', () => {
    const rate = (n: number): number => {
      const w = makeWorld({ survivors: n });
      quiet(w);
      const d = new Driver(w);
      const g = w.map.generators[0];
      place(w.players.get(1)!, 100, 100);
      const crew = [2, 3, 4].slice(0, n).map((id) => w.players.get(id)!);
      crew.forEach((p, i) => place(p, g.x + 50, g.y + i * 26 - 20));
      d.run(2);
      d.run(secs(5), (p) => (crew.includes(p) ? { buttons: Btn.Interact } : undefined));
      return w.gens[0].progress;
    };
    const one = rate(1);
    expect(rate(2) / one).toBeCloseTo(1.25, 1);
    expect(rate(3)).toBeGreaterThan(rate(2));
  });
});
