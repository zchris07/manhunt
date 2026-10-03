import { BALANCE, Btn, Rng, type InputCmd } from '@manhunt/shared';
import { GameHost } from '../src/GameHost';
import { MemoryHub, type LinkConditions } from '../src/transport/memory';
import { GameClient } from '../../client/src/net/GameClient';

export const TICK_MS = 1000 / BALANCE.net.tickHz;

export interface Harness {
  host: GameHost;
  hub: MemoryHub;
  clients: GameClient[];
  now(): number;
  /** Runs host ticks (and delivers messages) for `ms` of simulated time. */
  run(ms: number, eachTick?: (tick: number) => void): void;
  join(name: string, token?: string, tap?: (data: Uint8Array) => void): Promise<GameClient>;
}

export async function createHarness(names: string[], link?: LinkConditions, seed = 1): Promise<Harness> {
  let now = 1000;
  const rng = new Rng(seed);
  const random = (): number => rng.next();
  const hub = new MemoryHub(link ?? { latencyMs: 0, jitterMs: 0, loss: 0 }, random);
  const host = new GameHost({ transport: hub.host, room: 'TEST', now: () => now, random, handicapMs: 0 });
  const clients: GameClient[] = [];
  const h: Harness = {
    host,
    hub,
    clients,
    now: () => now,
    run(ms, eachTick) {
      const ticks = Math.round(ms / TICK_MS);
      for (let i = 0; i < ticks; i++) {
        now += TICK_MS;
        hub.flush(now);
        eachTick?.(i);
        host.tick();
        hub.flush(now);
      }
    },
    async join(name, token, tap) {
      const transport = hub.createGuest();
      if (tap) {
        // A "modified client": sees every raw byte the host sends it.
        const orig = transport.onMessage.bind(transport);
        transport.onMessage = (cb) => orig((d) => {
          tap(d.slice());
          cb(d);
        });
      }
      const c = new GameClient({ transport, now: () => now, name, token });
      await c.connect('TEST');
      clients.push(c);
      h.run(Math.max(100, (link?.latencyMs ?? 0) * 3 + 100));
      return c;
    },
  };
  for (const n of names) await h.join(n);
  h.run(100);
  return h;
}

export function move(dx: number, dy: number, buttons = 0, aim = 0, item = 0): Omit<InputCmd, 'seq'> {
  const l = Math.hypot(dx, dy) || 1;
  return { buttons, moveX: dx / l, moveY: dy / l, aim, aimDist: 200, item };
}

export const idle = (buttons = 0, aim = 0, item = 0): Omit<InputCmd, 'seq'> => ({ buttons, moveX: 0, moveY: 0, aim, aimDist: 200, item });

/** Readies everyone and starts a match with the given hunter count. */
export function startMatch(h: Harness, hunters = 1, seed = 'test-seed', testMode = false): void {
  const owner = h.clients.find((c) => c.isOwner)!;
  owner.send({ t: 'settings', settings: { hunters, survivors: 9, seed, testMode } });
  for (const c of h.clients) if (c !== owner) c.send({ t: 'ready', ready: true });
  h.run(500);
  owner.send({ t: 'start' });
  h.run(800);
}

export { Btn };
