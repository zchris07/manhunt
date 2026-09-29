/**
 * Transport abstraction. GameHost and the protocol only ever see these interfaces, so the same
 * GameHost runs over WebRTC (player-hosted, v1), in-memory (tests) or WebSockets (future Node
 * server) without changes.
 *
 * Payloads are bytes. `reliable` selects the ordered/reliable channel (lobby, events) versus
 * the unordered/unreliable channel (inputs, snapshots). Transports may fall back to the
 * reliable channel when no unreliable one exists.
 */
export interface HostTransport {
  send(peer: string, data: Uint8Array, reliable: boolean): void;
  onMessage(cb: (peer: string, data: Uint8Array) => void): void;
  onPeerJoin(cb: (peer: string) => void): void;
  onPeerLeave(cb: (peer: string) => void): void;
  /** Drops a peer's connection (kick). */
  disconnect(peer: string): void;
  close(): void;
}

export interface GuestTransport {
  connect(room: string): Promise<void>;
  send(data: Uint8Array, reliable: boolean): void;
  onMessage(cb: (data: Uint8Array) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

/** Peer id used for the lobby owner's own client, which talks to the host over a loopback. */
export const LOCAL_PEER = 'local';
