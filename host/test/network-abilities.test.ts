import { describe, expect, it } from 'vitest';
import { BarricadeState, Btn, Health, ItemKind, type GameEvent } from '@manhunt/shared';
import { createHarness, idle, move, startMatch, type Harness } from './harness';
import { clearLane, setCount } from './worldHelpers';
import type { GameClient } from '../../client/src/net/GameClient';

// Each hiding / item / ability mechanic driven purely by client inputs over a transport.
async function duel(testMode = false): Promise<{ h: Harness; hunter: GameClient; surv: GameClient }> {
  const h = await createHarness(['Hunter', 'Surv']);
  const owner = h.clients[0];
  const other = h.clients[1];
  owner.send({ t: 'rolePref', pref: 'hunter' });
  other.send({ t: 'rolePref', pref: 'survivor' });
  h.run(100);
  startMatch(h, 1, 'test-seed', testMode);
  const hunter = h.clients.find((c) => c.match!.role === 'hunter')!;
  const surv = h.clients.find((c) => c.match!.role === 'survivor')!;
  const w = h.host.world!;
  w.sexton.x = 60;
  w.sexton.y = w.map.height - 60;
  h.run(300);
  return { h, hunter, surv };
}

function sp(h: Harness, c: GameClient) {
  return h.host.world!.players.get(c.you)!;
}

function place(h: Harness, c: GameClient, x: number, y: number): void {
  const p = sp(h, c);
  p.move.x = x;
  p.move.y = y;
  for (let i = 0; i < p.history.length; i += 2) {
    p.history[i] = x;
    p.history[i + 1] = y;
  }
}

function tap(h: Harness, c: GameClient, buttons: number, extra: Partial<ReturnType<typeof idle>> = {}): void {
  h.run(34, () => c.pushInput({ ...idle(buttons), ...extra }));
  h.run(100, () => c.pushInput({ ...idle(0, extra.aim ?? 0), item: extra.item ?? 0 }));
}

function events(c: GameClient): GameEvent[] {
  return c.drainEvents();
}

describe('mechanics over the network', () => {
  it('hiding: enter via E, vanish from Zach, get dragged out by a search', async () => {
    const { h, hunter, surv } = await duel();
    const w = h.host.world!;
    const spot = w.map.hidingSpots.find((s) => s.kind === 'locker')!;
    place(h, surv, spot.exitX, spot.exitY);
    place(h, hunter, 5000, 5000);
    h.run(200, () => surv.pushInput(idle()));
    tap(h, surv, Btn.Interact);
    h.run(800, () => surv.pushInput(idle()));
    expect(surv.self!.hideState).toBe(2);
    place(h, hunter, spot.exitX, spot.exitY);
    h.run(200, () => hunter.pushInput(idle()));
    expect(hunter.latest!.entities.has(surv.you)).toBe(false);
    tap(h, hunter, Btn.Interact);
    h.run(1800, () => hunter.pushInput(idle()));
    expect(surv.self!.hideState).toBe(0);
    expect(surv.self!.health).toBe(Health.Wounded);
  });

  it('bottle: a click with the bottle slot selected stuns Zach; the inventory updates', async () => {
    const { h, hunter, surv } = await duel();
    const c = clearLane(h.host.world!, 350);
    place(h, surv, c.x, c.y);
    place(h, hunter, c.x + 200, c.y);
    setCount(sp(h, surv), ItemKind.Bottle, 2);
    h.run(100, () => surv.pushInput(idle()));
    tap(h, surv, Btn.Primary, { aim: 0, aimDist: 300, item: ItemKind.Bottle });
    h.run(300, () => surv.pushInput(idle()));
    expect(hunter.self!.stunT).toBeGreaterThan(0);
    expect(surv.self!.slots[ItemKind.Bottle - 1].n).toBe(1);
    expect(events(hunter).some((e) => e.k === 'stun' && e.kind === 'bottle')).toBe(true);
  });

  it('barricade: Space slams it on Zach; both clients see it down and Zach stunned', async () => {
    const { h, hunter, surv } = await duel();
    const b = h.host.world!.map.barricades[0];
    const nx = -Math.sin(b.angle);
    const ny = Math.cos(b.angle);
    place(h, surv, b.x + nx * 45, b.y + ny * 45);
    place(h, hunter, b.x, b.y);
    h.run(150, () => surv.pushInput(idle()));
    tap(h, surv, Btn.Space);
    expect(hunter.self!.stunT).toBeGreaterThan(0);
    expect(surv.latest!.worldState.barricades[0]).toBe(BarricadeState.Down);
    expect(hunter.latest!.worldState.barricades[0]).toBe(BarricadeState.Down);
  });

  it('Soundcloud Burst: F fires a wave that scares a survivor across the map', async () => {
    const { h, hunter, surv } = await duel();
    const w = h.host.world!;
    place(h, hunter, 600, 600);
    place(h, surv, w.map.width - 600, w.map.height - 600);
    h.run(100, () => hunter.pushInput(idle()));
    events(surv);
    tap(h, hunter, Btn.Secondary, { aim: Math.PI / 4 });
    expect(hunter.self!.burstCd).toBeGreaterThan(10);
    h.run(5000, () => hunter.pushInput(idle()));
    const evs = events(surv);
    expect(evs.some((e) => e.k === 'burst')).toBe(true);
    expect(evs.some((e) => e.k === 'scare')).toBe(true);
  });

  it('scent is always on for Zach, and the F lunge dashes him forward', async () => {
    const { h, hunter, surv } = await duel();
    const w = h.host.world!;
    const c = clearLane(w, 450);
    place(h, surv, c.x - 300, c.y + 200);
    place(h, hunter, c.x - 300, c.y);
    h.run(2000, () => {
      surv.pushInput(move(1, 0, Btn.Run));
      hunter.pushInput(idle());
    });
    const trail = events(hunter).filter((e) => e.k === 'trail') as Extract<GameEvent, { k: 'trail' }>[];
    expect(trail.reduce((n, t) => n + t.pts.length / 4, 0)).toBeGreaterThan(5);
    expect(events(surv).some((e) => e.k === 'trail')).toBe(false);

    place(h, surv, 200, w.map.height - 200);
    const x0 = sp(h, hunter).move.x;
    tap(h, hunter, Btn.Lunge, { aim: 0 });
    h.run(500, () => hunter.pushInput(idle()));
    expect(sp(h, hunter).move.x - x0).toBeGreaterThan(120);
    expect(hunter.self!.lungeCharges).toBe(1);
  });

  it('testing mode: T-switch over the network swaps roles in place', async () => {
    const { h, surv } = await duel(true);
    expect(surv.self!.slots.some((sl) => sl.kind === ItemKind.Shotgun)).toBe(true);
    let role = '';
    surv.on('role', (r) => {
      role = r as string;
    });
    surv.send({ t: 'switchRole' });
    h.run(300, () => surv.pushInput(idle()));
    expect(sp(h, surv).role).toBe('hunter');
    expect(role).toBe('hunter');
  });
});
