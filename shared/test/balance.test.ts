import { describe, expect, it } from 'vitest';
import { BALANCE, resolveBalance } from '../src/balance';

describe('auto-balance formula (pressure P = survivors / hunters, P0 = 4)', () => {
  it('uses the reference values at 1 hunter vs 4 survivors', () => {
    const b = resolveBalance({ hunters: 1, survivors: 4, difficulty: 1 });
    expect(b.pressure).toBe(4);
    expect(b.scale).toBe(1);
    expect(b.repairTime).toBe(BALANCE.objectives.repairTime);
    expect(b.hunterSpeed).toBe(BALANCE.hunter.speed);
    expect(b.stunMul).toBe(1);
    expect(b.lootMul).toBe(1);
    // required generators = clamp(ceil(S / sqrt(H)) + 1, 3, 7)
    expect(b.requiredGenerators).toBe(5);
    expect(b.totalGenerators).toBe(5 + BALANCE.objectives.extraGenerators);
    expect(b.escapeNeeded).toBe(2);
  });

  it('matches the prompt defaults: walk 120, run 190, crouch 70, Zach 205, lunge x2 for 0.6 s every 12 s', () => {
    expect(BALANCE.survivor.walk).toBe(120);
    expect(BALANCE.survivor.run).toBe(190);
    expect(BALANCE.survivor.crouch).toBe(70);
    expect(BALANCE.hunter.speed).toBe(205);
    expect(BALANCE.hunter.lunge).toMatchObject({ mul: 2, duration: 0.6, cooldown: 12 });
    expect(BALANCE.hunter.speed).toBeGreaterThan(BALANCE.survivor.run);
    expect(BALANCE.tools.stunImmunity).toBe(6);
  });

  it('keeps every lobby shape within the clamps', () => {
    for (let h = 1; h <= 9; h++) {
      for (let s = 1; h + s <= 10; s++) {
        const b = resolveBalance({ hunters: h, survivors: s, difficulty: 1 });
        expect(b.requiredGenerators).toBeGreaterThanOrEqual(3);
        expect(b.requiredGenerators).toBeLessThanOrEqual(7);
        expect(b.repairTime).toBeGreaterThanOrEqual(BALANCE.objectives.repairTime * 0.75 - 1e-9);
        expect(b.repairTime).toBeLessThanOrEqual(BALANCE.objectives.repairTime * 1.35 + 1e-9);
        expect(b.hunterSpeed).toBeGreaterThanOrEqual(BALANCE.hunter.speed * 0.95 - 1e-9);
        expect(b.hunterSpeed).toBeLessThanOrEqual(BALANCE.hunter.speed * 1.08 + 1e-9);
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
    expect(high.lootMul).toBeLessThan(low.lootMul);
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
