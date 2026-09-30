import { Action, BALANCE, BarricadeState, Btn, DEG, Health, ItemKind, angleDiff, pointSegDist2, raySegment, type InputCmd } from '@manhunt/shared';
import { canAct, type SimPlayer } from './player';
import type { World } from './World';
import { dropCarried } from './combat';

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
      fireShotgun(w, p, cmd.aim);
      p.reloadT = I.shotgun.reload;
      if (!w.testMode) {
        p.shells[0] = (p.shells[0] ?? 0) - 1;
        if (p.shells[0] <= 0) {
          p.shells.shift();
          consume(w, p, kind);
          w.emit([p.id], { k: 'item', text: 'The shotgun is empty and you drop it' });
        }
      }
      break;
    }
    case ItemKind.Energy:
      p.move.boostT = I.energy.duration;
      consume(w, p, kind);
      w.emit([p.id], { k: 'item', text: 'Energy drink! Sprint refills faster for a while.' });
      break;
    case ItemKind.Trap:
      w.traps.push({ id: w.allocEntityId(), x: p.move.x, y: p.move.y, owner: p.id, armT: I.trap.armTime });
      consume(w, p, kind);
      w.emit([p.id], { k: 'item', text: 'Galaxy gas trap planted' });
      break;
  }
}

function fireShotgun(w: World, p: SimPlayer, aim: number): void {
  const S = I.shotgun;
  const range = w.geo.raycastVision(p.move.x, p.move.y, aim, S.range);
  let hitH: SimPlayer | null = null;
  let hitD = Infinity;
  for (const h of w.order) {
    if (h.role !== 'hunter' || h.health === Health.Eliminated) continue;
    const d = Math.hypot(h.move.x - p.move.x, h.move.y - p.move.y);
    if (d > S.range + h.radius || d >= hitD) continue;
    const a = Math.atan2(h.move.y - p.move.y, h.move.x - p.move.x);
    if (Math.abs(angleDiff(a, aim)) > S.spreadDeg * DEG + Math.atan2(h.radius, Math.max(1, d))) continue;
    if (!w.geo.hasLineOfSight(p.move.x, p.move.y, h.move.x, h.move.y)) continue;
    hitH = h;
    hitD = d;
  }
  // Shane Jeans in the blast (and nearer than Zach) is shaken off.
  const sh = w.shane;
  const sd = Math.hypot(sh.x - p.move.x, sh.y - p.move.y);
  const shaneHit =
    sh.chasing && sd < Math.min(hitD, S.range + BALANCE.shane.radius) && Math.abs(angleDiff(Math.atan2(sh.y - p.move.y, sh.x - p.move.x), aim)) <= S.spreadDeg * DEG + Math.atan2(BALANCE.shane.radius, Math.max(1, sd)) && w.geo.hasLineOfSight(p.move.x, p.move.y, sh.x, sh.y);
  if (shaneHit) {
    w.emit(w.near(p.move.x, p.move.y, BALANCE.net.maxSensingRadius), { k: 'shot', x: Math.round(p.move.x), y: Math.round(p.move.y), a: Math.round(aim * 1000) / 1000, len: Math.round(sd), hit: true });
    sh.shotHit();
    return;
  }
  const len = hitH ? hitD : range;
  w.emit(w.near(p.move.x, p.move.y, BALANCE.net.maxSensingRadius), { k: 'shot', x: Math.round(p.move.x), y: Math.round(p.move.y), a: Math.round(aim * 1000) / 1000, len: Math.round(len), hit: !!hitH });
  if (!hitH) return;
  // The blast always shoves him back; the stun respects his immunity.
  const away = Math.atan2(hitH.move.y - p.move.y, hitH.move.x - p.move.x);
  hitH.move.kbT = S.kbDuration;
  hitH.move.kbDur = S.kbDuration;
  hitH.move.kbPeak = S.kbPeak;
  hitH.move.kbAng = away;
  hitH.move.lungeT = 0;
  if (stunHunter(w, hitH, S.stun, 'shotgun', p)) w.feed(`${p.name} blasted ${hitH.name} with a shotgun`);
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
  // unbroken window, Zach or an NPC.
  const B = I.bottle;
  const maxFlight = Math.hypot(w.map.width, w.map.height);
  const keep: typeof w.bottles = [];
  for (const b of w.bottles) {
    const step = B.speed * dt;
    const ang = Math.atan2(b.dy, b.dx);
    const free = Math.min(w.geo.raycastVision(b.x, b.y, ang, step + 1), windowHit(w, b.x, b.y, b.dx, b.dy, step + 1));
    const nx = b.x + b.dx * Math.min(step, free);
    const ny = b.y + b.dy * Math.min(step, free);
    const touches = (x: number, y: number, r: number): boolean => pointSegDist2(x, y, b.x, b.y, nx, ny) <= (r + B.hitRadius) ** 2;
    let hit: SimPlayer | null = null;
    for (const h of w.order) {
      if (h.role !== 'hunter' || h.health === Health.Eliminated) continue;
      if (touches(h.move.x, h.move.y, h.radius)) {
        hit = h;
        break;
      }
    }
    const sh = w.shane;
    const hitShane = !hit && touches(sh.x, sh.y, BALANCE.shane.radius);
    const hitNpc = !hit && !hitShane && ((w.sexton.alive && touches(w.sexton.x, w.sexton.y, BALANCE.sexton.radius)) || (w.chris.hittable && touches(w.chris.x, w.chris.y, BALANCE.chris.radius)));
    b.x = nx;
    b.y = ny;
    b.travelled += Math.min(step, free);
    if (hitShane) {
      w.noise(nx, ny, 900, 'glass');
      sh.bottleHit();
      continue;
    }
    if (hit) {
      const owner = w.players.get(b.owner);
      w.noise(nx, ny, 900, 'glass');
      if (stunHunter(w, hit, B.stun, 'bottle', owner)) w.feed(`${owner?.name ?? 'Someone'} smashed a bottle on ${hit.name}`);
      continue;
    }
    if (hitNpc || free <= step || b.travelled >= maxFlight) {
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
    const h = w.order.find((q) => q.role === 'hunter' && q.health !== Health.Eliminated && Math.hypot(q.move.x - t.x, q.move.y - t.y) <= T.triggerRadius);
    if (!h) return true;
    w.gases.push({ id: w.allocEntityId(), x: t.x, y: t.y, age: 0 });
    w.emit(w.near(t.x, t.y, BALANCE.net.maxSensingRadius), { k: 'gas', x: Math.round(t.x), y: Math.round(t.y) });
    w.feed(`${h.name} tripped a galaxy gas trap`);
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
        w.emit([p.id], { k: 'item', text: 'Your night vision goggles died' });
      }
    }
  }
}
