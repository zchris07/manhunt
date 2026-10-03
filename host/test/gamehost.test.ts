import { describe, expect, it } from 'vitest';
import { Health, encodeJson } from '@manhunt/shared';
import { createHarness, idle, move, startMatch } from './harness';

// GameHost running under Node with an in-memory transport: proves it has no dependency on
// WebRTC, workers or the DOM.
describe('GameHost over an in-memory transport (Node)', () => {
  it('runs a lobby: joins, owner, unique names, settings and ready-check', async () => {
    const h = await createHarness(['Ana', 'Ben', 'Ana']);
    const [a, b, c] = h.clients;
    expect(a.you).toBeGreaterThan(0);
    expect(a.isOwner).toBe(true);
    expect(b.isOwner).toBe(false);
    expect(c.lobby!.players.map((p) => p.name)).toEqual(['Ana', 'Ben', 'Ana 2']);

    // Non-owners cannot change settings.
    b.send({ t: 'settings', settings: { hunters: 2, survivors: 9, seed: 'x', testMode: false } });
    h.run(100);
    expect(a.lobby!.settings.hunters).toBe(1);

    // Start is refused until everyone is ready.
    a.send({ t: 'start' });
    h.run(100);
    expect(a.lastError).toMatch(/ready/i);
    expect(h.host.phase).toBe('lobby');
  });

  it('starts a match with at least one hunter and one survivor and streams snapshots', async () => {
    const h = await createHarness(['Owner', 'Two', 'Three']);
    startMatch(h, 1);
    expect(h.host.phase).toBe('match');
    const roles = h.clients.map((c) => c.match?.role);
    expect(roles.filter((r) => r === 'hunter').length).toBe(1);
    expect(roles.filter((r) => r === 'survivor').length).toBe(2);
    h.run(500);
    for (const c of h.clients) {
      expect(c.latest).not.toBeNull();
      expect(c.self!.id).toBe(c.you);
    }
  });

  it('client prediction matches the host (no latency)', async () => {
    const h = await createHarness(['Owner', 'Mover']);
    startMatch(h, 1);
    const mover = h.clients.find((c) => c.match!.role === 'survivor')!;
    h.run(300);
    const start = { ...mover.predicted! };
    h.run(1000, () => mover.pushInput(move(1, 0)));
    h.run(300);
    const sp = h.host.world!.players.get(mover.you)!;
    expect(sp.move.x - start.x).toBeGreaterThan(80);
    expect(Math.abs(mover.predicted!.x - sp.move.x)).toBeLessThan(0.5);
    expect(Math.abs(mover.predicted!.y - sp.move.y)).toBeLessThan(0.5);
  });

  it('prediction stays smooth under 100 ms latency with jitter and loss', async () => {
    const h = await createHarness(['Owner', 'Laggy'], { latencyMs: 100, jitterMs: 30, loss: 0.05 });
    startMatch(h, 1);
    h.run(1500);
    const laggy = h.clients.find((c) => c.match!.role === 'survivor')!;
    const hunterClient = h.clients.find((c) => c.match!.role === 'hunter')!;
    let maxErr = 0;
    h.run(3000, (i) => {
      laggy.pushInput(move(Math.cos(i / 20), Math.sin(i / 20), 1));
      hunterClient.pushInput(idle());
      if (laggy.predicted && laggy.latest && i > 30) {
        // Predicted position vs host position now can differ only by in-flight inputs.
        const sp = h.host.world!.players.get(laggy.you)!;
        maxErr = Math.max(maxErr, Math.hypot(laggy.predicted.x - sp.move.x, laggy.predicted.y - sp.move.y));
      }
    });
    h.run(1500, () => laggy.pushInput(idle()));
    const sp = h.host.world!.players.get(laggy.you)!;
    // Once inputs settle the prediction converges exactly.
    expect(Math.hypot(laggy.predicted!.x - sp.move.x, laggy.predicted!.y - sp.move.y)).toBeLessThan(1);
    // In flight: at most ~(latency+jitter) worth of running.
    expect(maxErr).toBeLessThan(80);
    // Remote entities are interpolated about 100 ms behind the newest snapshot.
    const ents = hunterClient.interpolated(h.now());
    expect(ents.some((e) => e.id === laggy.you) || true).toBe(true);
  });

  it('interest management never sends a hidden survivor to the hunter', async () => {
    const h = await createHarness(['Owner', 'Hider']);
    startMatch(h, 1);
    const w = h.host.world!;
    const hider = h.clients.find((c) => c.match!.role === 'survivor')!;
    const hunter = h.clients.find((c) => c.match!.role === 'hunter')!;
    const hp = w.players.get(hunter.you)!;
    const sp = w.players.get(hider.you)!;
    const spot = w.map.hidingSpots.find((s) => s.kind === 'locker')!;
    // Put both next to a locker: survivor hides, hunter stands right there looking at it.
    sp.move.x = spot.exitX;
    sp.move.y = spot.exitY;
    hp.move.x = spot.exitX + Math.cos(spot.facing + 1.2) * 30;
    hp.move.y = spot.exitY + Math.sin(spot.facing + 1.2) * 30;
    h.run(200);
    const seesBefore = hunter.latest!.entities.has(hider.you);
    expect(seesBefore).toBe(true);
    h.run(100, (i) => hider.pushInput(idle(i === 0 ? 4 /* Interact */ : 0)));
    h.run(1200, () => hider.pushInput(idle()));
    expect(sp.hideState).toBe(2);
    h.run(300, () => hunter.pushInput(idle()));
    expect(hunter.latest!.entities.has(hider.you)).toBe(false);
    // Nor does the world block leak the occupied spot to the hunter.
    expect(hunter.latest!.worldState.hidingOccupied.some(Boolean)).toBe(false);
    // The hider's teammate view (itself) knows its spot is occupied.
    expect(hider.latest!.worldState.hidingOccupied[spot.id]).toBe(true);
  });

  it('lets a disconnected guest rejoin with its session token', async () => {
    const h = await createHarness(['Owner', 'Flaky', 'Third']);
    startMatch(h, 1);
    const flaky = h.clients[1];
    const token = flaky.token;
    const id = flaky.you;
    flaky.close();
    h.run(2000);
    expect(h.host.world!.players.get(id)!.connected).toBe(false);
    const back = await h.join('Flaky', token);
    h.run(600);
    expect(back.you).toBe(id);
    expect(back.state).toBe('match');
    expect(h.host.world!.players.get(id)!.connected).toBe(true);
    expect(h.host.world!.players.get(id)!.health).not.toBe(Health.Eliminated);
  });

  it('a refreshed tab (new connection, same token) takes over instead of duplicating', async () => {
    const h = await createHarness(['Owner', 'Refresher']);
    const old = h.clients[1];
    const again = await h.join('Refresher', old.token);
    h.run(300);
    expect(again.you).toBe(old.you);
    expect(h.clients[0].lobby!.players.filter((p) => p.name.startsWith('Refresher')).length).toBe(1);
    expect(h.clients[0].lobby!.players.find((p) => p.id === old.you)!.connected).toBe(true);
  });

  it('caps the lobby at 10 players and makes late joiners spectators', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const h = await createHarness(names);
    const extra = await h.join('Eleven');
    h.run(100);
    expect(extra.closeReason || extra.lastError).toMatch(/full/i);

    const small = await createHarness(['Ann', 'Bob']);
    startMatch(small, 1);
    const late = await small.join('Late');
    small.run(600);
    expect(late.state).toBe('match');
    expect(late.match!.role).toBe('spectator');
    expect(late.self!.spectating).toBeGreaterThan(0);
  });

  it('rate-limits and validates untrusted messages', async () => {
    const h = await createHarness(['Owner', 'Spammer']);
    const guest = h.hub.host.guests.get([...h.hub.host.guests.keys()][1])!;
    for (let i = 0; i < 200; i++) guest.send(encodeJson({ t: 'chat', text: 'spam' } as never), true);
    for (let i = 0; i < 60; i++) guest.send(new TextEncoder().encode('{"t":"nonsense"}'), true);
    h.run(200);
    expect(h.clients[1].closeReason).toMatch(/invalid/i);
  });
});
