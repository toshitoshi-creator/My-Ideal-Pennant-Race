/**
 * 球団経営AI（PHASE 3.6）。
 *
 * これまで契約・ドラフト・FA・トレードがそれぞれ独立に判断していたものを、
 * 「戦力分析 → 戦略 → 補強ポイント → 予算配分 → 各施策」という
 * ひとつの流れにまとめる。
 *
 *   シーズン終了 → 戦力分析・戦略決定（TeamSeasonPlan を作る）
 *     → 契約更改      … 戦略に応じて残す／見送るを判断
 *     → ドラフト      … 補強ポイントを反映して指名
 *     → 補強ポイント再計算（獲得できた枠は下がる）
 *     → FA            … 残った穴に、配分した予算の範囲で参加
 *     → トレード      … FAで埋まらなかった穴を埋める
 *
 * 設計上の約束：
 *  - CPU は真の潜在能力を直接参照しない。KnownPlayer（推定値のみ）を通して判断する。
 *  - 乱数は AI 専用のシード系列を使い、試合や成長の乱数列をずらさない。
 *  - 完全最適化はしない。判断には ±3〜8% の揺らぎを入れる。
 *  - 重い総当たりはしない。分析はシーズンの節目だけで行う。
 */
import type { GameState, TeamAiPlan, TeamAiPlanLog } from './types';
import { Rng, seedFrom } from './rng';
import {
  POSITION_KEYS,
  POSITION_KEY_LABELS,
  analyzeRoster,
  financeOf,
  knownPlayersOf,
  staminaLookup,
  type PositionKey,
  type RosterAnalysis,
} from './rosterAnalysis';
import {
  STRATEGY_LABELS,
  decideStrategy,
  teamProfile,
  type TeamManagementProfile,
  type TeamStrategy,
} from './teamStrategy';
import { clamp1to100 } from './rank';

/** 総年俸の上限（PHASE 3.3〜3.5 と同じ） */
export const PAYROLL_CEILING_RATIO = 1.12;

/** 戦略ごとの FA 予算の割合（年間予算に対して） */
export const FA_BUDGET_RATIO: Record<TeamStrategy, { min: number; max: number }> = {
  WIN_NOW: { min: 0.35, max: 0.5 },
  BALANCED: { min: 0.2, max: 0.35 },
  YOUTH: { min: 0.1, max: 0.25 },
  BUDGET: { min: 0, max: 0.15 },
};

/* ---------------- 乱数（AI 専用の系列） ---------------- */

export type AiRngKind = 'aiStrategy' | 'aiContract' | 'aiFA' | 'aiTrade' | 'aiDraft' | 'aiPlan';

export function aiRng(state: GameState, kind: AiRngKind, ...parts: Array<string | number>): Rng {
  return new Rng(seedFrom(`${kind}:${state.seed}:${state.year}:${parts.join(':')}`));
}

/** 決定に乗せる揺らぎ（±3〜8%） */
export function decisionNoise(state: GameState, kind: AiRngKind, ...parts: Array<string | number>): number {
  const rng = aiRng(state, kind, ...parts);
  const magnitude = 0.03 + rng.next() * 0.05;
  return rng.chance(0.5) ? 1 + magnitude : 1 - magnitude;
}

/* ---------------- 推定潜在能力 ---------------- */

/**
 * その球団から見た推定潜在能力。
 * 自球団の選手は把握しているが、他球団の選手はスカウト精度ぶんの誤差が乗る。
 * （PHASE 3.5 の trade.ts と同じ考え方。循環参照を避けるためここにも置く）
 */
export function estimatePotentialFor(
  state: GameState,
  viewerTeamId: string,
  playerId: string,
): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 45;
  if (player.teamId === viewerTeamId) return player.ext.potential;
  const scout = state.scouting?.teams?.[viewerTeamId]?.ability;
  const accuracy = Math.max(20, Math.min(100, scout?.potential ?? 55));
  const rng = new Rng(seedFrom(`aiPot:${state.seed}:${state.year}:${viewerTeamId}:${playerId}`));
  return clamp1to100(player.ext.potential + rng.normal(0, (100 - accuracy) / 8 + 3));
}

/** その球団の戦力分析を作る */
export function analyzeTeam(state: GameState, teamId: string): RosterAnalysis {
  // 選手をIDで引けるようにしてから推定する（毎回の線形探索を避ける）
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const known = knownPlayersOf(state, teamId, 'own', (viewer, playerId) => {
    const player = byId.get(playerId);
    if (!player) return 45;
    if (player.teamId === viewer) return player.ext.potential;
    return estimatePotentialFor(state, viewer, playerId);
  });
  return analyzeRoster(
    teamId,
    known,
    staminaLookup(state),
    financeOf(state, teamId),
    PAYROLL_CEILING_RATIO,
  );
}

/* ---------------- 経営プラン ---------------- */

function emptyLog(): TeamAiPlanLog {
  return { contractsKept: 0, contractsReleased: 0, draftPicks: 0, faSigned: 0, tradesDone: 0 };
}

function faBudgetFor(
  analysis: RosterAnalysis,
  strategy: TeamStrategy,
  profile: TeamManagementProfile,
): number {
  const range = FA_BUDGET_RATIO[strategy];
  // 積極的な球団ほど上限寄り
  const t = Math.max(0, Math.min(1, profile.faActivity / 100));
  const ratio = range.min + (range.max - range.min) * t;
  // 実際に使えるのは「予算上限までの余力」を超えられない
  return Math.max(0, Math.min(analysis.faRoom, analysis.budget * ratio));
}

/** 補強ポイント（0〜100）を、戦略に応じて重みづけする */
export function weightedNeeds(
  analysis: RosterAnalysis,
  strategy: TeamStrategy,
): Record<PositionKey, number> {
  const needs = {} as Record<PositionKey, number>;
  for (const key of POSITION_KEYS) {
    let need = analysis.positions[key].need;
    // 先発投手は影響が大きいので、不足しているときは優先度を上げる
    if (key === 'SP' && need >= 55) need += 8;
    if (strategy === 'WIN_NOW') {
      // 今季勝ちにいくので、はっきりした穴をより強く見る
      need = need >= 60 ? need + 6 : need - 4;
    } else if (strategy === 'YOUTH') {
      // 若手に回すため、穴でなければ動かない
      need = need >= 75 ? need : need - 10;
    } else if (strategy === 'BUDGET') {
      need -= 8;
    }
    needs[key] = Math.max(0, Math.min(100, Math.round(need)));
  }
  return needs;
}

/**
 * 今季の経営プランを作る。
 * オフシーズンの入口で一度だけ呼び、契約・ドラフト・FA・トレードで共有する。
 */
export function buildTeamPlan(state: GameState, teamId: string): TeamAiPlan {
  const analysis = analyzeTeam(state, teamId);
  const profile = teamProfile(state, teamId);
  const decided = decideStrategy(state, analysis, profile);
  const needs = weightedNeeds(analysis, decided.strategy);

  return {
    teamId,
    year: state.year,
    strategy: decided.strategy,
    profile,
    needs,
    faBudget: Math.round(faBudgetFor(analysis, decided.strategy, profile)),
    faSpent: 0,
    reasons: decided.reasons,
    log: emptyLog(),
  };
}

/** 全球団のプランを作り直す（シーズン終了時に1回だけ） */
export function refreshTeamPlans(state: GameState): void {
  if (state.teamPlans && state.teamPlansYear === state.year) return;
  const plans: Record<string, TeamAiPlan> = {};
  for (const team of state.teams) plans[team.id] = buildTeamPlan(state, team.id);
  state.teamPlans = plans;
  state.teamPlansYear = state.year;
}

/**
 * プランを取り出す。まだ無ければその場で作る。
 *
 * プランは「そのオフシーズンに決めた、翌シーズンの方針」なので、
 * 年が変わっても作り直さない（作り直しは refreshTeamPlans が行う）。
 */
export function planFor(state: GameState, teamId: string): TeamAiPlan {
  if (!state.teamPlans) state.teamPlans = {};
  const existing = state.teamPlans[teamId];
  if (existing) return existing;
  const plan = buildTeamPlan(state, teamId);
  state.teamPlans[teamId] = plan;
  return plan;
}

/* ---------------- 施策どうしの連携 ---------------- */

/**
 * 補強できた枠の必要度を下げる（PHASE 3.6 の要）。
 * ドラフトで遊撃を獲れたなら、FA でさらに遊撃を大量に獲りにいかない。
 */
export function markNeedFilled(plan: TeamAiPlan, key: PositionKey, strength: number): void {
  const drop = Math.max(6, Math.min(45, Math.round(strength)));
  plan.needs[key] = Math.max(0, plan.needs[key] - drop);
}

/** ドラフトの獲得を反映して補強ポイントを見直す */
export function refreshNeedsAfterDraft(state: GameState): void {
  if (!state.teamPlans) return;
  for (const team of state.teams) {
    const plan = state.teamPlans[team.id];
    if (!plan || plan.year !== state.year) continue;
    const analysis = analyzeTeam(state, team.id);
    const recalculated = weightedNeeds(analysis, plan.strategy);
    // 一度決めた方針は保ちつつ、実際の戦力に寄せる
    for (const key of POSITION_KEYS) {
      plan.needs[key] = Math.round((plan.needs[key] + recalculated[key]) / 2);
    }
  }
}

/* ---------------- 説明文（UI用） ---------------- */

/** 補強ポイントの上位（必要度が高い枠） */
export function reinforcementTargets(plan: TeamAiPlan, limit = 2): PositionKey[] {
  return POSITION_KEYS.filter((key) => plan.needs[key] >= 55)
    .sort((a, b) => plan.needs[b] - plan.needs[a])
    .slice(0, limit);
}

export type ActivityLabel = '低' | '中' | '高';

export function activityLabel(value: number): ActivityLabel {
  if (value >= 62) return '高';
  if (value >= 38) return '中';
  return '低';
}

/** FAへの積極度（戦略と球団の癖から） */
export function faActivityLabel(plan: TeamAiPlan): ActivityLabel {
  const base = plan.strategy === 'WIN_NOW' ? 22 : plan.strategy === 'BUDGET' ? -22 : 0;
  return activityLabel(plan.profile.faActivity + base);
}

/** トレードへの積極度 */
export function tradeActivityLabel(plan: TeamAiPlan): ActivityLabel {
  const base = plan.strategy === 'WIN_NOW' ? 14 : plan.strategy === 'YOUTH' ? 8 : -6;
  return activityLabel(plan.profile.tradeActivity + base);
}

/** 球団方針の説明文（UI表示用。AIそのものは決定論的なTypeScript） */
export function planSummary(plan: TeamAiPlan): string {
  return STRATEGY_LABELS[plan.strategy];
}

/** 補強ポイントの表示名 */
export function targetLabels(plan: TeamAiPlan, limit = 2): string[] {
  return reinforcementTargets(plan, limit).map((key) => POSITION_KEY_LABELS[key]);
}

/** 「なぜこの選手を獲ったのか」を短く説明する */
export function acquisitionReason(plan: TeamAiPlan, key: PositionKey): string {
  if (plan.needs[key] >= 70) return `${POSITION_KEY_LABELS[key]}の層が薄いため獲得を優先`;
  if (plan.strategy === 'BUDGET') return '年俸を抑えられるため獲得';
  if (plan.strategy === 'YOUTH') return '若手の底上げのため獲得';
  return '戦力の底上げのため獲得';
}
