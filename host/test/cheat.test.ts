import { describe, expect, it } from 'vitest';
import { JSON_TAG, MSG_SNAPSHOT, decodeJson, decodeSnapshot, type DecodedSnapshot } from '@manhunt/shared';
import { createHarness, idle, startMatch } from './harness';

describe('interest management against a modified guest client', () => {
  it('decoding every raw packet never reveals a hidden survivor', async () => {
    // A "modified client": every raw byte the host sends Zach's connection is recorded.
    const raw: Uint8Array[] = [];
    const h = await createHarness([]);
    const hunter = await h.join('Zach', undefined, (d) => raw.push(d));
    const hider = await h.join('Hider');
    const other = await h.join('Other');
    hunter.send({ t: 'rolePref', pref: 'hunter' });
    hider.send({ t: 'rolePref', pref: 'survivor' });
    other.send({ t: 'rolePref', pref: 'survivor' });
    h.run(100);
    startMatch(h, 1);
    expect(hunter.match!.role).toBe('hunter');
    const w = h.host.world!;
    const sp = w.players.get(hider.you)!;
    const hp = w.players.get(hunter.you)!;
    const spot = w.map.hidingSpots.find((s) => s.kind === 'locker')!;
    sp.move.x = spot.exitX;
    sp.move.y = spot.exitY;
    hp.move.x = spot.exitX + 2000;
    hp.move.y = spot.exitY;
    h.run(200, () => hider.pushInput(idle()));
    h.run(34, () => hider.pushInput(idle(4)));
    h.run(1200, () => hider.pushInput(idle()));
    expect(sp.hideState).toBe(2);

    // Zach walks up and stares at the locker from 200 units for 4 seconds.
    hp.move.x = spot.exitX + Math.cos(spot.facing) * 200;
    hp.move.y = spot.exitY + Math.sin(spot.facing) * 200;
    const look = Math.atan2(spot.y - hp.move.y, spot.x - hp.move.x);
    const hiddenFromTick = w.tick;
    const hiddenFromIndex = raw.length;
    h.run(4000, () => {
      hunter.pushInput(idle(0, look));
      hider.pushInput(idle(0x800)); // holding breath
    });
    expect(sp.hideState).toBe(2);

    const history = new Map<number, DecodedSnapshot>();
    let snapshots = 0;
    raw.forEach((d, i) => {
      if (d[0] === MSG_SNAPSHOT) {
        const snap = decodeSnapshot(d, (t) => history.get(t));
        if (!snap) return;
        history.set(snap.tick, snap);
        if (snap.tick <= hiddenFromTick + 1) return;
        snapshots++;
        expect([...snap.entities.keys()]).not.toContain(hider.you);
        expect(snap.worldState.hidingOccupied.some(Boolean)).toBe(false);
      } else if (d[0] === JSON_TAG && i >= hiddenFromIndex) {
        const text = JSON.stringify(decodeJson(d));
        // No event may name the hidden survivor or give away the locker's position.
        expect(text).not.toContain(`"victim":${hider.you}`);
        expect(text).not.toContain(`"x":${Math.round(spot.x)},"y":${Math.round(spot.y)}`);
      }
    });
    expect(snapshots).toBeGreaterThan(50);
  });
});
