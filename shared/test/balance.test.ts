import { describe, expect, it } from 'vitest';
import { BALANCE, resolveBalance } from '../src/balance';

describe('auto-balance formula (pressure P = survivors / hunters, P0 = 4)', () => {
  it('uses the reference values at 1 hunter vs 4 survivors', () => {
    const b = resolveBalance({ hunters: 1, survivors: 4, difficulty: 1 });
    expect(b.pressure).toBe(4);
    expect(b.scale).toBe(1);
    expect(b.repairTime).toBe(BALANCE.objectives.repairTime);
    expect(b.hunterSpeedMul).toBe(1);
    expect(b.hunterSpeed).toBe(BALANCE.hunter.walk);
    expect(b.stunMul).toBe(1);
    // required generators = clamp(ceil(S / sqrt(H)) + 1, 3, 7); every generator is required.
    expect(b.requiredGenerators).toBe(5);
    expect(b.totalGenerators).toBe(5);
    expect(b.escapeNeeded).toBe(2);
  });

  it('movement: everything 20% faster; Zach walks 10% slower and sprints 20% faster than survivors', () => {
    expect(BALANCE.survivor.walk).toBeCloseTo(144);
    expect(BALANCE.survivor.run).toBeCloseTo(228);
    expect(BALANCE.survivor.crouch).toBeCloseTo(84);
    expect(BALANCE.hunter.walk).toBeCloseTo(BALANCE.survivor.walk * 0.9);
    expect(BALANCE.hunter.sprint).toBeCloseTo(BALANCE.survivor.run * 1.2);
    expect(BALANCE.survivor.stamina).toEqual({ max: 8, refill: 10 });
    expect(BALANCE.hunter.stamina).toEqual({ max: 6, refill: 6 });
    expect(BALANCE.sprintLockout).toBe(1.5);
  });

  it('matches the requested kit numbers', () => {
    expect(BALANCE.hunter.lunge).toMatchObject({ charges: 2, recharge: 7, duration: 0.5, hitboxMul: 1.5 });
    expect(BALANCE.hunter.attack.range).toBe(124);
    expect(BALANCE.hunter.burst.cooldown).toBe(12);
    expect(BALANCE.hunter.burst.width).toBe(BALANCE.hunter.radius * 2 * 6);
    expect(BALANCE.hunter.burst.scareTime).toBe(4);
    expect(BALANCE.hunter.hemp).toMatchObject({ duration: 8, zoomOut: 1.2, speedMul: 1.1 });
    expect(BALANCE.items.counts).toEqual({ bottle: 20, goggles: 3, confit: 6, shotgun: 2, energy: 8, trap: 8 });
    expect(BALANCE.items.maxStack).toBe(2);
    expect(BALANCE.items.goggles).toMatchObject({ meter: 15, coneMul: 1.2 });
    expect(BALANCE.items.shotgun).toMatchObject({ shells: 3, reload: 2, stun: 0.8 });
    expect(BALANCE.items.energy).toMatchObject({ duration: 20, refillMul: 1.5, bonusSec: 2 });
    expect(BALANCE.items.trap.triggerRadius).toBe(BALANCE.hunter.radius * 2 * 5);
    expect(BALANCE.items.trap.gasRadius).toBe(BALANCE.hunter.radius * 2 * 10);
    expect(BALANCE.items.trap.spreadTime).toBe(0.5);
    expect(BALANCE.xray.brightness).toBe(0.7);
    expect(BALANCE.world.treeKeep).toBe(0.75);
  });

  it('keeps every lobby shape within the clamps', () => {
    for (let h = 1; h <= 9; h++) {
      for (let s = 1; h + s <= 10; s++) {
        const b = resolveBalance({ hunters: h, survivors: s, difficulty: 1 });
        expect(b.requiredGenerators).toBeGreaterThanOrEqual(3);
        expect(b.requiredGenerators).toBeLessThanOrEqual(7);
        expect(b.repairTime).toBeGreaterThanOrEqual(BALANCE.objectives.repairTime * 0.75 - 1e-9);
        expect(b.repairTime).toBeLessThanOrEqual(BALANCE.objectives.repairTime * 1.35 + 1e-9);
        expect(b.hunterSpeedMul).toBeGreaterThanOrEqual(0.95 - 1e-9);
        expect(b.hunterSpeedMul).toBeLessThanOrEqual(1.08 + 1e-9);
        expect(b.stunMul).toBeGreaterThanOrEqual(0.75 - 1e-9);
        expect(b.stunMul).toBeLessThanOrEqual(1.3 + 1e-9);
        expect(b.escapeNeeded).toBeGreaterThanOrEqual(1);
        expect(b.escapeNeeded).toBeLessThanOrEqual(s);
      }
    }
  });

  it('more survivors per hunter means a harder job for each survivor', () => {
    const low = resolveBalance({ hunters: 2, survivors: 2, difficulty: 1 });
    const high = resolveBalance({ hunters: 1, survivors: 9, difficulty: 1 });
    expect(high.repairTime).toBeGreaterThan(low.repairTime);
    expect(high.hunterSpeed).toBeGreaterThan(low.hunterSpeed);
    expect(high.stunMul).toBeLessThan(low.stunMul);
    expect(high.requiredGenerators).toBeGreaterThan(low.requiredGenerators);
  });

  it('applies the lobby difficulty scaler and escape fraction', () => {
    const easy = resolveBalance({ hunters: 1, survivors: 4, difficulty: 0.5 });
    const hard = resolveBalance({ hunters: 1, survivors: 4, difficulty: 1.5 });
    expect(hard.repairTime).toBeGreaterThan(easy.repairTime);
    expect(hard.stunMul).toBeLessThan(easy.stunMul);
    expect(resolveBalance({ hunters: 1, survivors: 4, difficulty: 9 }).difficulty).toBe(1.5);
    expect(resolveBalance({ hunters: 1, survivors: 4, difficulty: 1, escapeFraction: 1 }).escapeNeeded).toBe(4);
    expect(resolveBalance({ hunters: 1, survivors: 5, difficulty: 1, escapeFraction: 0.5 }).escapeNeeded).toBe(3);
  });
});
