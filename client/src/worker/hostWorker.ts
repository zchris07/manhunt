/// <reference lib="webworker" />
import { GameHost, WorkerHostTransport, type BridgeToWorker } from '@manhunt/host';
import { BALANCE } from '@manhunt/shared';

/**
 * Runs the authoritative GameHost off the main thread so rendering can't stall the
 * simulation, and so a backgrounded host tab keeps ticking (workers are throttled less).
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const transport = new WorkerHostTransport(scope);
let host: GameHost | null = null;

scope.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as BridgeToWorker;
  if (m.type !== 'init' || host) return;
  try {
    host = new GameHost({
      transport,
      room: m.room,
      now: () => performance.now(),
      handicapMs: m.handicapMs,
      dev: m.dev === true,
      telemetry: (entry) => scope.postMessage({ type: 'telemetry', entry }),
    });
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
    return;
  }
  const stepMs = 1000 / BALANCE.net.tickHz;
  let next = performance.now();
  setInterval(() => {
    const now = performance.now();
    let steps = 0;
    while (now >= next && steps < 5) {
      try {
        host!.tick();
      } catch (err) {
        console.error('[host] tick failed', err);
      }
      next += stepMs;
      steps++;
    }
    // After a long stall, resync instead of fast-forwarding.
    if (now - next > 250) next = now;
  }, 4);
});
