import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { GuestTransport, HostTransport } from './types';

export interface WebRtcConfig {
  /** PeerJS options: signaling host/port/path/secure and `config.iceServers`. */
  peer: PeerOptions;
  /** Prefix that namespaces room codes on the shared signaling broker. */
  prefix: string;
}

const UNRELIABLE_CHANNEL_ID = 100;

/**
 * PeerJS gives us a reliable, ordered data channel. Once its SCTP association is up, both
 * sides create a pre-negotiated unordered channel with no retransmits for inputs/snapshots.
 */
function openUnreliable(conn: DataConnection, onData: (d: Uint8Array) => void): RTCDataChannel | null {
  const pc = conn.peerConnection;
  if (!pc) return null;
  try {
    const dc = pc.createDataChannel('mh-unreliable', { negotiated: true, id: UNRELIABLE_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => onData(toBytes(e.data));
    return dc;
  } catch {
    return null;
  }
}

function toBytes(d: unknown): Uint8Array {
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  if (typeof d === 'string') return new TextEncoder().encode(d);
  return new Uint8Array(0);
}

function sendBytes(target: { send(d: ArrayBuffer | ArrayBufferView): void }, data: Uint8Array): void {
  target.send(data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice());
}

interface Link {
  conn: DataConnection;
  unreliable: RTCDataChannel | null;
}

/** Host side: registers the room code with the signaling broker and accepts guests. */
export class WebRtcHostTransport implements HostTransport {
  private readonly links = new Map<string, Link>();
  private msgCb: (peer: string, data: Uint8Array) => void = () => {};
  private joinCb: (peer: string) => void = () => {};
  private leaveCb: (peer: string) => void = () => {};
  private closed = false;

  private constructor(private readonly peer: Peer) {
    peer.on('connection', (conn) => this.accept(conn));
    // Keep the room code registered if the signaling socket drops; P2P links stay up.
    peer.on('disconnected', () => {
      if (!this.closed) setTimeout(() => !this.closed && peer.reconnect(), 1000);
    });
  }

  /** Opens a room, retrying with new codes if a code is taken. Resolves with the room code. */
  static async open(cfg: WebRtcConfig, codeGen: () => string, attempts = 8): Promise<{ transport: WebRtcHostTransport; room: string }> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const room = codeGen();
      try {
        const peer = await new Promise<Peer>((resolve, reject) => {
          const p = new Peer(cfg.prefix + room, cfg.peer);
          const timer = setTimeout(() => {
            p.destroy();
            reject(new Error('Signaling server did not answer'));
          }, 15000);
          p.once('open', () => {
            clearTimeout(timer);
            resolve(p);
          });
          p.once('error', (e) => {
            clearTimeout(timer);
            p.destroy();
            reject(e);
          });
        });
        return { transport: new WebRtcHostTransport(peer), room };
      } catch (e) {
        lastErr = e;
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw lastErr ?? new Error('Could not open a room');
  }

  private accept(conn: DataConnection): void {
    const id = conn.peer;
    conn.on('open', () => {
      const unreliable = openUnreliable(conn, (d) => this.msgCb(id, d));
      this.links.set(id, { conn, unreliable });
      const pc = conn.peerConnection;
      pc?.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') this.drop(id);
      });
      this.joinCb(id);
    });
    conn.on('data', (d) => this.msgCb(id, toBytes(d)));
    conn.on('close', () => this.drop(id));
    conn.on('error', () => this.drop(id));
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    try {
      link.conn.close();
    } catch {
      // Already closed.
    }
    this.leaveCb(id);
  }

  send(peer: string, data: Uint8Array, reliable: boolean): void {
    const link = this.links.get(peer);
    if (!link) return;
    try {
      if (!reliable && link.unreliable?.readyState === 'open') sendBytes(link.unreliable, data);
      else if (link.conn.open) link.conn.send(data.slice());
    } catch {
      // Buffer full or channel closing: unreliable data can be dropped.
    }
  }

  onMessage(cb: (peer: string, data: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onPeerJoin(cb: (peer: string) => void): void {
    this.joinCb = cb;
  }

  onPeerLeave(cb: (peer: string) => void): void {
    this.leaveCb = cb;
  }

  disconnect(peer: string): void {
    this.drop(peer);
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.links.keys()]) this.drop(id);
    this.peer.destroy();
  }
}

/** Guest side: connects to a room code through the signaling broker. */
export class WebRtcGuestTransport implements GuestTransport {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private unreliable: RTCDataChannel | null = null;
  private msgCb: (data: Uint8Array) => void = () => {};
  private closeCb: (reason: string) => void = () => {};
  private closed = false;

  constructor(private readonly cfg: WebRtcConfig) {}

  connect(room: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        this.close();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('Timed out connecting to the host')), 20000);
      const peer = new Peer(this.cfg.peer);
      this.peer = peer;
      peer.on('error', (e) => {
        const type = (e as { type?: string }).type;
        if (!settled) {
          clearTimeout(timer);
          fail(new Error(type === 'peer-unavailable' ? `Room ${room} not found` : `Connection error (${type ?? e.message})`));
        } else if (type === 'peer-unavailable' || type === 'network') {
          this.handleClose('Lost connection to the host');
        }
      });
      peer.on('open', () => {
        const conn = peer.connect(this.cfg.prefix + room, { reliable: true, serialization: 'raw' });
        this.conn = conn;
        conn.on('open', () => {
          this.unreliable = openUnreliable(conn, (d) => this.msgCb(d));
          const pc = conn.peerConnection;
          pc?.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') this.handleClose('Lost connection to the host');
          });
          clearTimeout(timer);
          settled = true;
          resolve();
        });
        conn.on('data', (d) => this.msgCb(toBytes(d)));
        conn.on('close', () => this.handleClose('The host left'));
        conn.on('error', () => this.handleClose('Connection error'));
      });
    });
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.close();
    this.closeCb(reason);
  }

  send(data: Uint8Array, reliable: boolean): void {
    try {
      if (!reliable && this.unreliable?.readyState === 'open') sendBytes(this.unreliable, data);
      else if (this.conn?.open) this.conn.send(data.slice());
    } catch {
      // Dropped.
    }
  }

  onMessage(cb: (data: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn?.close();
    } catch {
      // Ignore.
    }
    this.peer?.destroy();
  }
}
