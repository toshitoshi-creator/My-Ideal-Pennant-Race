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
    atBatsAgainst: 0,
    doublesAllowed: 0,
    triplesAllowed: 0,
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
    // 後から足した記録（被OPS用）は古いセーブに無いことがある
    target[key] = (target[key] ?? 0) + (add[key] ?? 0);
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

/** 出塁率（犠飛・死球は扱っていないので (安打+四球)/(打数+四球)） */
export function obp(b: BattingStats): number {
  const denom = b.atBats + b.walks;
  return denom === 0 ? 0 : (b.hits + b.walks) / denom;
}

/** 長打率 */
export function slg(b: BattingStats): number {
  if (b.atBats === 0) return 0;
  return (b.hits + b.doubles + b.triples * 2 + b.homeRuns * 3) / b.atBats;
}

/** OPS（出塁率＋長打率） */
export function ops(b: BattingStats): number {
  return obp(b) + slg(b);
}

/**
 * 被OPS（投手が打たれた打者の OPS）。打者の OPS と同じ式で数える。
 * 対戦打数を記録する前のセーブ（その年の途中まで）は数えられないので null。
 */
export function opsAgainst(p: PitchingStats): number | null {
  const ab = p.atBatsAgainst ?? 0;
  if (ab === 0) return null;
  const obpA = (p.hitsAllowed + p.walks) / (ab + p.walks);
  const tb =
    p.hitsAllowed +
    (p.doublesAllowed ?? 0) +
    (p.triplesAllowed ?? 0) * 2 +
    p.homeRunsAllowed * 3;
  return obpA + tb / ab;
}

/** OPS の表示（1 未満は .812、1 以上は 1.034） */
export function formatOps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-.---';
  return formatAverage(value);
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
  'atBatsAgainst',
  'doublesAllowed',
  'triplesAllowed',
] as const;

export function packBatting(stats: BattingStats): number[] {
  return BATTING_FIELDS.map((key) => stats[key]);
}

export function packPitching(stats: PitchingStats): number[] {
  return PITCHING_FIELDS.map((key) => stats[key] ?? 0);
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
