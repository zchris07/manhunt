/**
 * Procedural sound generators. Each writes samples into a Float32Array at the context's
 * sample rate; the audio engine wraps them in AudioBuffers. All mono.
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

const footstep = (lo: number, hi: number, len: number, click = 0): SoundGen => (sr, rnd) => {
  const x = env(bandpass(noise(buf(sr, len), rnd), sr, lo, hi), sr, 0.004, len / 4);
  if (click) mixInto(x, env(tone(sr, 0.05, () => click), sr, 0.001, 0.012), 0, 0.3);
  return normalize(x, 0.8);
};

export const SOUND_GENERATORS: Record<string, SoundGen> = {
  footstepForest: footstep(180, 1600, 0.16),
  footstepDirt: footstep(120, 700, 0.14),
  footstepGrass: footstep(1500, 5000, 0.18),
  footstepConcrete: footstep(900, 4000, 0.08, 1800),
  footstepWood: (sr, rnd) => {
    const x = footstep(150, 900, 0.12)(sr, rnd);
    mixInto(x, env(tone(sr, 0.12, () => 140), sr, 0.002, 0.04), 0, 0.5);
    return normalize(x, 0.8);
  },
  footstepWater: (sr, rnd) => normalize(env(bandpass(noise(buf(sr, 0.25), rnd), sr, 400, 3000), sr, 0.02, 0.07), 0.7),
  footstepHeavy: (sr, rnd) => {
    const x = footstep(80, 600, 0.22)(sr, rnd);
    mixInto(x, env(tone(sr, 0.2, (t) => 70 - t * 80), sr, 0.002, 0.06), 0, 0.8);
    return normalize(x, 0.9);
  },

  heartbeat: (sr) => {
    const beat = (): Float32Array => env(tone(sr, 0.16, (t) => 58 - t * 90), sr, 0.005, 0.045);
    const x = buf(sr, 0.5);
    mixInto(x, beat(), 0, 1);
    mixInto(x, beat(), Math.floor(0.19 * sr), 0.7);
    return normalize(lowpass(x, sr, 180), 1);
  },

  stinger: (sr, rnd) => {
    const len = 2.8;
    const x = buf(sr, len);
    for (const f of [311, 329.6, 466, 493.9, 622]) {
      const v = tone(sr, len, (t) => f * (1 + 0.004 * Math.sin(t * 37)), 'saw');
      mixInto(x, v, 0, 0.18);
    }
    mixInto(x, bandpass(noise(buf(sr, len), rnd), sr, 2000, 7000), 0, 0.25);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.03) * Math.exp(-t / 0.9) * (0.75 + 0.25 * Math.sin(t * 60));
    }
    return normalize(lowpass(x, sr, 5000), 0.9);
  },

  chase: (sr, rnd) => {
    const len = 4;
    const x = buf(sr, len);
    mixInto(x, tone(sr, len, () => 55, 'saw'), 0, 0.3);
    mixInto(x, tone(sr, len, () => 58.3, 'saw'), 0, 0.3);
    mixInto(x, lowpass(noise(buf(sr, len), rnd), sr, 300), 0, 0.4);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2), 3);
      x[i] *= 0.35 + 0.65 * pulse;
    }
    return normalize(loopable(lowpass(x, sr, 900), sr, 0.25), 0.7);
  },

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

  genRepair: (sr, rnd) => {
    const len = 2;
    const x = lowpass(noise(buf(sr, len), rnd), sr, 1500);
    for (let k = 0; k < 14; k++) mixInto(x, env(highpass(noise(buf(sr, 0.03), rnd), sr, 1500), sr, 0.001, 0.008), Math.floor(rnd() * (len - 0.05) * sr), 2);
    for (let i = 0; i < x.length; i++) x[i] *= 0.5 + 0.5 * Math.abs(Math.sin((i / sr) * Math.PI * 3));
    return normalize(loopable(x, sr, 0.2), 0.45);
  },

  genDone: (sr, rnd) => {
    const x = tone(sr, 2.2, (t) => 30 + Math.min(1, t / 1.2) * 30, 'saw');
    mixInto(x, lowpass(noise(buf(sr, 2.2), rnd), sr, 400), 0, 0.5);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.2) * (t > 1.7 ? Math.max(0, 1 - (t - 1.7) / 0.5) : 1);
    }
    mixInto(x, env(tone(sr, 0.3, () => 90), sr, 0.001, 0.08), 0, 0.8);
    return normalize(lowpass(x, sr, 1200), 0.8);
  },

  genExplode: (sr, rnd) => {
    const x = env(lowpass(noise(buf(sr, 1.2), rnd), sr, 900), sr, 0.002, 0.18);
    for (let k = 0; k < 20; k++) mixInto(x, env(highpass(noise(buf(sr, 0.02), rnd), sr, 3000), sr, 0.001, 0.005), Math.floor(rnd() * 0.8 * sr), 0.6);
    return normalize(x, 1);
  },

  hit: (sr, rnd) => {
    const x = env(bandpass(noise(buf(sr, 0.35), rnd), sr, 300, 3000), sr, 0.002, 0.06);
    mixInto(x, env(tone(sr, 0.3, (t) => 110 - t * 150), sr, 0.002, 0.07), 0, 0.9);
    return normalize(x, 1);
  },

  hitSelf: (sr, rnd) => {
    const x = SOUND_GENERATORS.hit(sr, rnd);
    const out = buf(sr, 1.2);
    mixInto(out, x, 0, 1);
    mixInto(out, env(tone(sr, 1.2, () => 3100), sr, 0.001, 0.4), 0, 0.12);
    return normalize(out, 1);
  },

  scream: (sr, rnd) => {
    const len = 0.9;
    const x = tone(sr, len, (t) => 520 + 180 * Math.sin(t * 5) + 25 * Math.sin(t * 45), 'saw');
    mixInto(x, noise(buf(sr, len), rnd), 0, 0.3);
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin((Math.PI * i) / x.length);
    return normalize(bandpass(x, sr, 500, 2600), 0.7);
  },

  stunHit: (sr) => normalize(env(tone(sr, 1.0, (t) => 1900 - t * 300), sr, 0.001, 0.25), 0.5),

  stunBlind: (sr, rnd) => {
    const x = env(highpass(noise(buf(sr, 0.9), rnd), sr, 2500), sr, 0.02, 0.25);
    mixInto(x, env(tone(sr, 0.9, () => 2600), sr, 0.001, 0.3), 0, 0.3);
    return normalize(x, 0.7);
  },

  barricade: (sr, rnd) => {
    const x = env(lowpass(noise(buf(sr, 0.6), rnd), sr, 1200), sr, 0.001, 0.09);
    for (const f of [180, 263, 410]) mixInto(x, env(tone(sr, 0.5, () => f), sr, 0.001, 0.08), 0, 0.3);
    return normalize(x, 1);
  },

  vault: (sr, rnd) => {
    const x = env(bandpass(noise(buf(sr, 0.35), rnd), sr, 600, 3000), sr, 0.08, 0.08);
    mixInto(x, env(lowpass(noise(buf(sr, 0.12), rnd), sr, 300), sr, 0.002, 0.03), Math.floor(0.25 * sr), 1);
    return normalize(x, 0.7);
  },

  locker: (sr, rnd) => {
    const x = buf(sr, 1.0);
    for (const [f, a] of [
      [410, 1],
      [1063, 0.6],
      [1712, 0.4],
      [2521, 0.25],
    ] as const)
      mixInto(x, env(tone(sr, 1.0, () => f), sr, 0.001, 0.22), 0, a);
    mixInto(x, env(noise(buf(sr, 0.05), rnd), sr, 0.001, 0.01), 0, 0.6);
    return normalize(x, 0.8);
  },

  rustle: (sr, rnd) => {
    const x = bandpass(noise(buf(sr, 0.6), rnd), sr, 1800, 6000);
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin((Math.PI * i) / x.length) * (0.5 + 0.5 * Math.abs(Math.sin((i / sr) * 40)));
    return normalize(x, 0.6);
  },

  glass: (sr, rnd) => {
    const x = env(highpass(noise(buf(sr, 0.5), rnd), sr, 2500), sr, 0.001, 0.05);
    for (let k = 0; k < 12; k++) {
      const f = 3000 + rnd() * 5000;
      mixInto(x, env(tone(sr, 0.2, () => f), sr, 0.001, 0.04), Math.floor(rnd() * 0.3 * sr), 0.25);
    }
    return normalize(x, 0.9);
  },

  flare: (sr, rnd) => {
    const x = highpass(noise(buf(sr, 2.0), rnd), sr, 1500);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.05) * (t > 1.5 ? Math.max(0, 1 - (t - 1.5) / 0.5) : 1) * (0.7 + 0.3 * rnd());
    }
    return normalize(x, 0.6);
  },

  swing: (sr, rnd) => {
    const x = noise(buf(sr, 0.3), rnd);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / x.length;
      const a = 1 - Math.exp((-2 * Math.PI * (500 + 3500 * t)) / sr);
      y += a * (x[i] - y);
      x[i] = y * Math.sin(Math.PI * t);
    }
    return normalize(x, 0.6);
  },

  stake: (sr, rnd) => {
    const x = env(lowpass(noise(buf(sr, 0.5), rnd), sr, 500), sr, 0.001, 0.07);
    mixInto(x, SOUND_GENERATORS.creak(sr, rnd), Math.floor(0.1 * sr), 0.6);
    return normalize(x, 0.9);
  },

  gasp: (sr, rnd) => {
    const x = bandpass(noise(buf(sr, 0.5), rnd), sr, 400, 3000);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.03) * Math.exp(-t / 0.15);
    }
    return normalize(x, 0.7);
  },

  breath: (sr, rnd) => {
    const x = bandpass(noise(buf(sr, 1.5), rnd), sr, 300, 1800);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= t < 0.6 ? Math.sin((Math.PI * t) / 0.6) : t < 0.8 ? 0 : Math.sin((Math.PI * (t - 0.8)) / 0.7) * 0.8;
    }
    return normalize(x, 0.5);
  },

  pulse: (sr, rnd) => {
    const x = env(tone(sr, 1.6, (t) => 45 + 10 * Math.exp(-t * 3)), sr, 0.002, 0.5);
    const swell = bandpass(noise(buf(sr, 1.0), rnd), sr, 200, 2000);
    for (let i = 0; i < swell.length; i++) swell[i] *= Math.pow(i / swell.length, 2);
    const out = buf(sr, 2.0);
    mixInto(out, swell, 0, 0.5);
    mixInto(out, x, Math.floor(0.95 * sr), 1);
    return normalize(out, 0.9);
  },

  sniff: (sr, rnd) => {
    const out = buf(sr, 0.7);
    for (let k = 0; k < 3; k++) mixInto(out, env(bandpass(noise(buf(sr, 0.1), rnd), sr, 800, 4000), sr, 0.01, 0.03), Math.floor(k * 0.18 * sr), 1);
    return normalize(out, 0.6);
  },

  smash: (sr, rnd) => {
    const x = SOUND_GENERATORS.barricade(sr, rnd);
    mixInto(x, SOUND_GENERATORS.glass(sr, rnd).slice(0, x.length), 0, 0.5);
    return normalize(x, 1);
  },

  gateAlarm: (sr) => {
    const x = tone(sr, 1.0, (t) => 700 + 250 * Math.sin(t * Math.PI * 2), 'square');
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin((Math.PI * i) / x.length);
    return normalize(lowpass(x, sr, 2500), 0.5);
  },

  gatePowered: (sr, rnd) => {
    const x = buf(sr, 2.5);
    mixInto(x, SOUND_GENERATORS.genDone(sr, rnd), 0, 1);
    mixInto(x, SOUND_GENERATORS.gateAlarm(sr, rnd), Math.floor(1.0 * sr), 0.7);
    return normalize(x, 0.9);
  },

  gateOpen: (sr, rnd) => {
    const x = buf(sr, 3);
    for (let k = 0; k < 3; k++) mixInto(x, SOUND_GENERATORS.gateAlarm(sr, rnd), Math.floor(k * 0.9 * sr), 0.8);
    mixInto(x, env(lowpass(noise(buf(sr, 2), rnd), sr, 300), sr, 0.3, 0.8), 0, 0.6);
    return normalize(x, 0.9);
  },

  skillWarn: (sr) => normalize(env(tone(sr, 0.15, () => 1320), sr, 0.001, 0.04), 0.5),
  skillGood: (sr) => {
    const x = env(tone(sr, 0.3, () => 1760), sr, 0.001, 0.08);
    mixInto(x, env(tone(sr, 0.3, () => 2640), sr, 0.001, 0.06), 0, 0.4);
    return normalize(x, 0.5);
  },
  skillFail: (sr) => normalize(env(tone(sr, 0.4, () => 110, 'square'), sr, 0.001, 0.15), 0.6),

  grunt: (sr, rnd) => {
    const x = tone(sr, 0.4, (t) => 110 - t * 60, 'saw');
    mixInto(x, noise(buf(sr, 0.4), rnd), 0, 0.2);
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin((Math.PI * i) / x.length);
    return normalize(bandpass(x, sr, 150, 1200), 0.6);
  },

  install: (sr, rnd) => {
    const x = env(highpass(noise(buf(sr, 0.2), rnd), sr, 1500), sr, 0.001, 0.03);
    mixInto(x, env(tone(sr, 0.2, () => 620), sr, 0.001, 0.05), 0, 0.5);
    return normalize(x, 0.6);
  },

  eliminated: (sr, rnd) => {
    const x = buf(sr, 3.5);
    for (const f of [41.2, 43.6, 61.7]) mixInto(x, tone(sr, 3.5, () => f, 'saw'), 0, 0.3);
    mixInto(x, lowpass(noise(buf(sr, 3.5), rnd), sr, 250), 0, 0.4);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.05) * Math.exp(-t / 1.4);
    }
    return normalize(lowpass(x, sr, 600), 0.9);
  },

  search: (sr, rnd) => {
    const out = buf(sr, 1.2);
    for (let k = 0; k < 6; k++) mixInto(out, env(bandpass(noise(buf(sr, 0.12), rnd), sr, 500, 3000), sr, 0.01, 0.04), Math.floor(rnd() * 1.0 * sr), 0.8);
    return normalize(out, 0.6);
  },

  genKick: (sr, rnd) => {
    const x = SOUND_GENERATORS.locker(sr, rnd);
    mixInto(x, SOUND_GENERATORS.genExplode(sr, rnd).slice(0, x.length), 0, 0.3);
    return normalize(x, 0.9);
  },
};
