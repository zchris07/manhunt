import { describe, expect, it } from 'vitest';
import { BALANCE, Rng } from '@manhunt/shared';
import { GameHost } from '../src/GameHost';
import { MemoryHub } from '../src/transport/memory';
import { summarize, type MatchLogEntry } from '../src/telemetry';
import { GameClient } from '../../client/src/net/GameClient';

describe('telemetry', () => {
  it('the host logs outcome, duration, generators and eliminations when a match ends', async () => {
    let now = 0;
    const rng = new Rng(3);
    const hub = new MemoryHub();
    const logs: MatchLogEntry[] = [];
    const host = new GameHost({ transport: hub.host, room: 'LOGS', now: () => now, random: () => rng.next(), telemetry: (e) => logs.push(e) });
    const clients: GameClient[] = [];
    for (const name of ['Host', 'Guest', 'Third']) {
      const c = new GameClient({ transport: hub.createGuest(), now: () => now, name });
      await c.connect('LOGS');
      clients.push(c);
      host.tick();
    }
    const tick = (n: number): void => {
      for (let i = 0; i < n; i++) {
        now += 1000 / BALANCE.net.tickHz;
        host.tick();
      }
    };
    clients[1].send({ t: 'ready', ready: true });
    clients[2].send({ t: 'ready', ready: true });
    clients[0].send({ t: 'start' });
    tick(5);
    expect(host.phase).toBe('match');
    // Eliminate every survivor: the hunters win.
    for (const p of host.world!.order) if (p.role === 'survivor') p.health = 6;
    tick(3);
    expect(host.phase).toBe('results');
    expect(logs.length).toBe(1);
    const e = logs[0];
    expect(e.winner).toBe('hunters');
    expect(e.hunters).toBe(1);
    expect(e.survivors).toBe(2);
    expect(e.eliminated).toBe(2);
    expect(e.requiredGenerators).toBeGreaterThanOrEqual(3);
    expect(typeof e.durationSec).toBe('number');
    expect(e.players.length).toBe(3);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it('summarises win rates per lobby shape', () => {
    const base = { v: 1, at: '', seed: 1, mapHash: 1, difficulty: 1, escapeFraction: 0.5, requiredGenerators: 5, totalGenerators: 7, repairTime: 70, hunterSpeed: 205, stunMul: 1, lootMul: 1, reason: '', durationSec: 600, realDurationSec: 600, generatorsRepaired: 3, escaped: 0, eliminated: 4 } as const;
    const entries: MatchLogEntry[] = [
      { ...base, players: [], hunters: 1, survivors: 4, winner: 'hunters' },
      { ...base, players: [], hunters: 1, survivors: 4, winner: 'hunters' },
      { ...base, players: [], hunters: 1, survivors: 4, winner: 'survivors' },
      { ...base, players: [], hunters: 2, survivors: 8, winner: 'survivors' },
    ];
    const s = summarize(entries);
    expect(s.matches).toBe(4);
    expect(s.hunterWinRate).toBe(0.5);
    expect(s.byShape['1v4']).toEqual({ matches: 3, hunterWins: 2 });
    expect(s.byShape['2v8']).toEqual({ matches: 1, hunterWins: 0 });
  });
});
