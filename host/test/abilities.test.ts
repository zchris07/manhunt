import { describe, expect, it } from 'vitest';
import { BALANCE, BarricadeState, Btn, Health, ToolKind } from '@manhunt/shared';
import { Driver, makeWorld, openSpot, place } from './worldHelpers';
import { buildView } from '../src/sim/view';
import type { World } from '../src/sim/World';

const secs = (s: number): number => Math.ceil(s * 30);

function lockerWorld(): { w: World; d: Driver; spot: World['map']['hidingSpots'][number] } {
  const w = makeWorld({ survivors: 2 });
  const spot = w.map.hidingSpots.find((h) => h.kind === 'locker')!;
  const s = w.players.get(2)!;
  place(s, spot.exitX, spot.exitY);
  place(w.players.get(1)!, 200, 200);
  place(w.players.get(3)!, 5800, 5800);
  return { w, d: new Driver(w), spot };
}

describe('hiding (Outlast / DBD)', () => {
  it('entering takes ~0.6 s; hidden survivors vanish from the hunter view and snapshots', () => {
    const { w, d, spot } = lockerWorld();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    d.run(2);
    d.tap(s.id, Btn.Interact);
    expect(s.hideState).toBe(1);
    d.run(secs(BALANCE.hiding.enterTime));
    expect(s.hideState).toBe(2);
    expect(w.hiding[spot.id]).toBe(s.id);
    // Hunter right next to the locker, looking at it.
    place(h, spot.exitX + Math.cos(spot.facing + 1.2) * 30, spot.exitY + Math.sin(spot.facing + 1.2) * 30);
    d.run(2);
    const view = buildView(w, h);
    expect(view.entities.some((e) => e.id === s.id)).toBe(false);
    expect(view.world.hidingOccupied.every((o) => !o)).toBe(true);
  });

  it('entering near Zach is noisy', () => {
    const { w, d, spot } = lockerWorld();
    const s = w.players.get(2)!;
    place(w.players.get(1)!, spot.x + 250, spot.y);
    d.run(2);
    d.tap(s.id, Btn.Interact);
    d.run(secs(BALANCE.hiding.enterTime) + 2);
    expect(w.noises.some((n) => n.kind === 'locker' && n.survivor)).toBe(true);
  });

  it('Zach searching an occupied spot exposes and wounds the survivor', () => {
    const { w, d, spot } = lockerWorld();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    d.run(2);
    d.tap(s.id, Btn.Interact);
    d.run(secs(0.8));
    place(h, spot.exitX, spot.exitY);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(secs(BALANCE.hunter.searchTime) + 2);
    expect(s.hideState).toBe(0);
    expect(s.health).toBe(Health.Wounded);
  });

  it('locker slam: bursting out during a search stuns Zach', () => {
    const { w, d, spot } = lockerWorld();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    d.run(2);
    d.tap(s.id, Btn.Interact);
    d.run(secs(0.8));
    place(h, spot.exitX, spot.exitY);
    d.run(2);
    d.tap(h.id, Btn.Interact);
    d.run(5);
    d.tap(s.id, Btn.Interact);
    expect(h.stunT).toBeGreaterThan(0);
    expect(s.hideState).toBe(0);
    expect(s.health).toBe(Health.Healthy);
    expect(s.stats.stuns).toBe(1);
  });

  it('leaving is interruptible and holding breath silences you until you gasp', () => {
    const { w, d } = lockerWorld();
    const s = w.players.get(2)!;
    d.run(2);
    d.tap(s.id, Btn.Interact);
    d.run(secs(0.8));
    d.tap(s.id, Btn.Interact);
    expect(s.hideState).toBe(3);
    d.tap(s.id, Btn.Interact);
    expect(s.hideState).toBe(2);
    d.hold(s.id, Btn.HoldBreath, 2);
    expect(s.holdingBreath).toBe(true);
    expect(s.breath).toBeLessThan(0.8);
    d.hold(s.id, Btn.HoldBreath, BALANCE.hiding.breathMax);
    expect(w.noises.some((n) => n.kind === 'gasp')).toBe(true);
  });
});

describe('disruption tools (stun, never kill) with stun immunity', () => {
  function duel(): { w: World; d: Driver } {
    const w = makeWorld({ survivors: 2 });
    const c = openSpot(w, 4);
    place(w.players.get(1)!, c.x + 80, c.y);
    place(w.players.get(2)!, c.x, c.y);
    place(w.players.get(3)!, 5800, 5800);
    return { w, d: new Driver(w) };
  }

  it('a flare blinds Zach, and immunity stops a chain-stun', () => {
    const { w, d } = duel();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    s.tool = ToolKind.Flare;
    s.toolCount = 2;
    d.tap(s.id, Btn.UseItem);
    expect(h.blindT).toBeGreaterThan(0);
    expect(h.immuneT).toBeGreaterThan(BALANCE.tools.stunImmunity);
    expect(w.flares.length).toBe(1);
    const blind = h.blindT;
    d.tap(s.id, Btn.UseItem);
    expect(h.blindT).toBeLessThanOrEqual(blind);
    expect(s.stats.stuns).toBe(1);
    expect(h.health).not.toBe(Health.Eliminated);
  });

  it('flashlight flash needs ~2 s of sustained aim and uses a battery', () => {
    const { w, d } = duel();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    s.flashCharges = 1;
    d.hold(s.id, Btn.Flash, 1.0, { aim: 0 });
    expect(h.blindT).toBe(0);
    d.hold(s.id, Btn.Flash, 1.2, { aim: 0 });
    expect(h.blindT).toBeGreaterThan(0);
    expect(s.flashCharges).toBe(0);
  });

  it('slamming a barricade on Zach stuns him; he breaks it; survivors can vault it', () => {
    const w = makeWorld({ survivors: 2 });
    const d = new Driver(w);
    const b = w.map.barricades[0];
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    const nx = -Math.sin(b.angle);
    const ny = Math.cos(b.angle);
    place(s, b.x + nx * 45, b.y + ny * 45);
    place(h, b.x, b.y);
    place(w.players.get(3)!, 5800, 5800);
    d.run(2);
    d.tap(s.id, Btn.Vault);
    expect(w.barricades[0]).toBe(BarricadeState.Down);
    expect(h.stunT).toBeGreaterThan(0);
    expect(w.geo.isDynamicActive(b.dyn)).toBe(true);
    // Survivor vaults the dropped barricade.
    d.run(2);
    const side0 = (s.move.x - b.x) * nx + (s.move.y - b.y) * ny;
    d.tap(s.id, Btn.Vault);
    d.run(secs(BALANCE.survivor.vaultTime) + 2);
    const side1 = (s.move.x - b.x) * nx + (s.move.y - b.y) * ny;
    expect(Math.sign(side0)).not.toBe(Math.sign(side1));
    // Zach breaks it once the stun wears off.
    d.run(secs(BALANCE.tools.barricade.stun * w.balance.stunMul) + 2);
    place(h, b.x + nx * 45, b.y + ny * 45);
    d.run(2);
    d.tap(h.id, Btn.Vault);
    d.run(secs(BALANCE.hunter.breakBarricadeTime) + 2);
    expect(w.barricades[0]).toBe(BarricadeState.Broken);
    expect(w.geo.isDynamicActive(b.dyn)).toBe(false);
  });

  it('a thrown bottle lands as a noise decoy that Stalker\'s Pulse reports', () => {
    const { w, d } = duel();
    const s = w.players.get(2)!;
    const h = w.players.get(1)!;
    place(h, s.move.x + 1200, s.move.y);
    s.tool = ToolKind.Bottle;
    s.toolCount = 1;
    d.tap(s.id, Btn.UseItem, { aim: Math.PI / 2, aimDist: 300 });
    d.run(secs(1));
    const decoy = w.noises.find((n) => n.kind === 'glass');
    expect(decoy).toBeTruthy();
    expect(s.tool).toBe(ToolKind.None);
    d.tap(h.id, Btn.Ability1);
    const pulse = w.events.find((e) => e.e.k === 'pulse' && e.to.includes(h.id));
    expect(pulse).toBeTruthy();
    const echoes = (pulse!.e as { echoes: number[] }).echoes;
    expect(echoes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Zach Branch's abilities", () => {
  it('Lunge doubles speed briefly and a miss costs a recovery slow', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const c = openSpot(w, 5);
    place(h, c.x - 150, c.y);
    place(w.players.get(2)!, 5800, 5800);
    const x0 = h.move.x;
    d.run(1, (p) => (p === h ? { buttons: Btn.Lunge, aim: 0, moveX: 1 } : undefined));
    d.run(secs(0.3), (p) => (p === h ? { aim: 0, moveX: 1 } : undefined));
    const lungeDist = h.move.x - x0;
    expect(lungeDist).toBeGreaterThan(w.balance.hunterSpeed * 0.33 * 1.6);
    d.run(secs(0.5), (p) => (p === h ? { aim: 0 } : undefined));
    expect(h.move.slowT).toBeGreaterThan(0.5);
    expect(h.move.lungeCd).toBeGreaterThan(10);
  });

  it("Stalker's Pulse shows jittered echoes of recent survivor noise, not exact positions", () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = openSpot(w, 6);
    place(s, c.x, c.y);
    place(h, c.x + 900, c.y);
    d.run(secs(2), (p) => (p === s ? { buttons: Btn.Run, moveX: 1 } : undefined));
    d.tap(h.id, Btn.Ability1);
    const ev = w.events.find((e) => e.e.k === 'pulse');
    const echoes = (ev!.e as { echoes: number[] }).echoes;
    expect(echoes.length).toBeGreaterThan(0);
    expect(h.pulseCd).toBeGreaterThan(BALANCE.hunter.pulse.cooldown - 1);
    // Echoes are near the survivor's path but jittered.
    const ex = echoes[0];
    expect(Math.abs(ex - c.x)).toBeLessThan(500);
  });

  it('Bloodhound reveals footprints and blood trails for a few seconds', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = openSpot(w, 7);
    place(s, c.x, c.y);
    s.health = Health.Wounded;
    place(h, c.x + 400, c.y);
    d.run(secs(3), (p) => (p === s ? { buttons: Btn.Run, moveY: 1 } : undefined));
    d.tap(h.id, Btn.Ability2);
    expect(h.bloodhoundT).toBeGreaterThan(BALANCE.hunter.bloodhound.duration - 0.5);
    const trail = w.events.filter((e) => e.e.k === 'trail').pop();
    const pts = (trail!.e as { pts: number[] }).pts;
    const kinds = new Set<number>();
    for (let i = 2; i < pts.length; i += 4) kinds.add(pts[i]);
    expect(kinds.has(0)).toBe(true);
    expect(kinds.has(1)).toBe(true);
  });

  it('Vault Smash crosses a window faster than a survivor can vault', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const win = w.map.windows[0];
    const nx = -Math.sin(win.angle);
    const ny = Math.cos(win.angle);
    place(h, win.x + nx * 35, win.y + ny * 35);
    place(w.players.get(2)!, 5800, 5800);
    d.run(2);
    d.tap(h.id, Btn.Ability3);
    expect(h.vault).not.toBeNull();
    expect(h.vault!.dur).toBeLessThan(BALANCE.survivor.vaultTime);
    d.run(secs(BALANCE.hunter.vaultSmash.time) + 2);
    const side = (h.move.x - win.x) * nx + (h.move.y - win.y) * ny;
    expect(side).toBeLessThan(0);
    expect(h.smashCd).toBeGreaterThan(BALANCE.hunter.vaultSmash.cooldown - 1);
  });

  it('terror radius rises as Zach closes in', () => {
    const w = makeWorld({ survivors: 1 });
    const d = new Driver(w);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    const c = openSpot(w, 8);
    place(s, c.x, c.y);
    place(h, c.x + 900, c.y);
    d.run(2);
    expect(s.terror).toBe(0);
    place(h, c.x + 200, c.y);
    d.run(2);
    expect(s.terror).toBeGreaterThan(0.6);
  });
});
