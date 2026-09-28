import { Application } from 'pixi.js';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ background: '#050605', resizeTo: window, preference: 'webgl' });
  document.getElementById('game')!.appendChild(app.canvas);
}

void boot();
