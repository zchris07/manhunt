import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base so the static build works on GitHub Pages sub-paths, Netlify and Cloudflare Pages.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sandbox: resolve(__dirname, 'sandbox/index.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
