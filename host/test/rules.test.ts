import { describe, expect, it } from 'vitest';
import { BALANCE, BarricadeState, Btn, Health, MoveMode, Prompt } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, openSpot, parkSexton, place } from './worldHelpers';
import { swipeDamage } from '../src/sim/combat';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);

function setupDuel(w: World, dist = 60): { h: SimPlayer; s: SimPlayer; d: Driver; spot: { x: number; y: number } } {
  const spot = openSpot(w, 2);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  parkSexton(w);
  place(h, spot.x, spot.y);
  place(s, spot.x + dist, spot.y);
  for (const q of w.order) if (q !== h && q !== s) place(q, 5800, 5800 - q.id * 40);
  h.facing = 0;
  return { h, s, d: new Driver(w), spot };
}

describe('health states and the machete swipe', () => {
  it('each swipe takes a third of their health (Wounded), three down them, with a speed burst', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(10, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(s.health).toBe(Health.Wounded);
    expect(s.hp).toBeCloseTo(2 / 3, 3);
    expect(s.move.hasteT).toBeGreaterThan(0);
    expect(h.attackCd).toBeGreaterThan(0);
    for (const left of [1 / 3, 0]) {
      place(s, h.move.x + 60, h.move.y);
      d.run(secs(BALANCE.hunter.attack.hitCooldown) + 2, (p) => (p.id === h.id ? { aim: 0 } : undefined));
      place(s, h.move.x + 60, h.move.y);
      d.tap(h.id, Btn.Primary, { aim: 0 });
      d.run(10);
      expect(s.hp).toBeCloseTo(left, 3);
    }
    expect(s.health).toBe(Health.Downed);
    expect(s.move.mode).toBe(MoveMode.Crawl);
    expect(h.stats.downs).toBe(1);
  });

  it('the swipe reaches twice as far as before (124 u) but not behind him', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w, 115);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(10, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(s.health).toBe(Health.Wounded);
    // Behind him: a miss, with a short recovery.
    const w2 = makeWorld();
    const duel = setupDuel(w2);
    place(duel.s, duel.h.move.x - 60, duel.h.move.y);
    duel.d.tap(duel.h.id, Btn.Primary, { aim: 0 });
    duel.d.run(10, (p) => (p.id === duel.h.id ? { aim: 0 } : undefined));
    expect(duel.s.health).toBe(Health.Healthy);
    expect(duel.h.stats.hits).toBe(0);
    // Out of reach in front: also a miss.
    const w3 = makeWorld();
    const far = setupDuel(w3, 170);
    far.d.tap(far.h.id, Btn.Primary, { aim: 0 });
    far.d.run(10, (p) => (p.id === far.h.id ? { aim: 0 } : undefined));
    expect(far.s.health).toBe(Health.Healthy);
  });

  it('holding left click charges a heavy swipe: longer reach, and it takes two thirds of their health', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w, 150);
    const c = clearLane(w, 300);
    place(h, c.x, c.y);
    place(s, c.x + 150, c.y);
    const C = BALANCE.hunter.attack.charge;
    d.run(secs(C.max) + 1, (p) => (p.id === h.id ? { buttons: Btn.Primary, aim: 0 } : undefined));
    expect(h.chargeT).toBeGreaterThanOrEqual(C.heavyAt);
    expect(s.health).toBe(Health.Healthy);
    d.run(10, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(h.chargeT).toBe(-1);
    expect(s.health).toBe(Health.Wounded);
    expect(s.hp).toBeCloseTo(1 / 3, 3);
  });

  it('a half-charged swipe does proportionally more than a tap', () => {
    expect(swipeDamage(0)).toBeCloseTo(1 / 3, 5);
    const C = BALANCE.hunter.attack;
    expect(swipeDamage(C.damage.tapGrace)).toBeCloseTo(1 / 3, 5);
    expect(swipeDamage((C.charge.heavyAt + C.damage.tapGrace) / 2)).toBeCloseTo(0.5, 5);
    expect(swipeDamage(BALANCE.hunter.attack.charge.max)).toBeCloseTo(2 / 3, 5);
  });

  it('the swing is announced so everyone nearby sees the swipe animation', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w);
    d.tap(h.id, Btn.Primary, { aim: 0 });
    d.run(6, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    const swing = w.events.find((e) => e.e.k === 'swing');
    expect(swing).toBeTruthy();
    expect(swing!.to).toContain(s.id);
  });

  it('lag compensation hits where the hunter saw the survivor (rewind capped at 120 ms)', () => {
    const w = makeWorld({ lagMs: 100 });
    const { h, s, d } = setupDuel(w);
    place(s, h.move.x + 100, h.move.y);
    d.run(3, (p) => (p.id === s.id ? { moveX: 1, buttons: Btn.Run } : { aim: 0 }));
    const fled = s.move.x - h.move.x;
    d.run(1, (p) => (p.id === h.id ? { aim: 0, buttons: Btn.Primary } : p.id === s.id ? { moveX: 1, buttons: Btn.Run } : undefined));
    d.run(6, (p) => (p.id === s.id ? { moveX: 1, buttons: Btn.Run } : { aim: 0 }));
    expect(fled).toBeGreaterThan(100);
    expect(s.health).toBe(Health.Wounded);
  });

  it('carries a downed survivor to a stake; stage 1 times out into elimination (stage 2)', () => {
    const w = makeWorld({ survivors: 3 });
    const { h, s, d } = setupDuel(w, 45);
    s.health = Health.Downed;
    d.run(2);
    expect(h.prompt).toBe(Prompt.PickUp);
    d.tap(h.id, Btn.Interact);
    d.run(secs(BALANCE.hunter.pickupTime) + 2);
    expect(s.health).toBe(Health.Carried);
    expect(h.carrying).toBe(s.id);
    const stake = w.map.stakes[0];
    place(h, stake.x + 30, stake.y);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(secs(BALANCE.hunter.stakeTime) + 2);
    expect(s.health).toBe(Health.Staked);
    expect(s.stakeStage).toBe(1);
    expect(w.stakes[0]).toBe(s.id);
    d.run(secs(BALANCE.objectives.stakeStageTime) + 5);
    expect(s.health).toBe(Health.Eliminated);
    expect(w.stakes[0]).toBe(0);
    expect(h.stats.eliminations).toBe(1);
  });

  it('a teammate can unstake; the second staking eliminates immediately', () => {
    const w = makeWorld({ survivors: 3 });
    const { h, s, d } = setupDuel(w, 45);
    const mate = w.players.get(3)!;
    const stake = w.map.stakes[1];
    s.health = Health.Downed;
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    place(h, stake.x + 30, stake.y);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    expect(s.health).toBe(Health.Staked);
    place(h, stake.x + 900, stake.y);
    place(mate, stake.x - 40, stake.y);
    d.run(2);
    d.hold(mate.id, Btn.Interact, BALANCE.survivor.unstakeTime + 0.3);
    expect(s.health).toBe(Health.Wounded);
    expect(mate.stats.unstakes).toBe(1);
    // Down and stake again: stage 2 means elimination.
    s.health = Health.Downed;
    place(h, s.move.x - 40, s.move.y);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    place(h, stake.x + 30, stake.y);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    expect(s.health).toBe(Health.Eliminated);
  });

  it('revive (8 s) and heal (12 s) by a teammate', () => {
    const w = makeWorld({ survivors: 2 });
    parkSexton(w);
    const spot = openSpot(w, 3);
    const a = w.players.get(2)!;
    const b = w.players.get(3)!;
    place(w.players.get(1)!, spot.x + 2000, spot.y);
    place(a, spot.x, spot.y);
    place(b, spot.x + 40, spot.y);
    a.health = Health.Downed;
    const d = new Driver(w);
    d.run(2);
    d.hold(b.id, Btn.Interact, BALANCE.survivor.reviveTime + 0.3);
    expect(a.health).toBe(Health.Wounded);
    d.run(2);
    d.hold(b.id, Btn.Interact, BALANCE.survivor.healTime + 0.3);
    expect(a.health).toBe(Health.Healthy);
    expect(b.stats.revives).toBe(1);
    expect(b.stats.heals).toBe(1);
  });

  it('a carried survivor can wiggle free, stunning the hunter', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w, 45);
    s.health = Health.Downed;
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    expect(s.health).toBe(Health.Carried);
    d.run(secs(BALANCE.survivor.wiggleTime) + 5, (p) => (p.id === s.id ? { moveX: 1 } : undefined));
    expect(s.health).toBe(Health.Wounded);
    expect(h.carrying).toBe(0);
    expect(h.stunT).toBeGreaterThan(0);
  });
});

describe('barricades and doors', () => {
  it('a slammed barricade stuns Zach; two machete swipes break it; nobody can vault it', () => {
    const w = makeWorld({ survivors: 2 });
    parkSexton(w);
    const d = new Driver(w);
    const b = w.map.barricades[0];
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    const nx = -Math.sin(b.angle);
    const ny = Math.cos(b.angle);
    place(s, b.x + nx * 45, b.y + ny * 45);
    place(h, b.x, b.y);
    place(w.players.get(3)!, 5800, 5800);
    d.run(2);
    expect(s.prompt2).toBe(Prompt.DropBarricade);
    d.tap(s.id, Btn.Space);
    expect(w.barricades[0]).toBe(BarricadeState.Down);
    expect(h.stunT).toBeGreaterThan(0);
    expect(w.geo.isDynamicActive(b.dyn)).toBe(true);
    // No vaulting: Space does nothing next to a dropped barricade.
    d.run(2);
    const before = { x: s.move.x, y: s.move.y };
    d.tap(s.id, Btn.Space);
    d.run(30);
    expect(Math.hypot(s.move.x - before.x, s.move.y - before.y)).toBeLessThan(1);
    // Zach swipes it twice once the stun wears off.
    d.run(secs(BALANCE.items.barricade.stun * w.balance.stunMul) + 2);
    place(s, 5800, 200);
    place(h, b.x - nx * 50, b.y - ny * 50);
    const aim = Math.atan2(b.y - h.move.y, b.x - h.move.x);
    d.run(2, (p) => (p === h ? { aim } : undefined));
    d.tap(h.id, Btn.Primary, { aim });
    d.run(10, (p) => (p === h ? { aim } : undefined));
    expect(w.barricadeHits[0]).toBe(1);
    expect(w.barricades[0]).toBe(BarricadeState.Down);
    d.run(secs(BALANCE.hunter.attack.hitCooldown) + 2, (p) => (p === h ? { aim } : undefined));
    d.tap(h.id, Btn.Primary, { aim });
    d.run(10, (p) => (p === h ? { aim } : undefined));
    expect(w.barricades[0]).toBe(BarricadeState.Broken);
    expect(w.geo.isDynamicActive(b.dyn)).toBe(false);
  });

  it('anyone can open and close doors with E; closed doors block movement and sight', () => {
    const w = makeWorld({ survivors: 1 });
    parkSexton(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    const at = (dd: (typeof w.map.doors)[number]) => {
      const mx = dd.hx + Math.cos(dd.angle) * dd.length * 0.5;
      const my = dd.hy + Math.sin(dd.angle) * dd.length * 0.5;
      const nx = -Math.sin(dd.angle);
      const ny = Math.cos(dd.angle);
      place(s, mx + nx * 35, my + ny * 35);
      place(h, mx - nx * 35, my - ny * 35);
      d.run(2);
      return { mx, my, nx, ny };
    };
    // A closed door with nothing else (lockers, loot) competing for the E prompt.
    const door = w.map.doors.find((dd) => w.map.dynamicSegments[dd.dyn].active && (at(dd), s.prompt === Prompt.OpenDoor))!;
    const id = door.id;
    const { mx, my, nx, ny } = at(door);
    expect(w.doors[id]).toBe(false);
    expect(w.geo.hasLineOfSight(s.move.x, s.move.y, h.move.x, h.move.y)).toBe(false);
    expect(s.prompt).toBe(Prompt.OpenDoor);
    d.tap(s.id, Btn.Interact);
    expect(w.doors[id]).toBe(true);
    expect(w.geo.hasLineOfSight(s.move.x, s.move.y, h.move.x, h.move.y)).toBe(true);
    // Zach closes it again.
    d.run(15);
    expect(h.prompt).toBe(Prompt.CloseDoor);
    d.tap(h.id, Btn.Interact);
    expect(w.doors[id]).toBe(false);
    // Walking into a closed door goes nowhere.
    const y0 = s.move.y;
    d.run(30, (p) => (p === s ? { moveX: -nx, moveY: -ny } : undefined));
    expect(Math.abs((s.move.x - mx) * nx + (s.move.y - my) * ny)).toBeGreaterThan(10);
    void y0;
    // Zach smashes the closed door with two swipes; it stays open for good.
    place(s, 5800, 5800);
    const aim = Math.atan2(ny, nx);
    const swipe = (): void => {
      d.tap(h.id, Btn.Primary, { aim });
      d.run(secs(BALANCE.hunter.attack.hitCooldown + BALANCE.hunter.attack.windup) + 2, (p) => (p === h ? { aim } : undefined));
    };
    swipe();
    expect(w.doorHits[id]).toBe(1);
    expect(w.doors[id]).toBe(false);
    swipe();
    expect(w.doorBroken[id]).toBe(true);
    expect(w.doors[id]).toBe(true);
    expect(w.geo.hasLineOfSight(mx - nx * 30, my - ny * 30, mx + nx * 30, my + ny * 30)).toBe(true);
    expect(h.prompt).not.toBe(Prompt.CloseDoor);
  });
});

describe('objectives and win conditions', () => {
  it('start every generator (co-op is faster) -> gate power -> open -> escape -> survivors win', () => {
    const w = makeWorld({ survivors: 2 });
    parkSexton(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const [a, b] = [w.players.get(2)!, w.players.get(3)!];
    place(h, 100, 100);
    expect(w.gens.length).toBe(w.balance.requiredGenerators);
    for (let gi = 0; gi < w.gens.length; gi++) {
      const g = w.map.generators[gi];
      place(a, g.x + 60, g.y);
      place(b, g.x + 60, g.y + 30);
      d.run(2);
      expect(a.prompt).toBe(Prompt.Repair);
      const t0 = w.time;
      // Both repair; answer every skill check correctly.
      let guard = 0;
      while (!w.gens[gi].repaired && guard++ < 30 * 200) {
        for (const p of [a, b]) p.skill = null;
        d.run(1, (p) => (p === a || p === b ? { buttons: Btn.Interact } : undefined));
      }
      const took = w.time - t0;
      expect(w.gens[gi].repaired).toBe(true);
      // Two survivors repair faster than one would (coop multiplier 1.7).
      expect(took).toBeLessThan(w.balance.repairTime / 1.5);
      d.run(2);
    }
    expect(w.gate.powered).toBe(true);
    place(a, w.map.gate.leverX, w.map.gate.leverY + 10);
    d.run(2);
    d.hold(a.id, Btn.Interact, BALANCE.objectives.gateOpenTime + 0.5);
    expect(w.gate.open).toBe(true);
    for (const p of [a, b]) place(p, w.map.gate.x, w.map.gate.y + 30);
    d.run(90, (p) => (p === a || p === b ? { moveY: -1, buttons: Btn.Run } : undefined));
    expect(a.health).toBe(Health.Escaped);
    expect(w.result?.winner).toBe('survivors');
  });

  it('the night goes on until every survivor has escaped, is down or is gone', () => {
    const w = makeWorld({ survivors: 4 });
    const d = new Driver(w);
    for (const id of [2, 3, 4]) w.players.get(id)!.health = Health.Eliminated;
    d.run(2);
    // One survivor is still standing: no result yet, whatever the count.
    expect(w.result).toBeNull();
    w.players.get(5)!.health = Health.Downed;
    d.run(2);
    expect(w.result?.winner).toBe('hunters');
    expect(w.result?.reason).toMatch(/incapacitated/);
  });

  it('the survivors win if at least half of them escaped by the end', () => {
    const w = makeWorld({ survivors: 4 });
    const d = new Driver(w);
    for (const id of [2, 3]) w.players.get(id)!.health = Health.Escaped;
    w.players.get(4)!.health = Health.Eliminated;
    d.run(2);
    expect(w.result).toBeNull();
    w.players.get(5)!.health = Health.Staked;
    d.run(2);
    expect(w.result?.winner).toBe('survivors');
  });

  it('the hunter wins when time runs out', () => {
    const w = makeWorld({ survivors: 1 });
    w.time = w.balance.timeLimit - 0.05;
    new Driver(w).run(3);
    expect(w.result?.winner).toBe('hunters');
    expect(w.result?.reason).toMatch(/time/i);
  });

  it('a missed skill check regresses the generator with a visible blow-up', () => {
    const w = makeWorld({ survivors: 1 });
    parkSexton(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    const g = w.map.generators[0];
    place(s, g.x + 60, g.y);
    place(w.players.get(1)!, 100, 100);
    d.run(2);
    let guard = 0;
    while (!s.skill && guard++ < 3000) d.run(1, (p) => (p === s ? { buttons: Btn.Interact } : undefined));
    expect(s.skill).not.toBeNull();
    const before = w.gens[0].progress;
    // Never answer: the host times it out as a miss.
    d.run(130, (p) => (p === s ? { buttons: Btn.Interact } : undefined));
    expect(w.events.map((e) => e.e.k)).toContain('skillResult');
    expect(w.gens[0].progress).toBeLessThan(before + 0.08);
    expect(w.events.some((e) => e.e.k === 'noise' && e.e.s === 'gen_explode')).toBe(true);
  });

  it('the hunter can damage a generator, which then regresses', () => {
    const w = makeWorld({ survivors: 1 });
    parkSexton(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    w.gens[0].progress = 0.5;
    const g = w.map.generators[0];
    place(h, g.x + 60, g.y);
    place(w.players.get(2)!, 100, 100);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(secs(BALANCE.hunter.damageGenTime) + 2);
    expect(w.gens[0].regressing).toBe(true);
    const p1 = w.gens[0].progress;
    d.run(300);
    expect(w.gens[0].progress).toBeLessThan(p1);
    expect(h.stats.gensDamaged).toBe(1);
  });
});
