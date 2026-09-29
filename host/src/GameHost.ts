import {
  BALANCE,
  JSON_TAG,
  MSG_INPUT,
  MSG_PONG,
  PROTOCOL_VERSION,
  Rng,
  ByteReader,
  decodeInputs,
  decodeJson,
  encodeJson,
  encodePing,
  encodeSnapshot,
  encodeWorld,
  generateMap,
  hashString,
  mapHash,
  mapParamsFor,
  parseClientMessage,
  resolveBalance,
  sanitizeChat,
  sanitizeName,
  serializeMap,
  type ClientMessage,
  type HostMessage,
  type InputCmd,
  type MapData,
  type MatchPlayerInfo,
  type Phase,
  type ResolvedBalance,
  type SentSnapshot,
} from '@manhunt/shared';
import { Lobby } from './lobby';
import { LOCAL_PEER, type HostTransport } from './transport/types';
import { World } from './sim/World';
import { buildView } from './sim/view';
import { cycleSpectate, skillCheckResult } from './sim/objectives';
import { createPlayer } from './sim/player';
import { matchLogEntry, type MatchLogEntry } from './telemetry';
import { devCommand } from './dev/devCommands';

export interface GameHostOptions {
  transport: HostTransport;
  room: string;
  /** Monotonic clock in milliseconds. */
  now: () => number;
  /** Host input handicap in ms; null/undefined = auto (half the average guest RTT). */
  handicapMs?: number | null;
  telemetry?: (entry: MatchLogEntry) => void;
  random?: () => number;
  /** Accept dev/test commands (teleport, finish generators...). Never enable for real games. */
  dev?: boolean;
}

interface PeerState {
  id: string;
  playerId: number;
  lastSeen: number;
  rtt: number;
  ackTick: number;
  history: Map<number, SentSnapshot>;
  reliableTokens: number;
  unreliableTokens: number;
  strikes: number;
  delayed: { at: number; cmds: InputCmd[] }[];
}

const MAP_CHUNK = 12000;
const PEER_TIMEOUT_MS = 12000;

/**
 * Authoritative game host: lobby, match lifecycle, networking and snapshots. Knows nothing
 * about WebRTC, workers or the DOM; it only talks to a HostTransport.
 */
export class GameHost {
  phase: Phase = 'lobby';
  readonly lobby = new Lobby();
  world: World | null = null;
  readonly peers = new Map<string, PeerState>();
  private readonly byPlayer = new Map<number, string>();
  private readonly random: () => number;
  private lastPingAt = 0;
  private map: MapData | null = null;
  private mapJson: string | null = null;
  private matchSeed = 0;
  private balance: ResolvedBalance | null = null;
  private matchPlayers: MatchPlayerInfo[] = [];
  private startedAt = 0;
  private kicked: { peer: string; at: number }[] = [];

  constructor(private readonly opts: GameHostOptions) {
    this.random = opts.random ?? Math.random;
    const t = opts.transport;
    t.onPeerJoin((peer) => this.onJoin(peer));
    t.onPeerLeave((peer) => this.onLeave(peer));
    t.onMessage((peer, data) => this.onMessage(peer, data));
  }

  get room(): string {
    return this.opts.room;
  }

  /** The lobby owner: the host's own local client, else the longest-connected player. */
  get ownerId(): number {
    const local = this.peers.get(LOCAL_PEER);
    if (local?.playerId) return local.playerId;
    const first = [...this.lobby.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    return first?.id ?? 0;
  }

  /** Current input handicap applied to the host's own client. */
  get handicapMs(): number {
    if (this.opts.handicapMs != null) return Math.max(0, this.opts.handicapMs);
    const guests = [...this.peers.values()].filter((p) => p.id !== LOCAL_PEER && p.playerId && p.rtt > 0);
    if (!guests.length) return 0;
    const avg = guests.reduce((s, p) => s + p.rtt, 0) / guests.length;
    return Math.min(BALANCE.net.hostHandicapMaxMs, avg * BALANCE.net.hostHandicapRttFraction);
  }

  private send(peer: string, msg: HostMessage): void {
    this.opts.transport.send(peer, encodeJson(msg), true);
  }

  private sendToPlayer(playerId: number, msg: HostMessage): void {
    const peer = this.byPlayer.get(playerId);
    if (peer) this.send(peer, msg);
  }

  private broadcast(msg: HostMessage): void {
    const data = encodeJson(msg);
    for (const p of this.peers.values()) if (p.playerId) this.opts.transport.send(p.id, data, true);
  }

  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby', players: this.lobby.info(this.ownerId), settings: this.lobby.settings, phase: this.phase, owner: this.ownerId });
  }

  private onJoin(peer: string): void {
    const now = this.opts.now();
    this.peers.set(peer, {
      id: peer,
      playerId: 0,
      lastSeen: now,
      rtt: 0,
      ackTick: 0,
      history: new Map(),
      reliableTokens: BALANCE.net.reliableBurst,
      unreliableTokens: BALANCE.net.unreliableBurst,
      strikes: 0,
      delayed: [],
    });
  }

  private onLeave(peer: string): void {
    const ps = this.peers.get(peer);
    if (!ps) return;
    this.peers.delete(peer);
    if (!ps.playerId) return;
    this.byPlayer.delete(ps.playerId);
    const lp = this.lobby.players.get(ps.playerId);
    if (lp) {
      lp.connected = false;
      lp.ready = false;
      lp.leftAt = this.opts.now();
    }
    this.world?.setConnected(ps.playerId, false);
    this.broadcastLobby();
  }

  /** Tells a peer why, then drops it shortly after so the message can arrive first. */
  kick(peer: string, reason: string): void {
    this.send(peer, { t: 'kick', reason });
    const ps = this.peers.get(peer);
    this.onLeave(peer);
    if (ps) this.kicked.push({ peer, at: this.opts.now() + 300 });
    else this.opts.transport.disconnect(peer);
  }

  private strike(ps: PeerState): void {
    ps.strikes++;
    if (ps.strikes > 50) this.kick(ps.id, 'Too many invalid messages');
  }

  private onMessage(peer: string, data: Uint8Array): void {
    const ps = this.peers.get(peer);
    if (!ps || data.length === 0) return;
    ps.lastSeen = this.opts.now();
    const reliable = data[0] === JSON_TAG;
    if (reliable) {
      if (data.length > BALANCE.net.maxReliableBytes) return this.strike(ps);
      if (ps.reliableTokens < 1) return this.strike(ps);
      ps.reliableTokens -= 1;
      let msg: ClientMessage | null = null;
      try {
        msg = parseClientMessage(decodeJson(data));
      } catch {
        msg = null;
      }
      if (!msg) return this.strike(ps);
      this.handle(ps, msg);
      return;
    }
    if (data.length > BALANCE.net.maxUnreliableBytes) return this.strike(ps);
    if (ps.unreliableTokens < 1) return;
    ps.unreliableTokens -= 1;
    try {
      if (data[0] === MSG_INPUT) this.onInputs(ps, data);
      else if (data[0] === MSG_PONG) {
        const r = new ByteReader(data);
        r.u8();
        const sent = r.f64();
        const rtt = this.opts.now() - sent;
        if (rtt >= 0 && rtt < 5000) {
          ps.rtt = ps.rtt ? ps.rtt * 0.8 + rtt * 0.2 : rtt;
          const lp = this.lobby.players.get(ps.playerId);
          if (lp) lp.ping = ps.rtt;
          const sp = this.world?.players.get(ps.playerId);
          if (sp) sp.rtt = ps.rtt;
        }
      } else this.strike(ps);
    } catch {
      this.strike(ps);
    }
  }

  private onInputs(ps: PeerState, data: Uint8Array): void {
    const { ackTick, cmds } = decodeInputs(data);
    if (this.world && ackTick <= this.world.tick && ackTick > ps.ackTick && ps.history.has(ackTick)) ps.ackTick = ackTick;
    if (!this.world || !ps.playerId) return;
    if (ps.id === LOCAL_PEER && this.handicapMs > 0) {
      ps.delayed.push({ at: this.opts.now() + this.handicapMs, cmds });
      return;
    }
    this.world.enqueueInputs(ps.playerId, cmds);
  }

  private handle(ps: PeerState, msg: ClientMessage): void {
    if (msg.t === 'hello') return this.onHello(ps, msg.name, msg.token, msg.version);
    const lp = this.lobby.players.get(ps.playerId);
    if (!lp) return;
    const isOwner = lp.id === this.ownerId;
    switch (msg.t) {
      case 'rolePref':
        lp.pref = msg.pref;
        this.broadcastLobby();
        break;
      case 'ready':
        lp.ready = msg.ready;
        this.broadcastLobby();
        break;
      case 'settings':
        if (!isOwner || this.phase !== 'lobby') return;
        this.lobby.setSettings(msg.settings);
        this.broadcastLobby();
        break;
      case 'assign': {
        if (!isOwner || this.phase !== 'lobby') return;
        const target = this.lobby.players.get(msg.player);
        if (target) target.assigned = msg.role;
        this.broadcastLobby();
        break;
      }
      case 'shuffle': {
        if (!isOwner || this.phase !== 'lobby') return;
        const rng = new Rng((this.random() * 2 ** 32) >>> 0);
        const present = rng.shuffle([...this.lobby.players.values()].filter((p) => p.connected));
        const h = Math.min(this.lobby.settings.hunters, Math.max(1, present.length - 1));
        present.forEach((p, i) => (p.assigned = i < h ? 'hunter' : i - h < this.lobby.settings.survivors ? 'survivor' : 'spectator'));
        this.broadcastLobby();
        break;
      }
      case 'start':
        if (!isOwner || this.phase !== 'lobby') return;
        this.startMatch(ps);
        break;
      case 'toLobby':
        if (!isOwner || this.phase === 'lobby') return;
        this.returnToLobby();
        break;
      case 'chat': {
        const text = sanitizeChat(msg.text);
        if (text) this.broadcast({ t: 'chat', from: lp.name, text });
        break;
      }
      case 'skill': {
        const sp = this.world?.players.get(lp.id);
        if (sp && this.world) skillCheckResult(this.world, sp, msg.id, msg.result);
        break;
      }
      case 'spectate': {
        const sp = this.world?.players.get(lp.id);
        if (sp && this.world) cycleSpectate(this.world, sp, msg.dir);
        break;
      }
      case 'mapReq':
        this.sendMap(ps.id);
        break;
      case 'dev':
        if (this.opts.dev && this.world) devCommand(this.world, lp.id, msg.cmd, msg.args);
        break;
    }
  }

  private onHello(ps: PeerState, rawName: string, token: string | undefined, version: number): void {
    if (ps.playerId) return;
    if (version !== PROTOCOL_VERSION) {
      this.kick(ps.id, 'Game version mismatch. Refresh the page.');
      return;
    }
    const name = sanitizeName(rawName);
    if (name.length < 2) {
      this.send(ps.id, { t: 'err', msg: 'Names must be 2-16 letters or numbers' });
      return;
    }
    const now = this.opts.now();
    let lp = token ? this.lobby.byToken(token) : undefined;
    if (lp) {
      // Rejoin with a session token. If the old connection hasn't been detected as dropped
      // yet (e.g. a page refresh), the new connection takes over.
      const old = this.byPlayer.get(lp.id);
      if (old && old !== ps.id) {
        this.peers.delete(old);
        this.opts.transport.disconnect(old);
      }
      lp.connected = true;
      lp.leftAt = 0;
    } else {
      const connected = [...this.lobby.players.values()].filter((p) => p.connected).length;
      if (connected >= BALANCE.net.maxPlayers) {
        this.kick(ps.id, 'The lobby is full (10 players)');
        return;
      }
      const newToken = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(this.random() * 36)]).join('');
      lp = this.lobby.add(this.lobby.uniqueName(name), newToken, now);
    }
    ps.playerId = lp.id;
    this.byPlayer.set(lp.id, ps.id);
    this.send(ps.id, { t: 'welcome', you: lp.id, token: lp.token, room: this.room, version: PROTOCOL_VERSION });

    if (this.world && this.phase === 'match') {
      let sp = this.world.players.get(lp.id);
      if (sp) {
        this.world.setConnected(lp.id, true);
      } else {
        // Late joiner: spectate the current match.
        const spawn = this.world.map.survivorSpawns[0];
        sp = createPlayer(lp.id, lp.name, 'spectator', 0, spawn.x, spawn.y);
        this.world.addPlayer(sp);
        this.matchPlayers.push({ id: lp.id, name: lp.name, role: 'spectator', tint: 0 });
      }
      this.sendStart(ps.id, lp.id);
    }
    this.broadcastLobby();
  }

  private startMatch(ownerPeer: PeerState): void {
    if (!this.lobby.allReady(this.ownerId)) {
      this.send(ownerPeer.id, { t: 'err', msg: 'Everyone must be ready' });
      return;
    }
    const rng = new Rng((this.random() * 2 ** 32) >>> 0);
    const split = this.lobby.resolveRoles(rng);
    if (split.hunters.length < 1 || split.survivors.length < 1) {
      this.send(ownerPeer.id, { t: 'err', msg: 'A match needs at least 1 hunter and 1 survivor' });
      return;
    }
    const s = this.lobby.settings;
    this.matchSeed = s.seed ? hashString(s.seed) : (this.random() * 2 ** 32) >>> 0;
    this.balance = resolveBalance({ hunters: split.hunters.length, survivors: split.survivors.length, difficulty: s.difficulty, escapeFraction: s.escapeFraction });
    const params = mapParamsFor(this.matchSeed, this.balance);
    this.map = generateMap(params);
    this.mapJson = null;
    const name = (id: number): string => this.lobby.players.get(id)?.name ?? '?';
    this.matchPlayers = [
      ...split.hunters.map((id) => ({ id, name: name(id), role: 'hunter' as const, tint: 0 })),
      ...split.survivors.map((id, i) => ({ id, name: name(id), role: 'survivor' as const, tint: i % 10 })),
      ...split.spectators.map((id) => ({ id, name: name(id), role: 'spectator' as const, tint: 0 })),
    ];
    this.world = new World({
      map: this.map,
      balance: this.balance,
      players: this.matchPlayers,
      seed: this.matchSeed,
      viewLagMs: (id) => this.viewLag(id),
    });
    this.phase = 'match';
    this.startedAt = this.opts.now();
    for (const ps of this.peers.values()) {
      ps.history.clear();
      ps.ackTick = 0;
      ps.delayed = [];
      if (ps.playerId) this.sendStart(ps.id, ps.playerId);
    }
    this.broadcastLobby();
  }

  private viewLag(playerId: number): number {
    const peer = this.byPlayer.get(playerId);
    const ps = peer ? this.peers.get(peer) : undefined;
    const interp = BALANCE.net.interpolationDelayMs;
    if (!ps) return interp;
    if (ps.id === LOCAL_PEER) return interp + this.handicapMs;
    return interp + ps.rtt / 2;
  }

  private sendStart(peer: string, playerId: number): void {
    if (!this.world || !this.map || !this.balance) return;
    const sp = this.world.players.get(playerId);
    const ps = this.peers.get(peer);
    if (ps) {
      ps.history.clear();
      ps.ackTick = 0;
    }
    this.send(peer, {
      t: 'start',
      params: this.map.params,
      balance: this.balance,
      players: this.world.playerInfo(),
      you: playerId,
      role: sp?.role ?? 'spectator',
      mapHash: mapHash(this.map),
      tick: this.world.tick,
    });
  }

  private sendMap(peer: string): void {
    if (!this.map) return;
    this.mapJson ??= serializeMap(this.map);
    const n = Math.ceil(this.mapJson.length / MAP_CHUNK);
    for (let i = 0; i < n; i++) this.send(peer, { t: 'mapChunk', i, n, data: this.mapJson.slice(i * MAP_CHUNK, (i + 1) * MAP_CHUNK) });
  }

  private endMatch(): void {
    if (!this.world?.result || !this.balance) return;
    this.phase = 'results';
    const result = this.world.result;
    this.broadcast({ t: 'end', result });
    for (const p of this.lobby.players.values()) p.ready = false;
    this.opts.telemetry?.(
      matchLogEntry({
        seed: this.matchSeed,
        mapHash: this.map ? mapHash(this.map) : 0,
        balance: this.balance,
        settings: this.lobby.settings,
        result,
        realDurationSec: (this.opts.now() - this.startedAt) / 1000,
      }),
    );
    this.broadcastLobby();
  }

  returnToLobby(): void {
    this.phase = 'lobby';
    this.world = null;
    this.map = null;
    this.mapJson = null;
    for (const p of this.lobby.players.values()) p.ready = false;
    this.broadcastLobby();
  }

  private sendSnapshots(): void {
    const w = this.world!;
    for (const ps of this.peers.values()) {
      if (!ps.playerId) continue;
      const sp = w.players.get(ps.playerId);
      if (!sp) continue;
      const view = buildView(w, sp);
      const worldBytes = encodeWorld(view.world);
      const base = ps.ackTick ? (ps.history.get(ps.ackTick) ?? null) : null;
      const data = encodeSnapshot(w.tick, base, sp.lastSeq, view.self, view.entities, worldBytes);
      this.opts.transport.send(ps.id, data, false);
      ps.history.set(w.tick, { tick: w.tick, entities: new Map(view.entities.map((e) => [e.id, e])), world: worldBytes });
      const cutoff = w.tick - BALANCE.net.snapshotHistory * 2;
      for (const t of ps.history.keys()) if (t < cutoff) ps.history.delete(t);
      if (ps.ackTick && ps.ackTick < cutoff) ps.ackTick = 0;
    }
  }

  /** Advances the host by one fixed tick (30 Hz). Call from a timer loop. */
  tick(): void {
    const now = this.opts.now();
    const net = BALANCE.net;
    const dtSec = 1 / net.tickHz;
    if (this.kicked.length) {
      for (const k of this.kicked.filter((k) => k.at <= now)) this.opts.transport.disconnect(k.peer);
      this.kicked = this.kicked.filter((k) => k.at > now);
    }
    for (const ps of this.peers.values()) {
      ps.reliableTokens = Math.min(net.reliableBurst, ps.reliableTokens + net.reliableRatePerSec * dtSec);
      ps.unreliableTokens = Math.min(net.unreliableBurst, ps.unreliableTokens + net.unreliableRatePerSec * dtSec);
      if (ps.delayed.length && this.world && ps.playerId) {
        while (ps.delayed.length && ps.delayed[0].at <= now) this.world.enqueueInputs(ps.playerId, ps.delayed.shift()!.cmds);
      }
    }

    if (this.phase === 'match' && this.world) {
      const w = this.world;
      w.step();
      for (const ev of w.events) for (const id of ev.to) this.sendToPlayer(id, { t: 'ev', e: ev.e });
      w.events.length = 0;
      if (net.snapshotEvery[w.tick % net.snapshotEvery.length]) this.sendSnapshots();
      if (w.result) this.endMatch();
    }

    if (now - this.lastPingAt >= net.pingIntervalMs) {
      this.lastPingAt = now;
      const ping = encodePing(now);
      for (const ps of this.peers.values()) {
        if (ps.playerId) this.opts.transport.send(ps.id, ping, false);
        if (ps.id !== LOCAL_PEER && now - ps.lastSeen > PEER_TIMEOUT_MS) {
          this.opts.transport.disconnect(ps.id);
          this.onLeave(ps.id);
        }
      }
      // Forget lobby members who never came back.
      for (const lp of [...this.lobby.players.values()]) {
        const leftAt = lp.leftAt;
        const inMatch = this.phase === 'match' && this.world?.players.has(lp.id);
        if (!lp.connected && leftAt && now - leftAt > net.reconnectGraceSec * 1000 && !inMatch) {
          this.lobby.remove(lp.id);
          this.broadcastLobby();
        }
      }
    }
  }

  close(): void {
    this.opts.transport.close();
  }
}
