import { Action, BALANCE, BarricadeState, Btn, GOLDEN_BIT, Health, ItemKind, Prompt, pointSegDist2, resolveOverlaps, type InputCmd, type LootKind } from '@manhunt/shared';
import { canAct, type SimPlayer } from './player';
import type { World } from './World';
import { carrySurvivor, startCharge, damageSurvivor, restoreSurvivor, stakeSurvivor } from './combat';
import { dropBarricade, drinkShield, dropItem, fireZachPump, pickUpDrop, plantTrap, useItem } from './items';
import { addItem } from './inventory';
import { tryBurst, tryHemp, tryJarvis } from './abilities';

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

/** Closest door (by distance to its closed panel) within reach. */
export function nearbyDoor(w: World, x: number, y: number, reach: number = R.door): number {
  let best = -1;
  let bd = reach * reach;
  w.map.doors.forEach((d, i) => {
    if (w.doorBroken[i]) return;
    const bx = d.hx + Math.cos(d.angle) * d.length;
    const by = d.hy + Math.sin(d.angle) * d.length;
    const d2 = pointSegDist2(x, y, d.hx, d.hy, bx, by);
    if (d2 < bd) {
      bd = d2;
      best = i;
    }
  });
  return best;
}

export const LOOT_TO_ITEM: Record<LootKind, ItemKind> = {
  bottle: ItemKind.Bottle,
  goggles: ItemKind.Goggles,
  shotgun: ItemKind.Shotgun,
  energy: ItemKind.Energy,
  trap: ItemKind.Trap,
  confit: ItemKind.Confit,
  book: ItemKind.Book,
  beastbar: ItemKind.BeastBar,
  shield: ItemKind.Shield,
};

/** Zach next to an NPC or an item gets its name (survivors see them in their prompts). */
function nameNear(w: World, p: SimPlayer): void {
  const { x, y } = p.move;
  const npcs = [
    w.sexton.alive ? w.sexton : null,
    w.shane,
    w.chris.solid ? w.chris : null,
    w.marc,
    w.plasma,
    w.jaden.alive ? w.jaden : null,
    w.waz.solid ? w.waz : null,
  ];
  let best = -1;
  let bd: number = R.npcName;
  npcs.forEach((n, i) => {
    if (!n) return;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0) {
    p.prompt = Prompt.NameNpc;
    p.promptTarget = best;
    return;
  }
  const di = nearestIndex(w.drops, x, y, R.pickup, () => true);
  if (di >= 0) {
    const d = w.drops[di];
    p.prompt = Prompt.NameDrop;
    p.promptTarget = d.kind | (d.golden ? GOLDEN_BIT : 0);
    return;
  }
  const li = nearestIndex(w.map.loot, x, y, R.pickup, (_l, i) => !w.lootTaken[i]);
  if (li >= 0) {
    p.prompt = Prompt.NameLoot;
    p.promptTarget = li;
  }
}

/** A survivor grabs a loot spawn (a full inventory drops the last slot to make room). */
function takeLoot(w: World, p: SimPlayer, li: number): void {
  const item = w.map.loot[li];
  if (!item || w.lootTaken[li]) return;
  w.lootTaken[li] = true;
  if (w.testMode) {
    w.emit([p.id], { k: 'item', text: 'Items are infinite' });
    return;
  }
  addItem(w, p, LOOT_TO_ITEM[item.item]);
  w.emit([p.id], { k: 'item', text: `Picked up: ${ITEM_TEXT[item.item]}` });
}

/** Works out the E and Space prompts for every player. */
export function computePrompts(w: World): void {
  for (const p of w.order) {
    p.prompt = Prompt.None;
    p.promptTarget = -1;
    p.prompt2 = Prompt.None;
    p.prompt2Target = -1;
    if (p.role === 'survivor') survivorPrompts(w, p);
    else if (p.role === 'hunter' && canAct(p)) hunterPrompts(w, p);
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
  // Sexton waiting for you to keep listening comes before anything else.
  if (w.sexton.awaiting(p)) {
    set(Prompt.SextonMore, 0);
    return;
  }
  // Teammates first.
  let mate: SimPlayer | undefined;
  let mateD: number = R.teammate;
  const pri = (q: SimPlayer): number => (q.health === Health.Staked ? 0 : q.health === Health.Downed ? 1 : 2);
  for (const q of w.order) {
    if (q === p || q.role !== 'survivor') continue;
    if (q.health !== Health.Staked && q.health !== Health.Downed && !(q.health === Health.Wounded && q.hideState === 0)) continue;
    const d = Math.hypot(q.move.x - x, q.move.y - y);
    const cur = mate ? pri(mate) : 9;
    if (d < R.teammate && (pri(q) < cur || (pri(q) === cur && d < mateD))) {
      mate = q;
      mateD = d;
    }
  }
  if (mate) {
    if (mate.health === Health.Staked) set(Prompt.Unstake, mate.id);
    else if (mate.health === Health.Downed) set(Prompt.Revive, mate.id);
    else set(Prompt.Heal, mate.id);
  }

  if (p.prompt === Prompt.None && w.sexton.canTalk(p)) set(Prompt.TalkSexton, 0);
  if (p.prompt === Prompt.None && w.chris.canTalk(p)) set(Prompt.TalkChris, 0);
  if (p.prompt === Prompt.None && w.marc.canTalk(p)) set(Prompt.TalkMarc, 0);
  if (p.prompt === Prompt.None && w.plasma.canTalk(p)) set(Prompt.TalkPlasma, 0);
  if (p.prompt === Prompt.None && w.waz.canTalk(p)) set(Prompt.TalkWaz, 0);
  if (p.prompt === Prompt.None) {
    // Something a teammate dropped.
    const di = nearestIndex(w.drops, x, y, R.pickup, () => true);
    if (di >= 0) set(Prompt.PickDrop, w.drops[di].id);
  }
  if (p.prompt === Prompt.None) {
    const li = nearestIndex(w.map.loot, x, y, R.loot, (_l, i) => !w.lootTaken[i]);
    if (li >= 0) set(Prompt.Loot, li);
  }
  if (p.prompt === Prompt.None) {
    const gi = nearestIndex(w.map.generators, x, y, R.generator, (_g, i) => !w.gens[i].repaired);
    if (gi >= 0 && !w.gate.powered) set(Prompt.Repair, gi);
  }
  if (p.prompt === Prompt.None && Math.hypot(w.map.gate.leverX - x, w.map.gate.leverY - y) < R.gate && !w.gate.open) {
    set(w.gate.powered ? Prompt.OpenGate : Prompt.GatePowerless, 0);
  }
  if (p.prompt === Prompt.None) {
    const hi = nearestIndex(w.map.hidingSpots, x, y, R.hide, (h, i) => w.hiding[i] === 0 && Math.hypot(h.exitX - x, h.exitY - y) < R.hide + 10);
    if (hi >= 0) set(Prompt.Hide, hi);
  }
  if (p.prompt === Prompt.None) {
    const di = nearbyDoor(w, x, y);
    if (di >= 0) set(w.doors[di] ? Prompt.CloseDoor : Prompt.OpenDoor, di);
  }

  const bi = nearbyBarricade(w, p, BarricadeState.Up);
  if (bi >= 0) {
    p.prompt2 = Prompt.DropBarricade;
    p.prompt2Target = bi;
  }
}

function hunterPrompts(w: World, p: SimPlayer): void {
  const { x, y } = p.move;
  const set = (prompt: Prompt, target: number): void => {
    p.prompt = prompt;
    p.promptTarget = target;
  };
  if (p.carrying) {
    const si = nearestIndex(w.map.stakes, x, y, R.stake, (_s, i) => w.stakes[i] === 0);
    if (si >= 0) set(Prompt.Stake, si);
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
    if (target) set(Prompt.PickUp, target.id);
    else if (w.plasma.canTalk(p)) set(Prompt.TalkPlasma, 0);
    else if (w.hempDrop && Math.hypot(w.hempDrop.x - x, w.hempDrop.y - y) < R.pickup) set(Prompt.TakeHemp, 0);
    else {
      const hi = nearestIndex(w.map.hidingSpots, x, y, R.hide + 8, () => true);
      if (hi >= 0) set(Prompt.Search, hi);
      else {
        const gi = nearestIndex(w.map.generators, x, y, R.generator, (_g, i) => !w.gens[i].repaired && w.gens[i].progress > 0.01 && !w.gens[i].regressing);
        if (gi >= 0) set(Prompt.DamageGen, gi);
      }
    }
  }
  if (p.prompt === Prompt.None) {
    const di = nearbyDoor(w, x, y);
    if (di >= 0) set(w.doors[di] ? Prompt.CloseDoor : Prompt.OpenDoor, di);
  }
  // Nothing to do here: he still sees who or what is next to him.
  if (p.prompt === Prompt.None) nameNear(w, p);
}

/** Edge-triggered button handling for one input. */
const HOLD_PROMPTS: readonly Prompt[] = [Prompt.Repair, Prompt.Heal, Prompt.Revive, Prompt.Unstake, Prompt.OpenGate];

export function handlePresses(w: World, p: SimPlayer, cmd: InputCmd, pressed: number): void {
  if (p.role === 'survivor') {
    // Holding E starts hold-to-act interactions as soon as they become available.
    const heldStart = cmd.buttons & Btn.Interact && p.action === Action.None && p.hideState === 0 && HOLD_PROMPTS.includes(p.prompt);
    if (pressed & Btn.Interact || heldStart) survivorInteract(w, p);
    if (pressed & Btn.Space && canAct(p) && p.action === Action.None && p.prompt2 === Prompt.DropBarricade) dropBarricade(w, p, p.prompt2Target);
    if (pressed & Btn.Primary && canAct(p)) useItem(w, p, cmd);
    if (pressed & Btn.Drop) dropItem(w, p);
    if (pressed & Btn.Ability) tryJarvis(w, p);
    return;
  }
  if (p.role !== 'hunter' || !canAct(p)) return;
  // Plasma's golden pump replaces the machete while it has shots.
  if (p.pump > 0) {
    if (cmd.buttons & Btn.Primary) fireZachPump(w, p, cmd.aim);
  } else if (pressed & Btn.Primary) startCharge(p);
  if (pressed & Btn.Secondary) tryBurst(w, p, cmd.aim);
  if (pressed & Btn.Ability) tryHemp(w, p);
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
        // Searching is instant.
        const occupant = w.players.get(w.hiding[p.promptTarget]);
        if (occupant && occupant.hideState >= 1) {
          exitHiding(w, occupant, true);
          damageSurvivor(w, occupant, p);
          w.feed(`${p.name} dragged ${occupant.name} out of hiding`);
        }
        break;
      }
      case Prompt.DamageGen:
        w.startAction(p, Action.DamageGen, H.damageGenTime, p.promptTarget);
        break;
      case Prompt.TalkPlasma:
        w.plasma.talk(p);
        break;
      case Prompt.TakeHemp:
        if (w.hempDrop) {
          p.hemp = Math.max(p.hemp, 1);
          w.hempDrop = null;
          w.emit([p.id], { k: 'item', text: 'Got Hemp Battery' });
        }
        break;
      case Prompt.OpenDoor:
      case Prompt.CloseDoor:
        toggleDoor(w, p.promptTarget);
        break;
    }
  }
}

function toggleDoor(w: World, id: number): void {
  if (id < 0 || w.doorCd[id] > 0) return;
  w.setDoor(id, !w.doors[id]);
}

function survivorInteract(w: World, p: SimPlayer): void {
  if (p.hideState === 2) {
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
      // Instant: no pickup animation.
      takeLoot(w, p, p.promptTarget);
      break;
    case Prompt.Hide:
      w.hiding[p.promptTarget] = p.id;
      p.hideSpot = p.promptTarget;
      p.hideState = 1;
      p.gogglesOn = false;
      w.startAction(p, Action.HideEnter, BALANCE.hiding.enterTime, p.promptTarget);
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
    case Prompt.TalkSexton:
      w.sexton.startTalk(p);
      break;
    case Prompt.TalkChris:
      w.chris.activate(p);
      break;
    case Prompt.SextonMore:
      w.sexton.continueTalk(p);
      break;
    case Prompt.TalkMarc:
      w.marc.talk(p);
      break;
    case Prompt.TalkPlasma:
      w.plasma.talk(p);
      break;
    case Prompt.TalkWaz:
      w.waz.talk(p);
      break;
    case Prompt.PickDrop:
      pickUpDrop(w, p, p.promptTarget);
      break;
    case Prompt.OpenDoor:
    case Prompt.CloseDoor:
      toggleDoor(w, p.promptTarget);
      break;
  }
}

/** Progresses timed interactions. */
export function updateInteractions(w: World, dt: number): void {
  for (const p of w.order) {
    if (p.action === Action.None || p.action === Action.Attack || p.action === Action.Talk) continue;
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
            restoreSurvivor(q, 1);
            p.stats.heals++;
            w.emit([q.id, p.id], { k: 'item', text: `${p.name} patched ${q.name} up` });
          } else if (p.action === Action.Revive) {
            restoreSurvivor(q, BALANCE.survivor.reviveHp);
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
      case Action.Plant: {
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        p.action = Action.None;
        plantTrap(w, p);
        continue;
      }
      case Action.Drink: {
        if (!canAct(p)) {
          w.cancelAction(p);
          continue;
        }
        p.actionT += dt;
        if (p.actionT < p.actionDur) continue;
        p.action = Action.None;
        drinkShield(w, p);
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
          w.noise(def.x, def.y, 700, 'gen_kick');
        }
        continue;
      }
    }
  }
}

const ITEM_TEXT: Record<LootKind, string> = {
  bottle: 'bottle',
  goggles: 'night vision goggles',
  confit: 'duck confit',
  shotgun: 'shotgun',
  energy: 'Doctor Pepper',
  trap: 'galaxy gas trap',
  book: 'The Grapes of Wrath',
  beastbar: 'Mr Beast bar',
  shield: 'mini shield',
};

export function exitHiding(w: World, p: SimPlayer, _forced: boolean): void {
  const spot = w.map.hidingSpots[p.hideSpot];
  if (p.hideSpot >= 0) w.hiding[p.hideSpot] = 0;
  if (spot) {
    p.move.x = spot.exitX;
    p.move.y = spot.exitY;
  }
  p.hideSpot = -1;
  p.hideState = 0;
  p.holdingBreath = false;
  if (p.action === Action.HideExit || p.action === Action.HideEnter) p.action = Action.None;
  resolveOverlaps(w.geo, p.move, p.radius);
}

export function releaseFromStake(w: World, q: SimPlayer): void {
  const stake = w.map.stakes[q.stakeId];
  if (q.stakeId >= 0) w.stakes[q.stakeId] = 0;
  q.stakeId = -1;
  restoreSurvivor(q, BALANCE.survivor.reviveHp);
  q.move.hasteT = 0;
  if (stake) {
    q.move.x = stake.x + 30;
    q.move.y = stake.y + 30;
  }
  resolveOverlaps(w.geo, q.move, q.radius);
  w.emit('all', { k: 'unstaked', victim: q.id });
}
