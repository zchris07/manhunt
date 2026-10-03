import type { LobbySettings, MatchResult, ResolvedBalance } from '@manhunt/shared';

/** One match outcome, stored by the host (localStorage) and downloadable for tuning. */
export interface MatchLogEntry {
  v: 2;
  at: string;
  seed: number;
  mapHash: number;
  hunters: number;
  survivors: number;
  requiredGenerators: number;
  totalGenerators: number;
  repairTime: number;
  hunterSpeed: number;
  stunMul: number;
  winner: MatchResult['winner'];
  reason: string;
  durationSec: number;
  realDurationSec: number;
  generatorsRepaired: number;
  escaped: number;
  eliminated: number;
  players: { name: string; role: string; outcome: string; hits: number; downs: number; stuns: number; repairSec: number }[];
}

export function matchLogEntry(input: {
  seed: number;
  mapHash: number;
  balance: ResolvedBalance;
  settings: LobbySettings;
  result: MatchResult;
  realDurationSec: number;
}): MatchLogEntry {
  const { balance: b, result: r } = input;
  return {
    v: 2,
    at: new Date().toISOString(),
    seed: input.seed,
    mapHash: input.mapHash,
    hunters: b.hunters,
    survivors: b.survivors,
    requiredGenerators: b.requiredGenerators,
    totalGenerators: b.totalGenerators,
    repairTime: Math.round(b.repairTime * 10) / 10,
    hunterSpeed: Math.round(b.hunterSpeed),
    stunMul: Math.round(b.stunMul * 100) / 100,
    winner: r.winner,
    reason: r.reason,
    durationSec: r.durationSec,
    realDurationSec: Math.round(input.realDurationSec),
    generatorsRepaired: r.generatorsRepaired,
    escaped: r.escaped,
    eliminated: r.eliminated,
    players: r.stats.map((s) => ({ name: s.name, role: s.role, outcome: s.outcome, hits: s.hits, downs: s.downs, stuns: s.stuns, repairSec: s.repairSec })),
  };
}

export interface TelemetrySummary {
  matches: number;
  hunterWinRate: number;
  byShape: Record<string, { matches: number; hunterWins: number }>;
  avgDurationSec: number;
}

/** Aggregates stored logs, e.g. to check the ~60% hunter win-rate target per lobby shape. */
export function summarize(entries: readonly MatchLogEntry[]): TelemetrySummary {
  const byShape: TelemetrySummary['byShape'] = {};
  let hunterWins = 0;
  let dur = 0;
  for (const e of entries) {
    const key = `${e.hunters}v${e.survivors}`;
    byShape[key] ??= { matches: 0, hunterWins: 0 };
    byShape[key].matches++;
    if (e.winner === 'hunters') {
      byShape[key].hunterWins++;
      hunterWins++;
    }
    dur += e.durationSec;
  }
  return {
    matches: entries.length,
    hunterWinRate: entries.length ? hunterWins / entries.length : 0,
    byShape,
    avgDurationSec: entries.length ? dur / entries.length : 0,
  };
}
