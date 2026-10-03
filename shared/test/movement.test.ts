import { describe, expect, it } from 'vitest';
import { BALANCE, TICK_DT } from '../src/balance';
import { Geometry } from '../src/geometry';
import { Btn, emptyInput, type InputCmd } from '../src/sim/input';
import { dashDistance, maxStamina, newMoveState, stepMovement, type MoveContext, type MoveState } from '../src/sim/movement';
import { MoveMode } from '../src/sim/types';

const open = new Geometry(20000, 20000, [], []);
const SURV: MoveContext = { role: 'survivor', hunterSpeedMul: 1, carrying: false };
const ZACH: MoveContext = { role: 'hunter', hunterSpeedMul: 1, carrying: false };

function run(s: MoveState, ctx: MoveContext, sec: number, cmd: Partial<InputCmd>): number {
  const x0 = s.x;
  const n = Math.round(sec / TICK_DT);
  for (let i = 0; i < n; i++) stepMovement(s, { ...emptyInput(i), ...cmd }, ctx, open, TICK_DT);
  return s.x - x0;
}

describe('movement and sprint meters', () => {
  it('survivors walk and sprint 20% faster than before', () => {
    const s = newMoveState(1000, 1000);
    expect(run(s, SURV, 1, { moveX: 1 })).toBeCloseTo(BALANCE.survivor.walk, 0);
    expect(run(s, SURV, 1, { moveX: 1, buttons: Btn.Run })).toBeCloseTo(BALANCE.survivor.run, 0);
  });

  it('Zach walks slower than survivors and sprints faster', () => {
    const z = newMoveState(1000, 1000, 'hunter');
    const walk = run(z, ZACH, 1, { moveX: 1 });
    const sprint = run(z, ZACH, 1, { moveX: 1, buttons: Btn.Run });
    expect(walk).toBeCloseTo(BALANCE.survivor.walk * 0.9 * 0.95, 0);
    expect(sprint).toBeCloseTo(BALANCE.survivor.run * 1.2 * 0.95, 0);
  });

  it('the survivor meter empties after 8 s, locks for 1.5 s, and refills over 10 s', () => {
    const s = newMoveState(1000, 1000);
    run(s, SURV, 7.9, { moveX: 1, buttons: Btn.Run });
    expect(s.stamina).toBeGreaterThan(0);
    expect(s.sprinting).toBe(1);
    run(s, SURV, 0.2, { moveX: 1, buttons: Btn.Run });
    expect(s.stamina).toBe(0);
    expect(s.staminaLock).toBeGreaterThan(1.3);
    // Holding Shift: walking speed only, and no sprinting until the lockout passes.
    expect(run(s, SURV, 1, { moveX: 1, buttons: Btn.Run })).toBeCloseTo(BALANCE.survivor.walk, 0);
    run(s, SURV, 0.6, { moveX: 1 });
    expect(s.staminaLock).toBe(0);
    run(s, SURV, 10, {});
    expect(s.stamina).toBeCloseTo(BALANCE.survivor.stamina.max, 1);
  });

  it("Zach's meter is 6 s and refills in 10 s", () => {
    const z = newMoveState(1000, 1000, 'hunter');
    expect(z.stamina).toBe(6);
    run(z, ZACH, 6.1, { moveX: 1, buttons: Btn.Run });
    expect(z.stamina).toBe(0);
    run(z, ZACH, 1.5 + 6, {});
    expect(z.stamina).toBeLessThan(5);
    run(z, ZACH, 4, {});
    expect(z.stamina).toBeCloseTo(6, 1);
  });

  it('energy drinks add 2 s to the meter and refill it 1.5x faster, fading over 20 s', () => {
    expect(maxStamina('survivor', BALANCE.items.energy.duration)).toBe(10);
    expect(maxStamina('survivor', 0)).toBe(8);
    const a = newMoveState(1000, 1000);
    const b = newMoveState(1000, 1000);
    a.stamina = b.stamina = 0;
    b.boostT = BALANCE.items.energy.duration;
    run(a, SURV, 2, {});
    run(b, SURV, 2, {});
    expect(b.stamina / a.stamina).toBeGreaterThan(1.35);
  });

  it('lunge: two charges on F, a fast ease-out dash, recharging one at a time', () => {
    const z = newMoveState(1000, 1000, 'hunter');
    const L = BALANCE.hunter.lunge;
    const moved = run(z, ZACH, L.duration + 0.1, { buttons: Btn.Lunge, aim: 0 });
    expect(moved).toBeCloseTo(dashDistance(L.peak, L.duration), -1);
    expect(z.lungeCharges).toBe(1);
    expect(z.lungeRecharge).toBeGreaterThan(6);
    // Holding F does not fire the second charge; pressing again does.
    run(z, ZACH, 0.1, { buttons: 0 });
    run(z, ZACH, 0.05, { buttons: Btn.Lunge, aim: 0 });
    expect(z.lungeCharges).toBe(0);
    run(z, ZACH, L.recharge, {});
    expect(z.lungeCharges).toBe(1);
    run(z, ZACH, L.recharge, {});
    expect(z.lungeCharges).toBe(2);
  });

  it('knockback shoves you back even while stunned (locked)', () => {
    const z = newMoveState(1000, 1000, 'hunter');
    z.mode = MoveMode.Locked;
    const S = BALANCE.items.shotgun;
    z.kbT = z.kbDur = S.kbDuration;
    z.kbPeak = S.kbPeak;
    z.kbAng = 0;
    const moved = run(z, ZACH, 0.5, {});
    expect(moved).toBeCloseTo(dashDistance(S.kbPeak, S.kbDuration), -1);
    expect(moved).toBeLessThan(dashDistance(BALANCE.hunter.lunge.peak, BALANCE.hunter.lunge.duration) / 2);
  });
});
