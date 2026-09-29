import { BALANCE, BarricadeState, Health } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { nearbyBarricade, nearbyWindow, startVault } from './interact';

const H = BALANCE.hunter;

/** Ids of everyone who should see what hunter `h` sees (h plus spectators following h). */
function hunterAudience(w: World, h: SimPlayer): number[] {
  return w.order.filter((p) => p.id === h.id || ((p.role === 'spectator' || p.health === Health.Eliminated || p.health === Health.Escaped) && p.spectating === h.id)).map((p) => p.id);
}

/**
 * Stalker's Pulse: a radial ping showing recent survivor activity (repairs, running, noisy
 * hiding, decoys) as fading, jittered echoes, never exact positions.
 */
export function tryPulse(w: World, h: SimPlayer): void {
  if (h.pulseCd > 0) return;
  const P = H.pulse;
  h.pulseCd = P.cooldown;
  const echoes: number[] = [];
  for (const n of w.noises) {
    if (!n.survivor) continue;
    const age = w.time - n.t;
    if (age > P.historySec) continue;
    if (Math.hypot(n.x - h.move.x, n.y - h.move.y) > P.radius) continue;
    echoes.push(Math.round(n.x + w.rng.range(-P.jitter, P.jitter)), Math.round(n.y + w.rng.range(-P.jitter, P.jitter)), Math.round(age * 10));
    if (echoes.length >= 90) break;
  }
  w.emit(hunterAudience(w, h), { k: 'pulse', echoes });
  // Survivors nearby hear the ping: fair warning.
  w.noise(h.move.x, h.move.y, BALANCE.noise.pulse, 'pulse', false);
}

/** Bloodhound: footprints and blood trails become visible to Zach for a few seconds. */
export function tryBloodhound(w: World, h: SimPlayer): void {
  if (h.bloodhoundCd > 0) return;
  h.bloodhoundCd = H.bloodhound.cooldown;
  h.bloodhoundT = H.bloodhound.duration;
  sendTrail(w, h);
  w.noise(h.move.x, h.move.y, BALANCE.noise.sniff, 'sniff', false);
}

function sendTrail(w: World, h: SimPlayer): void {
  const pts: number[] = [];
  const r = H.bloodhound.radius;
  for (const t of w.trails) {
    const age = w.time - t.t;
    if (age > H.bloodhound.trailHistorySec) continue;
    if (Math.abs(t.x - h.move.x) > r || Math.abs(t.y - h.move.y) > r) continue;
    pts.push(Math.round(t.x), Math.round(t.y), t.kind, Math.round(age * 10));
    if (pts.length >= 600) break;
  }
  w.emit(hunterAudience(w, h), { k: 'trail', pts });
}

/** Vault Smash: crash through a window or dropped barricade faster than a survivor vaults. */
export function tryVaultSmash(w: World, h: SimPlayer): void {
  if (h.smashCd > 0 || h.carrying || h.vault) return;
  const bi = nearbyBarricade(w, h, BarricadeState.Down);
  if (bi >= 0) {
    w.setBarricade(bi, BarricadeState.Broken);
    const b = w.map.barricades[bi];
    w.noise(b.x, b.y, BALANCE.noise.smash, 'smash', false);
    h.smashCd = H.vaultSmash.cooldown;
    h.move.slowT = Math.max(h.move.slowT, H.vaultSmash.time);
    h.move.slowMul = Math.min(h.move.slowMul, H.smashBreakSlowMul);
    return;
  }
  const wi = nearbyWindow(w, h);
  if (wi >= 0 && startVault(w, h, wi, null, true)) {
    h.smashCd = H.vaultSmash.cooldown;
    w.noise(w.map.windows[wi].x, w.map.windows[wi].y, BALANCE.noise.windowSmash, 'smash', false);
  }
}

export function updateAbilities(w: World, dt: number): void {
  for (const h of w.order) {
    if (h.role !== 'hunter') continue;
    h.pulseCd = Math.max(0, h.pulseCd - dt);
    h.bloodhoundCd = Math.max(0, h.bloodhoundCd - dt);
    h.smashCd = Math.max(0, h.smashCd - dt);
    if (h.bloodhoundT > 0) {
      const before = h.bloodhoundT;
      h.bloodhoundT = Math.max(0, h.bloodhoundT - dt);
      // Refresh the trail twice a second while active.
      if (Math.floor(before * 2) !== Math.floor(h.bloodhoundT * 2) && h.bloodhoundT > 0) sendTrail(w, h);
    }
  }
}
