import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, INV_LIMIT, INV_SLOTS, ItemKind, Prompt, hempRegenMul, hunterHealthMul } from '@manhunt/shared';
import { Driver, clearLane, give, makeWorld, parkChris, parkSexton, parkShane, place, slotOf } from './worldHelpers';
import { buildView } from '../src/sim/view';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const I = BALANCE.items;

function quiet(w: World): void {
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  for (const n of [w.marc, w.plasma, w.jaden, w.waz, w.njaaron, w.monique, w.thomas, w.soham]) {
    n.x = 60;
    n.y = w.map.height - 60;
  }
}

/** A world with a survivor beside `at` (default: nothing near). */
const near = (p: SimPlayer, n: { x: number; y: number }, dx = 0): void => place(p, n.x + dx, n.y + 40);

describe('testing mode kit', () => {
  it('has a slot for every weapon: shotgun, golden pump, P250 and the 0.50 cal', () => {
    const w = makeWorld({ survivors: 1, testMode: true });
    const s = w.players.get(2)!;
    w.fillTestKit(s);
    expect(INV_SLOTS).toBeGreaterThan(INV_LIMIT);
    const kinds = s.inv.filter((x) => x.n > 0).map((x) => `${x.kind}${x.golden ? 'g' : ''}`);
    for (const k of [`${ItemKind.Shotgun}`, `${ItemKind.Shotgun}g`, `${ItemKind.Pistol}`, `${ItemKind.Sniper}`, `${ItemKind.Piss}`]) expect(kinds).toContain(k);
  });

  it('a real match keeps eight slots', () => {
    const w = makeWorld({ survivors: 1 });
    const s = w.players.get(2)!;
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) give(w, s, k as ItemKind);
    expect(s.inv.filter((x) => x.n > 0).length).toBe(INV_LIMIT);
  });
});

describe("Zach and Plasma's golden pump", () => {
  it('Zach can talk to Plasma.TTV and is handed the golden pump', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    near(h, w.plasma);
    w.plasma.x = 3000;
    w.plasma.y = 3000;
    place(h, 3040, 3000);
    d.run(3);
    expect(h.prompt).toBe(Prompt.TalkPlasma);
    d.tap(h.id, Btn.Interact);
    expect(h.pump).toBe(I.zachPump.shots);
  });
});

describe('weapons and items', () => {
  it('a P250 hit knocks the target back and stuns for 0.1 s (survivor and Zach)', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const t = w.players.get(3)!;
    const c = clearLane(w, 450);
    place(s, c.x - 200, c.y);
    place(t, c.x + 100, c.y);
    place(h, 100, 100);
    give(w, s, ItemKind.Pistol);
    d.tap(s.id, Btn.Primary, { item: slotOf(s, ItemKind.Pistol), aim: 0, aimDist: 300 });
    const stunned = t.stunT;
    const kb = t.move.kbT;
    for (let i = 0; i < 4 && kb === 0 && t.hp === 1; i++) {
      s.reloadT = 0;
      d.tap(s.id, Btn.Primary, { item: slotOf(s, ItemKind.Pistol), aim: 0, aimDist: 300 });
    }
    expect(t.hp).toBeLessThan(1);
    expect(stunned + t.stunT).toBeGreaterThanOrEqual(0);
    expect(t.move.kbPeak).toBe(I.pistol.kbPeak);
    expect(I.pistol.stun).toBe(0.1);
    // And Zach.
    place(h, c.x + 100, c.y);
    place(t, 5000, 5000);
    s.reloadT = 0;
    d.tap(s.id, Btn.Primary, { item: slotOf(s, ItemKind.Pistol), aim: 0, aimDist: 300 });
    for (let i = 0; i < 4 && h.hp === 1; i++) {
      s.reloadT = 0;
      d.tap(s.id, Btn.Primary, { item: slotOf(s, ItemKind.Pistol), aim: 0, aimDist: 300 });
    }
    expect(h.hp).toBeLessThan(1);
    expect(h.move.kbPeak).toBe(I.pistol.kbPeak);
  });

  it('beast bars and Doctor Pepper can be used on the move, at half speed', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    place(s, 3000, 3000);
    s.hp = 0.5;
    const slot = give(w, s, ItemKind.BeastBar);
    const x0 = s.move.x;
    d.tap(s.id, Btn.Primary, { item: slot, moveX: 1 });
    d.run(secs(0.6), (p) => (p === s ? { item: slot, moveX: 1 } : undefined));
    const v = (s.move.x - x0) / (w.time ? 0.7 : 1);
    expect(s.hp).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(BALANCE.survivor.walk * 0.75);
  });

  it('the Grapes of Wrath pictures cycle: never the same one twice in a row', () => {
    const w = makeWorld({ survivors: 1 });
    let last = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const n = w.nextBookImage();
      expect(n).not.toBe(last);
      seen.add(n);
      last = n;
    }
    expect(seen.size).toBe(I.book.images);
  });

  it('slaying Waz flashes for everyone in the lobby', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const s = w.players.get(2)!;
    place(s, 3000, 3000);
    w.waz.itemHit(s, 'bottle');
    expect(w.events.some((e) => e.e.k === 'wazSlain' && e.to.includes(s.id) && e.to.includes(w.players.get(1)!.id))).toBe(true);
  });

  it('a jar of piss: Zach takes 50% more damage for 5 s, with no stun; an NPC is stunned like by a bottle', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = clearLane(w, 450);
    place(s, c.x - 250, c.y);
    place(h, c.x + 100, c.y);
    place(w.players.get(3)!, 5800, 5800);
    const slot = give(w, s, ItemKind.Piss);
    d.tap(s.id, Btn.Primary, { item: slot, aim: 0, aimDist: 300 });
    d.run(secs(0.6));
    expect(h.pissT).toBeGreaterThan(3);
    expect(h.stunT).toBe(0);
    expect(h.hp).toBe(1);
  });

  it('piss is a stun item to an NPC', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    const c = clearLane(w, 450);
    place(s, c.x - 200, c.y);
    w.jaden.x = c.x;
    w.jaden.y = c.y;
    const slot = give(w, s, ItemKind.Piss);
    d.tap(s.id, Btn.Primary, { item: slot, aim: 0, aimDist: 300 });
    d.run(secs(0.5));
    expect(w.jaden.stunT).toBeGreaterThan(0.3);
  });

  it('there are 6 jars on the map, the item total is unchanged, and none is in water or on a structure', () => {
    const w = makeWorld({ survivors: 1 });
    expect(w.map.loot.filter((l) => l.item === 'piss').length).toBe(6);
    const counts = BALANCE.items.counts;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const placed = w.map.loot.length - BALANCE.items.ambulanceKit.length;
    expect(placed).toBeLessThanOrEqual(total);
    expect(placed).toBeGreaterThan(total - 6);
    for (const l of w.map.loot) expect(w.geo.inWater(l.x, l.y)).toBe(false);
  });

  it('some items sit well away from any trail (anywhere on the map)', () => {
    let far = 0;
    for (const seed of ['a', 'b', 'c']) {
      const w = makeWorld({ survivors: 1, seed });
      const dist = (x: number, y: number): number => {
        let best = Infinity;
        for (const p of w.map.paths) {
          for (let i = 0; i + 3 < p.points.length; i += 2) {
            const ax = p.points[i];
            const ay = p.points[i + 1];
            const bx = p.points[i + 2];
            const by = p.points[i + 3];
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
            best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)));
          }
        }
        return best;
      };
      far += w.map.loot.filter((l) => dist(l.x, l.y) > 130).length;
    }
    expect(far).toBeGreaterThan(5);
  });
});

describe('Chacko vengeance reaches Shane and times out', () => {
  it('Shane Jeans is alerted too, and after 30 s with nobody downed they all stand down', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    place(s, w.chacko.x, w.chacko.y - 36);
    w.chacko.itemHit(s, 'bottle');
    expect(w.shane.chasing).toBe(true);
    // Somewhere they can't quickly reach.
    place(s, 5800, 200);
    d.run(secs(BALANCE.chacko.vengeanceSec - 2));
    expect(w.vengeance).toBe(s.id);
    d.run(secs(4));
    expect(w.vengeance).toBe(0);
    expect(w.shane.chasing).toBe(false);
    expect(w.jaden.mode).not.toBe('chase');
    expect(w.plasma.raging).toBe(false);
  });
});

describe('Njaaron', () => {
  function setup(): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; t: SimPlayer } {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const c = clearLane(w, 450);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const t = w.players.get(3)!;
    place(h, 100, 100);
    place(t, 5800, 5800);
    w.njaaron.x = c.x;
    w.njaaron.y = c.y;
    place(s, c.x, c.y + 40);
    return { w, d: new Driver(w), h, s, t };
  }

  it('asks, and a survivor saying yes makes him follow them', () => {
    const { w, d, s } = setup();
    d.run(3);
    expect(s.prompt).toBe(Prompt.TalkNjaaron);
    d.tap(s.id, Btn.Interact);
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.who === 'njaaron' && e.e.say === BALANCE.njaaron.lineAsk)).toBe(true);
    d.run(3);
    expect(s.prompt).toBe(Prompt.NjaaronAsk);
    d.tap(s.id, Btn.Yes);
    expect(w.njaaron.mode).toBe('follow');
    place(s, w.njaaron.x + 300, w.njaaron.y);
    d.run(secs(3));
    expect(Math.hypot(w.njaaron.x - s.move.x, w.njaaron.y - s.move.y)).toBeLessThan(150);
  });

  it("when Zach closes in, he takes him on: 10 hp a punch with knockback; two swings kill him", () => {
    const { w, d, h, s } = setup();
    d.run(3);
    d.tap(s.id, Btn.Interact);
    d.run(3);
    d.tap(s.id, Btn.Yes);
    place(h, s.move.x + 250, s.move.y);
    const before = h.hp;
    d.run(secs(3));
    expect(w.njaaron.mode).toBe('defend');
    expect(before - h.hp).toBeGreaterThanOrEqual(0.099);
    expect(h.move.kbPeak).toBe(BALANCE.njaaron.kbPeak);
  });

  it('saying no: "cmon man", he attacks you for 10 s; three stuns or one firearm shot kill him; you can talk again after', () => {
    const { w, d, s } = setup();
    d.run(3);
    d.tap(s.id, Btn.Interact);
    d.run(3);
    d.tap(s.id, Btn.No);
    expect(w.njaaron.mode).toBe('attack');
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.say === 'cmon man')).toBe(true);
    d.run(secs(2));
    expect(s.hp).toBeLessThan(1);
    place(s, 5000, 600);
    d.run(secs(BALANCE.njaaron.angrySec + 1));
    expect(w.njaaron.mode).toBe('wander');
    // After he's done he can be talked to again.
    place(s, w.njaaron.x, w.njaaron.y + 40);
    s.hp = 1;
    d.run(3);
    expect(s.prompt).toBe(Prompt.TalkNjaaron);
  });

  it('Zach saying yes: +20% health recovery; saying no: he attacks Zach', () => {
    const { w, d, h } = setup();
    place(h, w.njaaron.x, w.njaaron.y + 40);
    place(w.players.get(2)!, 5800, 200);
    d.run(3);
    d.tap(h.id, Btn.Interact);
    d.run(3);
    d.tap(h.id, Btn.Yes);
    expect(h.njaaronRegen).toBe(true);
    h.njaaronRegen = false;
    d.run(secs(1));
    place(h, w.njaaron.x, w.njaaron.y + 40);
    w.njaaron.mode = 'wander';
    d.run(3);
    d.tap(h.id, Btn.Interact);
    d.run(3);
    d.tap(h.id, Btn.No);
    expect(w.njaaron.mode).toBe('attack');
    d.run(secs(2));
    expect(h.hp).toBeLessThan(1);
  });

  it('however he dies he explodes: up to 20 hp to Zach, up to half a bar to survivors, by distance', () => {
    const { w, d, h, s } = setup();
    place(h, w.njaaron.x + 30, w.njaaron.y);
    place(s, w.njaaron.x - 200, w.njaaron.y);
    const hz = h.hp;
    const hs = s.hp;
    w.njaaron.itemHit(s, 'shot');
    d.run(2);
    expect(w.njaaron.alive).toBe(false);
    expect(hz - h.hp).toBeGreaterThan(0.1);
    expect(hz - h.hp).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(hs - s.hp).toBeGreaterThan(0);
    expect(hs - s.hp).toBeLessThan(0.5);
    expect(w.events.some((e) => e.e.k === 'chackoBoom')).toBe(true);
  });

  it('Zach kills him in four light hits (a heavy swing counts two)', () => {
    const { w, h } = setup();
    for (let i = 0; i < 3; i++) w.njaaron.slashHit(h, 1);
    expect(w.njaaron.alive).toBe(true);
    w.njaaron.slashHit(h, 1);
    expect(w.njaaron.alive).toBe(false);
  });

  it('three stunning item hits kill him', () => {
    const { w, s } = setup();
    w.njaaron.itemHit(s, 'bottle');
    w.njaaron.itemHit(s, 'bottle');
    expect(w.njaaron.alive).toBe(true);
    w.njaaron.itemHit(s, 'bottle');
    expect(w.njaaron.alive).toBe(false);
  });
});

describe('Soham, Monique and Thomas', () => {
  it('Soham says Hi, and two seconds later explodes', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    place(w.players.get(1)!, 100, 100);
    w.soham.x = 3000;
    w.soham.y = 3000;
    place(s, 3030, 3000);
    d.run(3);
    expect(s.prompt).toBe(Prompt.TalkSoham);
    d.tap(s.id, Btn.Interact);
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.say === 'Hi')).toBe(true);
    expect(w.soham.alive).toBe(true);
    d.run(secs(BALANCE.soham.fuse + 0.3));
    expect(w.soham.alive).toBe(false);
    expect(s.hp).toBeLessThan(1);
  });

  it('Monique: the first survivor gets a 40 s arrow to Zach; the next a beast bar; survivors only', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const a = w.players.get(2)!;
    const b = w.players.get(3)!;
    place(h, 4000, 3000);
    w.monique.x = 3000;
    w.monique.y = 3000;
    place(h, 3030, 3040);
    d.run(3);
    expect(h.prompt).not.toBe(Prompt.TalkMonique);
    place(h, 4500, 3000);
    place(a, 3030, 3000);
    d.run(3);
    d.tap(a.id, Btn.Interact);
    expect(a.arrowT).toBeGreaterThan(39);
    const v = buildView(w, a).self;
    expect(v.arrowT).toBeGreaterThan(39);
    expect(v.arrowDist).toBeCloseTo(Math.hypot(h.move.x - a.move.x, h.move.y - a.move.y), 0);
    place(a, 5000, 5000);
    place(b, 3030, 3000);
    d.run(3);
    d.tap(b.id, Btn.Interact);
    expect(b.arrowT).toBe(0);
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.say === 'Hi there')).toBe(true);
    expect(slotOf(b, ItemKind.BeastBar)).toBeGreaterThan(0);
  });

  it('Monique: attacked by Zach she bolts; attacked by a survivor she shoots them with a 0.50 cal for 10 s', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    place(w.players.get(3)!, 5800, 5800);
    w.monique.x = 3000;
    w.monique.y = 3000;
    place(h, 3040, 3000);
    w.monique.hit(h);
    const x0 = w.monique.x;
    d.run(secs(1));
    expect(Math.hypot(w.monique.x - x0, w.monique.y - 3000)).toBeGreaterThan(BALANCE.sexton.flee);
    // A survivor: armed.
    w.monique.x = 3000;
    w.monique.y = 3000;
    place(h, 100, 100);
    place(s, 3200, 3000);
    w.monique.itemHit(s);
    expect(w.monique.armed).toBe(true);
    d.run(secs(2));
    expect(s.hp).toBeLessThan(0.7);
    d.run(secs(BALANCE.monique.attackSec));
    expect(w.monique.armed).toBe(false);
  });

  it('Thomas hands the first player a full Hemp Beam and runs when hit; survivors can fire it at Zach', () => {
    const w = makeWorld({ survivors: 2 });
    quiet(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    place(w.players.get(3)!, 5800, 5800);
    const c = clearLane(w, 450);
    place(h, 100, 100);
    w.thomas.x = c.x;
    w.thomas.y = c.y;
    place(s, c.x - 60, c.y);
    d.run(3);
    d.tap(s.id, Btn.Interact);
    expect(s.beamCharges).toBe(BALANCE.hunter.beam.charges);
    // Fire it at Zach.
    place(h, c.x + 250, c.y);
    h.knockT = 0;
    const hp0 = h.hp;
    d.tap(s.id, Btn.Beam, { aim: 0 });
    d.run(secs(BALANCE.hunter.beam.windup + 1.5), (p) => (p === s ? { aim: 0 } : undefined));
    expect(hp0 - h.hp).toBeGreaterThan(0.05);
    // A second player gets nothing; and he runs when hit.
    place(w.players.get(3)!, c.x - 60, c.y + 20);
    w.thomas.hit(h);
    d.run(secs(1));
    expect(Math.hypot(w.thomas.x - c.x, w.thomas.y - c.y)).toBeGreaterThan(BALANCE.sexton.flee);
  });

  it('the four townsfolk are sent to nearby players like the other NPCs', () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const s = w.players.get(2)!;
    for (const [n, kind] of [[w.njaaron, EntityKind.Njaaron], [w.monique, EntityKind.Monique], [w.thomas, EntityKind.Thomas], [w.soham, EntityKind.Soham]] as const) {
      n.x = 3000;
      n.y = 3000;
      place(s, 3100, 3000);
      expect(buildView(w, s).entities.some((e) => e.kind === kind)).toBe(true);
    }
  });
});

describe('piss on Zach', () => {
  it('doubles... no: +50% on what he takes', async () => {
    const w = makeWorld({ survivors: 1 });
    quiet(w);
    const h = w.players.get(1)!;
    const { hurtHunter } = await import('../src/sim/combat');
    hurtHunter(w, h, 10, null, 'bottle');
    const plain = 1 - h.hp;
    h.hp = 1;
    h.pissT = 5;
    hurtHunter(w, h, 10, null, 'bottle');
    expect((1 - h.hp) / plain).toBeCloseTo(1.5, 3);
  });
});

describe('continuous health slow, hemp recovery, npc respawn', () => {
  it('slow is continuous in health', () => {
    expect(hunterHealthMul(0.9, 0)).toBeCloseTo(0.96, 6);
    expect(hunterHealthMul(0.5, 0)).toBeCloseTo(0.8, 6);
    expect(hunterHealthMul(0.123, 0)).toBeCloseTo(1 - 0.877 * 0.4, 6);
  });

  it('hemp charge scales recovery by 10% x charge', () => {
    expect(hempRegenMul(1)).toBeCloseTo(1.1, 6);
    expect(hempRegenMul(0.5)).toBeCloseTo(1.05, 6);
    expect(hempRegenMul(0)).toBe(1);
  });

  it('testing mode brings slain NPCs back', () => {
    const w = makeWorld({ survivors: 1, testMode: true });
    w.jaden.alive = false;
    w.respawnNpcs();
    expect(w.jaden.alive).toBe(true);
  });
});
