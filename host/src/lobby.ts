import { Rng, type AssignedRole, type LobbyPlayerInfo, type LobbySettings, type RolePref } from '@manhunt/shared';

export interface LobbyPlayer {
  id: number;
  name: string;
  token: string;
  pref: RolePref;
  assigned: AssignedRole;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  leftAt: number;
  ping: number;
}

export const DEFAULT_SETTINGS: LobbySettings = {
  hunters: 1,
  survivors: 9,
  seed: '',
  testMode: false,
};

export interface RoleSplit {
  hunters: number[];
  survivors: number[];
  spectators: number[];
}

/** Lobby membership, settings and role assignment. The owner is decided by GameHost. */
export class Lobby {
  readonly players = new Map<number, LobbyPlayer>();
  settings: LobbySettings = { ...DEFAULT_SETTINGS };
  private nextId = 1;

  get size(): number {
    return this.players.size;
  }

  add(name: string, token: string, now: number): LobbyPlayer {
    let id = this.nextId;
    // Player ids fit in a byte and must stay unique while players are present.
    while (this.players.has(id) || id === 0) id = (id % 250) + 1;
    this.nextId = (id % 250) + 1;
    const p: LobbyPlayer = { id, name, token, pref: 'any', assigned: 'auto', ready: false, connected: true, joinedAt: now, leftAt: 0, ping: 0 };
    this.players.set(id, p);
    return p;
  }

  remove(id: number): void {
    this.players.delete(id);
  }

  byToken(token: string): LobbyPlayer | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  uniqueName(name: string, excludeId = -1): string {
    const taken = new Set([...this.players.values()].filter((p) => p.id !== excludeId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 20; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  setSettings(s: LobbySettings): void {
    this.settings = {
      hunters: Math.max(1, Math.min(9, Math.round(s.hunters))),
      survivors: Math.max(1, Math.min(9, Math.round(s.survivors))),
      seed: s.seed.slice(0, 32),
      testMode: s.testMode === true,
    };
  }

  /**
   * Splits connected players into roles. Owner assignments win; then hunter slots are filled
   * by preference (hunter > any > survivor), survivors take the rest up to the survivor cap,
   * and anyone left over spectates.
   */
  resolveRoles(rng: Rng): RoleSplit {
    const present = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const split: RoleSplit = { hunters: [], survivors: [], spectators: [] };
    const free: LobbyPlayer[] = [];
    for (const p of present) {
      if (p.assigned === 'hunter') split.hunters.push(p.id);
      else if (p.assigned === 'survivor') split.survivors.push(p.id);
      else if (p.assigned === 'spectator') split.spectators.push(p.id);
      else free.push(p);
    }
    const wantH = Math.max(0, Math.min(this.settings.hunters, present.length - 1) - split.hunters.length);
    const rank = (p: LobbyPlayer): number => (p.pref === 'hunter' ? 0 : p.pref === 'any' ? 1 : 2);
    const order = rng.shuffle(free.slice()).sort((a, b) => rank(a) - rank(b));
    const hunters = order.slice(0, wantH);
    for (const p of hunters) split.hunters.push(p.id);
    const rest = order.slice(wantH);
    const wantS = Math.max(0, this.settings.survivors - split.survivors.length);
    rest.sort((a, b) => (a.pref === 'survivor' ? 0 : 1) - (b.pref === 'survivor' ? 0 : 1));
    rest.forEach((p, i) => (i < wantS ? split.survivors : split.spectators).push(p.id));
    return split;
  }

  info(ownerId: number): LobbyPlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        pref: p.pref,
        assigned: p.assigned,
        ready: p.ready || p.id === ownerId,
        owner: p.id === ownerId,
        connected: p.connected,
        ping: Math.round(p.ping),
      }));
  }

  allReady(ownerId: number): boolean {
    return [...this.players.values()].filter((p) => p.connected).every((p) => p.ready || p.id === ownerId);
  }
}
