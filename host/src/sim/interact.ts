import {
  Action,
  BALANCE,
  BarricadeState,
  Btn,
  Gait,
  Health,
  Prompt,
  ToolKind,
  pointSegDist2,
  resolveOverlaps,
  type InputCmd,
  type LootKind,
} from '@manhunt/shared';
import { canAct, type SimPlayer } from './player';
import type { World } from './World';
import { attemptAttack, carrySurvivor, damageSurvivor, stakeSurvivor } from './combat';
import { dropBarricade, lockerSlam, useTool } from './tools';
import { tryPulse, tryBloodhound, tryVaultSmash } from './abilities';

const R = BALANCE.reach;

function nearestIndex<T extends { x: number; y: number }>(list: readonly T[], x: number, y: number, max: number, ok: (item: T, i: number) => boolean): number {
  let best = -1;
  let bd = max * max;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const d = (it.x - x) ** 2 + (it.y - y) ** 2;
    if (d < bd && ok(it, i)) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Distance from p to a window/barricade line if p is alongside it (within its span). */
function spanDist(px: number, py: number, cx: number, cy: number, angle: number, length: number): number {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const ax = cx - ux * (length / 2);
  const ay = cy - uy * (length / 2);
  const bx = cx + ux * (length / 2);
  const by = cy + uy * (length / 2);
  const along = (px - cx) * ux + (py - cy) * uy;
  if (Math.abs(along) > length / 2 + 6) return Infinity;
  return Math.sqrt(pointSegDist2(px, py, ax, ay, bx, by));
}

export function nearbyWindow(w: World, p: SimPlayer): number {
  const ws = w.map.windows;
  let best = -1;
  let bd: number = R.window;
  for (let i = 0; i < ws.length; i++) {
    const d = spanDist(p.move.x, p.move.y, ws[i].x, ws[i].y, ws[i].angle, ws[i].length);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export function nearbyBarricade(w: World, p: SimPlayer, state: number, reach: number = R.barricade): number {
  const bs = w.map.barricades;
  let best = -1;
  let bd = reach;
  for (let i = 0; i < bs.length; i++) {
    if (w.barricades[i] !== state) continue;
    const d = Math.hypot(bs[i].x - p.move.x, bs[i].y - p.move.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function canCarry(p: SimPlayer, item: LootKind): boolean {
  if (item === 'fuel' || item === 'wire') return p.fuel + p.wire < BALANCE.survivor.maxParts;
  if (item === 'battery') return p.flashCharges < BALANCE.survivor.maxFlashCharges;
  const kind = item === 'flare' ? ToolKind.Flare : ToolKind.Bottle;
  return p.tool === ToolKind.None || (p.tool === kind && p.toolCount < 3);
}

/** Works out the E and Space prompts for every player. */
export function computePrompts(w: World): void {
  for (const p of w.order) {
    p.prompt = Prompt.None;
    p.promptTarget = -1;
    p.prompt2 = Prompt.None;
    p.prompt2Target = -1;
    if (p.role === 'survivor') survivorPrompts(w, p);
    else if (p.role === 'hunter' && canAct(p) && p.health !== Health.Eliminated) hunterPrompts(w, p);
  }
}

function survivorPrompts(w: World, p: SimPlayer): void {
  if (p.hideState === 2 || p.hideState === 3) {
    p.prompt = Prompt.LeaveHiding;
    p.promptTarget = p.hideSpot;
    return;
  }
  if (!canAct(p)) return;
  const { x, y } = p.move;
  const set = (prompt: Prompt, target: number): boolean => {
    p.prompt = prompt;
    p.promptTarget = target;
    return true;
  };
  // Teammates first.
  let mate: SimPlayer | undefined;
  let mateD: number = R.teammate;
  for (const q of w.order) {
    if (q === p || q.role !== 'survivor') continue;
    if (q.health !== Health.Staked && q.health !== Health.Downed && !(q.health === Health.Wounded && q.hideState === 0 && !q.vault)) continue;
    const d = Math.hypot(q.move.x - x, q.move.y - y);
    const pri = q.health === Health.Staked ? 0 : q.health === Health.Downed ? 1 : 2;
    const cur = mate ? (mate.health === Health.Staked ? 0 : mate.health === Health.Downed ? 1 : 2) : 9;
    if (d < R.teammate && (pri < cur || (pri === cur && d < mateD))) {
      mate = q;
      mateD = d;
    }
  }
  if (mate) set(mate.health === Health.Staked ? Prompt.Unstake : mate.health === Health.Downed ? Prompt.Revive : Prompt.Heal, mate.id);

  if (p.prompt === Prompt.None) {
    const li = nearestIndex(w.map.loot, x, y, R.loot, (_l, i) => !w.lootTaken[i]);
    if (li >= 0) set(canCarry(p, w.map.loot[li].item) ? Prompt.Loot : Prompt.InventoryFull, li);
  }
  if (p.prompt === Prompt.None || p.prompt === Prompt.InventoryFull) {
    const gi = nearestIndex(w.map.generators, x, y, R.generator, (_g, i) => !w.gens[i].repaired);
    if (gi >= 0) {
      const g = w.gens[gi];
      if (!g.fuel) set(p.fuel > 0 ? Prompt.InstallFuel : Prompt.NeedParts, gi);
      else if (!g.wire) set(p.wire > 0 ? Prompt.InstallWire : Prompt.NeedParts, gi);
      else if (w.gate.powered) set(Prompt.None, -1);
      else set(Prompt.Repair, gi);
    }
  }
  if (p.prompt === Prompt.None && Math.hypot(w.map.gate.leverX - x, w.map.gate.leverY - y) < R.gate && !w.gate.open) {
    set(w.gate.powered ? Prompt.OpenGate : Prompt.GatePowerless, 0);
  }
  if (p.prompt === Prompt.None) {
    const hi = nearestIndex(w.map.hidingSpots, x, y, R.hide, (h, i) => w.hiding[i] === 0 && Math.hypot(h.exitX - x, h.exitY - y) < R.hide + 10);
    if (hi >= 0) set(Prompt.Hide, hi);
  }

  const bi = nearbyBarricade(w, p, BarricadeState.Up);
  if (bi >= 0) {
    p.prompt2 = Prompt.DropBarricade;
    p.prompt2Target = bi;
  } else {
    const wi = nearbyWindow(w, p);
    const di = nearbyBarricade(w, p, BarricadeState.Down, R.window + 10);
    if (wi >= 0) {
      p.prompt2 = Prompt.Vault;
      p.prompt2Target = wi;
    } else if (di >= 0) {
      p.prompt2 = Prompt.Vault;
      p.prompt2Target = 1000 + di;
    }
  }
}

function hunterPrompts(w: World, p: SimPlayer): void {
  const { x, y } = p.move;
  if (p.carrying) {
    const si = nearestIndex(w.map.stakes, x, y, R.stake, (_s, i) => w.stakes[i] === 0);
    if (si >= 0) {
      p.prompt = Prompt.Stake;
      p.promptTarget = si;
    }
  } else {
    let target: SimPlayer | undefined;
    let bd: number = R.pickup;
    for (const q of w.order) {
      if (q.role !== 'survivor' || q.health !== Health.Downed) continue;
      const d = Math.hypot(q.move.x - x, q.move.y - y);
      if (d < bd) {
        bd = d;
        target = q;
      }
    }
    if (target) {
      p.prompt = Prompt.PickUp;
      p.promptTarget = target.id;
    } else {
      const hi = nearestIndex(w.map.hidingSpots, x, y, R.hide + 8, () => true);
      if (hi >= 0) {
        p.prompt = Prompt.Search;
        p.promptTarget = hi;
      } else {
        const gi = nearestIndex(w.map.generators, x, y, R.generator, (_g, i) => !w.gens[i].repaired && w.gens[i].progress > 0.01 && !w.gens[i].regressing);
        if (gi >= 0) {
          p.prompt = Prompt.DamageGen;
          p.promptTarget = gi;
        }
      }
    }
  }
  const bi = nearbyBarricade(w, p, BarricadeState.Down);
  if (bi >= 0) {
    p.prompt2 = Prompt.BreakBarricade;
    p.prompt2Target = bi;
  } else if (!p.carrying) {
    const wi = nearbyWindow(w, p);
    if (wi >= 0) {
      p.prompt2 = Prompt.Vault;
      p.prompt2Target = wi;
    }
  }
}

/** Edge-triggered button handling for one input. */
export function handlePresses(w: World, p: SimPlayer, cmd: InputCmd, pressed: number): void {
  if (p.role === 'survivor') {
    if (pressed & Btn.Interact) survivorInteract(w, p);
    if (pressed & Btn.Vault && canAct(p) && p.action === Action.None) {
      if (p.prompt2 === Prompt.DropBarricade) dropBarricade(w, p, p.prompt2Target);
      else if (p.prompt2 === Prompt.Vault) startVault(w, p, p.prompt2Target, cmd);
    }
    if (pressed & Btn.UseItem && canAct(p)) useTool(w, p, cmd);
    return;
  }
  if (p.role !== 'hunter' || !canAct(p)) return;
  if (pressed & Btn.Attack) attemptAttack(w, p);
  if (pressed & Btn.Ability1) tryPulse(w, p);
  if (pressed & Btn.Ability2) tryBloodhound(w, p);
  if (pressed & Btn.Ability3) tryVaultSmash(w, p);
  if (p.action !== Action.None || p.attackWindup > 0) return;
  if (pressed & Btn.Interact) {
    const H = BALANCE.hunter;
    switch (p.prompt) {
      case Prompt.PickUp:
        w.startAction(p, Action.PickUp, H.pickupTime, p.promptTarget);
        break;
      case Prompt.Stake:
        w.startAction(p, Action.Stake, H.stakeTime, p.promptTarget);
        break;
      case Prompt.Search: {
        w.startAction(p, Action.Search, H.searchTime, p.promptTarget);
        const occupant = w.players.get(w.hiding[p.promptTarget]);
        if (occupant) occupant.slamWindow = BALANCE.hiding.slamWindow;
        w.noise(w.map.hidingSpots[p.promptTarget].x, w.map.hidingSpots[p.promptTarget].y, 250, 'search', false);
        break;
      }
      case Prompt.DamageGen:
        w.startAction(p, Action.DamageGen, H.damageGenTime, p.promptTarget);
        break;
    }
  }
  if (pressed & Btn.Vault) {
    if (p.prompt2 === Prompt.BreakBarricade) w.startAction(p, Action.BreakBarricade, BALANCE.hunter.breakBarricadeTime, p.prompt2Target);
    else if (p.prompt2 === Prompt.Vault) startVault(w, p, p.prompt2Target, cmd);
  }
}

function survivorInteract(w: World, p: SimPlayer): void {
  if (p.hideState === 2) {
    // A slam only works while Zach is mid-search on this spot.
    if (p.slamWindow > 0 && lockerSlam(w, p)) return;
    p.hideState = 3;
    w.startAction(p, Action.HideExit, BALANCE.hiding.exitTime, p.hideSpot);
    return;
  }
  if (p.hideState === 3) {
    // Leaving is interruptible: press again to stay hidden.
    p.hideState = 2;
    w.cancelAction(p);
    return;
  }
  if (!canAct(p) || p.action !== Action.None) return;
  const S = BALANCE.survivor;
  switch (p.prompt) {
    case Prompt.Loot:
      w.startAction(p, Action.Loot, S.pickupTime, p.promptTarget);
      break;
    case Prompt.Hide:
      w.hiding[p.promptTarget] = p.id;
      p.hideSpot = p.promptTarget;
      p.hideState = 1;
      w.startAction(p, Action.HideEnter, BALANCE.hiding.enterTime, p.promptTarget);
      break;
    case Prompt.InstallFuel:
    case Prompt.InstallWire:
      w.startAction(p, Action.Install, S.installPartTime, p.promptTarget);
      break;
    case Prompt.Repair:
      w.startAction(p, Action.Repair, 0, p.promptTarget);
      w.gens[p.promptTarget].workers++;
      w.gens[p.promptTarget].regressing = false;
      break;
    case Prompt.Heal:
      w.startAction(p, Action.Heal, S.healTime, p.promptTarget);
      break;
    case Prompt.Revive:
      w.startAction(p, Action.Revive, S.reviveTime, p.promptTarget);
      break;
    case Prompt.Unstake:
      w.startAction(p, Action.Unstake, S.unstakeTime, p.promptTarget);
      break;
    case Prompt.OpenGate:
      w.startAction(p, Action.OpenGate, BALANCE.objectives.gateOpenTime, 0);
      break;
  }
}

/** Starts a vault over window `target` (or barricade `target - 1000`). */
export function startVault(w: World, p: SimPlayer, target: number, cmd: InputCmd | null, fast = false): boolean {
  const isBarricade = target >= 1000;
  const def = isBarricade ? w.map.barricades[target - 1000] : w.map.windows[target];
  if (!def) return false;
  const ux = Math.cos(def.angle);
  const uy = Math.sin(def.angle);
  const nx = -uy;
  const ny = ux;
  const rel = (p.move.x - def.x) * nx + (p.move.y - def.y) * ny;
  const side = rel >= 0 ? 1 : -1;
  const along = Math.max(-def.length / 2 + p.radius, Math.min(def.length / 2 - p.radius, (p.move.x - def.x) * ux + (p.move.y - def.y) * uy));
  const off = p.radius + 24;
  const tx = def.x + ux * along - nx * off * side;
  const ty = def.y + uy * along - ny * off * side;
  let dur: number;
  if (p.role === 'hunter') dur = fast ? BALANCE.hunter.vaultSmash.time : BALANCE.hunter.vaultTime;
  else dur = cmd && cmd.buttons & Btn.Run && p.gait === Gait.Run ? BALANCE.survivor.fastVaultTime : BALANCE.survivor.vaultTime;
  p.vault = { fx: p.move.x, fy: p.move.y, tx, ty, t: 0, dur };
  w.startAction(p, Action.Vault, dur, target);
  const loud = p.role === 'hunter' || dur <= BALANCE.survivor.fastVaultTime;
  w.noise(def.x, def.y, loud ? 420 : 160, 'vault', p.role === 'survivor');
  return true;
}

/** Progresses timed interactions and vaults. */
export function updateInteractions(w: World, dt: number): void {
  for (const p of w.order) {
    if (p.slamWindow > 0) p.slamWindow = Math.max(0, p.slamWindow - dt);
    if (p.vault) {
      const v = p.vault;
      v.t += dt;
      const k = Math.min(1, v.t / v.dur);
      p.move.x = v.fx + (v.tx - v.fx) * k;
      p.move.y = v.fy + (v.ty - v.fy) * k;
      p.actionT = v.t;
      if (k >= 1) {
        p.vault = null;
        p.action = Action.None;
        resolveOverlaps(w.geo, p.move, p.radius);
      }
      continue;
    }
    if (p.action === Action.None || p.action === Action.Attack || p.action === Action.FlashAim) continue;
    const holding = (p.lastCmd.buttons & Btn.Interact) !== 0;
    const H = BALANCE.hunter;
    switch (p.action) {
      case Action.Repair: {
        const g = w.gens[p.actionTarget];
        const def = w.map.generators[p.actionTarget];
        if (!holding || g.repaired || w.gate.powered || Math.hypot(def.x - p.move.x, def.y - p.move.y) > R.generator + 10 || !canAct(p)) {
          w.cancelAction(p);
          continue;
        }
        p.stats.repairSec += dt;
        p.actionT += dt;
        continue;
      }
      case Action.Install: {
        const g = w.gens[p.actionTarget];
        if (!holding || !canAct(p)) {
          w.cancelAction(p);
          continue;
        }
        p.actionT += dt;
        if (p.actionT >= p.actionDur) {
          if (!g.fuel && p.fuel > 0) {
            g.fuel = true;
            p.fuel--;
          } else if (!g.wire && p.wire > 0) {
            g.wire = true;
            p.wire--;
          }
          w.noise(w.map.generators[p.actionTarget].x, w.map.generators[p.actionTarget].y, 200, 'install', true);
          p.action = Action.None;
        }
        continue;
      }
      case Action.Heal:
      case Action.Revive:
      case Action.Unstake: {
        const q = w.players.get(p.actionTarget);
        const want = p.action === Action.Heal ? Health.Wounded : p.action === Action.Revive ? Health.Downed : Health.Staked;
        if (!holding || !q || q.health !== want || !canAct(p) || Math.hypot(q.move.x - p.move.x, q.move.y - p.move.y) > R.teammate + 15) {
          w.cancelAction(p);
          continue;
        }
        p.actionT += dt;
        if (p.actionT >= p.actionDur) {
          if (p.action === Action.Heal) {
            q.health = Health.Healthy;
            p.stats.heals++;
            w.emit([q.id, p.id], { k: 'item', text: `${p.name} patched ${q.name} up` });
          } else if (p.action === Action.Revive) {
            q.health = Health.Wounded;
            p.stats.revives++;
            w.feed(`${p.name} got ${q.name} back on their feet`);
          } else {
            releaseFromStake(w, q);
            p.stats.unstakes++;
            w.feed(`${p.name} cut ${q.name} down`);
          }
          p.action = Action.None;
        }
        continue;
      }
      case Action.OpenGate:
        if (!holding || !w.gate.powered || w.gate.open || !canAct(p) || Math.hypot(w.map.gate.leverX - p.move.x, w.map.gate.leverY - p.move.y) > R.gate + 10) {
          w.cancelAction(p);
          continue;
        }
        p.actionT = w.gate.progress * p.actionDur;
        continue;
      case Action.Loot: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        const li = p.actionTarget;
        const item = w.map.loot[li];
        if (!w.lootTaken[li] && canCarry(p, item.item)) {
          w.lootTaken[li] = true;
          if (item.item === 'fuel') p.fuel++;
          else if (item.item === 'wire') p.wire++;
          else if (item.item === 'battery') p.flashCharges++;
          else {
            p.tool = item.item === 'flare' ? ToolKind.Flare : ToolKind.Bottle;
            p.toolCount++;
          }
          w.emit([p.id], { k: 'item', text: `Picked up ${item.item}` });
        }
        p.action = Action.None;
        continue;
      }
      case Action.HideEnter: {
        p.actionT += dt;
        const spot = w.map.hidingSpots[p.actionTarget];
        p.move.x += (spot.x - p.move.x) * Math.min(1, dt * 8);
        p.move.y += (spot.y - p.move.y) * Math.min(1, dt * 8);
        if (p.actionT >= p.actionDur) {
          p.move.x = spot.x;
          p.move.y = spot.y;
          p.hideState = 2;
          p.action = Action.None;
          const hunterNear = w.order.some((h) => h.role === 'hunter' && Math.hypot(h.move.x - spot.x, h.move.y - spot.y) < BALANCE.hiding.noisyEnterRadius);
          if (hunterNear) w.noise(spot.x, spot.y, BALANCE.hiding.enterNoise, spot.kind === 'grass' ? 'rustle' : 'locker', true);
        }
        continue;
      }
      case Action.HideExit: {
        p.actionT += dt;
        if (p.actionT >= p.actionDur) exitHiding(w, p, false);
        continue;
      }
      case Action.PickUp: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        const q = w.players.get(p.actionTarget);
        p.action = Action.None;
        if (q && q.health === Health.Downed && Math.hypot(q.move.x - p.move.x, q.move.y - p.move.y) < R.pickup + 20) carrySurvivor(w, p, q);
        continue;
      }
      case Action.Stake: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        p.action = Action.None;
        const q = w.players.get(p.carrying);
        if (q && w.stakes[p.actionTarget] === 0) stakeSurvivor(w, p, q, p.actionTarget);
        continue;
      }
      case Action.Search: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        p.action = Action.None;
        const occupant = w.players.get(w.hiding[p.actionTarget]);
        if (occupant && occupant.hideState >= 1) {
          exitHiding(w, occupant, true);
          damageSurvivor(w, occupant, p);
          w.feed(`${p.name} dragged ${occupant.name} out of hiding`);
        }
        continue;
      }
      case Action.BreakBarricade: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        p.action = Action.None;
        if (w.barricades[p.actionTarget] === BarricadeState.Down) {
          w.setBarricade(p.actionTarget, BarricadeState.Broken);
          const b = w.map.barricades[p.actionTarget];
          w.noise(b.x, b.y, 700, 'smash', false);
        }
        continue;
      }
      case Action.DamageGen: {
        p.actionT += dt;
        if (p.actionT < H.damageGenTime) continue;
        p.action = Action.None;
        const g = w.gens[p.actionTarget];
        if (!g.repaired) {
          g.progress = Math.max(0, g.progress - BALANCE.objectives.damageRegressInstant);
          g.regressing = true;
          p.stats.gensDamaged++;
          const def = w.map.generators[p.actionTarget];
          w.noise(def.x, def.y, 500, 'gen_kick', false);
        }
        continue;
      }
    }
  }
}

export function exitHiding(w: World, p: SimPlayer, forced: boolean): void {
  const spot = w.map.hidingSpots[p.hideSpot];
  if (p.hideSpot >= 0) w.hiding[p.hideSpot] = 0;
  if (spot) {
    p.move.x = spot.exitX;
    p.move.y = spot.exitY;
    const hunterNear = w.order.some((h) => h.role === 'hunter' && Math.hypot(h.move.x - spot.x, h.move.y - spot.y) < BALANCE.hiding.noisyEnterRadius);
    if (hunterNear || forced) w.noise(spot.x, spot.y, BALANCE.hiding.enterNoise, spot.kind === 'grass' ? 'rustle' : 'locker', true);
  }
  p.hideSpot = -1;
  p.hideState = 0;
  p.holdingBreath = false;
  p.slamWindow = 0;
  if (p.action === Action.HideExit || p.action === Action.HideEnter) p.action = Action.None;
  resolveOverlaps(w.geo, p.move, p.radius);
}

export function releaseFromStake(w: World, q: SimPlayer): void {
  const stake = w.map.stakes[q.stakeId];
  if (q.stakeId >= 0) w.stakes[q.stakeId] = 0;
  q.stakeId = -1;
  q.health = Health.Wounded;
  q.move.hasteT = 0;
  if (stake) {
    q.move.x = stake.x + 30;
    q.move.y = stake.y + 30;
  }
  resolveOverlaps(w.geo, q.move, q.radius);
  w.emit('all', { k: 'unstaked', victim: q.id });
}
