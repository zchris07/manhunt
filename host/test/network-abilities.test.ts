import { describe, expect, it } from 'vitest';
import { BarricadeState, Btn, EntityKind, Health, ToolKind, type GameEvent } from '@manhunt/shared';
import { createHarness, idle, move, startMatch, type Harness } from './harness';
import type { GameClient } from '../../client/src/net/GameClient';

// Each hiding / tool / ability mechanic driven purely by client inputs over a transport.
async function duel(): Promise<{ h: Harness; hunter: GameClient; surv: GameClient }> {
  const h = await createHarness(['Hunter', 'Surv']);
  const owner = h.clients[0];
  const other = h.clients[1];
  owner.send({ t: 'rolePref', pref: 'hunter' });
  other.send({ t: 'rolePref', pref: 'survivor' });
  h.run(100);
  startMatch(h, 1);
  const hunter = h.clients.find((c) => c.match!.role === 'hunter')!;
  const surv = h.clients.find((c) => c.match!.role === 'survivor')!;
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
  h.run(100, () => c.pushInput(idle(0, extra.aim ?? 0)));
}

function events(c: GameClient): GameEvent[] {
  return c.drainEvents();
}

describe('M5 mechanics over the network', () => {
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

  it('flare: lights up and blinds Zach (visible to both sides)', async () => {
    const { h, hunter, surv } = await duel();
    const c = h.host.world!.map.clearings[2];
    place(h, surv, c.x, c.y);
    place(h, hunter, c.x + 90, c.y);
    const s = sp(h, surv);
    s.tool = ToolKind.Flare;
    s.toolCount = 1;
    h.run(100, () => surv.pushInput(idle()));
    tap(h, surv, Btn.UseItem);
    expect(hunter.self!.blindT).toBeGreaterThan(0);
    expect([...hunter.latest!.entities.values()].some((e) => e.kind === EntityKind.Flare)).toBe(true);
    expect(events(hunter).some((e) => e.k === 'stun' && e.kind === 'flare')).toBe(true);
  });

  it('flashlight flash: hold F on Zach for 2 s', async () => {
    const { h, hunter, surv } = await duel();
    const c = h.host.world!.map.clearings[3];
    place(h, surv, c.x, c.y);
    place(h, hunter, c.x + 150, c.y);
    h.run(2300, () => surv.pushInput({ ...idle(Btn.Flash, 0) }));
    expect(hunter.self!.blindT).toBeGreaterThan(0);
    expect(surv.self!.flashCharges).toBe(0);
  });

  it('barricade: Space slams it on Zach; both clients see it down and Zach stunned', async () => {
    const { h, hunter, surv } = await duel();
    const b = h.host.world!.map.barricades[0];
    const nx = -Math.sin(b.angle);
    const ny = Math.cos(b.angle);
    place(h, surv, b.x + nx * 45, b.y + ny * 45);
    place(h, hunter, b.x, b.y);
    h.run(150, () => surv.pushInput(idle()));
    tap(h, surv, Btn.Vault);
    expect(hunter.self!.stunT).toBeGreaterThan(0);
    expect(surv.latest!.worldState.barricades[0]).toBe(BarricadeState.Down);
    expect(hunter.latest!.worldState.barricades[0]).toBe(BarricadeState.Down);
  });

  it("bottle decoy: Zach hears the smash and Stalker's Pulse reports it", async () => {
    const { h, hunter, surv } = await duel();
    const c = h.host.world!.map.clearings[4];
    place(h, surv, c.x, c.y);
    place(h, hunter, c.x + 500, c.y + 300);
    const s = sp(h, surv);
    s.tool = ToolKind.Bottle;
    s.toolCount = 1;
    h.run(100, () => surv.pushInput(idle()));
    events(hunter);
    tap(h, surv, Btn.UseItem, { aim: 0, aimDist: 380 });
    h.run(1000, () => hunter.pushInput(idle()));
    expect(events(hunter).some((e) => e.k === 'noise' && e.s === 'glass')).toBe(true);
    tap(h, hunter, Btn.Ability1);
    const pulse = events(hunter).find((e) => e.k === 'pulse') as Extract<GameEvent, { k: 'pulse' }> | undefined;
    expect(pulse).toBeTruthy();
    expect(pulse!.echoes.length).toBeGreaterThanOrEqual(3);
    expect(hunter.self!.pulseCd).toBeGreaterThan(20);
  });

  it('Bloodhound sends trails; Lunge and Vault Smash move Zach faster', async () => {
    const { h, hunter, surv } = await duel();
    const w = h.host.world!;
    const c = w.map.clearings[5];
    place(h, surv, c.x, c.y);
    sp(h, surv).health = Health.Wounded;
    place(h, hunter, c.x + 300, c.y);
    h.run(2000, () => {
      surv.pushInput(move(0, 1, Btn.Run));
      hunter.pushInput(idle());
    });
    events(hunter);
    tap(h, hunter, Btn.Ability2);
    const trail = events(hunter).find((e) => e.k === 'trail') as Extract<GameEvent, { k: 'trail' }> | undefined;
    expect(trail!.pts.length).toBeGreaterThan(8);

    const x0 = sp(h, hunter).move.x;
    h.run(34, () => hunter.pushInput({ ...move(-1, 0, Btn.Lunge), aim: Math.PI }));
    h.run(300, () => hunter.pushInput({ ...move(-1, 0), aim: Math.PI }));
    expect(x0 - sp(h, hunter).move.x).toBeGreaterThan(70);

    const win = w.map.windows[0];
    const nx = -Math.sin(win.angle);
    const ny = Math.cos(win.angle);
    place(h, hunter, win.x + nx * 35, win.y + ny * 35);
    h.run(100, () => hunter.pushInput(idle()));
    tap(h, hunter, Btn.Ability3);
    h.run(500, () => hunter.pushInput(idle()));
    const p = sp(h, hunter);
    expect((p.move.x - win.x) * nx + (p.move.y - win.y) * ny).toBeLessThan(0);
    expect(hunter.self!.smashCd).toBeGreaterThan(15);
  });
});
