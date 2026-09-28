// Local PeerJS signaling server for offline/LAN play and end-to-end tests.
// Usage: node scripts/signal-server.mjs [--port 9000]
import { PeerServer } from 'peer';

const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT ?? 9000);

PeerServer({ port, path: '/', allow_discovery: false, proxied: false });
console.log(`[signal] PeerJS signaling server listening on :${port}`);
