import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, Health, MoveMode } from '@manhunt/shared';
import { Driver, makeWorld, openSpot, place } from './worldHelpers';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

function setupDuel(w: World): { h: SimPlayer; s: SimPlayer; d: Driver; spot: { x: number; y: number } } {
  const spot = openSpot(w, 2);
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  place(h, spot.x, spot.y);
  place(s, spot.x + 45, spot.y);
  h.facing = 0;
  return { h, s, d: new Driver(w), spot };
}

describe('health states and the hunter', () => {
  it('Healthy -> Wounded -> Downed, with a speed burst after the first hit', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w);
    d.tap(h.id, Btn.Attack, { aim: 0 });
    d.run(10, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(s.health).toBe(Health.Wounded);
    expect(s.move.hasteT).toBeGreaterThan(0);
    expect(h.attackCd).toBeGreaterThan(0);
    place(s, h.move.x + 45, h.move.y);
    d.run(Math.ceil(BALANCE.hunter.attack.hitCooldown * 30) + 2, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    d.tap(h.id, Btn.Attack, { aim: 0 });
    d.run(10);
    expect(s.health).toBe(Health.Downed);
    expect(s.move.mode).toBe(MoveMode.Crawl);
    expect(h.stats.downs).toBe(1);
  });

  it('misses outside the swing arc and pays a recovery penalty', () => {
    const w = makeWorld();
    const { h, s, d } = setupDuel(w);
    place(s, h.move.x - 45, h.move.y);
    d.tap(h.id, Btn.Attack, { aim: 0 });
    d.run(10, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(s.health).toBe(Health.Healthy);
    expect(h.attackCd).toBeGreaterThan(0.5);
  });

  it('lag compensation hits where the hunter saw the survivor (rewind capped at 120 ms)', () => {
    const w = makeWorld({ lagMs: 100 });
    const { h, s, d } = setupDuel(w);
    // Survivor runs away along +x; history records their positions.
    place(s, h.move.x + 40, h.move.y);
    d.run(3, (p) => (p.id === s.id ? { moveX: 1, buttons: Btn.Run } : { aim: 0 }));
    const fled = s.move.x - h.move.x;
    d.run(1, (p) => (p.id === h.id ? { aim: 0, buttons: Btn.Attack } : p.id === s.id ? { moveX: 1, buttons: Btn.Run } : undefined));
    d.run(6, (p) => (p.id === s.id ? { moveX: 1, buttons: Btn.Run } : { aim: 0 }));
    expect(fled).toBeGreaterThan(40);
    expect(s.health).toBe(Health.Wounded);
  });

  it('carries a downed survivor to a stake; stage 1 times out into elimination (stage 2)', () => {
    const w = makeWorld({ survivors: 3 });
    const { h, s, d } = setupDuel(w);
    s.health = Health.Downed;
    d.run(2);
    expect(h.prompt).toBeGreaterThan(0);
    d.tap(h.id, Btn.Interact);
    d.run(Math.ceil(BALANCE.hunter.pickupTime * 30) + 2);
    expect(s.health).toBe(Health.Carried);
    expect(h.carrying).toBe(s.id);
    const stake = w.map.stakes[0];
    place(h, stake.x + 30, stake.y);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(Math.ceil(BALANCE.hunter.stakeTime * 30) + 2);
    expect(s.health).toBe(Health.Staked);
    expect(s.stakeStage).toBe(1);
    expect(w.stakes[0]).toBe(s.id);
    d.run(Math.ceil(BALANCE.objectives.stakeStageTime * 30) + 5);
    expect(s.health).toBe(Health.Eliminated);
    expect(w.stakes[0]).toBe(0);
    expect(h.stats.eliminations).toBe(1);
  });

  it('a teammate can unstake; the second staking eliminates immediately', () => {
    const w = makeWorld({ survivors: 3 });
    const { h, s, d } = setupDuel(w);
    const mate = w.players.get(3)!;
    const stake = w.map.stakes[1];
    s.health = Health.Downed;
    place(h, s.move.x - 40, s.move.y);
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
    const { h, s, d } = setupDuel(w);
    s.health = Health.Downed;
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(40);
    expect(s.health).toBe(Health.Carried);
    d.run(Math.ceil(BALANCE.survivor.wiggleTime * 30) + 5, (p) => (p.id === s.id ? { moveX: 1 } : undefined));
    expect(s.health).toBe(Health.Wounded);
    expect(h.carrying).toBe(0);
    expect(h.stunT).toBeGreaterThan(0);
  });
});

describe('objectives and win conditions', () => {
  function gearUp(w: World, s: SimPlayer, gi: number): void {
    const g = w.map.generators[gi];
    place(s, g.x + 60, g.y);
    s.fuel = 1;
    s.wire = 1;
  }

  it('parts -> repair (co-op is faster) -> gate power -> open -> escape -> survivors win', () => {
    const w = makeWorld({ survivors: 2 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const [a, b] = [w.players.get(2)!, w.players.get(3)!];
    place(h, 100, 100);
    for (let gi = 0; gi < w.balance.requiredGenerators; gi++) {
      gearUp(w, a, gi);
      place(b, a.move.x, a.move.y + 30);
      d.run(2);
      d.hold(a.id, Btn.Interact, BALANCE.survivor.installPartTime + 0.2);
      d.run(2);
      d.hold(a.id, Btn.Interact, BALANCE.survivor.installPartTime + 0.2);
      expect(w.gens[gi].fuel && w.gens[gi].wire).toBe(true);
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
    // Walk both survivors through the gate into the exit yard.
    for (const p of [a, b]) place(p, w.map.gate.x, w.map.gate.y + 30);
    d.run(90, (p) => (p === a || p === b ? { moveY: -1, buttons: Btn.Run } : undefined));
    expect(a.health).toBe(Health.Escaped);
    expect(w.result?.winner).toBe('survivors');
  });

  it('the hunter wins once enough survivors are eliminated', () => {
    const w = makeWorld({ survivors: 4 });
    const d = new Driver(w);
    // escapeNeeded = 2 of 4: eliminating 3 makes escape impossible.
    for (const id of [2, 3]) {
      const p = w.players.get(id)!;
      p.health = Health.Eliminated;
    }
    d.run(2);
    expect(w.result).toBeNull();
    w.players.get(4)!.health = Health.Eliminated;
    d.run(2);
    expect(w.result?.winner).toBe('hunters');
  });

  it('the hunter wins when time runs out', () => {
    const w = makeWorld({ survivors: 1 });
    w.time = w.balance.timeLimit - 0.05;
    new Driver(w).run(3);
    expect(w.result?.winner).toBe('hunters');
    expect(w.result?.reason).toMatch(/time/i);
  });

  it('a missed skill check regresses the generator and makes noise', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const s = w.players.get(2)!;
    gearUp(w, s, 0);
    d.run(2);
    d.hold(s.id, Btn.Interact, 1.5);
    d.run(2);
    d.hold(s.id, Btn.Interact, 1.5);
    let guard = 0;
    while (!s.skill && guard++ < 3000) d.run(1, (p) => (p === s ? { buttons: Btn.Interact } : undefined));
    expect(s.skill).not.toBeNull();
    const before = w.gens[0].progress;
    // Never answer: the host times it out as a miss.
    d.run(130, (p) => (p === s ? { buttons: Btn.Interact } : undefined));
    const events = w.events.map((e) => e.e.k);
    expect(events).toContain('skillResult');
    expect(w.gens[0].progress).toBeLessThan(before + 0.08);
    expect(w.noises.some((n) => n.kind === 'gen_explode')).toBe(true);
  });

  it('the hunter can damage a generator, which then regresses', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    w.gens[0].fuel = w.gens[0].wire = true;
    w.gens[0].progress = 0.5;
    const g = w.map.generators[0];
    place(h, g.x + 60, g.y);
    place(w.players.get(2)!, 100, 100);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(Math.ceil(BALANCE.hunter.damageGenTime * 30) + 2);
    expect(w.gens[0].regressing).toBe(true);
    const p1 = w.gens[0].progress;
    d.run(300);
    expect(w.gens[0].progress).toBeLessThan(p1);
    expect(h.stats.gensDamaged).toBe(1);
  });
});
