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

/* ---------------- 履歴用の圧縮形式（PHASE 3.7） ---------------- */

/**
 * 履歴に残す成績は「決まった順番の数値配列」で持つ。
 *
 * 50年ぶんの年度別成績をオブジェクトのまま保存すると、
 * キー名だけでセーブデータが数MBに膨らんでしまうため。
 * 順番は下の *_FIELDS が唯一の定義で、読み書きは pack/unpack を通す。
 */
export const BATTING_FIELDS = [
  'games',
  'plateAppearances',
  'atBats',
  'hits',
  'doubles',
  'triples',
  'homeRuns',
  'rbi',
  'runs',
  'steals',
  'strikeouts',
  'walks',
] as const;

export const PITCHING_FIELDS = [
  'games',
  'starts',
  'outs',
  'wins',
  'losses',
  'holds',
  'saves',
  'strikeouts',
  'walks',
  'hitsAllowed',
  'homeRunsAllowed',
  'runsAllowed',
  'earnedRuns',
] as const;

export function packBatting(stats: BattingStats): number[] {
  return BATTING_FIELDS.map((key) => stats[key]);
}

export function packPitching(stats: PitchingStats): number[] {
  return PITCHING_FIELDS.map((key) => stats[key]);
}

export function unpackBatting(line: number[] | undefined): BattingStats {
  const stats = emptyBatting();
  if (!line) return stats;
  BATTING_FIELDS.forEach((key, i) => {
    stats[key] = line[i] ?? 0;
  });
  return stats;
}

export function unpackPitching(line: number[] | undefined): PitchingStats {
  const stats = emptyPitching();
  if (!line) return stats;
  PITCHING_FIELDS.forEach((key, i) => {
    stats[key] = line[i] ?? 0;
  });
  return stats;
}
