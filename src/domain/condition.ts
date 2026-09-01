/**
 * 疲労・コンディション・モチベーション・チーム士気（PHASE 2）。
 *
 * 基本能力そのものは毎試合変えず、ここで管理する状態から
 * effective.ts が「実効能力」を計算する。
 */
import type { ConditionId, GameState, Player } from './types';
import { Rng } from './rng';
import { personalityEffects } from './personality';

export const CONDITIONS: ConditionId[] = ['worst', 'bad', 'normal', 'good', 'best'];

export const CONDITION_LABELS: Record<ConditionId, string> = {
  best: '絶好調',
  good: '好調',
  normal: '普通',
  bad: '不調',
  worst: '絶不調',
};

export const CONDITION_ICONS: Record<ConditionId, string> = {
  best: '↑↑',
  good: '↑',
  normal: '→',
  bad: '↓',
  worst: '↓↓',
};

/** コンディションによる実効能力の補正 */
export const CONDITION_MODIFIER: Record<ConditionId, number> = {
  best: 0.08,
  good: 0.04,
  normal: 0,
  bad: -0.05,
  worst: -0.1,
};

/** 疲労による実効能力の低下率（0〜1） */
export function fatiguePenalty(fatigue: number): number {
  if (fatigue < 20) return 0;
  if (fatigue < 40) return 0.02;
  if (fatigue < 60) return 0.05;
  if (fatigue < 80) return 0.1;
  return 0.2;
}

export function fatigueLabel(fatigue: number): string {
  if (fatigue < 20) return '万全';
  if (fatigue < 40) return 'やや疲労';
  if (fatigue < 60) return '疲労';
  if (fatigue < 80) return '重い疲労';
  return '極度の疲労';
}

export function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** 出場した選手の疲労を加算する */
export function addGameFatigue(
  player: Player,
  options: { plateAppearances: number; outs: number; started: boolean },
): void {
  const ext = player.ext;
  let amount = 0;
  if (options.plateAppearances > 0) {
    amount += 1.5 + options.plateAppearances * 0.9;
  }
  if (options.outs > 0) {
    // 投手は投球回に応じて大きく疲労する
    amount += options.started ? 10 + options.outs * 1.15 : 3 + options.outs * 1.6;
  }
  if (amount === 0) return;
  // 連続出場でさらに疲れる
  ext.consecutiveGames += 1;
  amount *= 1 + Math.min(0.4, ext.consecutiveGames * 0.02);
  ext.fatigue = clamp0to100(ext.fatigue + amount);
}

/**
 * 疲労の回復。毎日必ず少しずつ回復し、休んだ日はさらに大きく回復する。
 * 疲労が溜まっているほど回復量も大きくなるので、極端に振り切れない。
 */
export function recoverFatigue(player: Player, rested: boolean): void {
  const ext = player.ext;
  const personality = personalityEffects(ext.personality);
  const base = rested ? 4.5 : 2;
  const rate = rested ? 0.16 : 0.1;
  const age = player.age;
  // 年齢が高いほど回復が遅い
  const ageFactor = age <= 26 ? 1.1 : age <= 31 ? 1 : 0.85;
  const amount = (base + ext.fatigue * rate) * personality.fatigueRecovery * ageFactor;
  ext.fatigue = clamp0to100(ext.fatigue - amount);
  if (rested) ext.consecutiveGames = 0;
}

/**
 * コンディションを更新する。毎日変えると落ち着かないので、
 * 選手ごとのタイマーが切れたときだけ抽選する。
 */
export function updateCondition(rng: Rng, player: Player): boolean {
  const ext = player.ext;
  ext.conditionTimer -= 1;
  if (ext.conditionTimer > 0) return false;

  const personality = personalityEffects(ext.personality);
  // 疲労とモチベーションで期待値を動かす
  const bias =
    -fatiguePenalty(ext.fatigue) * 5 + (ext.motivation - 58) / 50 + (ext.morale - 50) / 80;
  const roll = rng.normal(bias, 1.15 * personality.conditionSwing);
  let index: number;
  if (roll > 1.35) index = 4;
  else if (roll > 0.45) index = 3;
  else if (roll > -0.45) index = 2;
  else if (roll > -1.35) index = 1;
  else index = 0;

  const next = CONDITIONS[index];
  const changed = next !== ext.condition;
  ext.condition = next;
  ext.conditionTimer = rng.int(3, 6);
  return changed;
}

/** 出場機会・成績・チーム状況からモチベーションを更新する */
export function updateMotivation(
  player: Player,
  options: { played: boolean; performed: boolean; teamWon: boolean | null; onFirstTeam: boolean },
): void {
  const ext = player.ext;
  const personality = personalityEffects(ext.personality);
  let delta = 0;

  if (options.played) {
    delta += 0.6;
    if (options.performed) delta += 1.2 * personality.successMotivation;
  } else {
    delta -= (options.onFirstTeam ? 0.55 : 0.95) * personality.benchSensitivity;
  }
  if (options.teamWon === true) delta += 0.45;
  else if (options.teamWon === false) delta -= 0.45 * personality.losingStreakSensitivity;

  // 50 に向かって戻る力（放っておくと極端に振り切れないように）
  delta += (50 - ext.motivation) * 0.1;
  ext.motivation = clamp0to100(ext.motivation + delta);
}

/** 試合内容から「調子」を更新し、必要ならスランプに入れる */
export function updateForm(
  rng: Rng,
  player: Player,
  today: string,
  performance: number,
): boolean {
  const ext = player.ext;
  ext.form = clamp0to100(ext.form + performance * 12 + (50 - ext.form) * 0.08);
  if (ext.slump) return false;
  if (ext.form < 26 && rng.chance(0.12)) {
    const personality = personalityEffects(ext.personality);
    ext.slump = {
      until: addDaysLocal(today, rng.int(5, 14)),
      severity: Math.min(0.12, 0.05 * personality.conditionSwing + rng.next() * 0.03),
    };
    return true;
  }
  return false;
}

/** スランプの解除判定 */
export function resolveSlump(player: Player, today: string): boolean {
  const ext = player.ext;
  if (!ext.slump) return false;
  if (today >= ext.slump.until || ext.form > 62) {
    ext.slump = null;
    return true;
  }
  return false;
}

function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** チーム士気の更新（勝敗と、リーダー・ムードメーカーの影響） */
export function updateTeamMorale(
  state: GameState,
  teamId: string,
  won: boolean | null,
): void {
  const current = state.teamMorale[teamId] ?? 50;
  const roster = state.players.filter((p) => p.teamId === teamId && p.roster === 'first');
  let influence = 1;
  let winBonus = 1;
  for (const p of roster) {
    const e = personalityEffects(p.ext.personality);
    influence += (e.teamMoraleInfluence - 1) * 0.25;
    winBonus += (e.winMoraleBonus - 1) * 0.25;
  }
  let delta = 0;
  if (won === true) delta = 2.4 * winBonus;
  else if (won === false) delta = -2.2;
  delta *= Math.min(1.8, influence);
  delta += (50 - current) * 0.05;
  state.teamMorale[teamId] = clamp0to100(current + delta);
}

/** チーム士気による実効能力の補正（±2%程度） */
export function teamMoraleModifier(morale: number): number {
  return ((morale - 50) / 50) * 0.02;
}
