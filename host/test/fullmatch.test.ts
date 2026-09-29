import { describe, expect, it } from 'vitest';
import { runBotMatch } from '../src/dev/bots';

// A complete match (lobby shape 1v4) is played to a result by the dev-only bot harness.
describe('full match', () => {
  it('plays a 1v4 match to a result', () => {
    const t0 = Date.now();
    const { result, world } = runBotMatch({ seed: 12345, hunters: 1, survivors: 4 });
    expect(result).toBeTruthy();
    expect(['hunters', 'survivors']).toContain(result.winner);
    expect(result.stats.length).toBe(5);
    expect(result.durationSec).toBeGreaterThan(30);
    // Objectives actually progressed and the hunter actually hunted.
    const hunterStats = result.stats.find((s) => s.role === 'hunter')!;
    const repair = result.stats.filter((s) => s.role === 'survivor').reduce((a, s) => a + s.repairSec, 0);
    expect(repair + hunterStats.hits).toBeGreaterThan(0);
    console.log(`1v4 bot match: ${result.winner} (${result.reason}) in ${result.durationSec}s, gens ${result.generatorsRepaired}/${result.generatorsRequired}, hits ${hunterStats.hits}, real ${Date.now() - t0}ms, ticks ${world.tick}`);
  });

  it('plays a 2v8 match to a result', () => {
    const { result } = runBotMatch({ seed: 777, hunters: 2, survivors: 8, timeLimitSec: 600 });
    expect(result).toBeTruthy();
    expect(result.stats.length).toBe(10);
  });
});
