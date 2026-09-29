import { Action, BALANCE, Health, type MatchResult } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';

const O = BALANCE.objectives;

/** Issues a timing minigame to a repairing survivor. */
function issueSkillCheck(w: World, p: SimPlayer): void {
  const sc = O.skillCheck;
  const id = w.skillSeq++;
  const delayMs = 650;
  const needleMs = sc.needleTime * 1000;
  const zone = w.rng.range(0.4, 0.82);
  p.skill = { id, issued: w.time, deadline: w.time + (delayMs + needleMs + sc.responseGraceMs) / 1000 };
  w.emit([p.id], { k: 'skill', id, delayMs, zone, size: sc.zoneSize, great: sc.greatSize, needleMs });
}

/** Result of a skill check from the client (or a timeout, which counts as a miss). */
export function skillCheckResult(w: World, p: SimPlayer, id: number, result: 'miss' | 'good' | 'great'): void {
  if (!p.skill || p.skill.id !== id) return;
  // Reject answers that arrive before the needle could have reached the zone.
  const elapsed = (w.time - p.skill.issued) * 1000;
  if (result !== 'miss' && elapsed < 650 + O.skillCheck.needleTime * 1000 * 0.3 - 250) result = 'miss';
  p.skill = null;
  if (p.action !== Action.Repair || p.actionTarget < 0) return;
  const g = w.gens[p.actionTarget];
  const def = w.map.generators[p.actionTarget];
  if (result === 'miss') {
    g.progress = Math.max(0, g.progress - O.skillCheck.failPenalty);
    w.noise(def.x, def.y, O.skillCheck.failNoise, 'gen_explode', true);
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
    const def = w.map.generators[gi];
    if (g.workers > 0 && !w.gate.powered) {
      const mul = O.coopMul[Math.min(g.workers, O.coopMul.length) - 1];
      g.progress += (mul / w.balance.repairTime) * dt;
      g.regressing = false;
      if (Math.floor(w.time) !== Math.floor(w.time - dt)) w.noises.push({ x: def.x, y: def.y, t: w.time, kind: 'repair', survivor: true });
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
      w.noise(def.x, def.y, 2600, 'gen_done', false);
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

  // Skill checks: issue while repairing; time out unanswered ones.
  for (const p of w.order) {
    if (p.role !== 'survivor') continue;
    if (p.skill && w.time > p.skill.deadline) skillCheckResult(w, p, p.skill.id, 'miss');
    if (p.action === Action.Repair && !p.skill && w.rng.chance(O.skillCheck.chancePerSec * dt)) issueSkillCheck(w, p);
  }

  // Exit gate.
  if (w.gate.powered && !w.gate.open) {
    const openers = w.order.filter((p) => p.action === Action.OpenGate);
    if (openers.length) {
      w.gate.progress = Math.min(1, w.gate.progress + dt / O.gateOpenTime);
      if (Math.floor(w.time * 2) !== Math.floor((w.time - dt) * 2)) {
        w.noise(w.map.gate.leverX, w.map.gate.leverY, O.gateNoise, 'gate', true);
      }
      if (w.gate.progress >= 1) {
        w.gate.open = true;
        w.geo.setDynamicActive(w.map.gate.dyn, false);
        for (const p of openers) w.cancelAction(p);
        w.emit('all', { k: 'gateOpen' });
        w.noise(w.map.gate.x, w.map.gate.y, 3000, 'gate_open', false);
        w.feed('The gate is open. RUN.');
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
    if (p.connected || p.disconnectedAt <= 0) continue;
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
  const remaining = survivors.length - escaped - eliminated;
  const need = Math.min(w.balance.escapeNeeded, survivors.length);
  let winner: MatchResult['winner'] | null = null;
  let reason = '';
  if (escaped >= need) {
    winner = 'survivors';
    reason = `${escaped} of ${survivors.length} survivors escaped`;
  } else if (escaped + remaining < need) {
    winner = 'hunters';
    reason = `Only ${escaped} escaped; ${need} needed`;
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
