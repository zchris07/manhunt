import { describe, expect, it } from 'vitest';
import { Action, BALANCE, Btn, EntityKind, Health, ItemKind, Prompt, dashDistance, maxStamina } from '@manhunt/shared';
import { Driver, clearLane, makeWorld, openSpot, parkSexton, place } from './worldHelpers';
import { buildView, canSee, visionFor } from '../src/sim/view';
import { roomFor } from '../src/sim/interact';
import type { World } from '../src/sim/World';
import type { SimPlayer } from '../src/sim/player';

const secs = (s: number): number => Math.ceil(s * 30);
const I = BALANCE.items;
const H = BALANCE.hunter;

function lockerWorld(): { w: World; d: Driver; spot: World['map']['hidingSpots'][number] } {
  const w = makeWorld({ survivors: 2 });
  parkSexton(w);
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
    place(h, spot.exitX + Math.cos(spot.facing + 1.2) * 30, spot.exitY + Math.sin(spot.facing + 1.2) * 30);
    d.run(2);
    const view = buildView(w, h);
    expect(view.entities.some((e) => e.id === s.id)).toBe(false);
    expect(view.world.hidingOccupied.every((o) => !o)).toBe(true);
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
    // Searching takes no time.
    d.tap(h.id, Btn.Interact);
    expect(s.hideState).toBe(0);
    expect(s.health).toBe(Health.Wounded);
  });

  it('leaving is interruptible and holding breath (Space) runs the breath down', () => {
    const { w, d } = lockerWorld();
    const s = w.players.get(2)!;
    d.run(2);
    d.tap(s.id, Btn.Interact);
    d.run(secs(0.8));
    d.tap(s.id, Btn.Interact);
    expect(s.hideState).toBe(3);
    d.tap(s.id, Btn.Interact);
    expect(s.hideState).toBe(2);
    d.hold(s.id, Btn.Space, 2);
    expect(s.holdingBreath).toBe(true);
    expect(s.breath).toBeLessThan(0.8);
  });
});

/** Zach and one survivor in an open clearing, `dist` apart along +x. */
function duel(dist = 150, opts: { testMode?: boolean } = {}): { w: World; d: Driver; h: SimPlayer; s: SimPlayer; c: { x: number; y: number } } {
  const w = makeWorld({ survivors: 2, testMode: opts.testMode });
  parkSexton(w);
  const c = clearLane(w, Math.min(450, Math.abs(dist) + 150));
  const h = w.players.get(1)!;
  const s = w.players.get(2)!;
  place(s, c.x, c.y);
  place(h, c.x + dist, c.y);
  place(w.players.get(3)!, 5800, 5800);
  return { w, d: new Driver(w), h, s, c };
}

function give(p: SimPlayer, kind: ItemKind, n = 1): void {
  p.inv[kind] = n;
  if (kind === ItemKind.Goggles) p.goggles = Array.from({ length: n }, () => I.goggles.meter);
  if (kind === ItemKind.Shotgun) p.shells = Array.from({ length: n }, () => I.shotgun.shells);
}

/** Clicks with the given item selected, aiming along +x. */
function use(d: Driver, p: SimPlayer, kind: ItemKind, extra: { aim?: number; aimDist?: number } = {}): void {
  d.tap(p.id, Btn.Primary, { item: kind, aim: 0, aimDist: 300, ...extra });
}

describe('survivor items (stun, never kill)', () => {
  it('inventory: at most 2 of each kind, and only one duck confit', () => {
    const { s } = duel();
    expect(roomFor(s, 'bottle')).toBe(true);
    s.inv[ItemKind.Bottle] = 2;
    expect(roomFor(s, 'bottle')).toBe(false);
    expect(roomFor(s, 'trap')).toBe(true);
    s.confit = 1;
    expect(roomFor(s, 'confit')).toBe(false);
  });

  it('a thrown bottle stuns Zach, and stun immunity stops a chain-stun', () => {
    const { w, d, h, s } = duel(200);
    give(s, ItemKind.Bottle, 2);
    use(d, s, ItemKind.Bottle);
    d.run(secs(0.4));
    expect(h.stunT).toBeGreaterThan(0);
    expect(h.immuneT).toBeGreaterThan(I.stunImmunity);
    expect(s.inv[ItemKind.Bottle]).toBe(1);
    expect(w.events.some((e) => e.e.k === 'stun' && e.e.kind === 'bottle')).toBe(true);
    use(d, s, ItemKind.Bottle);
    d.run(secs(0.4));
    expect(s.inv[ItemKind.Bottle]).toBe(0);
    expect(s.stats.stuns).toBe(1);
    expect(h.health).not.toBe(Health.Eliminated);
  });

  it('nothing happens with an empty slot selected', () => {
    const { w, d, s } = duel();
    use(d, s, ItemKind.Bottle);
    expect(w.bottles.length).toBe(0);
  });

  it('the shotgun stuns and shoves Zach back, then reloads for 2 s; three shells per gun', () => {
    const { d, h, s, c } = duel(200);
    give(s, ItemKind.Shotgun);
    use(d, s, ItemKind.Shotgun);
    expect(h.stunT).toBeGreaterThan(0);
    d.run(secs(0.5));
    expect(h.move.x - c.x).toBeGreaterThan(240);
    expect(s.shells[0]).toBe(2);
    expect(s.reloadT).toBeGreaterThan(1);
    use(d, s, ItemKind.Shotgun);
    expect(s.shells[0]).toBe(2);
    d.run(secs(I.shotgun.reload));
    use(d, s, ItemKind.Shotgun);
    d.run(secs(I.shotgun.reload));
    use(d, s, ItemKind.Shotgun);
    expect(s.inv[ItemKind.Shotgun]).toBe(0);
    expect(s.shells.length).toBe(0);
  });

  it('night vision: on only while held, sees through walls, and is used up for good', () => {
    const { w, d, s } = duel(2000);
    give(s, ItemKind.Goggles);
    const held = { buttons: Btn.Primary, item: ItemKind.Goggles };
    d.run(1, (p) => (p.id === s.id ? held : undefined));
    expect(s.gogglesOn).toBe(true);
    const v = visionFor(w, s);
    expect(v.xray).toBe(true);
    expect(v.cone.halfAngle).toBeCloseTo(BALANCE.survivor.vision.coneHalfAngleDeg * (Math.PI / 180) * I.goggles.coneMul, 3);
    d.run(secs(1), (p) => (p.id === s.id ? held : undefined));
    expect(s.gogglesOn).toBe(true);
    d.run(1, (p) => (p.id === s.id ? { item: ItemKind.Goggles } : undefined));
    expect(s.gogglesOn).toBe(false);
    const left = s.goggles[0];
    expect(left).toBeLessThan(I.goggles.meter);
    d.run(secs(3));
    expect(s.goggles[0]).toBe(left);
    s.goggles[0] = 0.5;
    d.run(secs(1), (p) => (p.id === s.id ? held : undefined));
    expect(s.gogglesOn).toBe(false);
    expect(s.inv[ItemKind.Goggles]).toBe(0);
  });

  it('the energy drink speeds up stamina refill and adds 2 s to the meter for 20 s', () => {
    const { d, s } = duel();
    give(s, ItemKind.Energy);
    use(d, s, ItemKind.Energy);
    expect(s.move.boostT).toBeGreaterThan(I.energy.duration - 0.2);
    expect(maxStamina('survivor', s.move.boostT)).toBeGreaterThan(BALANCE.survivor.stamina.max + 1.9);
    expect(s.inv[ItemKind.Energy]).toBe(0);
  });

  it('a galaxy gas trap arms, bursts when Zach comes near, and slows him', () => {
    const { w, d, h, s, c } = duel(1000);
    give(s, ItemKind.Trap);
    use(d, s, ItemKind.Trap);
    // Planting takes 2 s (standing still).
    expect(w.traps.length).toBe(0);
    expect(s.action).toBe(Action.Plant);
    d.run(secs(I.trap.plantTime) + 1, (p) => (p.id === s.id ? { item: ItemKind.Trap } : undefined));
    expect(w.traps.length).toBe(1);
    // Semi-hidden: Zach only gets it in his view when he can see it.
    place(h, c.x + 1000, c.y);
    h.facing = 0;
    d.run(secs(I.trap.armTime) + 2, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    expect(buildView(w, h).entities.some((e) => e.kind === EntityKind.Trap)).toBe(false);
    place(s, c.x - 400, c.y);
    place(h, c.x + I.trap.triggerRadius - 20, c.y);
    d.run(secs(I.trap.spreadTime) + 2);
    expect(w.traps.length).toBe(0);
    expect(w.gases.length).toBe(1);
    expect(h.gassed).toBe(true);
    const x0 = h.move.x;
    d.run(secs(1), (p) => (p.id === h.id ? { moveX: -1 } : undefined));
    const slowed = x0 - h.move.x;
    expect(slowed).toBeLessThan(w.balance.hunterSpeed * I.trap.slowMul * 1.1);
  });

  it('duck confit revives a downed teammate instantly, once', () => {
    const { w, d, s } = duel(3000);
    const mate = w.players.get(3)!;
    place(mate, s.move.x + 30, s.move.y);
    mate.health = Health.Downed;
    s.confit = 1;
    d.run(2);
    expect(s.prompt).toBe(Prompt.ConfitRevive);
    d.tap(s.id, Btn.Interact);
    expect(mate.health).toBe(Health.Wounded);
    expect(s.confit).toBe(0);
    mate.health = Health.Downed;
    d.run(2);
    expect(s.prompt).toBe(Prompt.Revive);
  });
});

describe("Zach's kit", () => {
  it('lunge: two charges on F, a fast dash, and one charge back every 7 s', () => {
    const { d, h, s, c } = duel(3000);
    place(s, 200, 5800);
    place(h, c.x - 300, c.y);
    const x0 = h.move.x;
    d.tap(h.id, Btn.Lunge, { aim: 0 });
    d.run(secs(H.lunge.duration));
    expect(h.move.x - x0).toBeGreaterThan(dashDistance(H.lunge.peak, H.lunge.duration) * 0.8);
    expect(h.move.lungeCharges).toBe(1);
    d.tap(h.id, Btn.Lunge, { aim: Math.PI });
    expect(h.move.lungeCharges).toBe(0);
    d.run(secs(H.lunge.duration));
    const x1 = h.move.x;
    d.tap(h.id, Btn.Lunge, { aim: 0 });
    d.run(5);
    expect(h.move.x).toBeCloseTo(x1, 0);
    d.run(secs(H.lunge.recharge - 0.7));
    expect(h.move.lungeCharges).toBe(1);
    d.run(secs(H.lunge.recharge));
    expect(h.move.lungeCharges).toBe(2);
  });

  it('a lunge only has to touch a survivor to hit them', () => {
    const { h, s, d } = duel(-220);
    h.facing = 0;
    d.tap(h.id, Btn.Lunge, { aim: 0 });
    d.run(secs(H.lunge.duration));
    expect(s.health).toBe(Health.Wounded);
    expect(h.move.lungeT).toBe(0);
  });

  it('Soundcloud Burst is an aimed wave: it flies through everything and scares only who it passes', () => {
    const { w, d, h, s } = duel(3000);
    const mate = w.players.get(3)!;
    // Aim at s (3000 u to the west); the teammate stands off to the side of the wave.
    place(mate, h.move.x - 1500, h.move.y + H.burst.width);
    d.tap(h.id, Btn.Secondary, { aim: Math.PI });
    expect(h.burstCd).toBeGreaterThan(H.burst.cooldown - 0.2);
    expect(w.events.some((e) => e.e.k === 'burst')).toBe(true);
    d.run(secs(2800 / H.burst.speed - 0.1));
    expect(s.scareT).toBe(0);
    d.run(secs(0.3));
    expect(s.scareT).toBeGreaterThan(0);
    d.run(secs(2.5));
    expect(mate.scareT).toBe(0);
    expect(w.events.filter((e) => e.e.k === 'scare').map((e) => e.to[0])).toEqual([s.id]);
    // On cooldown: a second press does nothing.
    const n = w.bursts.length;
    d.tap(h.id, Btn.Secondary);
    expect(w.bursts.length).toBe(n);
  });

  it("Bloodhound is always on: running survivors leave a scent only Zach receives", () => {
    const { w, d, h, s } = duel(600);
    d.run(secs(3), (p) => (p.id === s.id ? { moveY: 1, buttons: Btn.Run } : undefined));
    const trails = w.events.filter((e) => e.e.k === 'trail');
    expect(trails.length).toBeGreaterThan(0);
    expect(trails.every((e) => e.to.length === 1 && e.to[0] === h.id)).toBe(true);
    const pts = trails.flatMap((e) => (e.e.k === 'trail' ? e.e.pts : []));
    expect(pts.length / 4).toBeGreaterThan(5);
  });

  it('Hemp Battery: picked up where Sexton fell, used once with Q for x-ray light and speed', () => {
    const { w, d, h, s } = duel(300);
    w.hempDrop = { id: w.allocEntityId(), x: h.move.x + 20, y: h.move.y };
    d.run(2);
    expect(h.prompt).toBe(Prompt.TakeHemp);
    d.tap(h.id, Btn.Interact);
    expect(h.hemp).toBe(1);
    expect(w.hempDrop).toBeNull();
    d.tap(h.id, Btn.Ability);
    expect(h.move.hempT).toBeGreaterThan(H.hemp.duration - 0.2);
    expect(h.hemp).toBe(0);
    expect(w.events.some((e) => e.e.k === 'hemp' && e.to.includes(s.id))).toBe(true);
    expect(visionFor(w, h).xray).toBe(true);
    d.run(secs(H.hemp.duration));
    expect(h.move.hempT).toBe(0);
    d.tap(h.id, Btn.Ability);
    expect(h.move.hempT).toBe(0);
  });

  it('x-ray light (hemp or goggles) sees through walls inside the cone', () => {
    const w = makeWorld();
    parkSexton(w);
    const h = w.players.get(1)!;
    // Find a wall in the warehouse and stand on either side of it.
    const seg = w.map.walls.find((s) => s.vision && Math.hypot(s.bx - s.ax, s.by - s.ay) > 200)!;
    const mx = (seg.ax + seg.bx) / 2;
    const my = (seg.ay + seg.by) / 2;
    const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    const nx = -(seg.by - seg.ay) / len;
    const ny = (seg.bx - seg.ax) / len;
    place(h, mx + nx * 60, my + ny * 60);
    h.facing = Math.atan2(-ny, -nx);
    const tx = mx - nx * 60;
    const ty = my - ny * 60;
    expect(canSee(w, h, tx, ty)).toBe(false);
    h.move.hempT = 1;
    expect(canSee(w, h, tx, ty)).toBe(true);
  });
});

describe('Sexton Science and JARVIS', () => {
  function meetSexton(): { w: World; d: Driver; h: SimPlayer; s: SimPlayer } {
    const w = makeWorld({ survivors: 2 });
    const c = openSpot(w, 3);
    const h = w.players.get(1)!;
    const s = w.players.get(2)!;
    place(h, 5800, 200);
    place(w.players.get(3)!, 5800, 5800);
    w.sexton.x = c.x;
    w.sexton.y = c.y;
    w.sexton.mode = 'idle';
    place(s, c.x + 40, c.y);
    return { w, d: new Driver(w), h, s };
  }

  it('talking to him hands over the tablet; Q fires JARVIS once for everyone to hear', () => {
    const { w, d, h, s } = meetSexton();
    d.run(1);
    expect(s.prompt).toBe(Prompt.TalkSexton);
    d.tap(s.id, Btn.Interact);
    expect(w.sexton.mode).toBe('talk');
    expect(w.events.some((e) => e.e.k === 'sexton' && e.e.say.includes('something big'))).toBe(true);
    d.run(secs(BALANCE.sexton.talkTime) + 2);
    // He waits for another E before the second line and the handoff.
    expect(s.jarvis).toBe(0);
    expect(s.prompt).toBe(Prompt.SextonMore);
    d.tap(s.id, Btn.Interact);
    expect(w.events.some((e) => e.e.k === 'sexton' && e.e.say === `This is powerful tech, ${s.name}. Be careful with it type shi`)).toBe(true);
    d.run(secs(BALANCE.sexton.secondTalkTime + BALANCE.sexton.handTime) + 2);
    expect(s.jarvis).toBe(1);
    // Then he walks away, mysteriously.
    expect(w.sexton.mode).toBe('leave');
    expect(w.events.some((e) => e.e.k === 'tablet' && e.e.to === s.id)).toBe(true);
    // Only one tablet each.
    d.run(1);
    expect(s.prompt).not.toBe(Prompt.TalkSexton);

    d.tap(s.id, Btn.Ability);
    expect(s.jarvis).toBe(2);
    expect(s.jarvisT).toBeGreaterThan(BALANCE.sexton.jarvisRadarSec - 0.2);
    const ev = w.events.find((e) => e.e.k === 'jarvis');
    expect(ev?.to).toContain(h.id);
    expect(buildView(w, s).world.radar.length).toBe(1);
    d.run(secs(BALANCE.sexton.jarvisRadarSec));
    expect(buildView(w, s).world.radar.length).toBe(0);
    const count = w.events.filter((e) => e.e.k === 'jarvis').length;
    d.tap(s.id, Btn.Ability);
    expect(w.events.filter((e) => e.e.k === 'jarvis').length).toBe(count);
  });

  it('Zach slays him in three hits and he drops a Hemp Battery', () => {
    const { w, d, h } = meetSexton();
    place(w.players.get(2)!, 200, 5800);
    const at = { x: w.sexton.x, y: w.sexton.y };
    for (let i = 0; i < 3; i++) {
      if (i > 0) expect(w.sexton.mode).toBe('flee');
      w.sexton.x = at.x;
      w.sexton.y = at.y;
      place(h, at.x - 60, at.y);
      d.tap(h.id, Btn.Primary, { aim: 0 });
      d.run(secs(H.attack.hitCooldown + H.attack.windup) + 2, (p) => (p.id === h.id ? { aim: 0 } : undefined));
    }
    expect(w.sexton.alive).toBe(false);
    expect(w.hempDrop).not.toBeNull();
  });
});

describe('testing mode', () => {
  it('fills the kit, never uses items up, and lets a player switch sides in place', () => {
    const { w, d, h, s } = duel(200, { testMode: true });
    expect(s.inv[ItemKind.Bottle]).toBe(I.maxStack);
    expect(s.jarvis).toBe(3);
    expect(h.hemp).toBe(2);
    use(d, s, ItemKind.Bottle);
    use(d, s, ItemKind.Bottle);
    use(d, s, ItemKind.Bottle);
    expect(s.inv[ItemKind.Bottle]).toBe(I.maxStack);
    d.tap(s.id, Btn.Ability);
    d.tap(s.id, Btn.Ability);
    expect(w.events.filter((e) => e.e.k === 'jarvis').length).toBe(2);
    const x = s.move.x;
    expect(w.switchRole(s.id)).toBe(true);
    expect(s.role).toBe('hunter');
    expect(s.hemp).toBe(2);
    expect(s.move.x).toBeCloseTo(x, 0);
    expect(w.switchRole(s.id)).toBe(true);
    expect(s.role).toBe('survivor');
    expect(s.inv[ItemKind.Trap]).toBe(I.maxStack);
  });

  it('teleports to a clicked map point, and survivors see their own scent trail', () => {
    const { w, d, s } = duel(200, { testMode: true });
    w.teleport(s.id, 1234, 2345);
    expect(Math.hypot(s.move.x - 1234, s.move.y - 2345)).toBeLessThan(60);
    const c = clearLane(w, 450);
    place(s, c.x - 300, c.y);
    d.run(secs(3), (p) => (p.id === s.id ? { moveX: 1, buttons: Btn.Run } : undefined));
    expect(w.events.some((e) => e.e.k === 'trail' && e.to.includes(s.id))).toBe(true);
    // Outside testing mode there is no teleporting.
    const n = duel(200);
    const x0 = n.s.move.x;
    n.w.teleport(n.s.id, 1234, 2345);
    expect(n.s.move.x).toBe(x0);
  });

  it('switching sides is refused outside testing mode', () => {
    const { w, s } = duel();
    expect(w.switchRole(s.id)).toBe(false);
    expect(s.role).toBe('survivor');
  });
});
