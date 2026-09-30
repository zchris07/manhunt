import {
  BALANCE,
  ByteReader,
  JSON_TAG,
  MSG_PING,
  MSG_SNAPSHOT,
  MapWorld,
  MAX_REDUNDANT_INPUTS,
  PROTOCOL_VERSION,
  TICK_DT,
  copyMoveState,
  encodePong,
  decodeJson,
  decodeSnapshot,
  deserializeMap,
  encodeInputs,
  encodeJson,
  entityFacing,
  entityX,
  entityY,
  generateMap,
  mapHash,
  quantizeInput,
  stepMovement,
  type ClientMessage,
  type DecodedSnapshot,
  type EntityRecord,
  type GameEvent,
  type HostMessage,
  type InputCmd,
  type LobbyPlayerInfo,
  type LobbySettings,
  type MapData,
  type MatchPlayerInfo,
  type MatchResult,
  type MoveContext,
  type MoveState,
  type Phase,
  type ResolvedBalance,
  type Role,
  type SelfState,
} from '@manhunt/shared';
import type { GuestTransport } from '@manhunt/host';

export interface LobbyView {
  players: LobbyPlayerInfo[];
  settings: LobbySettings;
  phase: Phase;
  owner: number;
}

export interface MatchInfo {
  map: MapData;
  mw: MapWorld;
  balance: ResolvedBalance;
  players: Map<number, MatchPlayerInfo>;
  role: Role;
  you: number;
}

export interface InterpEntity {
  id: number;
  kind: number;
  x: number;
  y: number;
  facing: number;
  state: number;
  action: number;
  extra: number;
  aux: number;
  hp: number;
}

export interface GameClientOptions {
  transport: GuestTransport;
  now: () => number;
  name: string;
  token?: string;
  /** Disable to watch raw server positions (debugging). */
  prediction?: boolean;
}

const TICK_MS = 1000 / BALANCE.net.tickHz;

/**
 * Protocol client, independent of the DOM: handshake, lobby state, snapshots, client-side
 * prediction with server reconciliation for the local player, and snapshot interpolation
 * (about 100 ms behind) for everyone else.
 */
export class GameClient {
  state: 'connecting' | 'lobby' | 'match' | 'results' | 'closed' = 'connecting';
  you = 0;
  token = '';
  room = '';
  lobby: LobbyView | null = null;
  match: MatchInfo | null = null;
  result: MatchResult | null = null;
  latest: DecodedSnapshot | null = null;
  self: SelfState | null = null;
  closeReason = '';
  lastError = '';
  rtt = 0;

  /** Predicted local movement state and the one before it (for render interpolation). */
  predicted: MoveState | null = null;
  prevPredicted: MoveState | null = null;
  /** Visual correction offset that decays toward zero after reconciliation. */
  readonly smooth = { x: 0, y: 0 };
  corrections = 0;
  /** Bumped whenever a door opens or closes (cached light polygons must be rebuilt). */
  doorVersion = 0;

  private readonly pending: InputCmd[] = [];
  private seq = 0;
  private readonly history = new Map<number, DecodedSnapshot>();
  private readonly buffer: { tick: number; entities: Map<number, EntityRecord> }[] = [];
  private clockOffset: number | null = null;
  private mapChunks: string[] = [];
  private pendingStart: Extract<HostMessage, { t: 'start' }> | null = null;
  private readonly events: GameEvent[] = [];
  private readonly listeners: { [K in 'lobby' | 'start' | 'end' | 'close' | 'chat' | 'error' | 'welcome' | 'role']: ((arg: unknown) => void)[] } = {
    role: [],
    lobby: [],
    start: [],
    end: [],
    close: [],
    chat: [],
    error: [],
    welcome: [],
  };

  constructor(private readonly opts: GameClientOptions) {
    opts.transport.onMessage((d) => this.onData(d));
    opts.transport.onClose((reason) => {
      this.state = 'closed';
      this.closeReason = this.closeReason || reason;
      this.emit('close', reason);
    });
  }

  on(ev: keyof GameClient['listeners'], cb: (arg: unknown) => void): () => void {
    this.listeners[ev].push(cb);
    return () => {
      const list = this.listeners[ev];
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private emit(ev: keyof GameClient['listeners'], arg?: unknown): void {
    for (const cb of this.listeners[ev].slice()) cb(arg);
  }

  async connect(room: string): Promise<void> {
    this.room = room;
    await this.opts.transport.connect(room);
    this.send({ t: 'hello', name: this.opts.name, token: this.opts.token, version: PROTOCOL_VERSION });
  }

  send(msg: ClientMessage): void {
    this.opts.transport.send(encodeJson(msg), true);
  }

  close(): void {
    this.opts.transport.close();
    this.state = 'closed';
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }

  get isOwner(): boolean {
    return !!this.lobby && this.lobby.owner === this.you;
  }

  private onData(data: Uint8Array): void {
    if (data.length === 0) return;
    if (data[0] === JSON_TAG) {
      try {
        this.onHostMessage(decodeJson(data) as HostMessage);
      } catch (e) {
        console.warn('[net] bad host message', e);
      }
      return;
    }
    if (data[0] === MSG_SNAPSHOT) this.onSnapshot(data);
    else if (data[0] === MSG_PING) {
      const r = new ByteReader(data);
      r.u8();
      const t = r.f64();
      this.opts.transport.send(encodePong(t, 0), false);
    }
  }

  private onHostMessage(m: HostMessage): void {
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.token = m.token;
        this.room = m.room;
        if (this.state === 'connecting') this.state = 'lobby';
        this.emit('welcome', m);
        break;
      case 'lobby':
        this.lobby = { players: m.players, settings: m.settings, phase: m.phase, owner: m.owner };
        if (m.phase === 'lobby' && (this.state === 'match' || this.state === 'results')) {
          this.state = 'lobby';
          this.match = null;
          this.result = null;
        }
        this.emit('lobby', this.lobby);
        break;
      case 'start':
        this.beginMatch(m);
        break;
      case 'mapChunk':
        this.mapChunks[m.i] = m.data;
        if (this.mapChunks.filter((c) => c !== undefined).length === m.n && this.pendingStart) {
          const map = deserializeMap(this.mapChunks.join(''));
          this.mapChunks = [];
          this.finishStart(this.pendingStart, map);
        }
        break;
      case 'ev':
        if (m.e.k === 'roles' && this.match) {
          // Testing mode: someone switched between Zach and survivor.
          this.match.players = new Map(m.e.players.map((p) => [p.id, p]));
          const mine = this.match.players.get(this.you);
          if (mine && mine.role !== this.match.role) {
            this.match.role = mine.role;
            this.predicted = null;
            this.prevPredicted = null;
            this.pending.length = 0;
            this.emit('role', mine.role);
          }
        }
        this.events.push(m.e);
        break;
      case 'end':
        this.result = m.result;
        this.state = 'results';
        this.emit('end', m.result);
        break;
      case 'chat':
        this.emit('chat', m);
        break;
      case 'err':
        this.lastError = m.msg;
        this.emit('error', m.msg);
        break;
      case 'kick':
        this.closeReason = m.reason;
        this.emit('error', m.reason);
        break;
      case 'handicap':
        break;
    }
  }

  private beginMatch(m: Extract<HostMessage, { t: 'start' }>): void {
    const map = generateMap(m.params);
    if (mapHash(map) !== m.mapHash) {
      // Floating-point divergence between JS engines: fetch the host's map instead.
      console.warn('[net] map checksum mismatch, requesting map from host');
      this.pendingStart = m;
      this.mapChunks = [];
      this.send({ t: 'mapReq' });
      return;
    }
    this.finishStart(m, map);
  }

  private finishStart(m: Extract<HostMessage, { t: 'start' }>, map: MapData): void {
    this.pendingStart = null;
    this.match = {
      map,
      mw: new MapWorld(map),
      balance: m.balance,
      players: new Map(m.players.map((p) => [p.id, p])),
      role: m.role,
      you: m.you,
    };
    this.you = m.you;
    this.result = null;
    this.latest = null;
    this.self = null;
    this.predicted = null;
    this.prevPredicted = null;
    this.pending.length = 0;
    this.history.clear();
    this.buffer.length = 0;
    this.clockOffset = null;
    this.events.length = 0;
    this.state = 'match';
    this.emit('start', this.match);
  }

  private onSnapshot(data: Uint8Array): void {
    if (!this.match) return;
    let snap: DecodedSnapshot | null;
    try {
      snap = decodeSnapshot(data, (t) => this.history.get(t));
    } catch (e) {
      console.warn('[net] bad snapshot', e);
      return;
    }
    if (!snap) return;
    if (this.latest && snap.tick <= this.latest.tick) {
      // Out of order: still useful as a delta baseline.
      this.history.set(snap.tick, snap);
      return;
    }
    this.history.set(snap.tick, snap);
    for (const t of this.history.keys()) if (t < snap.tick - 64) this.history.delete(t);
    this.latest = snap;
    this.self = snap.self;

    const now = this.opts.now();
    const offset = now - snap.tick * TICK_MS;
    // Track the earliest arrival (least delayed) with slow upward drift to follow jitter.
    this.clockOffset = this.clockOffset === null ? offset : Math.min(offset, this.clockOffset + 0.5);
    this.buffer.push({ tick: snap.tick, entities: snap.entities });
    while (this.buffer.length > 40) this.buffer.shift();

    // Dynamic colliders follow the world state (barricades, gate, doors).
    const geo = this.match.mw.geo;
    const ws = snap.worldState;
    this.match.map.barricades.forEach((b, i) => geo.setDynamicActive(b.dyn, ws.barricades[i] === 1));
    geo.setDynamicActive(this.match.map.gate.dyn, !ws.gateOpen);
    let doorsChanged = false;
    this.match.map.doors.forEach((d, i) => {
      const open = ws.doors[i] === true;
      if (geo.isDynamicActive(d.dyn) === open) {
        geo.setDynamicActive(d.dyn, !open);
        doorsChanged = true;
      }
    });
    ws.windowsBroken.forEach((b, i) => {
      if (b !== geo.isWindowBroken(i)) geo.setWindowBroken(i, b);
    });
    if (doorsChanged) this.doorVersion++;

    this.reconcile(snap);
  }

  private moveCtx(): MoveContext {
    const m = this.match!;
    return { role: m.role === 'hunter' ? 'hunter' : 'survivor', hunterSpeedMul: m.balance.hunterSpeedMul, carrying: (this.self?.carrying ?? 0) > 0 };
  }

  private reconcile(snap: DecodedSnapshot): void {
    const s = snap.self;
    const m = this.match!;
    if (s.spectating || m.role === 'spectator') {
      this.predicted = null;
      this.pending.length = 0;
      return;
    }
    while (this.pending.length && this.pending[0].seq <= snap.lastSeq) this.pending.shift();
    const base: MoveState = {
      x: s.x,
      y: s.y,
      mode: s.mode,
      lungeT: s.lungeT,
      lungeAng: s.lungeAng,
      lungeCharges: s.lungeCharges,
      lungeRecharge: s.lungeRecharge,
      kbT: s.kbT,
      kbDur: s.kbDur,
      kbPeak: s.kbPeak,
      kbAng: s.kbAng,
      hasteT: s.hasteT,
      slowT: s.slowT,
      slowMul: s.slowMul || 1,
      stamina: s.stamina,
      staminaLock: s.staminaLock,
      sprintBlocked: s.sprintBlocked,
      boostT: s.boostT,
      hempT: s.hempT,
      prevButtons: s.prevButtons,
      sprinting: s.sprinting,
    };
    if (this.opts.prediction !== false) {
      const ctx = this.moveCtx();
      for (const cmd of this.pending) stepMovement(base, cmd, ctx, m.mw.geo, TICK_DT);
    }
    if (this.predicted && this.prevPredicted) {
      const ex = this.predicted.x - base.x;
      const ey = this.predicted.y - base.y;
      const err = Math.hypot(ex, ey);
      if (err > 120) {
        // Teleport (carried, stake, hiding): snap.
        this.smooth.x = 0;
        this.smooth.y = 0;
        this.prevPredicted = copyMoveState(base);
      } else {
        // Keep the drawn position continuous; the offset decays over a few frames.
        this.smooth.x += ex;
        this.smooth.y += ey;
        this.prevPredicted.x -= ex;
        this.prevPredicted.y -= ey;
        if (err > 2) this.corrections++;
      }
    } else {
      this.prevPredicted = copyMoveState(base);
    }
    this.predicted = base;
  }

  /** Called once per fixed input step (30 Hz): predicts locally and sends to the host. */
  pushInput(cmd: Omit<InputCmd, 'seq'>): InputCmd | null {
    if (this.state !== 'match' || !this.match) return null;
    const q = quantizeInput({ ...cmd, seq: ++this.seq });
    this.pending.push(q);
    if (this.pending.length > 120) this.pending.shift();
    if (this.predicted && this.opts.prediction !== false && this.match.role !== 'spectator' && !this.self?.spectating) {
      this.prevPredicted = copyMoveState(this.predicted);
      stepMovement(this.predicted, q, this.moveCtx(), this.match.mw.geo, TICK_DT);
    }
    this.opts.transport.send(encodeInputs(this.latest?.tick ?? 0, this.pending.slice(-MAX_REDUNDANT_INPUTS)), false);
    return q;
  }

  /** Decays the reconciliation smoothing offset (call every render frame). */
  decaySmoothing(dtSec: number): void {
    const k = Math.exp(-dtSec * 12);
    this.smooth.x *= k;
    this.smooth.y *= k;
  }

  /** Estimated server tick being rendered for remote entities (about 100 ms in the past). */
  renderTick(now: number): number {
    if (this.clockOffset === null) return this.latest?.tick ?? 0;
    return (now - this.clockOffset) / TICK_MS - BALANCE.net.interpolationDelayMs / TICK_MS;
  }

  /** Remote entities interpolated between the two snapshots around the render time. */
  interpolated(now: number): InterpEntity[] {
    const out: InterpEntity[] = [];
    if (!this.buffer.length) return out;
    const rt = this.renderTick(now);
    let a = this.buffer[0];
    let b = this.buffer[this.buffer.length - 1];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].tick <= rt) {
        a = this.buffer[i];
        b = this.buffer[Math.min(i + 1, this.buffer.length - 1)];
        break;
      }
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - a.tick) / span)) : 1;
    // Presence follows the newest snapshot so entities vanish as soon as the host says so.
    const newest = this.buffer[this.buffer.length - 1].entities;
    for (const [id, eb] of newest) {
      const ea = a.entities.get(id) ?? eb;
      const e1 = b.entities.get(id) ?? eb;
      const ax = entityX(ea);
      const ay = entityY(ea);
      const bx = entityX(e1);
      const by = entityY(e1);
      const teleport = Math.hypot(bx - ax, by - ay) > 250;
      const fa = entityFacing(ea);
      let df = entityFacing(e1) - fa;
      if (df > Math.PI) df -= Math.PI * 2;
      if (df < -Math.PI) df += Math.PI * 2;
      out.push({
        id,
        kind: eb.kind,
        x: teleport ? bx : ax + (bx - ax) * t,
        y: teleport ? by : ay + (by - ay) * t,
        facing: fa + df * t,
        state: eb.state,
        action: eb.action,
        extra: eb.extra,
        aux: eb.aux,
        hp: eb.hp,
      });
    }
    return out;
  }
}
