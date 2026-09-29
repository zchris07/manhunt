import type { PeerOptions } from 'peerjs';
import type { WebRtcConfig } from '@manhunt/host/webrtc';

/** Room codes are namespaced on the shared signaling broker. */
export const PEER_PREFIX = 'manhunt-v1-';

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];

/**
 * Signaling and ICE configuration from build-time env (VITE_*). With nothing set, the free
 * public PeerJS broker and public STUN servers are used. A TURN relay can be added for
 * players behind strict NATs: VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL.
 */
export function webRtcConfig(): WebRtcConfig {
  const env = import.meta.env;
  let iceServers: RTCIceServer[] = DEFAULT_ICE;
  if (env.VITE_ICE_SERVERS) {
    try {
      iceServers = JSON.parse(env.VITE_ICE_SERVERS) as RTCIceServer[];
    } catch {
      console.warn('[net] VITE_ICE_SERVERS is not valid JSON');
    }
  }
  if (env.VITE_TURN_URL) {
    iceServers = [...iceServers, { urls: env.VITE_TURN_URL, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }];
  }
  const peer: PeerOptions = { debug: 1, config: { iceServers } };
  if (env.VITE_PEER_HOST) {
    peer.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) peer.port = Number(env.VITE_PEER_PORT);
    peer.path = env.VITE_PEER_PATH ?? '/';
    peer.secure = env.VITE_PEER_SECURE ? env.VITE_PEER_SECURE === 'true' : location.protocol === 'https:';
  }
  return { peer, prefix: PEER_PREFIX };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomRoomCode(): string {
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

/** Accepts "ABCD", "abcd" or a full invite link. */
export function parseRoomInput(input: string): string | null {
  const s = input.trim();
  let code = s;
  try {
    const url = new URL(s);
    code = url.searchParams.get('room') ?? '';
  } catch {
    // Not a URL.
  }
  code = code.toUpperCase().replace(/[^A-Z]/g, '');
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

export function inviteLink(room: string): string {
  const url = new URL(location.href);
  url.search = `?room=${room}`;
  url.hash = '';
  return url.toString();
}
