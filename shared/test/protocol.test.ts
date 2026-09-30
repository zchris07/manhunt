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
import { EntityKind, ItemKind } from '../src/sim/types';

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
  doors: [true, false, false, true],
  radar: [{ x: 1200, y: 3400 }],
});

describe('input codec', () => {
  it('round-trips quantised inputs, including the selected item', () => {
    const cmds: InputCmd[] = [
      { seq: 10, buttons: Btn.Run | Btn.Interact | Btn.Lunge, moveX: 0.7071, moveY: -0.7071, aim: 1.2345, aimDist: 300, item: ItemKind.Shotgun },
      { seq: 11, buttons: Btn.Primary, moveX: 0, moveY: 1, aim: -2, aimDist: 0, item: 0 },
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
      expect(out[i].item).toBe(cmds[i].item);
    }
  });

  it('rejects malformed packets', () => {
    expect(() => decodeInputs(new Uint8Array([1, 0, 0]))).toThrow();
  });
});

describe('snapshot codec', () => {
  it('round-trips a full snapshot and applies deltas', () => {
    const self = { ...emptySelf(3), x: 1234.5, y: 99.25, stamina: 6.25, lungeCharges: 1, lungeRecharge: 4.5, inv: [0, 2, 1, 0, 0, 1], jarvis: 1, confit: 1 };
    const e1 = quantizeEntity(1, EntityKind.Player, 100, 200, 1, 0x1234, 3, 4, ItemKind.Bottle, 200);
    const e2 = quantizeEntity(2, EntityKind.Player, 300, 400, 2, 5, 0, 1);
    const wb = encodeWorld(world());
    const full = encodeSnapshot(10, null, 5, self, [e1, e2], wb);
    const history = new Map<number, DecodedSnapshot>();
    const d1 = decodeSnapshot(full, (t) => history.get(t))!;
    history.set(d1.tick, d1);
    expect(d1.self.x).toBeCloseTo(1234.5);
    expect(d1.self.stamina).toBeCloseTo(6.25, 5);
    expect(d1.self.lungeCharges).toBe(1);
    expect(d1.self.lungeRecharge).toBeCloseTo(4.5, 2);
    expect(d1.self.inv).toEqual([0, 2, 1, 0, 0, 1]);
    expect(d1.self.jarvis).toBe(1);
    expect(d1.self.confit).toBe(1);
    expect(d1.entities.size).toBe(2);
    expect(d1.entities.get(1)!.aux).toBe(ItemKind.Bottle);
    expect(d1.entities.get(1)!.stamina).toBe(200);
    expect(d1.worldState.lootTaken).toEqual(world().lootTaken);
    expect(d1.worldState.doors).toEqual(world().doors);
    expect(d1.worldState.radar).toEqual([{ x: 1200, y: 3400 }]);
    expect(d1.worldState.gens[0].progress).toBeCloseTo(0.5, 2);

    // Delta: e1 moved and its stamina dropped, e2 removed, e3 added, world unchanged.
    const e1b = quantizeEntity(1, EntityKind.Player, 110, 200, 1, 0x1234, 3, 4, ItemKind.Bottle, 150);
    const e3 = quantizeEntity(40, EntityKind.Gas, 50, 60, 0, 0, 0, 200);
    const base = { tick: 10, entities: new Map([e1, e2].map((e) => [e.id, e])), world: wb };
    const delta = encodeSnapshot(11, base, 6, self, [e1b, e3], wb);
    expect(delta.length).toBeLessThan(full.length + 10);
    const d2 = decodeSnapshot(delta, (t) => history.get(t))!;
    expect(d2.baseTick).toBe(10);
    expect(d2.entities.get(1)!.qx).toBe(e1b.qx);
    expect(d2.entities.get(1)!.stamina).toBe(150);
    expect(d2.entities.has(2)).toBe(false);
    expect(d2.entities.get(40)!.kind).toBe(EntityKind.Gas);
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
    const settings = { hunters: 1, survivors: 4, seed: 'abc', difficulty: 1, escapeFraction: 0.5, testMode: false };
    expect(parseClientMessage({ t: 'hello', name: 'Ana', version: 1 })).not.toBeNull();
    expect(parseClientMessage({ t: 'hello', name: 5, version: 1 })).toBeNull();
    expect(parseClientMessage({ t: 'settings', settings: { ...settings, hunters: 0 } })).toBeNull();
    expect(parseClientMessage({ t: 'settings', settings })).not.toBeNull();
    expect(parseClientMessage({ t: 'settings', settings: { ...settings, testMode: 'yes' } })).toBeNull();
    expect(parseClientMessage({ t: 'switchRole' })).toEqual({ t: 'switchRole' });
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
    expect(parseClientMessage('x')).toBeNull();
    expect(parseClientMessage({ t: 'assign', player: 2, role: 'god' })).toBeNull();
  });

  it('sanitises names', () => {
    expect(sanitizeName('  <b>Zach</b>  Branch!! ')).toBe('bZachb Branch');
    expect(sanitizeName('a'.repeat(40)).length).toBe(16);
  });
});
