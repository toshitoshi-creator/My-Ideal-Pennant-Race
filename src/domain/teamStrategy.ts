/**
 * 球団戦略（PHASE 3.6）。
 *
 * CPU球団は毎年、戦力・年齢構成・財務・前年の成績から
 * 「今季どう戦うか」を決める。固定の性格ではなく、状況で変わる。
 *
 *   WIN_NOW  … 今季勝ちにいく
 *   YOUTH    … 若手を育てて作り直す
 *   BUDGET   … 支出を締める
 *   BALANCED … その中間
 *
 * 判断には隠し情報を使わず、RosterAnalysis（KnownPlayer から作った分析）と
 * 公開されている成績だけを使う。
 */
import type { GameState, TradeTrait } from './types';
import { Rng, seedFrom } from './rng';
import type { RosterAnalysis } from './rosterAnalysis';
import { winPct } from './standings';

/** 戦略の種類（PHASE 3.5 の TradeTrait と同じ4種類を使う） */
export type TeamStrategy = TradeTrait;

export const STRATEGIES: TeamStrategy[] = ['WIN_NOW', 'BALANCED', 'YOUTH', 'BUDGET'];

export const STRATEGY_LABELS: Record<TeamStrategy, string> = {
  WIN_NOW: '優勝を狙う',
  BALANCED: '戦力を維持する',
  YOUTH: '若手を育てる',
  BUDGET: '支出を抑える',
};

export const STRATEGY_SHORT: Record<TeamStrategy, string> = {
  WIN_NOW: '今季優先',
  BALANCED: 'バランス',
  YOUTH: '若手育成',
  BUDGET: '堅実経営',
};

/**
 * 球団ごとの経営の癖。
 * seed から決まるので、同じゲームでは毎年変わらない。
 * 戦略そのものではなく「同じ状況でもこの球団は少し積極的」という程度の重みづけ。
 */
export interface TeamManagementProfile {
  /** 補強への積極さ 0〜100 */
  aggression: number;
  /** 若手を好む度合い 0〜100 */
  youthPreference: number;
  /** 支出の規律 0〜100（高いほど締める） */
  budgetDiscipline: number;
  /** トレードの活発さ 0〜100 */
  tradeActivity: number;
  /** FAへの積極さ 0〜100 */
  faActivity: number;
  /** ベテランを好む度合い 0〜100 */
  veteranPreference: number;
}

/** 球団の経営の癖。seed と球団IDから決まる */
export function teamProfile(state: GameState, teamId: string): TeamManagementProfile {
  const rng = new Rng(seedFrom(`aiProfile:${state.seed}:${teamId}`));
  const pick = () => Math.round(20 + rng.next() * 60);
  return {
    aggression: pick(),
    youthPreference: pick(),
    budgetDiscipline: pick(),
    tradeActivity: pick(),
    faActivity: pick(),
    veteranPreference: pick(),
  };
}

export type StrategyScores = Record<TeamStrategy, number>;

export interface StrategyResult {
  strategy: TeamStrategy;
  scores: StrategyScores;
  /** UI向けの短い説明 */
  reasons: string[];
}

/** 前年の勝率（記録がなければ 0.5） */
export function lastWinPct(state: GameState, teamId: string): number {
  const record = state.records[teamId];
  if (!record || record.games <= 0) return 0.5;
  return winPct(record);
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * 戦略スコアを計算する。
 * 各スコアは 0〜100 で、いちばん高いものがその年の戦略になる。
 */
export function strategyScores(
  analysis: RosterAnalysis,
  profile: TeamManagementProfile,
  context: { winPct: number; noise: number },
): StrategyScores {
  const { winPct: pct, noise } = context;

  // 戦力の高さ（総合40前後がリーグ平均）
  const strength = clamp01((analysis.overall - 34) / 14);
  // 財務の余裕
  const payrollRatio = analysis.payroll / Math.max(1, analysis.budget);
  const cashRoom = clamp01((analysis.cash + 500) / 3000);
  // 穴の多さ
  const holes = analysis.weakest.filter((key) => analysis.positions[key].need >= 70).length;
  const holeRatio = clamp01(holes / 4);

  const winNow =
    strength * 34 +
    clamp01((pct - 0.44) / 0.18) * 26 +
    clamp01(1 - Math.abs(analysis.averageAge - 28.5) / 4) * 12 +
    clamp01(1.05 - payrollRatio) * 10 +
    (profile.aggression / 100) * 12 +
    (profile.veteranPreference / 100) * 6;

  const youth =
    (1 - strength) * 26 +
    clamp01((0.5 - pct) / 0.18) * 18 +
    clamp01((analysis.veteranRatio - 0.14) / 0.2) * 16 +
    clamp01((analysis.youngRatio - 0.2) / 0.25) * 10 +
    (profile.youthPreference / 100) * 18 +
    holeRatio * 6;

  const budget =
    clamp01((payrollRatio - 0.88) / 0.3) * 34 +
    (1 - cashRoom) * 24 +
    (profile.budgetDiscipline / 100) * 22 +
    clamp01((analysis.veteranRatio - 0.2) / 0.2) * 6;

  // どれにも強く寄らないときの受け皿
  const balanced =
    36 +
    clamp01(1 - Math.abs(pct - 0.5) / 0.15) * 10 +
    clamp01(1 - Math.abs(payrollRatio - 0.9) / 0.25) * 8 +
    (100 - Math.abs(profile.aggression - 50) * 2) / 100 * 6;

  const jitter = (value: number, index: number) =>
    Math.round((value * (1 + noise * (index % 2 === 0 ? 1 : -1))) * 10) / 10;

  return {
    WIN_NOW: jitter(winNow, 0),
    YOUTH: jitter(youth, 1),
    BUDGET: jitter(budget, 2),
    BALANCED: jitter(balanced, 3),
  };
}

function buildReasons(
  strategy: TeamStrategy,
  analysis: RosterAnalysis,
  context: { winPct: number },
): string[] {
  const reasons: string[] = [];
  const payrollRatio = analysis.payroll / Math.max(1, analysis.budget);
  switch (strategy) {
    case 'WIN_NOW':
      if (context.winPct >= 0.5) reasons.push('前年の成績が良く、優勝を狙える位置にいます');
      if (analysis.overall >= 40) reasons.push('主力の能力が高く、今季が勝負どころです');
      if (payrollRatio < 1) reasons.push('年俸に余裕があり、補強に回せます');
      break;
    case 'YOUTH':
      if (analysis.veteranRatio > 0.15) reasons.push('ベテランの比率が高く、世代交代が必要です');
      if (context.winPct < 0.5) reasons.push('前年は苦しい成績でした。作り直しの時期です');
      if (analysis.youngRatio > 0.25) reasons.push('若手が育ってきており、出場機会を作ります');
      break;
    case 'BUDGET':
      if (payrollRatio > 0.95) reasons.push('総年俸が年間予算を圧迫しています');
      if (analysis.cash < 800) reasons.push('球団資金に余裕がありません');
      reasons.push('高額・長期の契約は避けます');
      break;
    default:
      reasons.push('大きな穴を埋めつつ、戦力を保ちます');
      break;
  }
  const hole = analysis.weakest[0];
  if (hole && analysis.positions[hole].need >= 60) {
    reasons.push('補強が必要な枠があります');
  }
  return reasons.slice(0, 3);
}

/**
 * その年の戦略を決める。
 * 決定は seed から作った乱数で ±3〜8% だけ揺らぐ（完全最適化にしない）。
 */
export function decideStrategy(
  state: GameState,
  analysis: RosterAnalysis,
  profile: TeamManagementProfile,
): StrategyResult {
  const rng = new Rng(seedFrom(`aiStrategy:${state.seed}:${state.year}:${analysis.teamId}`));
  const noise = 0.03 + rng.next() * 0.05;
  const pct = lastWinPct(state, analysis.teamId);
  const scores = strategyScores(analysis, profile, { winPct: pct, noise });

  let strategy: TeamStrategy = 'BALANCED';
  let best = -Infinity;
  for (const key of STRATEGIES) {
    if (scores[key] > best) {
      best = scores[key];
      strategy = key;
    }
  }
  return { strategy, scores, reasons: buildReasons(strategy, analysis, { winPct: pct }) };
}
