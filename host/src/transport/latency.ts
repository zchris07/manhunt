import type { GuestTransport } from './types';

/**
 * Wraps a guest transport with simulated one-way latency (applied both ways), jitter and
 * unreliable-channel loss. Used for the "simulated 100 ms latency" playtests (?lag=100).
 * Reliable messages keep their order.
 */
export function withLatency(
  inner: GuestTransport,
  opts: { latencyMs: number; jitterMs?: number; loss?: number },
  schedule: (fn: () => void, ms: number) => void,
): GuestTransport {
  const jitter = opts.jitterMs ?? 0;
  const loss = opts.loss ?? 0;
  let lastReliableOut = 0;
  let lastReliableIn = 0;
  const delayFor = (reliable: boolean, last: number): number => {
    const d = opts.latencyMs + (reliable ? 0 : Math.random() * jitter);
    const now = Date.now();
    return reliable ? Math.max(d, last - now) : d;
  };
  let msgCb: (data: Uint8Array) => void = () => {};
  inner.onMessage((data) => {
    const reliable = data[0] === 0x7b;
    if (!reliable && Math.random() < loss) return;
    const d = delayFor(reliable, lastReliableIn);
    if (reliable) lastReliableIn = Date.now() + d;
    schedule(() => msgCb(data), d);
  });
  return {
    connect: (room) => inner.connect(room),
    send(data, reliable) {
      if (!reliable && Math.random() < loss) return;
      const d = delayFor(reliable, lastReliableOut);
      if (reliable) lastReliableOut = Date.now() + d;
      const copy = data.slice();
      schedule(() => inner.send(copy, reliable), d);
    },
    onMessage(cb) {
      msgCb = cb;
    },
    onClose: (cb) => inner.onClose(cb),
    close: () => inner.close(),
  };
}
