import { ByteReader, ByteWriter } from '../protocol/binary';
import { TAU } from '../math';

/** Button bits in an input command. Meaning depends on role (see controls in the README). */
export const Btn = {
  Run: 1 << 0,
  Crouch: 1 << 1,
  Interact: 1 << 2,
  Attack: 1 << 3,
  UseItem: 1 << 4,
  Vault: 1 << 5,
  Flash: 1 << 6,
  Ability1: 1 << 7,
  Ability2: 1 << 8,
  Ability3: 1 << 9,
  Lunge: 1 << 10,
  HoldBreath: 1 << 11,
  SkillCheck: 1 << 12,
} as const;

export interface InputCmd {
  seq: number;
  buttons: number;
  /** Movement direction components in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** Aim angle in radians. */
  aim: number;
  /** Distance from the player to the cursor, in world units. */
  aimDist: number;
}

export function emptyInput(seq = 0): InputCmd {
  return { seq, buttons: 0, moveX: 0, moveY: 0, aim: 0, aimDist: 0 };
}

/** Quantises an input the same way the wire format does, so prediction matches the host. */
export function quantizeInput(cmd: InputCmd): InputCmd {
  const aimQ = Math.round((((cmd.aim % TAU) + TAU) % TAU) * (65535 / TAU)) & 0xffff;
  const [moveX, moveY] = unitMove(
    Math.max(-127, Math.min(127, Math.round(cmd.moveX * 127))) / 127,
    Math.max(-127, Math.min(127, Math.round(cmd.moveY * 127))) / 127,
  );
  return {
    seq: cmd.seq >>> 0,
    buttons: cmd.buttons & 0xffff,
    moveX,
    moveY,
    aim: (aimQ * TAU) / 65535,
    aimDist: Math.max(0, Math.min(65535, Math.round(cmd.aimDist))),
  };
}

/** Clamps a decoded movement vector to unit length (identical on host and client). */
function unitMove(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  return len > 1 ? [x / len, y / len] : [x, y];
}

export const MSG_INPUT = 1;
export const MSG_PING = 2;
export const MSG_PONG = 3;
export const MSG_SNAPSHOT = 4;
export const MAX_REDUNDANT_INPUTS = 4;

/** Input packet: the newest inputs (oldest first) plus the last snapshot tick received. */
export function encodeInputs(ackTick: number, cmds: readonly InputCmd[]): Uint8Array {
  const w = new ByteWriter(16 + cmds.length * 12);
  w.u8(MSG_INPUT).u32(ackTick).u8(cmds.length);
  for (const c of cmds) {
    const aimQ = Math.round((((c.aim % TAU) + TAU) % TAU) * (65535 / TAU)) & 0xffff;
    w.u32(c.seq).u16(c.buttons).i8(c.moveX * 127).i8(c.moveY * 127).u16(aimQ).u16(c.aimDist);
  }
  return w.finish();
}

export function decodeInputs(data: Uint8Array): { ackTick: number; cmds: InputCmd[] } {
  const r = new ByteReader(data);
  if (r.u8() !== MSG_INPUT) throw new Error('not an input packet');
  const ackTick = r.u32();
  const n = r.u8();
  if (n > MAX_REDUNDANT_INPUTS) throw new Error('too many inputs');
  const cmds: InputCmd[] = [];
  for (let i = 0; i < n; i++) {
    const seq = r.u32();
    const buttons = r.u16();
    const [moveX, moveY] = unitMove(r.i8() / 127, r.i8() / 127);
    const aim = (r.u16() * TAU) / 65535;
    const aimDist = r.u16();
    cmds.push({ seq, buttons, moveX, moveY, aim, aimDist });
  }
  return { ackTick, cmds };
}

export function encodePing(t: number): Uint8Array {
  return new ByteWriter(9).u8(MSG_PING).f64(t).finish();
}

export function encodePong(clientTime: number, hostTime: number): Uint8Array {
  return new ByteWriter(17).u8(MSG_PONG).f64(clientTime).f64(hostTime).finish();
}
