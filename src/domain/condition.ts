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

/**
 * 能力カテゴリ（PHASE 2.5）。
 * 調子は「全能力を一律○倍」ではなく、カテゴリごとに違う量で効く。
 */
export type AbilityCategory =
  | 'contact'
  | 'power'
  | 'speed'
  | 'defense'
  | 'pitchPower'
  | 'pitchControl'
  | 'pitchMovement'
  | 'stamina';

export const ABILITY_CATEGORY_LABELS: Record<AbilityCategory, string> = {
  contact: 'ミート系',
  power: 'パワー系',
  speed: '走力系',
  defense: '守備系',
  pitchPower: '球威系',
  pitchControl: '制球系',
  pitchMovement: '変化球系',
  stamina: 'スタミナ系',
};

export const ABILITY_CATEGORIES: AbilityCategory[] = [
  'contact', 'power', 'speed', 'defense',
  'pitchPower', 'pitchControl', 'pitchMovement', 'stamina',
];

/**
 * 調子による実効能力の補正（カテゴリ別）。
 * 絶好調でもミート系 +6% が上限で、全能力が同じだけ上がることはない。
 */
export const CONDITION_CATEGORY_MODIFIER: Record<
  ConditionId,
  Record<AbilityCategory, number>
> = {
  best: {
    contact: 0.06, power: 0.05, speed: 0.04, defense: 0.04,
    pitchPower: 0.05, pitchControl: 0.04, pitchMovement: 0.04, stamina: 0.03,
  },
  good: {
    contact: 0.03, power: 0.02, speed: 0.02, defense: 0.02,
    pitchPower: 0.03, pitchControl: 0.02, pitchMovement: 0.02, stamina: 0.01,
  },
  normal: {
    contact: 0, power: 0, speed: 0, defense: 0,
    pitchPower: 0, pitchControl: 0, pitchMovement: 0, stamina: 0,
  },
  bad: {
    contact: -0.03, power: -0.02, speed: -0.02, defense: -0.02,
    pitchPower: -0.03, pitchControl: -0.02, pitchMovement: -0.02, stamina: -0.01,
  },
  worst: {
    contact: -0.06, power: -0.05, speed: -0.04, defense: -0.04,
    pitchPower: -0.05, pitchControl: -0.04, pitchMovement: -0.04, stamina: -0.03,
  },
};

/** 表示・要約用の代表値（カテゴリ平均）。実効能力の計算にはカテゴリ別の値を使う */
export const CONDITION_MODIFIER: Record<ConditionId, number> = {
  best: average(CONDITION_CATEGORY_MODIFIER.best),
  good: average(CONDITION_CATEGORY_MODIFIER.good),
  normal: 0,
  bad: average(CONDITION_CATEGORY_MODIFIER.bad),
  worst: average(CONDITION_CATEGORY_MODIFIER.worst),
};

function average(values: Record<AbilityCategory, number>): number {
  const list = ABILITY_CATEGORIES.map((c) => values[c]);
  return list.reduce((a, b) => a + b, 0) / list.length;
}

/**
 * 調子による特殊能力の発動しやすさ（PHASE 2.5）。
 * 能力値には触れず、イベント係数の «1 からのズレ» を拡大・縮小する。
 * 好調なら長所がより出て短所が出にくく、不調ならその逆になる。
 */
export const CONDITION_EVENT_SCALE: Record<ConditionId, number> = {
  best: 1.12,
  good: 1.06,
  normal: 1,
  bad: 0.94,
  worst: 0.88,
};

export function conditionEventScale(condition: ConditionId): number {
  return CONDITION_EVENT_SCALE[condition] ?? 1;
}

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

/** 調子の出やすさ（この分布に近づくように遷移する） */
const CONDITION_PREFERENCE: Record<ConditionId, number> = {
  worst: 0.191,
  bad: 0.222,
  normal: 0.264,
  good: 0.187,
  best: 0.135,
};

/** 現在の状態からの距離による遷移のしやすさ（1段階ずつ動く） */
const TRANSITION_BY_DISTANCE = [0.7, 0.13, 0.02, 0.004, 0.001];

/** 調子を変えずに保つ最低日数 */
const CONDITION_MIN_HOLD = 1;

/**
 * 調子の変化しやすさを決めるバイアス。
 * プラスなら好調へ、マイナスなら不調へ寄る。
 * 疲労が高いと好調になりにくいが、「疲労が高い＝必ず不調」にはしない。
 */
export function conditionBias(player: Player): number {
  const ext = player.ext;
  return (
    -fatiguePenalty(ext.fatigue) * 5 +
    (ext.motivation - 51) / 50 +
    (ext.morale - 50) / 80
  );
}

/**
 * 調子を1日分更新する（PHASE 2.5）。
 * 隣接する段階へ移りやすく、いきなり絶不調から絶好調へは飛びにくい。
 * 乱数は呼び出し側から渡すので、シードを固定すれば結果は再現できる。
 */
export function updateCondition(rng: Rng, player: Player): boolean {
  const ext = player.ext;
  recordConditionHistory(player);

  if (ext.conditionTimer > 0) {
    ext.conditionTimer -= 1;
    return false;
  }

  const personality = personalityEffects(ext.personality);
  const bias = conditionBias(player);
  const currentIndex = Math.max(0, CONDITIONS.indexOf(ext.condition));

  const weights = CONDITIONS.map((candidate, index) => {
    const distance = Math.abs(index - currentIndex);
    // 繊細な選手ほど大きく動き、マイペース・冷静な選手ほど動かない
    const mobility = distance === 0 ? 1 / personality.conditionSwing : personality.conditionSwing;
    const preference = CONDITION_PREFERENCE[candidate];
    const attraction = Math.exp(bias * (index - 2) * 0.6);
    return TRANSITION_BY_DISTANCE[Math.min(distance, 4)] * mobility * preference * attraction;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  let nextIndex = currentIndex;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      nextIndex = i;
      break;
    }
  }

  const next = CONDITIONS[nextIndex];
  const changed = next !== ext.condition;
  ext.condition = next;
  if (changed) ext.conditionTimer = CONDITION_MIN_HOLD;
  return changed;
}

/** 直近の調子を最大7日分だけ残す */
export const CONDITION_HISTORY_LENGTH = 7;

export function recordConditionHistory(player: Player): void {
  const ext = player.ext;
  if (!Array.isArray(ext.conditionHistory)) ext.conditionHistory = [];
  ext.conditionHistory.push(ext.condition);
  if (ext.conditionHistory.length > CONDITION_HISTORY_LENGTH) {
    ext.conditionHistory.splice(0, ext.conditionHistory.length - CONDITION_HISTORY_LENGTH);
  }
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
