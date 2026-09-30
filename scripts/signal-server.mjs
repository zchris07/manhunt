// Local PeerJS signaling server for offline/LAN play and end-to-end tests.
// Usage: node scripts/signal-server.mjs [--port 9000] [--host 0.0.0.0]
import { PeerServer } from 'peer';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', process.env.PORT ?? 9000));
const host = arg('host', process.env.HOST ?? '0.0.0.0');

PeerServer({ port, host, path: '/', allow_discovery: false, proxied: false }, () => {
  console.log(`[signal] PeerJS signaling server listening on ${host}:${port}`);
});
