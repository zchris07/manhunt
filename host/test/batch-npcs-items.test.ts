import { describe, expect, it } from 'vitest';
import { Action, BALANCE, Btn, EntityKind, Health, ItemKind, Prompt, maxStamina } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, parkChris, parkSexton, parkShane, place } from './worldHelpers';
import { buildView } from '../src/sim/view';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const I = BALANCE.items;

/** Zach far away, two survivors, every NPC parked out of the way, and a clear lane. */
function setup(): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; m: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  w.marc.x = 60;
  w.marc.y = 3000;
  w.plasma.x = 5940;
  w.plasma.y = 3000;
  const c = clearLane(w, 450);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  const m = w.players.get(3)!;
  place(h, 60, 60);
  place(s, c.x - 300, c.y);
  place(m, 5900, 5900);
  return { w, d: new Driver(w), h, s, m, c };
}

const throwBottle = (d: Driver, p: SimPlayer, aim = 0): void => {
  p.inv[ItemKind.Bottle] = Math.max(1, p.inv[ItemKind.Bottle]);
  d.tap(p.id, Btn.Primary, { item: ItemKind.Bottle, aim, aimDist: 100 });
};
const shoot = (d: Driver, p: SimPlayer, aim = 0): void => {
  if (p.inv[ItemKind.Shotgun] <= 0) {
    p.inv[ItemKind.Shotgun] = 1;
    p.shells = [I.shotgun.shells];
  }
  d.tap(p.id, Btn.Primary, { item: ItemKind.Shotgun, aim });
};

describe('items', () => {
  it('energy drink: the sprint meter fills at once, and you walk up to 15% faster', () => {
    const { d, s } = setup();
    s.move.stamina = 0.5;
    s.inv[ItemKind.Energy] = 1;
    d.tap(s.id, Btn.Primary, { item: ItemKind.Energy });
    expect(s.move.stamina).toBeCloseTo(maxStamina('survivor', s.move.boostT), 1);
    const x0 = s.move.x;
    d.run(secs(1), (p) => (p === s ? { moveX: 1 } : undefined));
    const v = s.move.x - x0;
    expect(v).toBeGreaterThan(BALANCE.survivor.walk * 1.1);
    expect(v).toBeLessThan(BALANCE.survivor.walk * 1.16);
  });

  it('a galaxy gas trap takes 2 s to plant, and moving cancels it', () => {
    const { w, d, s } = setup();
    s.inv[ItemKind.Trap] = 2;
    d.tap(s.id, Btn.Primary, { item: ItemKind.Trap });
    expect(s.action).toBe(Action.Plant);
    d.run(secs(1), (p) => (p === s ? { moveX: 1, item: ItemKind.Trap } : undefined));
    expect(s.action).toBe(Action.None);
    expect(w.traps.length).toBe(0);
    d.tap(s.id, Btn.Primary, { item: ItemKind.Trap });
    d.run(secs(I.trap.plantTime - 0.2), (p) => (p === s ? { item: ItemKind.Trap } : undefined));
    expect(w.traps.length).toBe(0);
    d.run(secs(0.4), (p) => (p === s ? { item: ItemKind.Trap } : undefined));
    expect(w.traps.length).toBe(1);
    expect(s.inv[ItemKind.Trap]).toBe(1);
  });

  it('G drops one of the selected item; a teammate picks it up', () => {
    const { w, d, s, m } = setup();
    s.inv[ItemKind.Bottle] = 2;
    d.tap(s.id, Btn.Drop, { item: ItemKind.Bottle });
    expect(s.inv[ItemKind.Bottle]).toBe(1);
    expect(w.drops.length).toBe(1);
    expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Drop && (e.extra & 7) === ItemKind.Bottle)).toBe(true);
    const dr = w.drops[0];
    place(m, dr.x + 20, dr.y);
    d.run(1);
    expect(m.prompt).toBe(Prompt.PickDrop);
    d.tap(m.id, Btn.Interact);
    expect(m.inv[ItemKind.Bottle]).toBe(1);
    expect(w.drops.length).toBe(0);
  });

  it('bottles hit other survivors for a fifth of their health (they flinch), never the thrower', () => {
    const { w, d, s, m, c } = setup();
    place(m, c.x + 200, c.y);
    throwBottle(d, s);
    d.run(secs(1.2));
    expect(m.hp).toBeCloseTo(1 - I.bottle.damage, 3);
    expect(m.health).toBe(Health.Wounded);
    expect(s.hp).toBe(1);
    expect(w.events.some((e) => e.e.k === 'hit' && e.e.victim === m.id && e.e.w === 'bottle')).toBe(true);
  });

  it('the shotgun fires 8 pellets that fly until they hit; 15% each on a survivor', () => {
    const { w, d, s, m, c } = setup();
    place(m, s.move.x + 70, c.y);
    shoot(d, s);
    const shot = w.events.find((e) => e.e.k === 'shot')!.e as { p: number[] };
    expect(shot.p.length).toBe(I.shotgun.pellets * 2);
    const hitCount = Math.round((1 - m.hp) / I.shotgun.pelletDamage);
    expect(hitCount).toBeGreaterThan(3);
    // Pellets that missed carry on far past the old 420 u range.
    place(m, 5900, 5900);
    const h = w.players.get(1)!;
    place(h, c.x + 400, c.y);
    s.reloadT = 0;
    d.run(secs(I.shotgun.reload) + 1);
    shoot(d, s);
    expect(h.stunT > 0 || h.immuneT > 0).toBe(true);
  });

  it('shotgun pellets shatter windows and fly on through', () => {
    const { w, d, s } = setup();
    const i = w.geo.windowSegs.findIndex(() => true);
    const ms = w.geo.moveSeg;
    const o = w.geo.windowSegs[i] * 4;
    const mx = (ms[o] + ms[o + 2]) / 2;
    const my = (ms[o + 1] + ms[o + 3]) / 2;
    const nx = -(ms[o + 3] - ms[o + 1]);
    const ny = ms[o + 2] - ms[o];
    const l = Math.hypot(nx, ny);
    place(s, mx + (nx / l) * 60, my + (ny / l) * 60);
    shoot(d, s, Math.atan2(-ny, -nx));
    expect(w.windowsBroken[i]).toBe(true);
  });
});

describe('NPCs and items', () => {
  it('galaxy gas makes an alerted Shane Jeans give up', () => {
    const { w, d, s } = setup();
    w.shane.x = s.move.x + 40;
    w.shane.y = s.move.y;
    d.run(1);
    expect(w.shane.chasing).toBe(true);
    w.gases.push({ id: 200, x: w.shane.x, y: w.shane.y, age: 1 });
    d.run(2);
    expect(w.shane.chasing).toBe(false);
  });

  it('Chris Zelley only flinches at a bottle', () => {
    const { w, d, s, c } = setup();
    w.chris.x = c.x;
    w.chris.y = c.y;
    throwBottle(d, s);
    d.run(secs(0.6));
    expect(w.chris.hp).toBe(BALANCE.chris.hp);
    expect(w.chris.mode).not.toBe('flee');
  });
});

describe('Sexton Science self-defense', () => {
  function sextonLane(): ReturnType<typeof setup> {
    const t = setup();
    t.w.sexton.x = t.c.x - 50;
    t.w.sexton.y = t.c.y;
    t.w.sexton.mode = 'idle';
    return t;
  }

  it("a survivor's items can't kill him: he turns on every survivor with a Hemp Beam, three times, then flees", () => {
    const { w, d, s, m, c } = sextonLane();
    const sx = w.sexton;
    throwBottle(d, s);
    d.run(secs(0.5));
    expect(sx.alive).toBe(true);
    expect(sx.defending).toBe(true);
    // Hit again while defending: a short stun.
    shoot(d, s);
    expect(sx.stunT).toBeGreaterThan(0.2);
    expect(sx.alive).toBe(true);
    // The other survivor is a target too.
    place(m, c.x - 250, c.y + 40);
    let beams = 0;
    let wasBeaming = false;
    for (let t = 0; t < secs(40); t++) {
      d.run(1);
      if (sx.beaming && !wasBeaming) beams++;
      wasBeaming = sx.beaming;
      if (beams === 1 && sx.beaming) expect(buildView(w, s).entities.some((e) => e.kind === EntityKind.Beam)).toBe(true);
    }
    expect(beams).toBe(BALANCE.sexton.defense.attacks);
    expect(sx.phase).toBe('flee');
    // Beam hits take a third of a survivor's health each.
    const lost = 2 - s.hp - m.hp;
    expect(lost).toBeGreaterThan(0.3);
    expect(Math.round(lost * 3) / 3).toBeCloseTo(lost, 2);
  });

  it('he calms down once no survivor has been near for 10 s', () => {
    const { w, d, s, m } = sextonLane();
    throwBottle(d, s);
    d.run(secs(0.5));
    expect(w.sexton.defending).toBe(true);
    place(s, 200, 5800);
    place(m, 5800, 5800);
    d.run(secs(BALANCE.sexton.defense.resetAfter - 1));
    expect(w.sexton.defending).toBe(true);
    d.run(secs(2));
    expect(w.sexton.defending).toBe(false);
  });

  it('bottles and gas slow or stun him while defending', () => {
    const { w, d, s } = sextonLane();
    throwBottle(d, s);
    d.run(secs(0.4));
    throwBottle(d, s);
    d.run(secs(0.4));
    expect(w.sexton.hurtT).toBeGreaterThan(0);
    expect(BALANCE.sexton.defense.bottleStun).toBe(0.1);
    expect(BALANCE.sexton.defense.shotStun).toBe(0.3);
  });
});

describe('Marc Cortez', () => {
  it('starts in the warehouse; talking heals you to full and gives duck confit once', () => {
    const { w, d, s } = setup();
    const wh = w.map.warehouse;
    const fresh = makeWorld({ survivors: 2 });
    expect(fresh.marc.x).toBeGreaterThan(wh.x);
    expect(fresh.marc.x).toBeLessThan(wh.x + wh.w);
    w.marc.x = s.move.x + 40;
    w.marc.y = s.move.y;
    s.hp = 0.4;
    s.health = Health.Wounded;
    d.run(1);
    expect(s.prompt).toBe(Prompt.TalkMarc);
    d.tap(s.id, Btn.Interact);
    expect(s.hp).toBe(1);
    expect(s.health).toBe(Health.Healthy);
    expect(s.confit).toBe(1);
    s.confit = 0;
    d.run(secs(BALANCE.marc.talkCooldown) + 1);
    d.tap(s.id, Btn.Interact);
    expect(s.confit).toBe(0);
  });

  it("Zach can't hurt him: he just complains and stands there", () => {
    const { w, d, h, c } = setup();
    w.marc.x = c.x + 60;
    w.marc.y = c.y;
    place(h, c.x, c.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(6, (p) => (p === h ? { aim: 0 } : undefined));
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.who === 'marc' && e.e.say === 'Hey man, what the heck?')).toBe(true);
    const x = w.marc.x;
    d.run(secs(1));
    expect(w.marc.x).toBe(x);
    d.run(secs(1));
    place(h, w.marc.x - 60, w.marc.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(6, (p) => (p === h ? { aim: 0 } : undefined));
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.say === 'Cut it out')).toBe(true);
  });
});

describe('Plasma.TTV', () => {
  function plasmaLane(): ReturnType<typeof setup> {
    const t = setup();
    t.w.plasma.x = t.c.x - 100;
    t.w.plasma.y = t.c.y;
    t.w.plasma.mode = 'idle';
    return t;
  }

  it('hit him and GAMER RAGE: 2 s to transform, then he punches his attacker down and turns back', () => {
    const { w, d, s } = plasmaLane();
    const pl = w.plasma;
    throwBottle(d, s);
    d.run(secs(0.4));
    expect(pl.mode).toBe('transform');
    d.run(secs(BALANCE.plasma.transformTime - 0.6));
    expect(pl.mode).toBe('transform');
    d.run(secs(0.4));
    expect(pl.mode).toBe('rage');
    for (let t = 0; t < secs(15) && s.health !== Health.Downed; t++) d.run(1);
    expect(s.health).toBe(Health.Downed);
    expect(pl.mode).toBe('revert');
    d.run(secs(1.2));
    expect(pl.beast).toBe(false);
  });

  it('Zach who slashes him gets chased and knocked out for 6 s, then gets back up', () => {
    const { w, d, h } = plasmaLane();
    const pl = w.plasma;
    place(h, pl.x - 60, pl.y);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(6, (p) => (p === h ? { aim: 0 } : undefined));
    expect(pl.target).toBe(h.id);
    for (let t = 0; t < secs(15) && h.knockT <= 0; t++) d.run(1);
    expect(h.knockT).toBeGreaterThan(5);
    const view = buildView(w, h);
    expect(view.self.health).toBe(Health.Downed);
    d.run(secs(BALANCE.plasma.zachKnockTime + 0.2));
    expect(h.knockT).toBe(0);
    expect(h.hp).toBe(1);
  });

  it('get away for 10 s and he calms down; items stun him and gas blinds him', () => {
    const { w, d, s, m } = plasmaLane();
    const pl = w.plasma;
    throwBottle(d, s);
    d.run(secs(BALANCE.plasma.transformTime + 0.5));
    throwBottle(d, s, Math.atan2(pl.y - s.move.y, pl.x - s.move.x));
    for (let t = 0; t < secs(1) && pl.stunT <= 0; t++) d.run(1);
    expect(pl.stunT).toBeGreaterThan(0);
    place(s, 200, 5800);
    place(m, 5800, 5800);
    d.run(secs(BALANCE.plasma.escapeTime + 1));
    expect(pl.raging).toBe(false);
  });

  it('talk to him: "ggs" and a golden pump (5 shells, half the reload) that takes the shotgun slot', () => {
    const { w, d, s } = plasmaLane();
    s.inv[ItemKind.Shotgun] = 1;
    s.shells = [3];
    w.plasma.x = s.move.x + 40;
    w.plasma.y = s.move.y;
    d.run(1);
    expect(s.prompt).toBe(Prompt.TalkPlasma);
    d.tap(s.id, Btn.Interact);
    expect(w.events.some((e) => e.e.k === 'npc' && e.e.say === 'ggs')).toBe(true);
    expect(s.golden).toBe(true);
    expect(s.inv[ItemKind.Shotgun]).toBe(1);
    expect(s.shells).toEqual([I.golden.shells]);
    // The old shotgun went on the ground.
    expect(w.drops.some((dr) => dr.kind === ItemKind.Shotgun && !dr.golden)).toBe(true);
    expect(I.golden.reload).toBe(I.shotgun.reload / 2);
    // Only once each.
    d.run(1);
    expect(s.prompt).not.toBe(Prompt.TalkPlasma);
  });

  it("Zach's golden pump replaces the machete for 10 shots: 9% a pellet, a stun and a shove", () => {
    const { w, d, h, s, c } = plasmaLane();
    place(h, w.plasma.x - 40, w.plasma.y);
    d.run(1);
    expect(h.prompt).toBe(Prompt.TalkPlasma);
    d.tap(h.id, Btn.Interact);
    expect(h.pump).toBe(I.zachPump.shots);
    w.plasma.x = 5940;
    w.plasma.y = 3000;
    place(h, c.x - 150, c.y);
    place(s, c.x - 90, c.y);
    const x0 = s.move.x;
    d.tap(h.id, Btn.Primary, { aim: 0 });
    expect(h.pump).toBe(I.zachPump.shots - 1);
    expect(s.hp).toBeLessThan(1 - I.zachPump.pelletDamage * 3 + 0.001);
    expect(h.chargeT).toBe(-1);
    d.run(3);
    expect(s.move.x).toBeGreaterThan(x0 + 5);
  });
});
