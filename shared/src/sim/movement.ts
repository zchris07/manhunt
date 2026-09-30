import { BALANCE } from '../balance';
import { moveCircle } from '../collision';
import type { Geometry } from '../geometry';
import { Btn, type InputCmd } from './input';
import { Gait, MoveMode } from './types';

/** The part of a player's state that movement prediction needs. Host and client share it. */
export interface MoveState {
  x: number;
  y: number;
  mode: MoveMode;
  /** Seconds left in the current lunge dash (0 = not dashing). */
  lungeT: number;
  lungeAng: number;
  lungeCharges: number;
  /** Seconds until the next lunge charge comes back (0 when both are ready). */
  lungeRecharge: number;
  /** Knockback (shotgun): seconds left, total duration, peak speed, direction. */
  kbT: number;
  kbDur: number;
  kbPeak: number;
  kbAng: number;
  hasteT: number;
  slowT: number;
  slowMul: number;
  /** Sprint meter in seconds of sprinting left. */
  stamina: number;
  /** Seconds before sprinting is allowed again after the meter ran dry. */
  staminaLock: number;
  /** 1 after the meter ran dry until sprint is released (holding Shift doesn't restart it). */
  sprintBlocked: number;
  /** Energy drink: seconds left in its fading boost. */
  boostT: number;
  /** Hemp Battery: seconds left of its speed bonus. */
  hempT: number;
  /** Buttons of the previous step (edge detection for the lunge). */
  prevButtons: number;
  /** 1 if the last step was a sprint (animation, scent). */
  sprinting: number;
}

export interface MoveContext {
  role: 'hunter' | 'survivor';
  hunterSpeedMul: number;
  carrying: boolean;
}

export function newMoveState(x: number, y: number, role: 'hunter' | 'survivor' = 'survivor'): MoveState {
  return {
    x,
    y,
    mode: MoveMode.Normal,
    lungeT: 0,
    lungeAng: 0,
    lungeCharges: BALANCE.hunter.lunge.charges,
    lungeRecharge: 0,
    kbT: 0,
    kbDur: 0,
    kbPeak: 0,
    kbAng: 0,
    hasteT: 0,
    slowT: 0,
    slowMul: 1,
    stamina: maxStaminaBase(role),
    staminaLock: 0,
    sprintBlocked: 0,
    boostT: 0,
    hempT: 0,
    prevButtons: 0,
    sprinting: 0,
  };
}

export function copyMoveState(s: MoveState): MoveState {
  return { ...s };
}

export function radiusFor(role: 'hunter' | 'survivor'): number {
  return role === 'hunter' ? BALANCE.hunter.radius : BALANCE.survivor.radius;
}

function maxStaminaBase(role: 'hunter' | 'survivor'): number {
  return role === 'hunter' ? BALANCE.hunter.stamina.max : BALANCE.survivor.stamina.max;
}

/** Current sprint meter capacity (the energy drink adds a fading bonus). */
export function maxStamina(role: 'hunter' | 'survivor', boostT: number): number {
  const E = BALANCE.items.energy;
  return maxStaminaBase(role) + E.bonusSec * Math.max(0, Math.min(1, boostT / E.duration));
}

/** Dash speed curve shared by the lunge and knockback: instant peak, then a fast ease-out. */
export function dashSpeed(peak: number, elapsed: number, duration: number): number {
  const k = Math.max(0, 1 - elapsed / duration);
  return peak * k * k;
}

/** Distance a full dash covers (the integral of dashSpeed). */
export function dashDistance(peak: number, duration: number): number {
  return (peak * duration) / 3;
}

/**
 * Advances movement by one fixed step. Deterministic: the client replays the same inputs
 * through this function for prediction and reconciliation. Returns the gait for this step.
 */
export function stepMovement(s: MoveState, cmd: InputCmd, ctx: MoveContext, geo: Geometry, dt: number): Gait {
  const pressed = cmd.buttons & ~s.prevButtons;
  s.prevButtons = cmd.buttons;
  const radius = radiusFor(ctx.role);
  s.hasteT = Math.max(0, s.hasteT - dt);
  s.hempT = Math.max(0, s.hempT - dt);
  if (s.slowT > 0) {
    s.slowT = Math.max(0, s.slowT - dt);
    if (s.slowT === 0) s.slowMul = 1;
  }

  // Lunge charges come back one at a time.
  const L = BALANCE.hunter.lunge;
  if (s.lungeCharges < L.charges) {
    s.lungeRecharge -= dt;
    if (s.lungeRecharge <= 0) {
      s.lungeCharges++;
      s.lungeRecharge = s.lungeCharges < L.charges ? s.lungeRecharge + L.recharge : 0;
    }
  } else {
    s.lungeRecharge = 0;
  }

  // Knockback moves you even while stunned.
  if (s.kbT > 0) {
    const elapsed = s.kbDur - s.kbT;
    const step = Math.min(dt, s.kbT);
    const v = dashSpeed(s.kbPeak, elapsed + step / 2, s.kbDur);
    moveCircle(geo, s, radius, Math.cos(s.kbAng) * v * step, Math.sin(s.kbAng) * v * step);
    s.kbT = Math.max(0, s.kbT - dt);
  }

  // Sprint meter.
  const role = ctx.role;
  const cfg = role === 'hunter' ? BALANCE.hunter.stamina : BALANCE.survivor.stamina;
  const E = BALANCE.items.energy;
  const boostK = Math.max(0, Math.min(1, s.boostT / E.duration));
  const cap = maxStamina(role, s.boostT);
  const refill = (cfg.max / cfg.refill) * (1 + (E.refillMul - 1) * boostK);
  s.boostT = Math.max(0, s.boostT - dt);
  if (s.staminaLock > 0) s.staminaLock = Math.max(0, s.staminaLock - dt);
  const runHeld = (cmd.buttons & Btn.Run) !== 0;
  if (!runHeld && s.staminaLock <= 0) s.sprintBlocked = 0;

  if (s.mode === MoveMode.Locked) {
    s.lungeT = 0;
    s.sprinting = 0;
    if (s.staminaLock <= 0) s.stamina = Math.min(cap, s.stamina + refill * dt);
    return Gait.Idle;
  }

  let dx = cmd.moveX;
  let dy = cmd.moveY;
  const moving = dx !== 0 || dy !== 0;
  const crouching = role === 'survivor' && (cmd.buttons & Btn.Crouch) !== 0;
  const wantsSprint = runHeld && moving && !crouching && s.mode === MoveMode.Normal;
  const sprint = wantsSprint && s.sprintBlocked === 0 && s.staminaLock <= 0 && s.stamina > 0;
  if (sprint) {
    s.stamina -= dt;
    if (s.stamina <= 0) {
      s.stamina = 0;
      s.staminaLock = BALANCE.sprintLockout;
      s.sprintBlocked = 1;
    }
  } else if (s.staminaLock <= 0) {
    s.stamina = Math.min(cap, s.stamina + refill * dt);
  }
  s.stamina = Math.min(s.stamina, cap);
  s.sprinting = sprint ? 1 : 0;

  let speed: number;
  let gait: Gait;
  if (role === 'hunter') {
    const H = BALANCE.hunter;
    if (pressed & Btn.Lunge && s.lungeCharges > 0 && s.lungeT <= 0 && !ctx.carrying && s.mode === MoveMode.Normal) {
      s.lungeCharges--;
      if (s.lungeRecharge <= 0) s.lungeRecharge = L.recharge;
      s.lungeT = L.duration;
      s.lungeAng = cmd.aim;
    }
    if (s.lungeT > 0) {
      const elapsed = L.duration - s.lungeT;
      const step = Math.min(dt, s.lungeT);
      const v = dashSpeed(L.peak, elapsed + step / 2, L.duration);
      moveCircle(geo, s, radius, Math.cos(s.lungeAng) * v * step, Math.sin(s.lungeAng) * v * step);
      s.lungeT = Math.max(0, s.lungeT - dt);
      return Gait.Run;
    }
    speed = (sprint ? H.sprint : H.walk) * ctx.hunterSpeedMul;
    if (ctx.carrying) speed *= H.carrySpeedMul;
    if (s.hempT > 0) speed *= H.hemp.speedMul;
    if (s.slowT > 0) speed *= s.slowMul;
    gait = moving ? (sprint ? Gait.Run : Gait.Walk) : Gait.Idle;
  } else {
    const sv = BALANCE.survivor;
    if (s.mode === MoveMode.Crawl) {
      speed = sv.crawl;
      gait = moving ? Gait.Crouch : Gait.Idle;
    } else if (crouching) {
      speed = sv.crouch;
      gait = moving ? Gait.Crouch : Gait.Idle;
    } else if (sprint) {
      speed = sv.run;
      gait = Gait.Run;
    } else {
      speed = sv.walk;
      gait = moving ? Gait.Walk : Gait.Idle;
    }
    if (s.hasteT > 0) speed *= sv.hitHasteMul;
    if (s.slowT > 0) speed *= s.slowMul;
  }

  if (moving) {
    dx *= speed * dt;
    dy *= speed * dt;
    moveCircle(geo, s, radius, dx, dy);
  }
  return gait;
}
