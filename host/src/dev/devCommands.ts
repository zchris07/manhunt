import { Health, resolveOverlaps } from '@manhunt/shared';
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
      if (p.role === 'survivor') p.health = args[0] as Health;
      break;
    case 'parts':
      p.fuel = 1;
      p.wire = 1;
      break;
    case 'give':
      // args: [toolKind (1 flare, 2 bottle), count, batteries]
      p.tool = (args[0] ?? 0) as typeof p.tool;
      p.toolCount = args[1] ?? 1;
      p.flashCharges = Math.max(p.flashCharges, args[2] ?? 0);
      break;
    case 'gens':
      // Nearly finish the required generators; the objective system completes them next tick.
      for (let i = 0; i < w.balance.requiredGenerators; i++) {
        const g = w.gens[i];
        g.fuel = g.wire = true;
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
  }
}
