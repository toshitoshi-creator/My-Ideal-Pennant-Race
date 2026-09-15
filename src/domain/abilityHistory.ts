/**
 * 能力履歴（PHASE 4.9-B）。
 *
 * これまで年度別に残していたのは「成績」だけで、能力値は現在値しか持っていなかった。
 * そのため「この選手は伸びているのか、もう落ちているのか」をグラフで見せられなかった。
 *
 * ここでは、シーズンを締めるときの能力を1年ぶん1行だけ記録する。
 * 保存量を抑えるため、成績と同じく「決まった順番の数値配列」で持つ。
 *
 * 重要：過去にさかのぼって能力を作り出すことはしない。
 * 記録が無い年は「記録なし」として扱い、現在値から推測した値を混ぜない。
 */
import type {
  BatterAbilities,
  PitcherAbilities,
  Player,
  PlayerHistory,
  PlayerSeasonHistoryEntry,
} from './types';
import { overallRating } from './rating';

/** 野手能力の並び（この順番が唯一の定義。読み書きは pack/unpack を通す） */
export const BATTER_ABILITY_FIELDS = [
  'trajectory',
  'contact',
  'power',
  'speed',
  'arm',
  'fielding',
  'catching',
] as const;

/** 投手能力の並び */
export const PITCHER_ABILITY_FIELDS = [
  'velocity',
  'control',
  'stamina',
  'power',
  'movement',
] as const;

export function packBatterAbilities(abilities: BatterAbilities): number[] {
  return BATTER_ABILITY_FIELDS.map((key) => Math.round(abilities[key]));
}

export function packPitcherAbilities(abilities: PitcherAbilities): number[] {
  return PITCHER_ABILITY_FIELDS.map((key) => Math.round(abilities[key]));
}

export function unpackBatterAbilities(line: number[] | undefined): BatterAbilities | null {
  if (!line || line.length < BATTER_ABILITY_FIELDS.length) return null;
  const out = {} as BatterAbilities;
  BATTER_ABILITY_FIELDS.forEach((key, i) => {
    out[key] = line[i] ?? 0;
  });
  return out;
}

export function unpackPitcherAbilities(line: number[] | undefined): PitcherAbilities | null {
  if (!line || line.length < PITCHER_ABILITY_FIELDS.length) return null;
  const out = {} as PitcherAbilities;
  PITCHER_ABILITY_FIELDS.forEach((key, i) => {
    out[key] = line[i] ?? 0;
  });
  return out;
}

/** 1年ぶんの能力の記録（グラフが読みやすい形にほどいたもの） */
export interface AbilityPoint {
  year: number;
  age: number | null;
  overall: number;
  batting: BatterAbilities | null;
  pitching: PitcherAbilities | null;
}

/**
 * 能力履歴を古い順に取り出す。
 * 同じ年に複数球団の行がある（シーズン途中のトレード）ときは、能力を持つ行だけを使う。
 */
export function abilityPoints(history: PlayerHistory | undefined): AbilityPoint[] {
  if (!history) return [];
  const byYear = new Map<number, AbilityPoint>();
  for (const season of history.seasons) {
    if (typeof season.o !== 'number') continue;
    if (byYear.has(season.year)) continue;
    byYear.set(season.year, {
      year: season.year,
      age: history.birthYear > 0 ? season.year - history.birthYear : null,
      overall: season.o,
      batting: unpackBatterAbilities(season.a),
      pitching: unpackPitcherAbilities(season.q),
    });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** 能力履歴を持っているか（持っていなければグラフを出さず、その旨を書く） */
export function hasAbilityHistory(history: PlayerHistory | undefined): boolean {
  return abilityPoints(history).length > 0;
}

/* ================= 成長 / ピーク / 衰退 ================= */

export type GrowthPhase = 'GROWING' | 'PEAK' | 'DECLINING' | 'UNKNOWN';

export const GROWTH_PHASE_LABELS: Record<GrowthPhase, string> = {
  GROWING: '成長中',
  PEAK: 'ピーク付近',
  DECLINING: '衰退傾向',
  UNKNOWN: '判定できません',
};

/** 色に頼らず読めるよう、記号でも示す（§6） */
export const GROWTH_PHASE_MARKS: Record<GrowthPhase, string> = {
  GROWING: '↑',
  PEAK: '→',
  DECLINING: '↓',
  UNKNOWN: '―',
};

export interface GrowthReading {
  phase: GrowthPhase;
  /** キャリアで最も高かった総合値（記録がある年のうち） */
  peakOverall: number | null;
  peakYear: number | null;
  /** 直近の総合値 */
  latestOverall: number | null;
  /** 直近とピークの差（マイナスならピークより落ちている） */
  fromPeak: number | null;
  /** 判定の根拠を文章で（グラフから直接読めることだけを書く） */
  text: string;
}

/**
 * 能力履歴から「成長中 / ピーク付近 / 衰退傾向」を読む。
 *
 * ゲーム内部の成長判定を新しく作らない。ここでやるのは
 * 「記録された総合値がどう動いたか」を読むだけで、
 * 将来の成長率や潜在能力には一切触れない。
 *
 * 判定は直近3年（無ければあるぶん）の傾きとピーク差で決める。
 */
export function readGrowth(points: AbilityPoint[]): GrowthReading {
  if (points.length === 0) {
    return {
      phase: 'UNKNOWN',
      peakOverall: null,
      peakYear: null,
      latestOverall: null,
      fromPeak: null,
      text: '能力の記録がまだありません。シーズンを終えると1年ぶんずつ残っていきます。',
    };
  }

  const latest = points[points.length - 1];
  let peak = points[0];
  for (const point of points) {
    if (point.overall > peak.overall) peak = point;
  }
  const fromPeak = latest.overall - peak.overall;

  if (points.length === 1) {
    return {
      phase: 'UNKNOWN',
      peakOverall: peak.overall,
      peakYear: peak.year,
      latestOverall: latest.overall,
      fromPeak,
      text: `記録は${latest.year}年の1年ぶんだけです。推移はもう1年たつと読めるようになります。`,
    };
  }

  // 直近3年ぶん（無ければあるぶん）の変化量で傾きを見る
  const recent = points.slice(-3);
  const slope = recent[recent.length - 1].overall - recent[0].overall;

  let phase: GrowthPhase;
  if (slope >= 2) phase = 'GROWING';
  else if (fromPeak <= -3) phase = 'DECLINING';
  else phase = 'PEAK';

  const text =
    phase === 'GROWING'
      ? `${recent[0].year}年から${latest.year}年で総合が${slope}上がっています。`
      : phase === 'DECLINING'
        ? `${peak.year}年の${peak.overall}がこれまでの最高で、いまは${Math.abs(fromPeak)}低い${latest.overall}です。`
        : `${latest.year}年は${latest.overall}で、これまでの最高（${peak.year}年 ${peak.overall}）と${Math.abs(fromPeak)}差です。`;

  return { phase, peakOverall: peak.overall, peakYear: peak.year, latestOverall: latest.overall, fromPeak, text };
}

/**
 * いまの選手からシーズン終了時の記録を作る。
 * 呼ぶのは「シーズンを締めるとき」の1回だけ（history.ts）。
 */
export function abilitySnapshot(player: Player): {
  o: number;
  a: number[];
  q?: number[];
} {
  const snapshot: { o: number; a: number[]; q?: number[] } = {
    o: overallRating(player),
    a: packBatterAbilities(player.batting),
  };
  if (player.pitching) snapshot.q = packPitcherAbilities(player.pitching);
  return snapshot;
}

/* ================= 通算成績の推移（PHASE 4.9-B） ================= */

export interface CareerCumulativePoint {
  year: number;
  /** その年までの累計 */
  total: number;
  /** その年の成績（記録が無い年は null） */
  season: number | null;
}

/**
 * 年度別成績から通算の積み上げを作る。
 * 記録が無い年は積み上げを増やさず、その年の値は null にする。
 */
export function careerCumulative(
  history: PlayerHistory | undefined,
  pick: (season: PlayerSeasonHistoryEntry) => number | null,
): CareerCumulativePoint[] {
  if (!history) return [];
  const byYear = new Map<number, number | null>();
  for (const season of history.seasons) {
    const value = pick(season);
    const current = byYear.get(season.year);
    if (value === null) {
      if (current === undefined) byYear.set(season.year, null);
      continue;
    }
    // 同じ年に複数球団の行があるときは足し合わせる
    byYear.set(season.year, (current ?? 0) + value);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  let total = 0;
  return years.map((year) => {
    const season = byYear.get(year) ?? null;
    if (season !== null) total += season;
    return { year, total, season };
  });
}
