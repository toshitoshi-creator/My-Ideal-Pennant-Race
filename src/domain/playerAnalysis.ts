/**
 * PHASE 4.1 選手分析。
 *
 * 「この選手を今どう扱うべきか」の判断材料を、既存データだけから決定論的に組み立てる。
 * UI には依存しない純粋な計算で、乱数・現在時刻・外部APIは一切使わない。
 * 同じ GameState と選手からは必ず同じ結果になる。
 *
 * 重要：Player.ext.potential の実数値はここから外へ出さない。
 * 出すのは PHASE 2 から表示している 5 段階のラベル由来の粗い星の数だけで、
 * 他球団の選手は確度を下げ、予測レンジを広く取る。
 */
import type {
  BattingStats,
  GameState,
  PitchingStats,
  Player,
  PlayerSeasonStats,
} from './types';
import { overallRating, battingRating, pitchingRating } from './rating';
import { potentialLabel } from './growth';
import { velocityToScale, clamp1to100 } from './rank';
import { average, era, unpackBatting, unpackPitching } from './stats';
import { effectiveDefense } from './positions';
import { marketValue } from './contract';
import { usageRoleOf } from './club';

/* ================= 型 ================= */

/** 総合的な立ち位置。S が中心選手、D が整理検討 */
export type PlayerGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 起用の助言（自動でロスターは変えない） */
export type UsageAdvice =
  | 'FIRST_TEAM'
  | 'SECOND_TEAM'
  | 'DEVELOP'
  | 'COMPETE'
  | 'REST'
  | 'INJURED';

/** 扱いの助言 */
export type PlayerRecommendation =
  | 'CORE'
  | 'KEEP'
  | 'DEVELOP'
  | 'ADJUST'
  | 'RELEASE_CANDIDATE'
  | 'INJURY_RETURN';

export type AnalysisTrend = 'UP' | 'FLAT' | 'DOWN' | 'UNKNOWN';

export interface RadarAxis {
  key: string;
  label: string;
  /** 現在の推定能力 1〜100 */
  value: number;
  /**
   * 将来予測レンジの上端 1〜100。
   * 確定値ではないので、UI では薄い領域として描く。伸びしろが無ければ null。
   */
  projected: number | null;
}

export interface TrendPoint {
  year: number;
  teamId: string;
  values: Record<string, number>;
}

export interface AnalysisStars {
  /** 現在戦力 0〜5 */
  current: number;
  /** 将来性 0〜5（粗いラベル由来） */
  future: number;
  /** 成長期待 0〜5 */
  development: number;
  /** 起用優先度 0〜5 */
  usage: number;
}

export interface PlayerAnalysis {
  playerId: string;
  grade: PlayerGrade;
  /** 現在の総合値 1〜100 */
  currentRating: number;
  /** 直近の成績スコア 0〜100。出場が少なければ null */
  recentPerformance: number | null;
  /** 通算の成績スコア 0〜100。記録が無ければ null */
  careerPerformance: number | null;
  developmentTrend: AnalysisTrend;
  /** 成績推移の判定に使えた年数 */
  trendSeasons: number;
  /** 情報の確からしさ 0〜1 */
  scoutingConfidence: number;
  /** 守備位置・役割との噛み合い 0〜100 */
  roleFit: number;
  /** 年齢的な余地 0〜100（若いほど高い） */
  ageFactor: number;
  /** 離脱リスク 0〜100 */
  injuryRisk: number;
  /** 年俸に対する費用対効果 0〜100（高いほど割安） */
  contractValue: number;
  stars: AnalysisStars;
  usage: UsageAdvice;
  usageReason: string;
  recommendation: PlayerRecommendation;
  recommendationReason: string;
  /** 判断の根拠（UI に必ず並べる） */
  reasons: string[];
  /** 一言でまとめた球団分析 */
  summary: string;
  radar: RadarAxis[];
  trend: TrendPoint[];
  /** 能力の履歴が保存されているか（PHASE 4.1 時点では常に false） */
  abilityHistoryAvailable: boolean;
}

/* ================= ラベル ================= */

export const GRADE_LABELS: Record<PlayerGrade, string> = {
  S: '主力・中心選手',
  A: '1軍戦力',
  B: '育成・競争枠',
  C: '2軍調整候補',
  D: '整理・放出検討',
};

export const USAGE_ADVICE_LABELS: Record<UsageAdvice, string> = {
  FIRST_TEAM: '1軍起用推奨',
  SECOND_TEAM: '2軍調整推奨',
  DEVELOP: '育成優先',
  COMPETE: '競争枠',
  REST: '休養推奨',
  INJURED: '復帰待ち',
};

export const RECOMMENDATION_LABELS: Record<PlayerRecommendation, string> = {
  CORE: '中心選手',
  KEEP: '戦力維持',
  DEVELOP: '育成候補',
  ADJUST: '調整候補',
  RELEASE_CANDIDATE: '整理候補',
  INJURY_RETURN: '怪我からの復帰待ち',
};

/* ================= 成績のスコア化 ================= */

/** 打撃成績を 0〜100 に。出場が少なければ null（無理に評価しない） */
export function battingScore(stats: BattingStats, minPa = 40): number | null {
  if (stats.plateAppearances < minPa) return null;
  const avg = average(stats);
  // 打率 .200→30 / .250→50 / .300→72 / .340→88
  const avgScore = clamp0to100(30 + (avg - 0.2) * 440);
  const perPa = (v: number) => (v / Math.max(1, stats.plateAppearances)) * 600;
  // 600打席あたり 本塁打20本→70 / 打点70→70
  const hrScore = clamp0to100(28 + perPa(stats.homeRuns) * 2.1);
  const rbiScore = clamp0to100(24 + perPa(stats.rbi) * 0.66);
  const eyeScore = clamp0to100(
    40 + (perPa(stats.walks) - perPa(stats.strikeouts) * 0.34) * 0.9,
  );
  const runScore = clamp0to100(34 + perPa(stats.steals) * 1.5 + perPa(stats.runs) * 0.3);
  return round1(
    avgScore * 0.36 + hrScore * 0.22 + rbiScore * 0.2 + eyeScore * 0.12 + runScore * 0.1,
  );
}

/** 投手成績を 0〜100 に。投球回が少なければ null */
export function pitchingScore(stats: PitchingStats, minOuts = 60): number | null {
  if (stats.outs < minOuts) return null;
  const innings = stats.outs / 3;
  const e = era(stats);
  // 防御率 5.00→26 / 4.00→45 / 3.00→66 / 2.00→86
  const eraScore = clamp0to100(106 - e * 16);
  const per9 = (v: number) => (v / Math.max(1, innings)) * 9;
  const kScore = clamp0to100(24 + per9(stats.strikeouts) * 5.6);
  const whip = (stats.walks + stats.hitsAllowed) / Math.max(1, innings);
  const whipScore = clamp0to100(150 - whip * 66);
  const hrScore = clamp0to100(84 - per9(stats.homeRunsAllowed) * 30);
  // 起用のされ方（回数・勝敗・セーブ）は少しだけ見る
  const roleScore = clamp0to100(
    30 + innings * 0.32 + stats.wins * 2.2 + stats.saves * 1.8 + stats.holds * 1.2,
  );
  return round1(
    eraScore * 0.4 + whipScore * 0.2 + kScore * 0.18 + hrScore * 0.1 + roleScore * 0.12,
  );
}

/** 選手の役割に合わせて成績を 0〜100 に。評価できなければ null */
export function performanceScore(
  player: Player,
  stats: { batting: BattingStats; pitching: PitchingStats } | undefined,
  scale = 1,
): number | null {
  if (!stats) return null;
  if (player.isPitcher) return pitchingScore(stats.pitching, Math.max(9, 60 * scale));
  return battingScore(stats.batting, Math.max(8, 40 * scale));
}

/* ================= 年度別の推移 ================= */

interface SeasonLine {
  year: number;
  teamId: string;
  batting: BattingStats;
  pitching: PitchingStats;
}

/** 歴史に残っている年度別成績（古い順）。今季ぶんは含まない */
function seasonLines(state: GameState, player: Player): SeasonLine[] {
  const history = state.history?.players?.[player.id];
  if (!history) return [];
  return history.seasons.map((s) => ({
    year: s.year,
    teamId: s.teamId,
    batting: unpackBatting(s.b),
    pitching: unpackPitching(s.p),
  }));
}

/**
 * 年度別の推移データ。UI のグラフがそのまま使える形にする。
 * 過去のデータを作り出すことはしない（記録が無ければ空）。
 */
export function trendPoints(state: GameState, player: Player): TrendPoint[] {
  return seasonLines(state, player).map((line) => ({
    year: line.year,
    teamId: line.teamId,
    values: (player.isPitcher
      ? {
          era: Math.round(era(line.pitching) * 100) / 100,
          wins: line.pitching.wins,
          strikeouts: line.pitching.strikeouts,
          innings: Math.round((line.pitching.outs / 3) * 10) / 10,
          saves: line.pitching.saves,
        }
      : {
          average: Math.round(average(line.batting) * 1000) / 1000,
          homeRuns: line.batting.homeRuns,
          rbi: line.batting.rbi,
          hits: line.batting.hits,
          games: line.batting.games,
        }) as Record<string, number>,
  }));
}

/** 直近の成績が上向きか下向きか。2年ぶん取れなければ UNKNOWN */
export function developmentTrend(
  state: GameState,
  player: Player,
): { trend: AnalysisTrend; seasons: number } {
  const lines = seasonLines(state, player);
  const scored: number[] = [];
  for (const line of lines) {
    const score = performanceScore(player, line);
    if (score !== null) scored.push(score);
  }
  if (scored.length < 2) return { trend: 'UNKNOWN', seasons: scored.length };
  const recent = scored.slice(-3);
  if (recent.length === 2) {
    const diff = recent[1] - recent[0];
    return { trend: diff >= 6 ? 'UP' : diff <= -6 ? 'DOWN' : 'FLAT', seasons: scored.length };
  }
  // 3年ぶんあるときは「後半2年の平均 − 前半」で見る
  const early = recent[0];
  const late = (recent[1] + recent[2]) / 2;
  const diff = late - early;
  return { trend: diff >= 5 ? 'UP' : diff <= -5 ? 'DOWN' : 'FLAT', seasons: scored.length };
}

/* ================= 補助的な指標 ================= */

/** 年齢的な余地 0〜100。若いほど高い */
export function ageFactor(age: number): number {
  if (age <= 21) return 100;
  if (age >= 38) return 4;
  // 22歳=96 から 37歳=8 までなだらかに落とす
  return clamp0to100(Math.round(96 - (age - 22) * 5.9));
}

/** 離脱リスク 0〜100 */
export function injuryRisk(player: Player): number {
  const ext = player.ext;
  let risk = 12;
  if (ext.injury) {
    risk += ext.injury.level === 'major' ? 55 : ext.injury.level === 'moderate' ? 35 : 18;
  }
  risk += ext.fatigue * 0.32;
  risk += Math.max(0, player.age - 30) * 2.4;
  risk += Math.max(0, ext.consecutiveGames - 8) * 1.1;
  return clamp0to100(Math.round(risk));
}

/** 年俸に対する費用対効果 0〜100。高いほど割安 */
export function contractValueScore(
  state: GameState,
  player: Player,
  stats: PlayerSeasonStats | undefined,
): number {
  const salary = player.ext.contract?.salary ?? 0;
  if (salary <= 0) return 50;
  const value = marketValue(player, stats, state.year);
  if (value <= 0) return 50;
  // 市場価値 = 年俸 なら 50、市場価値が倍なら 85、年俸が倍なら 15
  const ratio = value / salary;
  return clamp0to100(Math.round(50 + Math.log2(ratio) * 35));
}

/** 守備位置・役割との噛み合い 0〜100 */
export function roleFitScore(player: Player): number {
  if (player.isPitcher && player.pitching) {
    const stamina = player.pitching.stamina;
    const base = pitchingRating(player);
    // 先発向き／救援向きのどちらかにはっきり寄っているほど噛み合う
    const shape = stamina >= 55 ? stamina * 0.35 : (100 - stamina) * 0.22;
    return clamp0to100(Math.round(base * 0.7 + shape));
  }
  const fit = effectiveDefense(player, player.mainPosition);
  return clamp0to100(Math.round(fit * 0.55 + battingRating(player) * 0.45));
}

/**
 * その選手についてどれくらい確かな情報を持っているか 0〜1。
 * 自球団の選手は日々見ているので高く、他球団の選手は低い。
 * 出場が多いほど、記録が長いほど確度が上がる。
 */
export function scoutingConfidence(state: GameState, player: Player): number {
  const own = player.teamId === state.playerTeamId;
  let confidence = own ? 0.68 : 0.34;
  const history = state.history?.players?.[player.id];
  confidence += Math.min(0.16, (history?.seasons.length ?? 0) * 0.04);
  const stats = state.stats?.[player.id];
  const played = stats ? Math.max(stats.batting.games, stats.pitching.games) : 0;
  confidence += Math.min(0.14, played * 0.004);
  return Math.round(Math.min(0.98, confidence) * 100) / 100;
}

/* ================= 星 ================= */

/** 粗い将来性ラベルを 1〜5 の星に置き換える（実数値は使わない） */
export function futureStarsFromLabel(label: string): number {
  switch (label) {
    case '非常に高い':
      return 5;
    case '高い':
      return 4;
    case '普通':
      return 3;
    case '低い':
      return 2;
    default:
      return 1;
  }
}

function currentStars(overall: number): number {
  if (overall >= 68) return 5;
  if (overall >= 57) return 4;
  if (overall >= 46) return 3;
  if (overall >= 36) return 2;
  return 1;
}

/* ================= 本体 ================= */

/**
 * 選手の分析をひとまとめに作る。
 * state は読み取りだけで、書き換えない。
 */
export function analyzePlayer(state: GameState, player: Player): PlayerAnalysis {
  const overall = overallRating(player);
  const stats = state.stats?.[player.id];
  const history = state.history?.players?.[player.id];

  const recent = performanceScore(player, stats);
  const career = history ? performanceScore(player, history.career, 3) : null;
  const { trend, seasons } = developmentTrend(state, player);
  const confidence = scoutingConfidence(state, player);
  const age = player.age;
  const ageScore = ageFactor(age);
  const risk = injuryRisk(player);
  const fit = roleFitScore(player);
  const value = contractValueScore(state, player, stats);

  // 将来性は粗いラベル由来。年齢が上がるほど残りの伸びしろは小さく見る
  const labelStars = futureStarsFromLabel(potentialLabel(player.ext.potential));
  const future = Math.max(
    1,
    Math.min(labelStars, age >= 33 ? 2 : age >= 30 ? 3 : age >= 28 ? 4 : 5),
  );

  // 成長期待：将来性・年齢・成績の向き・現状との差
  const headroom = Math.max(0, future - currentStars(overall));
  let devScore = future * 0.9 + headroom * 0.7 + ageScore / 40;
  if (trend === 'UP') devScore += 0.8;
  else if (trend === 'DOWN') devScore -= 0.7;
  if (age >= 32) devScore -= 1.1;
  const development = clampStars(Math.round(devScore));

  const games = stats ? Math.max(stats.batting.games, stats.pitching.games) : 0;
  const usageRole = usageRoleOf(state, player);

  // 起用優先度：今の力と直近成績が中心。怪我はここで大きく下げる
  let usageScore = currentStars(overall) * 0.86 + fit / 34;
  if (recent !== null) usageScore += (recent - 50) / 22;
  if (usageRole === 'CORE') usageScore += 0.5;
  else if (usageRole === 'BENCH') usageScore -= 0.8;
  if (player.ext.injury) usageScore -= 2.4;
  const usageStars = clampStars(Math.round(usageScore));

  const stars: AnalysisStars = {
    current: currentStars(overall),
    future,
    development,
    usage: usageStars,
  };

  const reasons: string[] = [];
  const grade = decideGrade({
    overall,
    recent,
    ageScore,
    fit,
    development,
    usageStars,
    value,
    risk,
    games,
    seasonLength: state.seasonLength,
  });

  const recommendation = decideRecommendation({
    player,
    overall,
    recent,
    career,
    trend,
    future,
    ageScore,
    value,
    games,
    seasonLength: state.seasonLength,
    reasons,
  });

  const usage = decideUsage({ player, overall, recent, trend, future, games, state });

  return {
    playerId: player.id,
    grade,
    currentRating: overall,
    recentPerformance: recent,
    careerPerformance: career,
    developmentTrend: trend,
    trendSeasons: seasons,
    scoutingConfidence: confidence,
    roleFit: fit,
    ageFactor: ageScore,
    injuryRisk: risk,
    contractValue: value,
    stars,
    usage: usage.advice,
    usageReason: usage.reason,
    recommendation: recommendation.kind,
    recommendationReason: recommendation.reason,
    reasons,
    summary: buildSummary({ player, overall, recent, trend, future, usage: usage.advice }),
    radar: buildRadar(player, { future, confidence, age }),
    trend: trendPoints(state, player),
    // PHASE 4.1 では能力の履歴を保存しない（過去データを作り出さない）
    abilityHistoryAvailable: false,
  };
}

/* ---------------- 5段階の評価 ---------------- */

function decideGrade(input: {
  overall: number;
  recent: number | null;
  ageScore: number;
  fit: number;
  development: number;
  usageStars: number;
  value: number;
  risk: number;
  games: number;
  seasonLength: number;
}): PlayerGrade {
  const { overall, recent, ageScore, fit, development, usageStars, value, risk } = input;
  // 出場が少ない選手は成績で決めつけず、能力の比重を上げる
  const hasRecent = recent !== null;
  let score =
    overall * (hasRecent ? 0.36 : 0.46) +
    (hasRecent ? recent * 0.24 : 0) +
    fit * 0.1 +
    ageScore * 0.08 +
    development * 3.2 +
    usageStars * 2.2 +
    (value - 50) * 0.08 -
    risk * 0.06;
  const played = input.games / Math.max(1, input.seasonLength);
  if (played >= 0.5) score += 3;
  if (score >= 70) return 'S';
  if (score >= 58) return 'A';
  if (score >= 46) return 'B';
  if (score >= 37) return 'C';
  return 'D';
}

/* ---------------- 扱いの助言 ---------------- */

function decideRecommendation(input: {
  player: Player;
  overall: number;
  recent: number | null;
  career: number | null;
  trend: AnalysisTrend;
  future: number;
  ageScore: number;
  value: number;
  games: number;
  seasonLength: number;
  reasons: string[];
}): { kind: PlayerRecommendation; reason: string } {
  const { player, overall, recent, career, trend, future, value, reasons } = input;
  const age = player.age;
  const playedRatio = input.games / Math.max(1, input.seasonLength);

  // 怪我はまず復帰を待つ
  if (player.ext.injury) {
    const back = player.ext.injury.returnDate;
    reasons.push(`${player.ext.injury.name}で離脱中`);
    return {
      kind: 'INJURY_RETURN',
      reason: back
        ? `離脱中のため、まずは復帰を待つ段階です（復帰予定 ${back}）。`
        : '離脱中のため、まずは復帰を待つ段階です。',
    };
  }

  // 「整理候補」は 1 つの要素では決めない。重なった数で判断する
  const negatives: string[] = [];
  if (overall < 42) negatives.push('現在能力が低水準');
  if (recent !== null && recent < 40) negatives.push('直近成績が低水準');
  if (future <= 2) negatives.push('伸びしろが小さい');
  if (age >= 32) negatives.push(`${age}歳と高齢`);
  if (playedRatio < 0.15) negatives.push('出場機会が少ない');
  if (value < 32) negatives.push('年俸に対して働きが小さい');
  if (trend === 'DOWN') negatives.push('成績が下降傾向');

  const young = age <= 24;
  const promising = future >= 4 || trend === 'UP';

  if (negatives.length >= 4 && !young) {
    reasons.push(...negatives);
    return {
      kind: 'RELEASE_CANDIDATE',
      reason: `${negatives.slice(0, 4).join('・')}。整理を検討する材料が重なっています。ただし最終判断は球団の方針次第です。`,
    };
  }

  if (young && (promising || overall < 46)) {
    const parts = [`${age}歳と若い`];
    if (trend === 'UP') parts.push('成績が上向き');
    if (future >= 4) parts.push('将来性の評価が高い');
    if (overall < 46) parts.push('現在能力はまだ低水準');
    reasons.push(...parts);
    return {
      kind: 'DEVELOP',
      reason: `${parts.join('・')}。出場機会を作って伸ばす価値があります。`,
    };
  }

  // 能力はあるのに成績が出ていない → 調整
  if (recent !== null && recent < 45 && overall >= 50 && (career === null || career >= 45)) {
    reasons.push('能力は維持されているが直近成績が低迷');
    return {
      kind: 'ADJUST',
      reason: `現在能力は ${overall} と保たれており、直近の成績不振は調整で戻る可能性があります。`,
    };
  }

  if (overall >= 62 && (recent === null || recent >= 55)) {
    reasons.push('現在能力・直近成績ともに高水準');
    return {
      kind: 'CORE',
      reason: '現在能力・直近成績ともに高く、チームの軸として起用する価値があります。',
    };
  }

  if (negatives.length > 0) reasons.push(...negatives.slice(0, 2));
  return {
    kind: 'KEEP',
    reason: '大きな不安要素はなく、現在の立ち位置を維持して問題ありません。',
  };
}

/* ---------------- 1軍／2軍の助言 ---------------- */

function decideUsage(input: {
  player: Player;
  overall: number;
  recent: number | null;
  trend: AnalysisTrend;
  future: number;
  games: number;
  state: GameState;
}): { advice: UsageAdvice; reason: string } {
  const { player, overall, recent, trend, future, state } = input;
  const ext = player.ext;

  if (ext.injury) {
    return {
      advice: 'INJURED',
      reason: `${ext.injury.name}で離脱中です。復帰後にあらためて起用を判断してください。`,
    };
  }

  if (ext.fatigue >= 72 || ext.consecutiveGames >= 14) {
    return {
      advice: 'REST',
      reason: `疲労が ${Math.round(ext.fatigue)}、連続出場が ${ext.consecutiveGames}日です。休養を挟むと成績の落ち込みを防げます。`,
    };
  }

  const age = player.age;
  if (overall >= 58 && (recent === null || recent >= 50)) {
    return {
      advice: 'FIRST_TEAM',
      reason: `現在能力 ${overall}${recent !== null ? `・直近成績も水準以上` : ''}で、1軍で起用する価値が高い状態です。`,
    };
  }

  if (age <= 24 && overall < 55) {
    return {
      advice: 'DEVELOP',
      reason: `${age}歳で現在能力は ${overall} です。${trend === 'UP' ? '成績が上向いており、' : ''}2軍での出場機会を優先する価値があります。`,
    };
  }

  if (recent !== null && recent < 42) {
    return {
      advice: 'SECOND_TEAM',
      reason:
        overall >= 50
          ? '能力は維持されていますが直近成績が低迷しています。2軍で出場機会を確保すると立て直しやすくなります。'
          : '成績不振に加えて能力も1軍水準に届いていないため、1軍起用の優先度は低めです。',
    };
  }

  const direction = state.clubs?.[player.teamId]?.direction;
  const developing = direction === 'DEVELOP' || direction === 'REBUILD';
  return {
    advice: 'COMPETE',
    reason: developing
      ? `球団方針が若手重視のため、${future >= 4 ? '将来性を踏まえて' : ''}競争枠として起用を見極める段階です。`
      : '突出した強みも不安もないため、競争枠として起用を見極める段階です。',
  };
}

/* ---------------- 一言の球団分析 ---------------- */

function ageBand(age: number): string {
  if (age <= 22) return 'ルーキー級';
  if (age <= 25) return '若手';
  if (age <= 30) return '中堅';
  if (age <= 33) return 'ベテラン';
  return '大ベテラン';
}

/**
 * 同じデータからは必ず同じ文章になる。ランダム性は入れない。
 */
export function buildSummary(input: {
  player: Player;
  overall: number;
  recent: number | null;
  trend: AnalysisTrend;
  future: number;
  usage: UsageAdvice;
}): string {
  const { player, overall, recent, trend, future, usage } = input;
  const age = player.age;

  const abilityWord =
    overall >= 66 ? '高い' : overall >= 54 ? '平均以上' : overall >= 44 ? '平均的' : '低め';
  const parts: string[] = [`${age}歳・${ageBand(age)}。現在能力は${abilityWord}です`];

  if (player.ext.injury) {
    parts.push(`現在は${player.ext.injury.name}で離脱中です`);
  } else if (recent === null) {
    parts.push('出場が少なく成績からの判断材料は限られます');
  } else if (recent >= 60) {
    parts.push('直近の成績も良好な水準です');
  } else if (recent >= 45) {
    parts.push('直近の成績はおおむね平均的です');
  } else {
    parts.push('直近の成績は低迷しています');
  }

  if (trend === 'UP') parts.push('ここ数年は成績が上向いています');
  else if (trend === 'DOWN') parts.push('ここ数年は成績が下降しています');
  else if (trend === 'FLAT') parts.push('成績は安定して推移しています');

  if (future >= 4 && age <= 27) parts.push('将来性の評価は高めです');
  else if (future <= 2 && age >= 31) parts.push('年齢的な伸びしろは小さくなっています');

  const tail: Record<UsageAdvice, string> = {
    FIRST_TEAM: '1軍で起用を続ける価値があります',
    SECOND_TEAM: '2軍で出場機会を確保する価値があります',
    DEVELOP: '2軍での出場機会を増やして育てる価値があります',
    COMPETE: '競争枠として見極める段階です',
    REST: '休養を挟む判断が有効です',
    INJURED: '復帰を待つ段階です',
  };
  parts.push(tail[usage]);

  return parts.join('。').replace(/。。/g, '。') + '。';
}

/* ---------------- レーダーチャート ---------------- */

/**
 * 現在の推定能力だけを軸にする。潜在能力の実数値は使わない。
 * projected は「粗い将来性ラベル・年齢・情報の確度」から作った幅で、確定値ではない。
 */
export function buildRadar(
  player: Player,
  ctx: { future: number; confidence: number; age: number },
): RadarAxis[] {
  const upside = projectionUpside(ctx);
  const axis = (key: string, label: string, value: number): RadarAxis => {
    const v = clamp1to100(value);
    return {
      key,
      label,
      value: v,
      projected: upside > 0 ? clamp1to100(v + upside) : null,
    };
  };

  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    return [
      axis('velocity', '球速', velocityToScale(p.velocity)),
      axis('control', '制球', p.control),
      axis('stamina', 'スタミナ', p.stamina),
      axis('power', '球威', p.power),
      axis('movement', '変化', p.movement),
    ];
  }
  const b = player.batting;
  return [
    axis('contact', 'ミート', b.contact),
    axis('power', 'パワー', b.power),
    axis('speed', '走力', b.speed),
    axis('arm', '肩', b.arm),
    axis('fielding', '守備', b.fielding),
    axis('catching', '捕球', b.catching),
  ];
}

/**
 * 予測レンジの伸びしろ幅。
 * 情報の確度が低いほど広く取り、確定値に見せない。年齢が上がると 0 になる。
 */
export function projectionUpside(ctx: {
  future: number;
  confidence: number;
  age: number;
}): number {
  if (ctx.age >= 29 || ctx.future <= 2) return 0;
  const base = (ctx.future - 2) * 5;
  const uncertainty = 1 + (1 - ctx.confidence) * 0.8;
  return Math.round(base * uncertainty);
}

/* ================= 小道具 ================= */

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampStars(value: number): number {
  return Math.max(1, Math.min(5, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
