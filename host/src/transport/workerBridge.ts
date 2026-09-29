import { LOCAL_PEER, type GuestTransport, type HostTransport } from './types';

/**
 * WebRTC is only available on the main thread, but GameHost runs in a Web Worker. This bridge
 * relays transport events between them, and gives the lobby owner's own client a loopback
 * GuestTransport that reaches the worker without touching the network.
 */
export type BridgeToWorker =
  | { type: 'init'; room: string; handicapMs: number | null }
  | { type: 'join'; peer: string }
  | { type: 'leave'; peer: string }
  | { type: 'msg'; peer: string; data: Uint8Array };

export type BridgeFromWorker =
  | { type: 'send'; peer: string; data: Uint8Array; reliable: boolean }
  | { type: 'kick'; peer: string }
  | { type: 'telemetry'; entry: unknown }
  | { type: 'error'; message: string };

interface PortLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
}

/** Worker side: a HostTransport backed by postMessage. */
export class WorkerHostTransport implements HostTransport {
  private msgCb: (peer: string, data: Uint8Array) => void = () => {};
  private joinCb: (peer: string) => void = () => {};
  private leaveCb: (peer: string) => void = () => {};

  constructor(private readonly port: PortLike) {
    port.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as BridgeToWorker;
      if (m.type === 'join') this.joinCb(m.peer);
      else if (m.type === 'leave') this.leaveCb(m.peer);
      else if (m.type === 'msg') this.msgCb(m.peer, m.data);
    });
  }

  send(peer: string, data: Uint8Array, reliable: boolean): void {
    const copy = data.slice();
    this.port.postMessage({ type: 'send', peer, data: copy, reliable } satisfies BridgeFromWorker, [copy.buffer]);
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
    this.port.postMessage({ type: 'kick', peer } satisfies BridgeFromWorker);
  }

  close(): void {}
}

/** Main-thread side: connects the network transport and the local loopback to the worker. */
export class HostBridge {
  private localMsg: (data: Uint8Array) => void = () => {};
  private localClose: (reason: string) => void = () => {};
  private telemetryCb: (entry: unknown) => void = () => {};
  private errorCb: (message: string) => void = () => {};

  constructor(
    private readonly worker: PortLike & { terminate(): void },
    private readonly net: HostTransport | null,
  ) {
    worker.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as BridgeFromWorker;
      if (m.type === 'send') {
        if (m.peer === LOCAL_PEER) this.localMsg(m.data);
        else this.net?.send(m.peer, m.data, m.reliable);
      } else if (m.type === 'kick') {
        if (m.peer !== LOCAL_PEER) this.net?.disconnect(m.peer);
      } else if (m.type === 'telemetry') {
        this.telemetryCb(m.entry);
      } else if (m.type === 'error') {
        this.errorCb(m.message);
      }
    });
    net?.onPeerJoin((peer) => this.post({ type: 'join', peer }));
    net?.onPeerLeave((peer) => this.post({ type: 'leave', peer }));
    net?.onMessage((peer, data) => {
      const copy = data.slice();
      this.worker.postMessage({ type: 'msg', peer, data: copy } satisfies BridgeToWorker, [copy.buffer]);
    });
  }

  private post(m: BridgeToWorker): void {
    this.worker.postMessage(m);
  }

  init(room: string, handicapMs: number | null): void {
    this.post({ type: 'init', room, handicapMs });
  }

  /** The lobby owner's own connection to the host (no network involved). */
  localGuest(): GuestTransport {
    return {
      connect: async () => this.post({ type: 'join', peer: LOCAL_PEER }),
      send: (data) => {
        const copy = data.slice();
        this.worker.postMessage({ type: 'msg', peer: LOCAL_PEER, data: copy } satisfies BridgeToWorker, [copy.buffer]);
      },
      onMessage: (cb) => {
        this.localMsg = cb;
      },
      onClose: (cb) => {
        this.localClose = cb;
      },
      close: () => this.post({ type: 'leave', peer: LOCAL_PEER }),
    };
  }

  onTelemetry(cb: (entry: unknown) => void): void {
    this.telemetryCb = cb;
  }

  onError(cb: (message: string) => void): void {
    this.errorCb = cb;
  }

  terminate(): void {
    this.localClose('Host closed');
    this.net?.close();
    this.worker.terminate();
  }
}
