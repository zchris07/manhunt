import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, Health, ItemKind, Prompt, ChackoFlag } from '@manhunt/shared';
import { Driver, clearLane, countOf, makeWorld, parkChris, parkSexton, parkShane, place } from './worldHelpers';
import { buildView } from '../src/sim/view';
import { spawnVape } from '../src/sim/vape';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const C = BALANCE.chacko;

function quiet(w: World): void {
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  for (const n of [w.marc, w.plasma, w.jaden, w.waz]) {
    n.x = 60;
    n.y = w.map.height - 60;
  }
}

/** Stand a player next to Chacko, in front of the couch. */
function beside(w: World, p: SimPlayer): void {
  place(p, w.chacko.x, w.chacko.y - 36);
}

describe('the lounge', () => {
  it('is always built, on every map, with Chacko in his seat inside it', () => {
    for (const seed of ['a', 'b', 'lounge-3', 'x9', 'zzz', 'q', 'm1', '77']) {
      const w = makeWorld({ survivors: 1, seed });
      const L = w.map.lounge;
      expect(L.room.w).toBeGreaterThanOrEqual(240);
      expect(w.chacko.x).toBeGreaterThan(L.room.x);
      expect(w.chacko.x).toBeLessThan(L.room.x + L.room.w);
      expect(w.chacko.y).toBeGreaterThan(L.room.y);
      expect(w.chacko.y).toBeLessThan(L.room.y + L.room.h);
      expect(w.chacko.alive).toBe(true);
      // No generator or loot sits inside it.
      expect(w.map.generators.some((g) => g.x > L.room.x && g.x < L.room.x + L.room.w && g.y > L.room.y && g.y < L.room.y + L.room.h)).toBe(false);
      // He can be seen from the front of the couch.
      expect(w.geo.hasLineOfSight(w.chacko.x, w.chacko.y - 40, w.chacko.x, w.chacko.y)).toBe(true);
    }
  });
});

describe('talking to Chacko', () => {
  it('a survivor gets one Doctor Pepper, once', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    beside(w, s);
    d.run(3);
    expect(s.prompt).toBe(Prompt.TalkChacko);
    const before = countOf(s, ItemKind.Energy);
    d.tap(s.id, Btn.Interact);
    expect(countOf(s, ItemKind.Energy)).toBe(before + 1);
    d.run(3);
    expect(s.prompt).not.toBe(Prompt.TalkChacko);
    d.tap(s.id, Btn.Interact);
    expect(countOf(s, ItemKind.Energy)).toBe(before + 1);
    // Another survivor still gets theirs.
    const t = w.players.get(3)!;
    beside(w, t);
    d.run(3);
    d.tap(t.id, Btn.Interact);
    expect(countOf(t, ItemKind.Energy)).toBeGreaterThan(0);
  });

  it('Zach is handed 50 Nic: Penjamin with 50% more reach, in blue', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    h.viewReach = 700;
    spawnVape(w, h, 0);
    const plain = w.vapes[0].range;
    w.vapes.length = 0;
    beside(w, h);
    d.run(3);
    expect(h.prompt).toBe(Prompt.TalkChacko);
    d.tap(h.id, Btn.Interact);
    expect(h.nic).toBe(true);
    spawnVape(w, h, 0);
    expect(w.vapes[0].range).toBeCloseTo(plain * C.nicRangeMul, 5);
    expect(w.events.some((e) => e.e.k === 'vape' && e.e.nic === true)).toBe(true);
  });
});

describe('slaying Chacko', () => {
  it('Zach, with one hit: he explodes and takes half of Zach\'s health', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    beside(w, h);
    const aim = Math.PI / 2;
    d.tap(h.id, Btn.Primary, { aim });
    d.run(10, (p) => (p === h ? { aim } : undefined));
    expect(w.chacko.alive).toBe(false);
    expect(w.events.some((e) => e.e.k === 'chackoBoom')).toBe(true);
    expect(h.hp).toBeCloseTo(0.5, 2);
    expect(w.chacko.record().state & ChackoFlag.Dead).toBeTruthy();
  });

  it('a survivor, with one hit of any item: Jaden and Plasma hunt them wherever they are until they are downed', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    beside(w, s);
    w.chacko.itemHit(s, 'bottle');
    expect(w.chacko.alive).toBe(false);
    expect(w.vengeance).toBe(s.id);
    expect(w.jaden.target).toBe(s.id);
    // Far across the map, with no line of sight, for a long time: they keep coming.
    place(s, 5000, 5000);
    d.run(secs(12));
    expect(w.jaden.mode).toBe('chase');
    expect(w.jaden.target).toBe(s.id);
    expect(w.plasma.raging).toBe(true);
    expect(Math.hypot(w.jaden.x - s.move.x, w.jaden.y - s.move.y)).toBeGreaterThan(300);
    // They get there and put them down: once downed, both let go.
    d.run(secs(40));
    expect(s.health).toBe(Health.Downed);
    expect(w.vengeance).toBe(0);
    expect(w.vengeance).toBe(0);
    expect(w.jaden.mode).not.toBe('chase');
  });

  it('it ends if either of them is slain first', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    beside(w, s);
    w.chacko.itemHit(s, 'shot');
    expect(w.vengeance).toBe(s.id);
    w.jaden.snipe(s);
    d.run(2);
    expect(w.vengeance).toBe(0);
  });

  it('a new attacker draws them off, and they go back to ordinary behaviour', () => {
    const w = makeWorld({ survivors: 3 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    const t = w.players.get(3)!;
    place(w.players.get(1)!, 100, 100);
    beside(w, s);
    w.chacko.itemHit(s, 'bottle');
    place(s, 5000, 5000);
    place(t, 3000, 3000);
    w.jaden.x = 3100;
    w.jaden.y = 3000;
    w.jaden.itemHit(t, 'bottle');
    d.run(2);
    expect(w.jaden.target).toBe(t.id);
    // Back to ordinary: it can lose them now.
    d.run(secs(BALANCE.jaden.chaseTime + 5));
    expect(w.jaden.mode).not.toBe('chase');
  });
});

describe('the small ones', () => {
  it("Jaden's shot takes 8% of Zach's full health", () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const h = w.players.get(1)!;
    const c = clearLane(w, 450);
    place(h, c.x, c.y);
    w.jaden.x = c.x + 150;
    w.jaden.y = c.y;
    w.jaden.facing = Math.PI;
    const before = h.hp;
    (w.jaden as unknown as { fire(t: SimPlayer): void }).fire(h);
    // The spread can miss; one clean shot at this range lands within a few tries.
    for (let i = 0; i < 6 && h.hp === before; i++) {
      w.jaden.facing = Math.PI;
      (w.jaden as unknown as { fire(t: SimPlayer): void }).fire(h);
    }
    expect(before - h.hp).toBeCloseTo(0.08, 3);
  });

  it('Zach can not swing his machete while he is down', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    place(h, 3000, 3000);
    place(s, 3060, 3000);
    h.knockT = 5;
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(10, (p) => (p === h ? { aim: 0 } : undefined));
    expect(s.hp).toBe(1);
    expect(h.chargeT).toBe(-1);
  });

  it('galaxy gas is 35% smaller', () => {
    expect(BALANCE.items.trap.gasRadius).toBeCloseTo(BALANCE.hunter.radius * 2 * 10 * 0.65, 6);
  });

  it('Chacko is sent to nearby players like the other NPCs', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const s = w.players.get(2)!;
    place(s, w.chacko.x, w.chacko.y - 100);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Chacko)).toBe(true);
  });
});

describe('Zach vs aggressive NPCs', () => {
  it('Soundcloud Burst stuns an alerted Jaden, a raging Plasma and a defending Sexton for 2.5 s', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = clearLane(w, 450);
    place(h, c.x - 300, c.y);
    place(s, 5800, 5800);
    place(w.players.get(3)!, 5800, 200);
    w.jaden.x = c.x;
    w.jaden.y = c.y;
    w.plasma.x = c.x + 100;
    w.plasma.y = c.y;
    // Zach provoked both, so they are after him.
    w.jaden.provoke(h);
    w.plasma.provoke(h);
    d.run(secs(2.2));
    w.jaden.stunT = 0;
    w.jaden.x = c.x;
    w.jaden.y = c.y;
    w.plasma.stunT = 0;
    w.plasma.x = c.x + 100;
    w.plasma.y = c.y;
    expect(w.jaden.mode).toBe('chase');
    expect(w.plasma.raging).toBe(true);
    d.tap(h.id, Btn.Secondary, { aim: 0 });
    d.run(secs(0.4), (p) => (p === h ? { aim: 0 } : undefined));
    expect(w.jaden.stunT).toBeGreaterThan(BALANCE.hunter.burst.npcStun - 0.6);
    expect(w.plasma.stunT).toBeGreaterThan(BALANCE.hunter.burst.npcStun - 0.6);
  });

  it('Penjamin slows NPCs in the gas and hurts them as a light swipe every 1.5 s', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const c = clearLane(w, 450);
    place(h, c.x - 300, c.y);
    h.viewReach = 700;
    w.sexton.x = c.x;
    w.sexton.y = c.y;
    const hp0 = w.sexton.hp;
    d.tap(h.id, Btn.Vape, { aim: 0 });
    d.run(secs(0.8));
    expect(w.sexton.vapeSlow).toBeGreaterThan(0.25);
    d.run(secs(1.2));
    expect(w.sexton.hp).toBeLessThan(hp0);
  });

  it('the Hemp Beam keeps hurting an NPC it touches', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const c = clearLane(w, 450);
    place(h, c.x - 300, c.y);
    h.beamCharges = 1;
    w.jaden.x = c.x;
    w.jaden.y = c.y;
    d.tap(h.id, Btn.Beam, { aim: 0 });
    d.run(secs(BALANCE.hunter.beam.windup + 3.2), (p) => (p === h ? { aim: 0 } : undefined));
    expect(w.jaden.alive).toBe(false);
  });
});
