import { HostBridge, withLatency, type GuestTransport } from '@manhunt/host';
import { WebRtcGuestTransport, WebRtcHostTransport } from '@manhunt/host/webrtc';
import { GameClient } from './GameClient';
import { randomRoomCode, webRtcConfig } from './config';
import { appendMatchLog } from './matchLog';

export interface Session {
  client: GameClient;
  room: string;
  isHost: boolean;
  close(): void;
}

function lagFromUrl(): number {
  const lag = Number(new URLSearchParams(location.search).get('lag') ?? 0);
  return Number.isFinite(lag) && lag > 0 ? Math.min(lag, 500) : 0;
}

function maybeLag(t: GuestTransport): GuestTransport {
  const lag = lagFromUrl();
  return lag ? withLatency(t, { latencyMs: lag / 2, jitterMs: lag / 10 }, (fn, ms) => setTimeout(fn, ms)) : t;
}

/**
 * Creates a lobby: opens a room on the signaling broker, starts GameHost in a worker, and
 * connects this player's own client to it through a loopback.
 */
export async function hostGame(name: string, token?: string): Promise<Session> {
  const { transport, room } = await WebRtcHostTransport.open(webRtcConfig(), randomRoomCode);
  const worker = new Worker(new URL('../worker/hostWorker.ts', import.meta.url), { type: 'module', name: 'manhunt-host' });
  const bridge = new HostBridge(worker, transport);
  bridge.onTelemetry((entry) => appendMatchLog(entry));
  bridge.onError((m) => console.error('[host]', m));
  const handicap = new URLSearchParams(location.search).get('handicap');
  bridge.init(room, handicap === null ? null : Number(handicap));
  const client = new GameClient({ transport: maybeLag(bridge.localGuest()), now: () => performance.now(), name, token });
  await client.connect(room);
  return {
    client,
    room,
    isHost: true,
    close: () => {
      client.close();
      bridge.terminate();
    },
  };
}

/** Joins a lobby by room code. */
export async function joinGame(room: string, name: string, token?: string): Promise<Session> {
  const transport = maybeLag(new WebRtcGuestTransport(webRtcConfig()));
  const client = new GameClient({ transport, now: () => performance.now(), name, token });
  await client.connect(room);
  return { client, room, isHost: false, close: () => client.close() };
}
