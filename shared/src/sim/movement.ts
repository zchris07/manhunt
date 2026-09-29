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
  lungeT: number;
  lungeCd: number;
  hasteT: number;
  slowT: number;
  slowMul: number;
}

export interface MoveContext {
  role: 'hunter' | 'survivor';
  hunterSpeed: number;
  carrying: boolean;
}

export function newMoveState(x: number, y: number): MoveState {
  return { x, y, mode: MoveMode.Normal, lungeT: 0, lungeCd: 0, hasteT: 0, slowT: 0, slowMul: 1 };
}

export function copyMoveState(s: MoveState): MoveState {
  return { ...s };
}

export function radiusFor(role: 'hunter' | 'survivor'): number {
  return role === 'hunter' ? BALANCE.hunter.radius : BALANCE.survivor.radius;
}

/**
 * Advances movement by one fixed step. Deterministic: the client replays the same inputs
 * through this function for prediction and reconciliation. Returns the gait for this step.
 */
export function stepMovement(s: MoveState, cmd: InputCmd, ctx: MoveContext, geo: Geometry, dt: number): Gait {
  s.lungeCd = Math.max(0, s.lungeCd - dt);
  s.hasteT = Math.max(0, s.hasteT - dt);
  if (s.slowT > 0) {
    s.slowT = Math.max(0, s.slowT - dt);
    if (s.slowT === 0) s.slowMul = 1;
  }
  if (s.mode === MoveMode.Locked) {
    s.lungeT = 0;
    return Gait.Idle;
  }

  let dx = cmd.moveX;
  let dy = cmd.moveY;
  let speed: number;
  let gait: Gait;

  if (ctx.role === 'hunter') {
    const L = BALANCE.hunter.lunge;
    if (cmd.buttons & Btn.Lunge && s.lungeCd <= 0 && s.lungeT <= 0 && !ctx.carrying && s.mode === MoveMode.Normal) {
      s.lungeT = L.duration;
      s.lungeCd = L.cooldown;
    }
    speed = ctx.hunterSpeed * (ctx.carrying ? BALANCE.hunter.carrySpeedMul : 1) * (s.slowT > 0 ? s.slowMul : 1);
    if (s.lungeT > 0) {
      dx = Math.cos(cmd.aim);
      dy = Math.sin(cmd.aim);
      speed *= L.mul;
      s.lungeT = Math.max(0, s.lungeT - dt);
    }
    gait = dx || dy ? Gait.Run : Gait.Idle;
  } else {
    const sv = BALANCE.survivor;
    if (s.mode === MoveMode.Crawl) {
      speed = sv.crawl;
      gait = dx || dy ? Gait.Crouch : Gait.Idle;
    } else if (cmd.buttons & Btn.Crouch) {
      speed = sv.crouch;
      gait = dx || dy ? Gait.Crouch : Gait.Idle;
    } else if (cmd.buttons & Btn.Run) {
      speed = sv.run;
      gait = dx || dy ? Gait.Run : Gait.Idle;
    } else {
      speed = sv.walk;
      gait = dx || dy ? Gait.Walk : Gait.Idle;
    }
    if (s.hasteT > 0) speed *= sv.hitHasteMul;
    if (s.slowT > 0) speed *= s.slowMul;
  }

  if (dx || dy) moveCircle(geo, s, radiusFor(ctx.role), dx * speed * dt, dy * speed * dt);
  return gait;
}
