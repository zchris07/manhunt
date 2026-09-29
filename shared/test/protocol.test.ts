import { describe, expect, it } from 'vitest';
import {
  decodeInputs,
  encodeInputs,
  quantizeInput,
  Btn,
  type InputCmd,
} from '../src/sim/input';
import {
  decodeSnapshot,
  emptySelf,
  encodeSnapshot,
  encodeWorld,
  quantizeEntity,
  type DecodedSnapshot,
  type WorldState,
} from '../src/protocol/snapshot';
import { parseClientMessage, sanitizeName } from '../src/protocol/messages';
import { EntityKind } from '../src/sim/types';

const world = (): WorldState => ({
  timeLeft: 900,
  required: 5,
  repaired: 1,
  escaped: 0,
  eliminated: 0,
  survivorsTotal: 4,
  gens: [
    { progress: 0.5, flags: 2 },
    { progress: 1, flags: 1 },
  ],
  gatePowered: false,
  gateProgress: 0,
  gateOpen: false,
  barricades: [0, 1, 2],
  lootTaken: [true, false, false, true, false, false, false, false, true],
  stakes: [0, 3],
  hidingOccupied: [false, true],
});

describe('input codec', () => {
  it('round-trips quantised inputs', () => {
    const cmds: InputCmd[] = [
      { seq: 10, buttons: Btn.Run | Btn.Interact, moveX: 0.7071, moveY: -0.7071, aim: 1.2345, aimDist: 300 },
      { seq: 11, buttons: 0, moveX: 0, moveY: 1, aim: -2, aimDist: 0 },
    ];
    const { ackTick, cmds: out } = decodeInputs(encodeInputs(77, cmds));
    expect(ackTick).toBe(77);
    expect(out.length).toBe(2);
    const q = cmds.map(quantizeInput);
    for (let i = 0; i < 2; i++) {
      expect(out[i].seq).toBe(q[i].seq);
      expect(out[i].buttons).toBe(q[i].buttons);
      expect(out[i].moveX).toBeCloseTo(q[i].moveX, 6);
      expect(out[i].moveY).toBeCloseTo(q[i].moveY, 6);
      expect(out[i].aim).toBeCloseTo(q[i].aim, 6);
    }
  });

  it('rejects malformed packets', () => {
    expect(() => decodeInputs(new Uint8Array([1, 0, 0]))).toThrow();
  });
});

describe('snapshot codec', () => {
  it('round-trips a full snapshot and applies deltas', () => {
    const self = { ...emptySelf(3), x: 1234.5, y: 99.25, fuel: 1, terror: 0.5 };
    const e1 = quantizeEntity(1, EntityKind.Player, 100, 200, 1, 0x1234, 3, 4);
    const e2 = quantizeEntity(2, EntityKind.Player, 300, 400, 2, 5, 0, 1);
    const wb = encodeWorld(world());
    const full = encodeSnapshot(10, null, 5, self, [e1, e2], wb);
    const history = new Map<number, DecodedSnapshot>();
    const d1 = decodeSnapshot(full, (t) => history.get(t))!;
    history.set(d1.tick, d1);
    expect(d1.self.x).toBeCloseTo(1234.5);
    expect(d1.self.fuel).toBe(1);
    expect(d1.entities.size).toBe(2);
    expect(d1.worldState.lootTaken).toEqual(world().lootTaken);
    expect(d1.worldState.gens[0].progress).toBeCloseTo(0.5, 2);

    // Delta: e1 moved, e2 removed, e3 added, world unchanged.
    const e1b = quantizeEntity(1, EntityKind.Player, 110, 200, 1, 0x1234, 3, 4);
    const e3 = quantizeEntity(40, EntityKind.Flare, 50, 60, 0, 0, 0, 200);
    const base = { tick: 10, entities: new Map([e1, e2].map((e) => [e.id, e])), world: wb };
    const delta = encodeSnapshot(11, base, 6, self, [e1b, e3], wb);
    expect(delta.length).toBeLessThan(full.length + 10);
    const d2 = decodeSnapshot(delta, (t) => history.get(t))!;
    expect(d2.baseTick).toBe(10);
    expect(d2.entities.get(1)!.qx).toBe(e1b.qx);
    expect(d2.entities.has(2)).toBe(false);
    expect(d2.entities.get(40)!.kind).toBe(EntityKind.Flare);
    expect(d2.worldState.barricades).toEqual([0, 1, 2]);
  });

  it('an unchanged entity costs nothing in a delta', () => {
    const self = emptySelf(1);
    const e1 = quantizeEntity(1, EntityKind.Player, 100, 200, 1, 0, 0, 0);
    const wb = encodeWorld(world());
    const base = { tick: 1, entities: new Map([[1, e1]]), world: wb };
    const withEntity = encodeSnapshot(2, base, 0, self, [e1], wb);
    const without = encodeSnapshot(2, { ...base, entities: new Map() }, 0, self, [], wb);
    expect(withEntity.length).toBe(without.length);
  });

  it('returns null when the baseline is missing', () => {
    const wb = encodeWorld(world());
    const data = encodeSnapshot(5, { tick: 4, entities: new Map(), world: wb }, 0, emptySelf(1), [], wb);
    expect(decodeSnapshot(data, () => undefined)).toBeNull();
  });
});

describe('message validation', () => {
  it('accepts valid and rejects invalid client messages', () => {
    expect(parseClientMessage({ t: 'hello', name: 'Ana', version: 1 })).not.toBeNull();
    expect(parseClientMessage({ t: 'hello', name: 5, version: 1 })).toBeNull();
    expect(parseClientMessage({ t: 'settings', settings: { hunters: 0, survivors: 4, seed: '', difficulty: 1, escapeFraction: 0.5 } })).toBeNull();
    expect(parseClientMessage({ t: 'settings', settings: { hunters: 1, survivors: 4, seed: 'abc', difficulty: 1, escapeFraction: 0.5 } })).not.toBeNull();
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
    expect(parseClientMessage('x')).toBeNull();
    expect(parseClientMessage({ t: 'assign', player: 2, role: 'god' })).toBeNull();
  });

  it('sanitises names', () => {
    expect(sanitizeName('  <b>Zach</b>  Branch!! ')).toBe('bZachb Branch');
    expect(sanitizeName('a'.repeat(40)).length).toBe(16);
  });
});
