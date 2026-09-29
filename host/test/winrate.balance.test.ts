import { describe, expect, it } from 'vitest';
import { runBotMatch } from '../src/dev/bots';

/**
 * DEV-ONLY regression balance run: `npm run balance` (MATCHES=n to change the sample size).
 * Bots are not humans, so this does not measure the 60% target directly; it catches changes
 * that swing outcomes wildly and compares lobby shapes against each other.
 */
const MATCHES = Number(process.env.MATCHES ?? 12);
const SHAPES: [number, number][] = [
  [1, 1],
  [1, 2],
  [1, 4],
  [2, 4],
  [2, 8],
  [1, 9],
];

describe('bot balance harness', () => {
  for (const [h, s] of SHAPES) {
    it(`${h} hunter(s) vs ${s} survivor(s)`, async () => {
      let hunterWins = 0;
      let dur = 0;
      let gens = 0;
      for (let i = 0; i < MATCHES; i++) {
        await new Promise((r) => setTimeout(r, 0));
        const { result } = runBotMatch({ seed: 9000 + i * 131 + h * 7 + s, hunters: h, survivors: s });
        if (result.winner === 'hunters') hunterWins++;
        dur += result.durationSec;
        gens += result.generatorsRepaired / result.generatorsRequired;
      }
      const rate = hunterWins / MATCHES;
      console.log(`[balance] ${h}v${s}: hunter win ${(rate * 100).toFixed(0)}% over ${MATCHES} · avg ${Math.round(dur / MATCHES)}s · objective progress ${Math.round((gens / MATCHES) * 100)}%`);
      // Regression guards only: Zach must win sometimes, and survivors must still make real
      // objective progress (bots are weaker than people, so they are not expected to win).
      expect(rate).toBeGreaterThan(0.2);
      if (s >= 2) expect(gens / MATCHES).toBeGreaterThan(0.1);
    });
  }
});
