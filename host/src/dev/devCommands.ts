import { BALANCE, Health, ItemKind, resolveOverlaps } from '@manhunt/shared';
import type { World } from '../sim/World';

/** DEV-ONLY: test hooks for end-to-end tests and debugging (host must run with dev: true). */
export function devCommand(w: World, playerId: number, cmd: string, args: number[]): void {
  const p = w.players.get(playerId);
  if (!p) return;
  switch (cmd) {
    case 'tp':
      p.move.x = args[0];
      p.move.y = args[1];
      resolveOverlaps(w.geo, p.move, p.radius);
      break;
    case 'tpTo': {
      const q = w.players.get(args[0]);
      if (q) {
        p.move.x = q.move.x + (args[1] ?? 40);
        p.move.y = q.move.y + (args[2] ?? 0);
        resolveOverlaps(w.geo, p.move, p.radius);
      }
      break;
    }
    case 'health':
      if (p.role === 'survivor') {
        p.health = args[0] as typeof p.health;
        p.hp = p.health === Health.Healthy ? 1 : p.health === Health.Wounded ? 0.5 : 0;
      }
      break;
    case 'give': {
      // args: [ItemKind, count]
      const kind = args[0] as ItemKind;
      if (kind < ItemKind.Bottle || kind > ItemKind.Trap) break;
      const n = Math.max(0, Math.min(BALANCE.items.maxStack, args[1] ?? 1));
      p.inv[kind] = n;
      if (kind === ItemKind.Goggles) p.goggles = Array.from({ length: n }, () => BALANCE.items.goggles.meter);
      if (kind === ItemKind.Shotgun) p.shells = Array.from({ length: n }, () => BALANCE.items.shotgun.shells);
      break;
    }
    case 'confit':
      p.confit = 1;
      break;
    case 'jarvis':
      p.jarvis = 1;
      break;
    case 'hemp':
      p.hemp = 1;
      break;
    case 'sexton': {
      // Bring Sexton next to this player.
      const s = w.sexton;
      s.x = p.move.x + (args[0] ?? 60);
      s.y = p.move.y + (args[1] ?? 0);
      s.unstick();
      break;
    }
    case 'shane':
    case 'jaden': {
      // Bring Shane Jeans or Jaden Nguyen next to this player (close enough to alert him).
      const sh = cmd === 'jaden' ? w.jaden : w.shane;
      sh.x = p.move.x + (args[0] ?? 40);
      sh.y = p.move.y + (args[1] ?? 0);
      sh.unstick();
      break;
    }
    case 'marc':
    case 'plasma': {
      // Bring Marc Cortez or Plasma.TTV next to this player.
      const n = cmd === 'marc' ? w.marc : w.plasma;
      n.x = p.move.x + (args[0] ?? 60);
      n.y = p.move.y + (args[1] ?? 0);
      n.unstick();
      break;
    }
    case 'chris': {
      // Bring Chris Zelley next to this player.
      const c = w.chris;
      c.x = p.move.x + (args[0] ?? 60);
      c.y = p.move.y + (args[1] ?? 0);
      c.unstick();
      break;
    }
    case 'gens':
      // Nearly finish every generator; the objective system completes them next tick.
      for (const g of w.gens) {
        g.regressing = false;
        g.progress = 1;
      }
      break;
    case 'gate':
      w.gate.powered = true;
      w.gate.progress = 1;
      w.gate.open = true;
      w.geo.setDynamicActive(w.map.gate.dyn, false);
      break;
    case 'exit': {
      const ez = w.map.exitZone;
      p.move.x = ez.x + ez.w / 2;
      p.move.y = ez.y + ez.h / 2;
      break;
    }
    case 'time':
      w.balance.timeLimit = w.time + Math.max(1, args[0]);
      break;
    case 'heal':
      if (p.role === 'survivor' && p.health !== Health.Eliminated && p.health !== Health.Escaped) {
        p.health = Health.Healthy;
        p.hp = 1;
      }
      break;
  }
}
