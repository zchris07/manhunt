import { Action, BALANCE, Health, type MatchResult } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';

const O = BALANCE.objectives;

/** Result of a skill check from the client (or a timeout, which counts as a miss). */
export function skillCheckResult(w: World, p: SimPlayer, id: number, result: 'miss' | 'good' | 'great'): void {
  if (!p.skill || p.skill.id !== id) return;
  // Reject answers that arrive before the needle could have reached the zone.
  const elapsed = (w.time - p.skill.issued) * 1000;
  const sc = O.skillCheck;
  if (result !== 'miss' && elapsed < sc.warnMs + sc.needleTime * 1000 * sc.minAnswerFraction - sc.latencySlackMs) result = 'miss';
  p.skill = null;
  if (p.action !== Action.Repair || p.actionTarget < 0) return;
  const g = w.gens[p.actionTarget];
  const def = w.map.generators[p.actionTarget];
  if (result === 'miss') {
    g.progress = Math.max(0, g.progress - O.skillCheck.failPenalty);
    w.noise(def.x, def.y, O.skillCheck.failNoise, 'gen_explode');
  } else if (result === 'great') {
    g.progress = Math.min(0.999, g.progress + O.skillCheck.greatBonus);
  }
  w.emit([p.id], { k: 'skillResult', ok: result !== 'miss', great: result === 'great' });
}

export function updateObjectives(w: World, dt: number): void {
  // Generators.
  const workers = new Array<number>(w.gens.length).fill(0);
  for (const p of w.order) if (p.role === 'survivor' && p.action === Action.Repair && p.actionTarget >= 0) workers[p.actionTarget]++;
  w.gens.forEach((g, gi) => {
    g.workers = workers[gi];
    if (g.repaired) return;
    if (g.workers > 0 && !w.gate.powered) {
      const mul = 1 + O.coopStep * (g.workers - 1);
      g.progress += (mul / w.balance.repairTime) * dt;
      g.regressing = false;
    } else if (g.regressing) {
      g.progress -= O.regressPerSec * dt;
      if (g.progress <= 0) {
        g.progress = 0;
        g.regressing = false;
      }
    }
    if (g.progress >= 1) {
      g.progress = 1;
      g.repaired = true;
      g.regressing = false;
      for (const p of w.order) if (p.action === Action.Repair && p.actionTarget === gi) w.cancelAction(p);
      w.emit('all', { k: 'genDone', id: gi });
      const repaired = w.gens.filter((x) => x.repaired).length;
      w.feed(`Generator restored (${Math.min(repaired, w.balance.requiredGenerators)}/${w.balance.requiredGenerators})`);
      if (repaired >= w.balance.requiredGenerators && !w.gate.powered) {
        w.gate.powered = true;
        w.emit('all', { k: 'gatePowered' });
        w.feed('The exit gate has power');
        for (const p of w.order) if (p.action === Action.Repair) w.cancelAction(p);
      }
    }
  });

  // Exit gate.
  if (w.gate.powered && !w.gate.open) {
    const openers = w.order.filter((p) => p.action === Action.OpenGate);
    if (openers.length) {
      w.gate.progress = Math.min(1, w.gate.progress + dt / O.gateOpenTime);
      if (w.gate.progress >= 1) {
        w.gate.open = true;
        w.geo.setDynamicActive(w.map.gate.dyn, false);
        for (const p of openers) w.cancelAction(p);
        w.emit('all', { k: 'gateOpen' });
        w.feed('The gate is open');
      }
    }
  }

  // Escape through the open gate.
  if (w.gate.open) {
    for (const p of w.order) {
      if (p.role !== 'survivor' || (p.health !== Health.Healthy && p.health !== Health.Wounded) || p.hideState !== 0) continue;
      if (!w.mw.inExitZone(p.move.x, p.move.y)) continue;
      w.cancelAction(p);
      p.health = Health.Escaped;
      p.stats.outcome = 'escaped';
      p.endedTime = w.time;
      p.spectating = w.defaultSpectateTarget(p.id);
      w.emit('all', { k: 'escaped', victim: p.id });
      w.feed(`${p.name} escaped`);
    }
  }

  // Disconnected players past the grace period forfeit.
  for (const p of w.order) {
    if (p.connected || p.disconnectedAt <= 0 || w.testMode) continue;
    if (w.time - p.disconnectedAt > BALANCE.net.reconnectGraceSec) {
      p.disconnectedAt = -1;
      w.forfeit(p.id);
    }
  }

  // Keep spectators pointed at someone still playing.
  for (const p of w.order) {
    const watching = p.role === 'spectator' || p.health === Health.Escaped || p.health === Health.Eliminated;
    if (!watching) continue;
    const t = w.players.get(p.spectating);
    if (!t || t.id === p.id || t.health === Health.Escaped || t.health === Health.Eliminated || t.role === 'spectator') p.spectating = w.defaultSpectateTarget(p.id);
  }
}

/** Cycles a spectator to the next live player. */
export function cycleSpectate(w: World, p: SimPlayer, dir: 1 | -1): void {
  const live = w.order.filter((q) => q.id !== p.id && (q.role === 'hunter' ? q.health !== Health.Eliminated : q.role === 'survivor' && q.health !== Health.Escaped && q.health !== Health.Eliminated));
  if (!live.length) return;
  const i = live.findIndex((q) => q.id === p.spectating);
  p.spectating = live[(i + dir + live.length) % live.length].id;
}

export function checkWin(w: World): void {
  if (w.result) return;
  const survivors = w.order.filter((p) => p.role === 'survivor');
  const hunters = w.order.filter((p) => p.role === 'hunter');
  const escaped = survivors.filter((p) => p.health === Health.Escaped).length;
  const eliminated = survivors.filter((p) => p.health === Health.Eliminated).length;
  // The night goes on while anyone is still on their feet (or hiding).
  const standing = survivors.filter((p) => p.health === Health.Healthy || p.health === Health.Wounded).length;
  const need = Math.min(w.balance.escapeNeeded, survivors.length);
  const verdict = (): MatchResult['winner'] => (escaped >= need ? 'survivors' : 'hunters');
  let winner: MatchResult['winner'] | null = null;
  let reason = '';
  if (survivors.length > 0 && standing === 0) {
    winner = verdict();
    const down = survivors.length - escaped - eliminated;
    reason = `${escaped} escaped, ${eliminated} eliminated${down ? `, ${down} left incapacitated` : ''}`;
  } else if (w.time >= w.balance.timeLimit) {
    winner = 'hunters';
    reason = 'Time ran out';
  } else if (hunters.length > 0 && hunters.every((h) => h.health === Health.Eliminated)) {
    winner = 'survivors';
    reason = 'The hunters left';
  }
  if (!winner) return;
  for (const p of survivors) {
    if (p.health !== Health.Escaped && p.health !== Health.Eliminated) p.stats.outcome = winner === 'hunters' ? 'eliminated' : 'survived';
  }
  w.result = {
    winner,
    reason,
    durationSec: Math.round(w.time),
    escaped,
    eliminated,
    survivors: survivors.length,
    hunters: hunters.length,
    generatorsRepaired: w.gens.filter((g) => g.repaired).length,
    generatorsRequired: w.balance.requiredGenerators,
    stats: w.order.filter((p) => p.role !== 'spectator').map((p) => ({ ...p.stats, repairSec: Math.round(p.stats.repairSec), timeAlive: Math.round(p.stats.timeAlive) })),
  };
}
