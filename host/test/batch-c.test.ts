import { describe, expect, it } from 'vitest';
import { BALANCE, Btn, Health, ItemKind, NPC_NAMES, Prompt, newMoveState, stepMovement, type InputCmd } from '@manhunt/shared';
import { buildView } from '../src/sim/view';
import { Driver, clearLane, makeWorld, parkChris, parkSexton, parkShane, place } from './worldHelpers';
import { createHarness, startMatch } from './harness';
import type { World } from '../src/sim/World';

const secs = (s: number): number => Math.round(s * 30);

/** Everyone but `keep` off in far corners. */
function parkNpcs(w: World, keep?: 'jaden'): void {
  parkSexton(w);
  parkShane(w);
  parkChris(w);
  w.marc.x = 60;
  w.marc.y = 60;
  w.plasma.x = w.map.width / 2;
  w.plasma.y = 60;
  if (keep !== 'jaden') {
    w.jaden.x = 60;
    w.jaden.y = w.map.height / 2;
  }
}

describe('Jaden Nguyen', () => {
  it('is alerted like Shane, shoots his target, and stops once they have lost half their health', () => {
    const w = makeWorld({ survivors: 1 });
    parkNpcs(w, 'jaden');
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = clearLane(w, 450);
    place(h, 60, 60);
    place(s, c.x - 200, c.y);
    w.jaden.x = c.x - 200 + BALANCE.jaden.alertRadius - 10;
    w.jaden.y = c.y;
    d.run(2);
    expect(w.jaden.chasing).toBe(true);
    expect(w.jaden.target).toBe(s.id);
    d.run(secs(15));
    // Half their health gone (four 12.5% shots), then he lets them go.
    expect(s.hp).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(s.hp).toBeGreaterThan(0.3);
    expect(s.health).toBe(Health.Wounded);
    expect(w.jaden.chasing).toBe(false);
  });

  it('is shaken off by a thrown bottle pair like Shane', () => {
    const w = makeWorld({ survivors: 1 });
    parkNpcs(w, 'jaden');
    const s = w.players.get(2)!;
    const c = clearLane(w, 450);
    place(s, c.x, c.y);
    w.jaden.x = c.x + 60;
    w.jaden.y = c.y;
    const d = new Driver(w);
    d.run(2);
    expect(w.jaden.chasing).toBe(true);
    w.jaden.itemHit(s, 'bottle');
    w.jaden.itemHit(s, 'bottle');
    expect(w.jaden.mode).toBe('flee');
  });
});

describe('Lake, windows, pickups', () => {
  it('wading through the lake is much slower', () => {
    const w = makeWorld();
    const lake = w.map.lake;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < lake.length; i += 2) {
      cx += lake[i];
      cy += lake[i + 1];
    }
    cx /= lake.length / 2;
    cy /= lake.length / 2;
    expect(w.geo.inWater(cx, cy)).toBe(true);
    const cmd: InputCmd = { seq: 1, buttons: 0, moveX: 1, moveY: 0, aim: 0, aimDist: 100, item: 0 };
    const ctx = { role: 'survivor' as const, hunterSpeedMul: 1, carrying: false };
    const wet = newMoveState(cx, cy);
    for (let i = 0; i < 10; i++) stepMovement(wet, cmd, ctx, w.geo, 1 / 30);
    const c = clearLane(w, 300);
    const dry = newMoveState(c.x, c.y);
    for (let i = 0; i < 10; i++) stepMovement(dry, cmd, ctx, w.geo, 1 / 30);
    expect(wet.x - cx).toBeCloseTo((dry.x - c.x) * BALANCE.wadeMul, 0);
  });

  it('survivors pick up items instantly', () => {
    const w = makeWorld({ survivors: 1 });
    parkNpcs(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    const li = w.map.loot.findIndex((l) => l.item === 'bottle');
    const l = w.map.loot[li];
    place(s, l.x + 10, l.y);
    d.run(1);
    expect(s.prompt).toBe(Prompt.Loot);
    const before = s.inv[ItemKind.Bottle];
    d.run(1, (p) => (p === s ? { buttons: Btn.Interact } : undefined));
    expect(w.lootTaken[li]).toBe(true);
    expect(s.inv[ItemKind.Bottle]).toBe(before + 1);
  });
});

describe('Zach sees names', () => {
  it('next to an NPC or an item, Zach gets its name', () => {
    const w = makeWorld({ survivors: 1 });
    parkNpcs(w);
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const c = clearLane(w, 300);
    place(h, c.x, c.y);
    w.marc.x = c.x + 60;
    w.marc.y = c.y;
    d.run(1);
    expect(h.prompt).toBe(Prompt.NameNpc);
    expect(NPC_NAMES[h.promptTarget]).toBe('Marc Cortez');
    w.marc.x = 60;
    w.marc.y = 60;
    const li = w.map.loot.findIndex((l) => l.item === 'shotgun');
    const l = w.map.loot[li];
    place(h, l.x + 20, l.y);
    d.run(1);
    if (h.prompt === Prompt.NameLoot) expect(w.map.loot[h.promptTarget].item).toBe('shotgun');
    else expect([Prompt.Search, Prompt.OpenDoor, Prompt.CloseDoor, Prompt.DamageGen]).toContain(h.prompt);
  });
});

describe('Testing mode', () => {
  it('sends every NPC to everyone (for the map), only in testing mode', () => {
    const t = makeWorld({ testMode: true });
    const h = t.players.get(1)!;
    place(h, 60, 60);
    const v = buildView(t, h);
    expect(v.world.npcs.map((n) => NPC_NAMES[n.k])).toEqual(expect.arrayContaining(['Shane Jeans', 'Jaden Nguyen', 'Marc Cortez', 'Plasma.TTV']));
    const normal = makeWorld();
    expect(buildView(normal, normal.players.get(1)!).world.npcs).toEqual([]);
  });

  it('a testing room gives everyone host permissions and drops late joiners in as survivors', async () => {
    const h = await createHarness(['Host', 'Guest']);
    const [, guest] = h.clients;
    startMatch(h, 1, 'test-seed', true);
    expect(h.host.phase).toBe('match');
    expect(guest.isOwner).toBe(true);
    const late = await h.join('Late');
    h.run(500);
    expect(late.match?.role).toBe('survivor');
    const sp = h.host.world!.players.get(late.you)!;
    expect(sp.role).toBe('survivor');
    expect(sp.inv[ItemKind.Bottle]).toBe(BALANCE.items.maxStack);
    expect(h.clients[0].match!.players.get(late.you)?.role).toBe('survivor');
    // A guest can send everyone back to the lobby, and change settings there.
    guest.send({ t: 'toLobby' });
    h.run(300);
    expect(h.host.phase).toBe('lobby');
    guest.send({ t: 'settings', settings: { ...guest.lobby!.settings, hunters: 2 } });
    h.run(300);
    expect(h.clients[0].lobby!.settings.hunters).toBe(2);
  });
});

describe('JARVIS never helps Zach', () => {
  it('Zach on the spectated side gets no reveal either', () => {
    const w = makeWorld({ survivors: 1 });
    parkNpcs(w);
    const d = new Driver(w);
    const s = w.players.get(2)!;
    s.jarvis = 1;
    d.tap(s.id, Btn.Ability);
    expect(w.revealT).toBeGreaterThan(0);
    expect(buildView(w, w.players.get(1)!).world.reveal).toBe(false);
    expect(buildView(w, s).world.reveal).toBe(true);
  });
});
