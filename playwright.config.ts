import { defineConfig } from '@playwright/test';

const PORT = 4173;
const SIGNAL_PORT = 9123;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--allow-loopback-in-peer-connection',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: [
    {
      command: `node scripts/signal-server.mjs --port ${SIGNAL_PORT}`,
      port: SIGNAL_PORT,
      reuseExistingServer: true,
    },
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
      cwd: 'client',
      port: PORT,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        VITE_PEER_HOST: '127.0.0.1',
        VITE_PEER_PORT: String(SIGNAL_PORT),
        VITE_PEER_SECURE: 'false',
        VITE_ICE_SERVERS: '[]',
      },
    },
  ],
});
