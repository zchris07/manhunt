// Starts a local signaling server and the Vite dev server pointed at it.
// Use this for LAN play or when the public PeerJS broker is unreachable.
import { spawn } from 'node:child_process';

const signalPort = process.env.SIGNAL_PORT ?? '9000';
const children = [];
function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code) => {
    for (const c of children) if (c !== child) c.kill();
    process.exit(code ?? 0);
  });
}

run('node', ['scripts/signal-server.mjs', '--port', signalPort]);
run('npm', ['run', 'dev', '-w', '@manhunt/client', '--', '--host'], {
  VITE_PEER_HOST: '/',
  VITE_PEER_PORT: signalPort,
  VITE_PEER_SECURE: 'false',
});
