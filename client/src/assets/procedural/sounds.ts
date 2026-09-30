/**
 * Procedural atmosphere generators. Each writes samples into a Float32Array at the
 * context's sample rate; the audio engine wraps them in AudioBuffers. All mono.
 * Only ambience exists: no footsteps, hits or ability sounds, so nobody gets given away.
 */

export type SoundGen = (sr: number, rnd: () => number) => Float32Array;

function buf(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.floor(sr * seconds)));
}

/** One-pole filters applied in place. */
function lowpass(x: Float32Array, sr: number, hz: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] = y;
  }
  return x;
}

function highpass(x: Float32Array, sr: number, hz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * hz) / sr);
  let prevX = 0;
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = a * (y + x[i] - prevX);
    prevX = x[i];
    x[i] = y;
  }
  return x;
}

function bandpass(x: Float32Array, sr: number, lo: number, hi: number): Float32Array {
  return lowpass(highpass(x, sr, lo), sr, hi);
}

function noise(n: Float32Array, rnd: () => number, amp = 1): Float32Array {
  for (let i = 0; i < n.length; i++) n[i] = (rnd() * 2 - 1) * amp;
  return n;
}

/** Exponential decay envelope with a short attack. */
function env(x: Float32Array, sr: number, attack: number, decay: number): Float32Array {
  const a = Math.max(1, attack * sr);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] *= (i < a ? i / a : 1) * Math.exp(-(t - attack) / decay);
  }
  return x;
}

function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

function mixInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1): Float32Array {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain;
  return dst;
}

function tone(sr: number, seconds: number, f: (t: number) => number, shape: 'sine' | 'saw' | 'square' = 'sine'): Float32Array {
  const x = buf(sr, seconds);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    phase += f(i / sr) / sr;
    const p = phase % 1;
    x[i] = shape === 'sine' ? Math.sin(p * Math.PI * 2) : shape === 'saw' ? p * 2 - 1 : p < 0.5 ? 1 : -1;
  }
  return x;
}

/** Makes a buffer loop seamlessly by crossfading its tail into its head. */
function loopable(x: Float32Array, sr: number, fade = 0.3): Float32Array {
  const n = Math.floor(fade * sr);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + x[x.length - n + i] * (1 - k);
  }
  return out;
}

export const SOUND_GENERATORS: Record<string, SoundGen> = {
  wind: (sr, rnd) => {
    const len = 9;
    const x = noise(buf(sr, len), rnd);
    // Brown-ish noise.
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc = (acc + x[i] * 0.02) * 0.998;
      x[i] = acc;
    }
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= 0.55 + 0.45 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    }
    return normalize(loopable(bandpass(x, sr, 60, 900), sr, 1.2), 0.6);
  },

  crickets: (sr, rnd) => {
    const x = buf(sr, 0.5);
    const f = 4200 + rnd() * 900;
    for (let k = 0; k < 3; k++) mixInto(x, env(tone(sr, 0.03, () => f), sr, 0.003, 0.01), Math.floor(k * 0.06 * sr), 0.8);
    return normalize(x, 0.5);
  },

  owl: (sr) => {
    const x = buf(sr, 1.6);
    const hoot = (): Float32Array => {
      const h = tone(sr, 0.45, (t) => 380 - t * 60 + 6 * Math.sin(t * 40));
      for (let i = 0; i < h.length; i++) h[i] *= Math.sin((Math.PI * i) / h.length);
      return h;
    };
    mixInto(x, hoot(), 0, 1);
    mixInto(x, hoot(), Math.floor(0.7 * sr), 0.8);
    return normalize(lowpass(x, sr, 1200), 0.5);
  },

  branchSnap: (sr, rnd) => normalize(env(highpass(noise(buf(sr, 0.12), rnd), sr, 1200), sr, 0.001, 0.02), 0.7),

  indoorHum: (sr, rnd) => {
    const len = 6;
    const x = buf(sr, len);
    mixInto(x, tone(sr, len, () => 60), 0, 0.4);
    mixInto(x, tone(sr, len, () => 120), 0, 0.15);
    mixInto(x, lowpass(noise(buf(sr, len), rnd), sr, 200), 0, 0.3);
    return normalize(loopable(x, sr, 0.5), 0.35);
  },

  drip: (sr) => normalize(env(tone(sr, 0.15, (t) => 1400 + t * 3000), sr, 0.001, 0.03), 0.4),

  creak: (sr) => {
    const x = tone(sr, 0.9, (t) => 90 + 40 * Math.sin(t * 7) + t * 30, 'saw');
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin((Math.PI * i) / x.length) * (0.6 + 0.4 * Math.sin((i / sr) * 180));
    return normalize(bandpass(x, sr, 200, 1500), 0.5);
  },

  genHum: (sr, rnd) => {
    const len = 2;
    const x = buf(sr, len);
    mixInto(x, tone(sr, len, () => 55, 'saw'), 0, 0.5);
    mixInto(x, tone(sr, len, () => 110, 'square'), 0, 0.15);
    mixInto(x, noise(buf(sr, len), rnd), 0, 0.08);
    for (let i = 0; i < x.length; i++) x[i] *= 0.8 + 0.2 * Math.sin((i / sr) * Math.PI * 2 * 12);
    return normalize(loopable(lowpass(x, sr, 700), sr, 0.2), 0.6);
  },
};
