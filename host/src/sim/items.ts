import { Action, BALANCE, BarricadeState, Btn, DEG, Health, ITEM_NAMES, ItemKind, maxStamina, overlapsCollider, pointSegDist2, rayCircle, raySegment, type InputCmd } from '@manhunt/shared';
import { canAct, type SimPlayer } from './player';
import type { Drop, World } from './World';
import { dropCarried, hurtSurvivor } from './combat';
import type { NpcTarget } from './npc';

const I = BALANCE.items;

function interruptHunter(w: World, h: SimPlayer): void {
  if (h.action !== Action.None) w.cancelAction(h);
  h.attackWindup = 0;
  h.chargeT = -1;
  h.move.lungeT = 0;
  if (h.carrying) dropCarried(w, h);
}

/**
 * Stuns Zach (he can never be killed). After each stun he is immune for a short while so
 * survivors cannot chain-stun him. Returns false if he is immune.
 */
export function stunHunter(w: World, h: SimPlayer, seconds: number, kind: string, by?: SimPlayer): boolean {
  if (h.role !== 'hunter' || h.immuneT > 0 || h.health === Health.Eliminated) return false;
  const dur = seconds * w.balance.stunMul;
  h.stunT = Math.max(h.stunT, dur);
  h.immuneT = dur + I.stunImmunity;
  interruptHunter(w, h);
  h.stats.stunnedTimes++;
  if (by) by.stats.stuns++;
  w.emit('all', { k: 'stun', target: h.id, kind });
  return true;
}

/** Slams a standing barricade down across its gap, stunning Zach if he is in it. */
export function dropBarricade(w: World, p: SimPlayer, bi: number): void {
  if (w.barricades[bi] !== BarricadeState.Up) return;
  const b = w.map.barricades[bi];
  const ux = Math.cos(b.angle) * (b.length / 2);
  const uy = Math.sin(b.angle) * (b.length / 2);
  const stunned: SimPlayer[] = [];
  for (const h of w.order) {
    if (h.role !== 'hunter') continue;
    const d2 = pointSegDist2(h.move.x, h.move.y, b.x - ux, b.y - uy, b.x + ux, b.y + uy);
    if (d2 < (I.barricade.slamRadius + h.radius) ** 2) stunned.push(h);
  }
  w.setBarricade(bi, BarricadeState.Down);
  w.barricadeHits[bi] = 0;
  w.noise(b.x, b.y, 700, 'barricade');
  for (const h of stunned) {
    if (stunHunter(w, h, I.barricade.stun, 'barricade', p)) w.feed(`${p.name} slammed a barricade on ${h.name}`);
  }
}

/** Uses up one of an item (testing mode never runs out). */
function consume(w: World, p: SimPlayer, kind: ItemKind): void {
  if (w.testMode) return;
  p.inv[kind] = Math.max(0, p.inv[kind] - 1);
}

/** Left click: use the item in the selected slot. */
export function useItem(w: World, p: SimPlayer, cmd: InputCmd): void {
  const kind = p.selItem as ItemKind;
  if (!kind || p.inv[kind] <= 0 || p.action !== Action.None || !canAct(p)) return;
  switch (kind) {
    case ItemKind.Bottle: {
      const dx = Math.cos(cmd.aim);
      const dy = Math.sin(cmd.aim);
      w.bottles.push({ id: w.allocEntityId(), x: p.move.x + dx * (p.radius + 4), y: p.move.y + dy * (p.radius + 4), dx, dy, travelled: 0, owner: p.id });
      consume(w, p, kind);
      break;
    }
    case ItemKind.Goggles:
      // Held, not toggled: see updateItems.
      break;
    case ItemKind.Shotgun: {
      if (p.reloadT > 0) return;
      fireShotgun(w, p, cmd.aim, I.shotgun.pelletDamage);
      p.reloadT = p.golden ? I.golden.reload : I.shotgun.reload;
      if (!w.testMode) {
        p.shells[0] = (p.shells[0] ?? 0) - 1;
        if (p.shells[0] <= 0) {
          p.shells.shift();
          consume(w, p, kind);
          w.emit([p.id], { k: 'item', text: p.golden ? 'Golden pump empty' : 'Shotgun empty' });
          p.golden = false;
        }
      }
      break;
    }
    case ItemKind.Energy: {
      p.move.boostT = I.energy.duration;
      // The (now longer) sprint meter fills up at once.
      p.move.stamina = maxStamina('survivor', p.move.boostT);
      p.move.staminaLock = 0;
      p.move.sprintBlocked = 0;
      consume(w, p, kind);
      w.emit([p.id], { k: 'item', text: 'Energy drink' });
      break;
    }
    case ItemKind.Trap:
      // Planting takes a moment; moving cancels it.
      w.startAction(p, Action.Plant, I.trap.plantTime, 0);
      break;
  }
}

/** The plant finished: the trap goes down. */
export function plantTrap(w: World, p: SimPlayer): void {
  if (p.inv[ItemKind.Trap] <= 0) return;
  w.traps.push({ id: w.allocEntityId(), x: p.move.x, y: p.move.y, owner: p.id, armT: I.trap.armTime });
  consume(w, p, ItemKind.Trap);
  w.emit([p.id], { k: 'item', text: 'Trap planted' });
}

/** Zach's golden pump (it replaces his machete until the shots run out). */
export function fireZachPump(w: World, h: SimPlayer, aim: number): void {
  if (h.pump <= 0 || h.reloadT > 0 || !canAct(h) || h.carrying || h.action !== Action.None) return;
  fireShotgun(w, h, aim, I.zachPump.pelletDamage);
  h.reloadT = I.zachPump.reload;
  if (!w.testMode) h.pump--;
  if (h.pump <= 0) w.emit([h.id], { k: 'item', text: 'Golden pump empty' });
}

/**
 * Eight pellets with random bloom inside the cone. Each flies on until it hits something
 * solid or someone; windows in the way shatter and let it through.
 */
function fireShotgun(w: World, p: SimPlayer, aim: number, pelletDamage: number): void {
  const S = I.shotgun;
  const zachGun = p.role === 'hunter';
  const ox = p.move.x;
  const oy = p.move.y;
  const pellets: number[] = [];
  const onSurvivor = new Map<SimPlayer, number>();
  const npcs = new Set<NpcTarget>();
  let zach: SimPlayer | null = null;
  const targets = w.npcTargets();
  for (let i = 0; i < S.pellets; i++) {
    const a = aim + w.rng.range(-1, 1) * S.spreadDeg * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const sx = ox + dx * (p.radius + 2);
    const sy = oy + dy * (p.radius + 2);
    const max = S.range;
    let wall = w.geo.raycastVision(sx, sy, a, max);
    // Glass shatters and the pellet carries on.
    for (let guard = 0; guard < 8; guard++) {
      const win = nearestWindow(w, sx, sy, dx, dy, wall);
      if (!win) break;
      w.breakWindow(win.i);
      w.noise(sx + dx * win.t, sy + dy * win.t, 800, 'glass');
    }
    wall = Math.min(wall, max);
    let best = wall;
    let hitP: SimPlayer | null = null;
    let hitN: NpcTarget | null = null;
    for (const q of w.order) {
      if (q === p) continue;
      const survivor = q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2;
      const hunter = !zachGun && q.role === 'hunter' && q.health !== Health.Eliminated;
      if (!survivor && !hunter) continue;
      const t = rayCircle(sx, sy, dx, dy, q.move.x, q.move.y, q.radius);
      if (t < best) {
        best = t;
        hitP = q;
        hitN = null;
      }
    }
    for (const n of targets) {
      const t = rayCircle(sx, sy, dx, dy, n.x, n.y, n.hitRadius);
      if (t < best) {
        best = t;
        hitN = n;
        hitP = null;
      }
    }
    pellets.push(Math.round(a * 1000), Math.round(best + p.radius + 2));
    if (hitN) npcs.add(hitN);
    else if (hitP?.role === 'hunter') zach = hitP;
    else if (hitP) onSurvivor.set(hitP, (onSurvivor.get(hitP) ?? 0) + 1);
  }
  const hit = zach !== null || onSurvivor.size > 0;
  w.emit(w.near(ox, oy, BALANCE.net.maxSensingRadius), { k: 'shot', x: Math.round(ox), y: Math.round(oy), p: pellets, hit, gold: zachGun || p.golden });
  w.noise(ox, oy, 1100, 'shot');
  for (const [q, n] of onSurvivor) {
    if (zachGun) {
      // Zach's pump: a short stun and a shove away from the blast.
      const Z = I.zachPump;
      q.stunT = Math.max(q.stunT, Z.stun);
      q.move.kbT = Z.kbDuration;
      q.move.kbDur = Z.kbDuration;
      q.move.kbPeak = Z.kbPeak;
      q.move.kbAng = Math.atan2(q.move.y - oy, q.move.x - ox);
    }
    hurtSurvivor(w, q, n * pelletDamage, p, 'pellet');
  }
  for (const n of npcs) n.itemHit(p, 'shot');
  if (!zach) return;
  // The blast always shoves Zach back; the stun respects his immunity.
  const away = Math.atan2(zach.move.y - oy, zach.move.x - ox);
  zach.move.kbT = S.kbDuration;
  zach.move.kbDur = S.kbDuration;
  zach.move.kbPeak = S.kbPeak;
  zach.move.kbAng = away;
  zach.move.lungeT = 0;
  if (stunHunter(w, zach, S.stun, 'shotgun', p)) w.feed(`${p.name} blasted ${zach.name} with a ${p.golden ? 'golden pump' : 'shotgun'}`);
}

/** The first unbroken window a ray meets before `max`, if any. */
function nearestWindow(w: World, x: number, y: number, dx: number, dy: number, max: number): { i: number; t: number } | null {
  const ms = w.geo.moveSeg;
  let best: { i: number; t: number } | null = null;
  w.geo.windowSegs.forEach((m, i) => {
    if (w.windowsBroken[i]) return;
    const o = m * 4;
    const t = raySegment(x, y, dx, dy, ms[o], ms[o + 1], ms[o + 2], ms[o + 3]);
    if (t < max && (!best || t < best.t)) best = { i, t };
  });
  return best;
}

/** G: drop one of the selected item on the ground for a teammate. */
export function dropItem(w: World, p: SimPlayer): void {
  const kind = p.selItem as ItemKind;
  if (!kind || p.inv[kind] <= 0 || !canAct(p) || p.action !== Action.None) return;
  const d: Drop = { id: w.allocEntityId(), x: p.move.x, y: p.move.y, kind, golden: false, amount: 0 };
  if (kind === ItemKind.Goggles) d.amount = (w.testMode ? I.goggles.meter : p.goggles.pop()) ?? I.goggles.meter;
  if (kind === ItemKind.Shotgun) {
    d.golden = p.golden;
    d.amount = (w.testMode ? (p.golden ? I.golden.shells : I.shotgun.shells) : p.shells.pop()) ?? I.shotgun.shells;
    if (!w.testMode) p.golden = false;
  }
  if (!w.testMode) p.inv[kind]--;
  placeDrop(w, d, p.move.x + Math.cos(p.facing) * 26, p.move.y + Math.sin(p.facing) * 26);
  w.emit([p.id], { k: 'item', text: `Dropped: ${ITEM_NAMES[kind]}${d.golden ? ' (golden pump)' : ''}` });
}

/** Puts a dropped item on the ground at (x,y), or at the dropper's feet if that's blocked. */
export function placeDrop(w: World, d: Drop, x: number, y: number): void {
  if (!overlapsCollider(w.geo, x, y, 12) && w.geo.hasLineOfSight(d.x, d.y, x, y)) {
    d.x = x;
    d.y = y;
  }
  w.drops.push(d);
}

/** A survivor picks up a dropped item (a golden pump and a shotgun swap places). */
export function pickUpDrop(w: World, p: SimPlayer, id: number): void {
  const i = w.drops.findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = w.drops[i];
  if (d.kind === ItemKind.Shotgun) {
    if (!giveShotgun(w, p, d.golden, d.amount)) return;
  } else {
    if (p.inv[d.kind] >= I.maxStack) return;
    p.inv[d.kind]++;
    if (d.kind === ItemKind.Goggles) p.goggles.push(d.amount);
  }
  w.drops.splice(i, 1);
  w.emit([p.id], { k: 'item', text: `Picked up: ${ITEM_NAMES[d.kind]}${d.golden ? ' (golden pump)' : ''}` });
}

/**
 * Puts a shotgun (or the golden pump) in the shotgun slot. The golden pump fills the slot on
 * its own: getting one drops your shotguns, and picking up a shotgun drops the golden pump.
 */
export function giveShotgun(w: World, p: SimPlayer, golden: boolean, shells: number): boolean {
  const S = ItemKind.Shotgun;
  if (golden || p.golden) {
    // Swap: whatever is in the slot goes on the ground.
    while (p.inv[S] > 0) {
      const d: Drop = { id: w.allocEntityId(), x: p.move.x, y: p.move.y, kind: S, golden: p.golden, amount: p.shells.pop() ?? I.shotgun.shells };
      p.inv[S]--;
      placeDrop(w, d, p.move.x - Math.cos(p.facing) * 24, p.move.y - Math.sin(p.facing) * 24);
    }
    p.golden = golden;
  } else if (p.inv[S] >= I.maxStack) return false;
  p.inv[S]++;
  p.shells.push(shells);
  return true;
}

/** Distance along a ray to the nearest unbroken window (bottles shatter on the glass). */
function windowHit(w: World, x: number, y: number, dx: number, dy: number, max: number): number {
  const ms = w.geo.moveSeg;
  let best = max;
  w.geo.windowSegs.forEach((m, i) => {
    if (w.windowsBroken[i]) return;
    const o = m * 4;
    const t = raySegment(x, y, dx, dy, ms[o], ms[o + 1], ms[o + 2], ms[o + 3]);
    if (t < best) best = t;
  });
  return best;
}

export function updateItems(w: World, dt: number): void {
  // Bottles in flight fly on until they hit something: a wall, a tree, a closed door, an
  // unbroken window, Zach, another survivor or an NPC.
  const B = I.bottle;
  const maxFlight = Math.hypot(w.map.width, w.map.height);
  const npcs = w.npcTargets();
  const keep: typeof w.bottles = [];
  for (const b of w.bottles) {
    const step = B.speed * dt;
    const ang = Math.atan2(b.dy, b.dx);
    const free = Math.min(w.geo.raycastVision(b.x, b.y, ang, step + 1), windowHit(w, b.x, b.y, b.dx, b.dy, step + 1));
    const move = Math.min(step, free);
    // The first person or NPC along this tick's flight.
    let best = move + B.hitRadius;
    let hitP: SimPlayer | null = null;
    let hitN: NpcTarget | null = null;
    for (const q of w.order) {
      if (q.id === b.owner) continue;
      const ok = q.role === 'hunter' ? q.health !== Health.Eliminated : q.role === 'survivor' && (q.health === Health.Healthy || q.health === Health.Wounded) && q.hideState !== 2;
      if (!ok) continue;
      const t = rayCircle(b.x, b.y, b.dx, b.dy, q.move.x, q.move.y, q.radius + B.hitRadius);
      if (t < best) {
        best = t;
        hitP = q;
      }
    }
    for (const n of npcs) {
      const t = rayCircle(b.x, b.y, b.dx, b.dy, n.x, n.y, n.hitRadius + B.hitRadius);
      if (t < best) {
        best = t;
        hitN = n;
        hitP = null;
      }
    }
    const adv = hitP || hitN ? Math.min(move, best) : move;
    const nx = b.x + b.dx * adv;
    const ny = b.y + b.dy * adv;
    b.x = nx;
    b.y = ny;
    b.travelled += adv;
    const owner = w.players.get(b.owner);
    if (hitN) {
      w.noise(nx, ny, 900, 'glass');
      if (owner) hitN.itemHit(owner, 'bottle');
      continue;
    }
    if (hitP?.role === 'hunter') {
      w.noise(nx, ny, 900, 'glass');
      if (stunHunter(w, hitP, B.stun, 'bottle', owner)) w.feed(`${owner?.name ?? 'Someone'} smashed a bottle on ${hitP.name}`);
      continue;
    }
    if (hitP) {
      w.noise(nx, ny, 900, 'glass');
      hurtSurvivor(w, hitP, B.damage, owner ?? null, 'bottle');
      continue;
    }
    if (free <= step || b.travelled >= maxFlight) {
      w.noise(nx, ny, 900, 'glass');
      continue;
    }
    keep.push(b);
  }
  w.bottles = keep;

  // Gas traps: arm, then burst into galaxy gas when Zach comes close.
  const T = I.trap;
  w.traps = w.traps.filter((t) => {
    t.armT = Math.max(0, t.armT - dt);
    if (t.armT > 0) return true;
    // Zach, an alerted Shane Jeans or a raging Plasma sets it off.
    const near = (x: number, y: number): boolean => Math.hypot(x - t.x, y - t.y) <= T.triggerRadius;
    const h = w.order.find((q) => q.role === 'hunter' && q.health !== Health.Eliminated && near(q.move.x, q.move.y));
    const who = h ? h.name : w.shane.chasing && near(w.shane.x, w.shane.y) ? 'Shane Jeans' : w.plasma.raging && near(w.plasma.x, w.plasma.y) ? 'Plasma.TTV' : '';
    if (!who) return true;
    w.gases.push({ id: w.allocEntityId(), x: t.x, y: t.y, age: 0 });
    w.emit(w.near(t.x, t.y, BALANCE.net.maxSensingRadius), { k: 'gas', x: Math.round(t.x), y: Math.round(t.y) });
    w.feed(`${who} tripped a galaxy gas trap`);
    return false;
  });
  for (const p of w.order) p.gassed = false;
  w.gases = w.gases.filter((g) => {
    g.age += dt;
    const r = T.gasRadius * Math.min(1, g.age / T.spreadTime);
    for (const h of w.order) {
      if (h.role !== 'hunter' || Math.hypot(h.move.x - g.x, h.move.y - g.y) > r) continue;
      h.gassed = true;
      h.move.slowT = Math.max(h.move.slowT, 0.2);
      h.move.slowMul = Math.min(h.move.slowMul, T.slowMul);
    }
    // NPCs in the gas: Shane gives up his chase, Sexton is slowed, Plasma is blinded and slowed.
    const inGas = (x: number, y: number): boolean => Math.hypot(x - g.x, y - g.y) <= r;
    if (inGas(w.shane.x, w.shane.y)) w.shane.gassed();
    if (inGas(w.sexton.x, w.sexton.y)) w.sexton.gasT = 0.25;
    if (inGas(w.plasma.x, w.plasma.y)) w.plasma.gasT = 0.25;
    return g.age < T.gasTime;
  });

  for (const p of w.order) {
    if (p.role !== 'survivor') continue;
    p.reloadT = Math.max(0, p.reloadT - dt);
    p.scareT = Math.max(0, p.scareT - dt);
    p.jarvisT = Math.max(0, p.jarvisT - dt);
    // Night vision is on only while left click is held with the goggles selected.
    const holding = (p.lastCmd.buttons & Btn.Primary) !== 0 && p.selItem === ItemKind.Goggles && p.inv[ItemKind.Goggles] > 0;
    p.gogglesOn = holding && (canAct(p) || p.health === Health.Downed) && p.hideState === 0 && (w.testMode || (p.goggles[0] ?? 0) > 0);
    if (p.gogglesOn && !w.testMode) {
      p.goggles[0] = (p.goggles[0] ?? 0) - dt;
      if (p.goggles[0] <= 0) {
        // This pair is spent: it's gone.
        p.goggles.shift();
        p.inv[ItemKind.Goggles] = Math.max(0, p.inv[ItemKind.Goggles] - 1);
        p.gogglesOn = false;
        w.emit([p.id], { k: 'item', text: 'Goggles dead' });
      }
    }
  }
}
