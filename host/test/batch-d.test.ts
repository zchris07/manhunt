import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, EntityKind, Health, INV_LIMIT, ItemKind, Prompt, hunterHealthMul } from '@manhunt/shared';
import { Driver, clearLane, countOf, give, makeWorld, parkChris, parkSexton, parkShane, place, runUntil, slotOf } from './worldHelpers';
import { createHarness, idle, move, startMatch } from './harness';
import { buildView, visionFor } from '../src/sim/view';
import { addItem, moveSlot } from '../src/sim/inventory';
import { hurtHunter, hurtSurvivor } from '../src/sim/combat';
import { playTestFx } from '../src/sim/testFx';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const I = BALANCE.items;
const ZH = BALANCE.hunter.health;

/** Every NPC parked in a far corner, Zach and one survivor on a clear lane. */
function arena(dist = 200): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 1 });
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
  place(s, c.x, c.y);
  place(h, c.x + dist, c.y);
  return { w, d: new Driver(w), h, s, c };
}

const use = (d: Driver, p: SimPlayer, kind: ItemKind, aim = 0): void => d.tap(p.id, Btn.Primary, { item: slotOf(p, kind), aim, aimDist: 300 });

describe('inventory: eight free slots', () => {
  it('identical items stack without limit; weapons each take a slot of their own', () => {
    const { w, s } = arena();
    give(w, s, ItemKind.Bottle, 25);
    expect(s.inv[0]).toMatchObject({ kind: ItemKind.Bottle, n: 25 });
    give(w, s, ItemKind.Shotgun);
    give(w, s, ItemKind.Shotgun);
    give(w, s, ItemKind.Shotgun, 1, true);
    const guns = s.inv.filter((sl) => sl.kind === ItemKind.Shotgun);
    expect(guns.length).toBe(3);
    expect(guns.every((g) => g.n === 1)).toBe(true);
    expect(guns[2].golden).toBe(true);
    expect(guns[2].amt[0]).toBe(I.golden.shells);
  });

  it('a ninth distinct item drops whatever is in the eighth slot', () => {
    const { w, s } = arena();
    const kinds = [ItemKind.Bottle, ItemKind.Goggles, ItemKind.Shotgun, ItemKind.Energy, ItemKind.Trap, ItemKind.Book, ItemKind.Confit, ItemKind.Pistol];
    for (const k of kinds) give(w, s, k);
    give(w, s, ItemKind.Bottle, 2);
    expect(s.inv.slice(0, INV_LIMIT).every((sl) => sl.n > 0)).toBe(true);
    expect(s.inv[INV_LIMIT - 1].kind).toBe(ItemKind.Pistol);
    // Another shotgun is a ninth item: the pistol goes on the ground.
    addItem(w, s, ItemKind.Shotgun);
    expect(s.inv[INV_LIMIT - 1].kind).toBe(ItemKind.Shotgun);
    expect(w.drops.map((d) => d.kind)).toEqual([ItemKind.Pistol]);
    // More bottles still stack.
    give(w, s, ItemKind.Bottle);
    expect(countOf(s, ItemKind.Bottle)).toBe(4);
  });

  it('a full stack in the eighth slot goes down whole, and loot is always picked up', () => {
    const { w, d, s } = arena();
    for (const k of [ItemKind.Goggles, ItemKind.Shotgun, ItemKind.Energy, ItemKind.Trap, ItemKind.Book, ItemKind.Confit, ItemKind.Pistol]) give(w, s, k);
    give(w, s, ItemKind.Bottle, 3);
    expect(s.inv[7]).toMatchObject({ kind: ItemKind.Bottle, n: 3 });
    const li = w.map.loot.findIndex((l) => l.item === 'shotgun');
    place(s, w.map.loot[li].x + 10, w.map.loot[li].y);
    d.run(1);
    expect(s.prompt).toBe(Prompt.Loot);
    d.tap(s.id, Btn.Interact);
    expect(w.lootTaken[li]).toBe(true);
    expect(s.inv[7].kind).toBe(ItemKind.Shotgun);
    expect(w.drops.filter((dr) => dr.kind === ItemKind.Bottle).length).toBe(3);
  });

  it('slots can be swapped (drag and drop)', () => {
    const { w, s } = arena();
    give(w, s, ItemKind.Bottle);
    give(w, s, ItemKind.Book);
    moveSlot(s, 0, 5);
    expect(s.inv[5].kind).toBe(ItemKind.Bottle);
    expect(s.inv[0].kind).toBe(0);
    expect(buildView(w, s).self.slots[5].kind).toBe(ItemKind.Bottle);
  });

  it('Doctor Pepper replaced the energy drink', () => {
    const { w, d, s } = arena();
    give(w, s, ItemKind.Energy);
    use(d, s, ItemKind.Energy);
    expect(s.move.boostT).toBeGreaterThan(I.energy.duration - 0.2);
    expect(w.events.some((e) => e.e.k === 'item' && e.e.text === 'Doctor Pepper')).toBe(true);
  });
});

describe("Zach's 100 hp", () => {
  it('a bottle takes 5 hp (and still stuns); a full shotgun blast 25 hp, 3.125 a pellet', () => {
    const { w, d, h, s } = arena(200);
    give(w, s, ItemKind.Bottle);
    use(d, s, ItemKind.Bottle);
    d.run(secs(0.4));
    expect(h.stunT).toBeGreaterThan(0);
    expect(h.hp * ZH.max).toBeCloseTo(95, 0);
    const before = h.hp;
    place(h, s.move.x + 60, s.move.y);
    give(w, s, ItemKind.Shotgun);
    use(d, s, ItemKind.Shotgun);
    expect((before - h.hp) * ZH.max).toBeCloseTo(25, 0);
    expect(I.shotgun.zachBlastDamage / I.shotgun.pellets).toBe(3.125);
  });

  it('galaxy gas burns 2 hp a second', () => {
    const { w, d, h } = arena(200);
    w.gases.push({ id: 200, x: h.move.x, y: h.move.y, age: 1 });
    const before = h.hp;
    d.run(secs(1));
    // Net of his regeneration.
    expect((before - h.hp) * ZH.max).toBeCloseTo(I.trap.zachDps - ZH.max / ZH.regenTime, 0);
  });

  it('at 0 he is down for 10 s, then back at half health; each down slows him for good, up to 20%', () => {
    const { w, d, h } = arena(200);
    hurtHunter(w, h, 100, null, 'bullet');
    expect(h.knockT).toBe(ZH.downTime);
    expect(h.downs).toBe(1);
    expect(buildView(w, h).self.health).toBe(Health.Downed);
    d.run(secs(ZH.downTime) + 1);
    expect(h.knockT).toBe(0);
    expect(h.hp).toBeCloseTo(0.5, 1);
    expect(hunterHealthMul(1, 1)).toBeCloseTo(0.95, 5);
    expect(hunterHealthMul(1, 9)).toBeCloseTo(0.8, 5);
  });

  it('every 25% of the bar gone is 10% slower, walking and sprinting', () => {
    expect(hunterHealthMul(1, 0)).toBe(1);
    expect(hunterHealthMul(0.8, 0)).toBe(1);
    expect(hunterHealthMul(0.75, 0)).toBeCloseTo(0.9, 5);
    expect(hunterHealthMul(0.4, 0)).toBeCloseTo(0.8, 5);
    expect(hunterHealthMul(0.2, 2)).toBeCloseTo(0.6, 5);
    const { d, h } = arena(200);
    const walk = (): number => {
      const x0 = h.move.x;
      d.run(secs(1), (p) => (p === h ? { moveX: 1 } : undefined));
      return h.move.x - x0;
    };
    const full = walk();
    h.hp = 0.45;
    const hurt = walk();
    expect(hurt / full).toBeCloseTo(0.8, 1);
  });

  it('he regenerates the whole bar in 90 s while up', () => {
    const { d, h } = arena(200);
    h.hp = 0.5;
    d.run(secs(ZH.regenTime / 2));
    expect(h.hp).toBeCloseTo(1, 1);
  });
});

describe('The Grapes of Wrath', () => {
  it('four spawn; thrown like a bottle, it stuns him for 2.5 s, flashes a picture (0.8 s) and booms', () => {
    const { w, d, h, s } = arena(250);
    expect(w.map.loot.filter((l) => l.item === 'book').length).toBe(4);
    give(w, s, ItemKind.Book);
    use(d, s, ItemKind.Book);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Bottle && e.state === 1)).toBe(true);
    d.run(secs(0.5));
    // Stunned for 2.5 s (whatever the lobby's stun scaling), less the flight time.
    expect(h.stunT).toBeGreaterThan(1.8);
    // And every ability is off for 6 s.
    expect(h.abilityLockT).toBeGreaterThan(BALANCE.hunter.bookAbilityLock - 1);
    expect(h.stunT).toBeLessThanOrEqual(I.book.stun);
    expect(h.hp * ZH.max).toBeCloseTo(95, 0);
    const book = w.events.find((e) => e.e.k === 'book');
    expect(book?.to).toEqual([h.id]);
    expect(w.events.some((e) => e.e.k === 'boom' && e.to.includes(s.id))).toBe(true);
  });
});

describe('Jaden Nguyen, revised', () => {
  function jadenLane(): { w: World; d: Driver; s: SimPlayer; c: { x: number; y: number } } {
    const { w, d, s, h, c } = arena(200);
    place(h, 60, 60);
    w.jaden.x = c.x + 60;
    w.jaden.y = c.y;
    return { w, d, s, c };
  }

  it('stops once he has taken half of the health you had when he started', () => {
    const { w, d, s, c } = jadenLane();
    s.hp = 0.6;
    s.health = Health.Wounded;
    runUntil(d, () => w.jaden.chasing);
    place(s, c.x - 150, c.y);
    d.run(secs(15));
    expect(w.jaden.chasing).toBe(false);
    expect(s.hp).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(s.hp).toBeGreaterThan(0.1);
  });

  it('stops if you get out of range', () => {
    const { w, d, s, c } = jadenLane();
    runUntil(d, () => w.jaden.chasing);
    place(s, c.x - BALANCE.jaden.loseRadius - 300, c.y);
    d.run(2);
    expect(w.jaden.chasing).toBe(false);
  });

  it('any item stuns him for 1.2 s; three kill him and he drops a 10-shot pistol', () => {
    const { w, d, s } = jadenLane();
    w.jaden.itemHit(s, 'bottle');
    expect(w.jaden.stunT).toBeCloseTo(BALANCE.jaden.stun, 5);
    const x = w.jaden.x;
    d.run(secs(0.6));
    expect(w.jaden.x).toBe(x);
    w.jaden.itemHit(s, 'shot');
    expect(w.jaden.alive).toBe(true);
    w.jaden.itemHit(s, 'bottle');
    expect(w.jaden.alive).toBe(false);
    expect(w.jaden.solid).toBe(false);
    const drop = w.drops.find((dr) => dr.kind === ItemKind.Pistol);
    expect(drop?.amount).toBe(I.pistol.shots);
  });

  it('the P250: 10 shots, 10 hp each on Zach', () => {
    const { w, d, h, s } = arena(200);
    give(w, s, ItemKind.Pistol);
    use(d, s, ItemKind.Pistol);
    expect(h.hp * ZH.max).toBeCloseTo(90, 0);
    expect(s.inv[0].amt[0]).toBe(I.pistol.shots - 1);
  });
});

describe('alert meters', () => {
  it('Shane and Jaden show how close they are to being alerted', () => {
    const { w, d, s, c } = arena(200);
    w.shane.x = c.x - 100;
    w.shane.y = c.y;
    d.run(secs(0.5));
    const rec = buildView(w, s).entities.find((e) => e.kind === EntityKind.Shane)!;
    expect(rec.extra).toBeGreaterThan(0);
    expect(w.shane.chasing).toBe(false);
  });
});

describe('Plasma.TTV', () => {
  it('turns back on his own 10 s after transforming if he has put nobody down', () => {
    const { w, d, s } = arena(200);
    w.plasma.x = 5900;
    w.plasma.y = 100;
    w.plasma.itemHit(s, 'bottle');
    expect(w.plasma.raging).toBe(true);
    d.run(secs(BALANCE.plasma.rageTime) + 2);
    expect(w.plasma.raging).toBe(false);
  });
});

describe('Waz', () => {
  function wazLane(): ReturnType<typeof arena> {
    const a = arena(200);
    a.w.waz.x = a.s.move.x + 40;
    a.w.waz.y = a.s.move.y;
    return a;
  }

  it('"lemme take a looksie": a survivor sees 10% more for good, once', () => {
    const { w, d, s } = wazLane();
    const before = visionFor(w, s);
    d.run(1);
    expect(s.prompt).toBe(Prompt.TalkWaz);
    d.tap(s.id, Btn.Interact);
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.who === 'waz' && e.e.say === 'lemme take a looksie')).toBe(true);
    expect(s.fovMul).toBeCloseTo(1.1, 5);
    expect(visionFor(w, s).prox).toBeCloseTo(before.prox * 1.1, 5);
    expect(visionFor(w, s).cone.halfAngle).toBeCloseTo(before.cone.halfAngle * 1.1, 5);
    expect(buildView(w, s).self.fovMul).toBeCloseTo(1.1, 3);
    d.run(secs(3));
    w.waz.x = s.move.x + 40;
    w.waz.y = s.move.y;
    d.run(1);
    expect(s.prompt).not.toBe(Prompt.TalkWaz);
  });

  it('a survivor slays him with one item, sees 10% less, and gets the picture', () => {
    const { w, s } = wazLane();
    w.waz.itemHit(s, 'bottle');
    expect(w.waz.alive).toBe(false);
    expect(s.fovMul).toBeCloseTo(0.9, 5);
    expect(w.events.some((e) => e.e.k === 'wazSlain' && e.to.includes(s.id))).toBe(true);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Waz)).toBe(false);
  });

  it('Zach slays him in three hits (he bolts in between) and sees 10% more', () => {
    const { w, h } = wazLane();
    w.waz.hit(h);
    expect(w.waz.alive).toBe(true);
    expect(w.waz.record().state & 1).toBe(1);
    w.waz.hit(h);
    w.waz.hit(h);
    expect(w.waz.alive).toBe(false);
    expect(h.fovMul).toBeCloseTo(1.1, 5);
    expect(w.events.some((e) => e.e.k === 'wazSlain' && e.to.includes(h.id))).toBe(true);
  });
});

describe('scent', () => {
  it('walking leaves scent too (fainter than running)', () => {
    const { w, d, s } = arena(3000);
    d.run(secs(1), (p) => (p === s ? { moveX: 1 } : undefined));
    const mine = w.trails.filter((t) => t.who === s.id && t.kind === 0);
    expect(mine.length).toBeGreaterThan(3);
    expect(w.time - mine[mine.length - 1].t).toBeGreaterThan(BALANCE.trails.walkHeadStart - 0.5);
  });
});

describe('rejoining', () => {
  it('a player who drops and rejoins gets a fresh start and can move freely again', async () => {
    const h = await createHarness(['Host', 'Guest']);
    startMatch(h, 1, 'rejoin-seed');
    const guest = h.clients[1];
    const id = guest.you;
    // Plenty of inputs first, so the old connection's sequence numbers run high.
    h.run(3000, () => guest.pushInput(idle()));
    const token = guest.token;
    guest.close();
    h.run(500);
    const back = await h.join('Guest', token);
    expect(back.you).toBe(id);
    h.run(500, () => back.pushInput(idle()));
    const sp = h.host.world!.players.get(id)!;
    const x0 = sp.move.x;
    const y0 = sp.move.y;
    h.run(2000, () => back.pushInput(move(1, 0)));
    const moved = Math.hypot(sp.move.x - x0, sp.move.y - y0);
    expect(moved).toBeGreaterThan(80);
  });
});

describe('Mr Beast bars and mini shields', () => {
  it('15 beast bars and 20 mini shields spawn, plus 2 + 2 + a duck confit by the ambulance', () => {
    const { w } = arena();
    const n = (k: string): number => w.map.loot.filter((l) => l.item === k).length;
    expect(n('beastbar')).toBe(17);
    expect(n('shield')).toBe(22);
    expect(n('confit')).toBe(I.counts.confit + 1);
  });

  it('a Mr Beast bar heals a fifth of your health', () => {
    const { w, d, s } = arena();
    s.hp = 0.5;
    s.health = Health.Wounded;
    give(w, s, ItemKind.BeastBar);
    use(d, s, ItemKind.BeastBar);
    expect(s.hp).toBeCloseTo(0.7, 5);
    expect(countOf(s, ItemKind.BeastBar)).toBe(0);
  });

  it('a mini shield takes 2 s to drink, adds a quarter bar of shield (max a full bar), and soaks damage first', () => {
    const { w, d, s } = arena(3000);
    give(w, s, ItemKind.Shield, 6);
    const slot = slotOf(s, ItemKind.Shield);
    for (let i = 0; i < 5; i++) {
      d.tap(s.id, Btn.Primary, { item: slot });
      d.run(secs(I.shield.drinkTime - 0.3), (p) => (p === s ? { item: slot } : undefined));
      expect(s.shield).toBeCloseTo(Math.min(1, i * 0.25), 5);
      d.run(secs(0.5), (p) => (p === s ? { item: slot } : undefined));
    }
    expect(s.shield).toBe(1);
    // Full: the fifth wasn't drunk.
    expect(countOf(s, ItemKind.Shield)).toBe(2);
    expect(buildView(w, s).self.shield).toBeCloseTo(1, 2);
    // Moving doesn't cancel a drink: it completes, at half speed.
    s.shield = 0.5;
    d.tap(s.id, Btn.Primary, { item: slot });
    const x0 = s.move.x;
    d.run(secs(1), (p) => (p === s ? { item: slot, moveX: 1 } : undefined));
    expect(s.move.x - x0).toBeLessThan(BALANCE.survivor.walk * 0.6);
    expect(s.move.x - x0).toBeGreaterThan(BALANCE.survivor.walk * 0.3);
    d.run(secs(2), (p) => (p === s ? { item: slot } : undefined));
    expect(s.shield).toBe(0.75);
    // Damage: the shield goes first.
    hurtSurvivor(w, s, 0.9, null, 'bottle');
    expect(s.shield).toBe(0);
    expect(s.hp).toBeCloseTo(0.85, 5);
  });
});

describe('testing mode effects', () => {
  it('plays any stun or flash on yourself at the click of a button', () => {
    const w = makeWorld({ testMode: true });
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    playTestFx(w, h, 'book');
    expect(h.stunT).toBe(I.book.stun);
    expect(w.events.some((e) => e.e.k === 'book' && e.to.includes(h.id))).toBe(true);
    playTestFx(w, s, 'waz');
    expect(w.events.some((e) => e.e.k === 'wazSlain' && e.to.includes(s.id))).toBe(true);
    playTestFx(w, s, 'stun');
    expect(s.stunT).toBeGreaterThan(0);
    playTestFx(w, h, 'down');
    expect(h.knockT).toBe(ZH.downTime);
    expect(h.downs).toBe(0);
    // Never outside testing mode.
    const n = makeWorld();
    playTestFx(n, n.players.get(2)!, 'stun');
    expect(n.players.get(2)!.stunT).toBe(0);
  });
});
