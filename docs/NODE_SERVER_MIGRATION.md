# Migrating MANHUNT to a dedicated Node WebSocket server

MANHUNT v1 is **player-hosted**. The lobby owner's browser runs `GameHost` in a Web Worker and
guests connect to it over WebRTC. This document gives the exact steps for moving the host into a
small dedicated **Node + `ws`** server, with the files that change and the files that must not.

Nothing here is built yet. This is the plan.

## Why the migration is small

`GameHost`, the simulation and the protocol only ever talk to two interfaces in
`host/src/transport/types.ts`:

```ts
interface HostTransport {             // the server side
  send(peer: string, data: Uint8Array, reliable: boolean): void;
  onMessage(cb: (peer: string, data: Uint8Array) => void): void;
  onPeerJoin(cb: (peer: string) => void): void;
  onPeerLeave(cb: (peer: string) => void): void;
  disconnect(peer: string): void;
  close(): void;
}
interface GuestTransport {            // the client side
  connect(room: string): Promise<void>;
  send(data: Uint8Array, reliable: boolean): void;
  onMessage(cb: (data: Uint8Array) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}
```

`host/test/gamehost.test.ts` already runs `GameHost` under Node with an in-memory transport,
which proves it has no dependency on WebRTC, Web Workers or the DOM. ESLint enforces this: no
`window`, `document`, `process`, `peerjs` or `node:*` imports are allowed in `host/src` outside
the transport folder.

## Files that must NOT change

| Path | Why |
|---|---|
| `shared/**` | Simulation, protocol, balance and map generation are transport-agnostic. |
| `host/src/GameHost.ts`, `host/src/sim/**`, `host/src/lobby.ts`, `host/src/telemetry.ts` | Same host, different transport. |
| `client/src/net/GameClient.ts`, `client/src/game/**`, `client/src/ui/**` | The client only sees a `GuestTransport`. |

If you find yourself editing any of these for the migration, something is wrong.

## Files that change or are added

| Path | Change |
|---|---|
| `server/package.json` | **New.** `@manhunt/server` workspace: `ws`, `@manhunt/host`, `@manhunt/shared`, `tsx`. |
| `server/src/WsServerTransport.ts` | **New.** `HostTransport` over one `ws.WebSocketServer`, one instance per room. |
| `server/src/rooms.ts` | **New.** Room registry: room code → `{ host: GameHost, transport }`, tick loop, idle cleanup. |
| `server/src/main.ts` | **New.** HTTP server: static client files + WebSocket upgrade on `/ws/:room`. |
| `host/src/transport/ws.ts` | **New.** `WsClientTransport implements GuestTransport` (browser `WebSocket`). |
| `host/package.json` | Add the export `"./ws": "./src/transport/ws.ts"`. |
| `client/src/net/session.ts` | Add `hostGameOnServer()` and `joinGameOnServer()` (or switch by `VITE_SERVER_URL`). |
| `client/src/net/config.ts` | Add `serverUrl()` from `VITE_SERVER_URL`. |
| `package.json` (root) | Add `"server"` to `workspaces`, plus scripts `server:dev` and `server:start`. |
| `Dockerfile`, `fly.toml`, `.dockerignore` | **New.** Container build and Fly.io config. |
| `.github/workflows/deploy-server.yml` | **New** (optional). `flyctl deploy` on push to `main`. |
| `README.md` | Document server hosting. |

## Step by step

### 1. Add the workspace

```jsonc
// package.json
"workspaces": ["shared", "host", "client", "server"],
"scripts": {
  "server:dev": "npm run dev -w @manhunt/server",
  "server:start": "npm run start -w @manhunt/server"
}
```

```jsonc
// server/package.json
{
  "name": "@manhunt/server",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": { "@manhunt/host": "*", "@manhunt/shared": "*", "ws": "^8", "tsx": "^4" },
  "devDependencies": { "@types/ws": "^8" }
}
```

Add `server/tsconfig.json` extending `../tsconfig.base.json` with `"types": ["node"]`, and add
`tsc -p server --noEmit` to the root `typecheck` script.

### 2. `WsServerTransport` (server side)

WebSockets are a single ordered, reliable stream, so `reliable` is ignored. That is correct but
loses the unreliable channel's advantage: on a lossy link a late snapshot delays the next one.
This is acceptable for a first version. A later upgrade can use WebTransport datagrams or
`node-datachannel` for an unreliable path, with no protocol change.

```ts
// server/src/WsServerTransport.ts
import type { WebSocket } from 'ws';
import type { HostTransport } from '@manhunt/host';

export class WsServerTransport implements HostTransport {
  private sockets = new Map<string, WebSocket>();
  private msg = (_p: string, _d: Uint8Array) => {};
  private join = (_p: string) => {};
  private leave = (_p: string) => {};
  private next = 1;

  /** Called by main.ts for each upgraded connection to this room. */
  accept(ws: WebSocket): void {
    const peer = `ws-${this.next++}`;
    ws.binaryType = 'nodebuffer';
    this.sockets.set(peer, ws);
    ws.on('message', (data: Buffer) => this.msg(peer, new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
    ws.on('close', () => { if (this.sockets.delete(peer)) this.leave(peer); });
    this.join(peer);
  }
  send(peer: string, data: Uint8Array): void {
    const ws = this.sockets.get(peer);
    // Drop instead of queueing when a client can't keep up (snapshots are superseded anyway).
    if (ws && ws.readyState === ws.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(data);
  }
  onMessage(cb: typeof this.msg) { this.msg = cb; }
  onPeerJoin(cb: typeof this.join) { this.join = cb; }
  onPeerLeave(cb: typeof this.leave) { this.leave = cb; }
  disconnect(peer: string) { this.sockets.get(peer)?.close(4000, 'kicked'); }
  get size() { return this.sockets.size; }
  close() { for (const ws of this.sockets.values()) ws.close(1001, 'room closed'); }
}
```

### 3. Rooms and lobby codes

In v1 the 4-letter room code is the host's PeerJS peer id. On the server it is a key in a map.

```ts
// server/src/rooms.ts
import { GameHost } from '@manhunt/host';
import { BALANCE } from '@manhunt/shared';
import { WsServerTransport } from './WsServerTransport';

const rooms = new Map<string, { host: GameHost; transport: WsServerTransport; emptySince: number }>();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function createRoom(): string {
  let code: string;
  do code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  while (rooms.has(code));
  const transport = new WsServerTransport();
  const host = new GameHost({ transport, room: code, now: () => performance.now(), telemetry: (e) => console.log(JSON.stringify(e)) });
  rooms.set(code, { host, transport, emptySince: Date.now() });
  return code;
}
export const getRoom = (code: string) => rooms.get(code);

// One timer drives every room at 30 Hz.
setInterval(() => {
  for (const [code, r] of rooms) {
    r.host.tick();
    if (r.transport.size > 0) r.emptySince = Date.now();
    else if (Date.now() - r.emptySince > 5 * 60_000) { r.host.close(); rooms.delete(code); }
  }
}, 1000 / BALANCE.net.tickHz);
```

The ownership rule already exists in `GameHost.ownerId`. With no `local` peer, the longest-connected
player owns the lobby. If they leave, ownership passes to the next player automatically, so no
change is needed. The v1 "host left, match over" screen stops appearing; the match continues.

For a quicker win, replace `setInterval` with the drift-corrected loop from
`client/src/worker/hostWorker.ts`.

### 4. HTTP + upgrade (`server/src/main.ts`)

- `POST /api/rooms` → `{ room: createRoom() }`. Rate-limit per IP (for example 10 per minute).
- `GET /ws/:room` upgrade → `getRoom(code)?.transport.accept(ws)`, or close with 4404 if the room
  is unknown.
- Serve `client/dist` as static files for everything else (or keep the client on Pages/Netlify
  and set CORS for `POST /api/rooms`).
- Set `maxPayload: BALANCE.net.maxReliableBytes * 4` on the `WebSocketServer`. `GameHost` already
  validates, size-checks and rate-limits every message.

### 5. `WsClientTransport` (browser side)

```ts
// host/src/transport/ws.ts
import type { GuestTransport } from './types';

export class WsClientTransport implements GuestTransport {
  private ws: WebSocket | null = null;
  private msg = (_d: Uint8Array) => {};
  private closed = (_r: string) => {};
  constructor(private baseUrl: string) {}
  connect(room: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.baseUrl.replace(/^http/, 'ws')}/ws/${room}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`Room ${room} not found`));
      ws.onmessage = (e) => this.msg(new Uint8Array(e.data as ArrayBuffer));
      ws.onclose = (e) => this.closed(e.code === 4404 ? 'Room not found' : 'Lost connection to the server');
      this.ws = ws;
    });
  }
  send(data: Uint8Array) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data); }
  onMessage(cb: typeof this.msg) { this.msg = cb; }
  onClose(cb: typeof this.closed) { this.closed = cb; }
  close() { this.ws?.close(); }
}
```

Export it from `host/package.json` as `"./ws"`, next to `"./webrtc"`.

### 6. Client session switch

In `client/src/net/session.ts`, when `serverUrl()` is set:

- **Create lobby:** `POST {server}/api/rooms` → `{ room }`, then `joinGame(room, name)` with
  `new WsClientTransport(server)`. No worker and no `HostBridge`: every player, including the
  lobby creator, is an ordinary guest.
- **Join:** `new WsClientTransport(server)` instead of `WebRtcGuestTransport`.
- `Session.isHost` becomes `false` for everyone. Hide the "keep this tab in the foreground"
  warning, and move the "Download match log" button to a server endpoint (for example
  `GET /api/rooms/:code/log`), or read the JSON lines from the server's stdout.
- Set `handicapMs` to `0`: nobody is local any more, so the host-handicap code path is idle.

### 7. Docker and Fly.io

```Dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY host/package.json host/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npm", "run", "server:start"]
```

```toml
# fly.toml
app = "manhunt"
primary_region = "iad"          # pick the region closest to your group

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"   # scale to zero between game nights
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

Deploy with `fly launch --no-deploy`, then `fly deploy`. One small machine runs many 10-player
rooms. The simulation costs well under a millisecond per tick per room.

### 8. Tests to add

1. `server/test/ws.test.ts`: start the server on a random port, connect three `WsClientTransport`
   clients (with `globalThis.WebSocket` from `ws` in Node), and run the lobby-to-match flow from
   `host/test/gamehost.test.ts`.
2. A Playwright project with `VITE_SERVER_URL` set, running the existing
   `e2e/multiplayer.spec.ts`. The specs don't care which transport is used.

## Behaviour differences to expect

| v1 player-hosted | Node server |
|---|---|
| Host has 0 ms input latency (partly offset by the handicap). | Everyone has equal latency to the server. |
| The host can see all state (trusted). | Nobody can: interest management applies to everyone. |
| Host leaves → match over. | Ownership passes to the next player; the match continues. |
| About 10–20% of NATs need TURN. | Plain HTTPS/WSS: works everywhere. |
| Free. | About $0–5/month on Fly.io with scale-to-zero. |
| Unreliable data channel for snapshots. | Ordered TCP stream (head-of-line blocking on loss). |
