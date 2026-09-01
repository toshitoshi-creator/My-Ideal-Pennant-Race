import type { BattingStats, PitchingStats, PlayerSeasonStats } from './types';

export function emptyBatting(): BattingStats {
  return {
    games: 0,
    plateAppearances: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    rbi: 0,
    runs: 0,
    steals: 0,
    strikeouts: 0,
    walks: 0,
  };
}

export function emptyPitching(): PitchingStats {
  return {
    games: 0,
    starts: 0,
    outs: 0,
    wins: 0,
    losses: 0,
    holds: 0,
    saves: 0,
    strikeouts: 0,
    walks: 0,
    hitsAllowed: 0,
    homeRunsAllowed: 0,
    runsAllowed: 0,
    earnedRuns: 0,
  };
}

export function emptySeasonStats(playerId: string): PlayerSeasonStats {
  return { playerId, batting: emptyBatting(), pitching: emptyPitching() };
}

export function addBatting(target: BattingStats, add: BattingStats): void {
  (Object.keys(add) as Array<keyof BattingStats>).forEach((key) => {
    target[key] += add[key];
  });
}

export function addPitching(target: PitchingStats, add: PitchingStats): void {
  (Object.keys(add) as Array<keyof PitchingStats>).forEach((key) => {
    target[key] += add[key];
  });
}

/** 打率 */
export function average(stats: BattingStats): number {
  return stats.atBats === 0 ? 0 : stats.hits / stats.atBats;
}

/** 出塁率（PHASE 1 は四球のみ考慮の簡易版） */
export function onBase(stats: BattingStats): number {
  const denom = stats.atBats + stats.walks;
  return denom === 0 ? 0 : (stats.hits + stats.walks) / denom;
}

/** 防御率 */
export function era(stats: PitchingStats): number {
  if (stats.outs === 0) return 0;
  return (stats.earnedRuns * 27) / stats.outs;
}

export function formatAverage(value: number): string {
  if (!Number.isFinite(value)) return '.000';
  const s = value.toFixed(3);
  return value < 1 ? s.slice(1) : s;
}

export function formatEra(stats: PitchingStats): string {
  if (stats.outs === 0) return '-.--';
  return era(stats).toFixed(2);
}

/** アウト数 → 「5.1」（5回1/3）形式 */
export function formatInnings(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}
