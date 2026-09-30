import type { GuestTransport, HostTransport } from './types';

interface Pending {
  due: number;
  deliver: () => void;
}

export interface LinkConditions {
  latencyMs: number;
  jitterMs: number;
  /** Probability that an unreliable message is dropped. */
  loss: number;
}

/**
 * In-memory transport hub for tests and headless simulation. Messages are delivered when
 * `flush(now)` is called (or immediately with zero latency), optionally with simulated
 * latency, jitter and loss on the unreliable channel.
 */
export class MemoryHub {
  readonly host: MemoryHostTransport;
  private queue: Pending[] = [];
  private now = 0;
  private seq = 0;

  constructor(
    private readonly conditions: LinkConditions = { latencyMs: 0, jitterMs: 0, loss: 0 },
    private readonly random: () => number = Math.random,
  ) {
    this.host = new MemoryHostTransport(this);
  }

  createGuest(): MemoryGuestTransport {
    return new MemoryGuestTransport(this, `guest-${++this.seq}`);
  }

  /** @internal */
  schedule(reliable: boolean, deliver: () => void): void {
    const c = this.conditions;
    if (!reliable && c.loss > 0 && this.random() < c.loss) return;
    if (c.latencyMs === 0 && c.jitterMs === 0) {
      deliver();
      return;
    }
    const jitter = reliable ? 0 : this.random() * c.jitterMs;
    this.queue.push({ due: this.now + c.latencyMs + jitter, deliver });
  }

  /** Delivers every message due at or before `now` (ms). */
  flush(now: number): void {
    this.now = now;
    const due = this.queue.filter((p) => p.due <= now).sort((a, b) => a.due - b.due);
    this.queue = this.queue.filter((p) => p.due > now);
    for (const p of due) p.deliver();
  }
}

export class MemoryHostTransport implements HostTransport {
  private msgCb: (peer: string, data: Uint8Array) => void = () => {};
  private joinCb: (peer: string) => void = () => {};
  private leaveCb: (peer: string) => void = () => {};
  /** @internal */
  readonly guests = new Map<string, MemoryGuestTransport>();

  constructor(private readonly hub: MemoryHub) {}

  send(peer: string, data: Uint8Array, reliable: boolean): void {
    const g = this.guests.get(peer);
    if (!g) return;
    const copy = data.slice();
    this.hub.schedule(reliable, () => g.receive(copy));
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
    const g = this.guests.get(peer);
    if (!g) return;
    this.guests.delete(peer);
    g.closedByHost('kicked');
    this.leaveCb(peer);
  }

  close(): void {
    for (const [peer, g] of [...this.guests]) {
      this.guests.delete(peer);
      g.closedByHost('host closed');
    }
  }

  /** @internal */
  attach(g: MemoryGuestTransport): void {
    this.guests.set(g.peer, g);
    this.joinCb(g.peer);
  }

  /** @internal */
  detach(g: MemoryGuestTransport): void {
    if (this.guests.delete(g.peer)) this.leaveCb(g.peer);
  }

  /** @internal */
  receive(peer: string, data: Uint8Array, reliable: boolean): void {
    const copy = data.slice();
    this.hub.schedule(reliable, () => {
      if (this.guests.has(peer)) this.msgCb(peer, copy);
    });
  }
}

export class MemoryGuestTransport implements GuestTransport {
  private msgCb: (data: Uint8Array) => void = () => {};
  private closeCb: (reason: string) => void = () => {};
  private open = false;

  constructor(
    private readonly hub: MemoryHub,
    readonly peer: string,
  ) {}

  async connect(): Promise<void> {
    this.open = true;
    this.hub.host.attach(this);
  }

  send(data: Uint8Array, reliable: boolean): void {
    if (this.open) this.hub.host.receive(this.peer, data, reliable);
  }

  onMessage(cb: (data: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.hub.host.detach(this);
  }

  /** @internal */
  receive(data: Uint8Array): void {
    if (this.open) this.msgCb(data);
  }

  /** @internal */
  closedByHost(reason: string): void {
    this.open = false;
    this.closeCb(reason);
  }
}
