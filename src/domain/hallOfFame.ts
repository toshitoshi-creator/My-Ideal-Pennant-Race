/**
 * 殿堂入りと選手の格付け（PHASE 3.7）。
 *
 * 「能力が高かった」ではなく「何を積み上げたか」で決める。
 * 通算成績・ピーク・在籍の長さ・優勝・タイトル・記録を見る。
 */
import type { HallOfFameEntry, HistoryState, PlayerHistory, PlayerTier } from './types';
import { average, era } from './stats';
import { seasonTotalOf } from './history';

/** 殿堂入りの目安。これを超えた引退選手が入る（143試合シーズン換算） */
export const HALL_OF_FAME_THRESHOLD = 500;

/** 点数の基準にするシーズン試合数。短いシーズンでも同じ物差しで測る */
export const SCORE_BASE_GAMES = 143;

/** 通算成績の積み上げ（打者・投手を同じ物差しに載せる） */
export function careerValue(history: PlayerHistory): number {
  const b = history.career.batting;
  const p = history.career.pitching;
  const batting =
    b.hits * 0.05 + b.homeRuns * 0.22 + b.rbi * 0.05 + b.steals * 0.04 + b.walks * 0.02;
  const innings = p.outs / 3;
  const pitching = p.wins * 0.75 + p.saves * 0.4 + p.strikeouts * 0.03 + innings * 0.03;
  return batting + pitching;
}

/** 一番良かったシーズンの高さ */
export function peakValue(history: PlayerHistory): number {
  const years = [...new Set(history.seasons.map((s) => s.year))];
  let best = 0;
  for (const year of years) {
    const total = seasonTotalOf(history, year);
    const b = total.batting;
    const p = total.pitching;
    let score = b.homeRuns * 0.5 + b.hits * 0.1 + b.rbi * 0.1 + b.steals * 0.08;
    if (b.atBats >= 100) score += Math.max(0, average(b) - 0.25) * 100;
    score += p.wins * 1.6 + p.saves * 0.9 + p.strikeouts * 0.06;
    if (p.outs >= 300) score += Math.max(0, 4.5 - era(p)) * 4;
    best = Math.max(best, score);
  }
  return best;
}

/** 現役を続けた長さ（成績のあるシーズン数） */
export function longevity(history: PlayerHistory): number {
  return new Set(history.seasons.map((s) => s.year)).size;
}

/** タイトル・表彰の重み（MVPは重く、タイトルは軽く） */
export function awardValue(history: PlayerHistory): number {
  let value = 0;
  for (const award of history.awards) {
    if (award.kind === 'MVP') value += 12;
    else if (award.kind === 'BEST_PITCHER') value += 7;
    else if (award.kind === 'ROOKIE') value += 4;
    else value += 3;
  }
  return value;
}

/**
 * 殿堂入りの点数。
 *
 * 積み上げた数字はシーズンの試合数に比例するので、
 * 143試合シーズンに換算してから測る（10試合設定でも同じ基準になる）。
 */
export function hallOfFameScore(history: PlayerHistory, seasonLength = SCORE_BASE_GAMES): number {
  const scale = SCORE_BASE_GAMES / Math.max(1, seasonLength);
  const seasons = longevity(history);
  // 短い在籍で数字だけ良い選手が入らないよう、年数で伸びを抑える
  const lengthFactor = Math.min(1, seasons / 12);
  return Math.round(
    ((careerValue(history) + peakValue(history) * 0.6) * scale +
      awardValue(history) +
      history.championships * 2.5 +
      history.records * 3 +
      seasons * 1.2) *
      (0.55 + lengthFactor * 0.45),
  );
}

/** 殿堂入りの資格（引退していること・一定年数以上プレーしたこと） */
export function isHallOfFameEligible(history: PlayerHistory): boolean {
  return history.retiredAt !== null && longevity(history) >= 8;
}

/** 引退した選手を殿堂入りさせるか判定して、入るなら記録を返す */
export function judgeHallOfFame(
  history: PlayerHistory,
  year: number,
  seasonLength = SCORE_BASE_GAMES,
): HallOfFameEntry | null {
  if (!isHallOfFameEligible(history)) return null;
  const score = hallOfFameScore(history, seasonLength);
  if (score < HALL_OF_FAME_THRESHOLD) return null;
  return {
    playerId: history.playerId,
    name: history.name,
    mainPosition: history.mainPosition,
    debutYear: history.debutYear,
    retiredAt: history.retiredAt ?? year,
    inductedYear: year,
    score,
  };
}

export function isInHallOfFame(history: HistoryState, playerId: string): boolean {
  return history.hallOfFame.some((e) => e.playerId === playerId);
}

export const TIER_LABELS: Record<PlayerTier, string> = {
  ROOKIE: '新人',
  REGULAR: 'レギュラー',
  STAR: 'スター',
  SUPERSTAR: 'スーパースター',
  LEGEND: 'レジェンド',
};

/**
 * 選手の歴史的な位置づけ。
 * 現在の能力値ではなく、積み上げた成績・タイトル・記録から決める。
 */
export function playerTier(
  history: PlayerHistory,
  seasonLength = SCORE_BASE_GAMES,
): PlayerTier {
  const seasons = longevity(history);
  if (seasons <= 1) return 'ROOKIE';
  const score = hallOfFameScore(history, seasonLength);
  if (score >= HALL_OF_FAME_THRESHOLD) return 'LEGEND';
  if (score >= 300) return 'SUPERSTAR';
  if (score >= 150) return 'STAR';
  return 'REGULAR';
}
