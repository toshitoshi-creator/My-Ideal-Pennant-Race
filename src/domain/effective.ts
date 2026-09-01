/**
 * 実効能力（PHASE 2 / PHASE 2.5）。
 *
 * 基本能力そのものは試合ごとに書き換えず、
 * 調子・疲労・モチベーション・スランプ・チーム士気・性格から
 * 「その試合の実効能力」を計算する。
 *
 * PHASE 2.5 では調子だけ能力カテゴリごとに効き方を変える。
 * （ミート系は動きやすく、スタミナ系は動きにくい、など）
 * 他の補正は選手全体にかかるので、
 *
 *   実効能力 = 基本能力 × clamp(1 + 共通補正 + 調子補正(カテゴリ), 0.72, 1.16)
 *
 * となる。各補正を掛け続けて極端な値にならないよう、最終倍率に上限・下限を設ける。
 */
import type { BatterAbilities, ConditionId, PitcherAbilities, Player } from './types';
import {
  CONDITION_CATEGORY_MODIFIER,
  fatiguePenalty,
  teamMoraleModifier,
  type AbilityCategory,
} from './condition';
import { personalityEffects } from './personality';

/** 実効能力倍率の下限・上限 */
export const EFFECTIVE_MIN = 0.72;
export const EFFECTIVE_MAX = 1.16;

export interface EffectiveContext {
  /** 接戦（終盤かつ点差1以内） */
  closeGame?: boolean;
  /** プレッシャーの大きさ 0〜1 */
  pressure?: number;
  /** チーム士気 0〜100 */
  teamMorale?: number;
}

/** 各補正の内訳（画面表示・テスト用） */
export interface EffectiveBreakdown {
  /** 基準値（常に 1） */
  base: number;
  /** 調子による補正（カテゴリ平均の代表値） */
  conditionModifier: number;
  fatigueModifier: number;
  motivationModifier: number;
  slumpModifier: number;
  moraleModifier: number;
  personalityModifier: number;
  /** 代表値としての最終倍率（カテゴリ平均の調子補正を使ったもの） */
  finalMultiplier: number;
  /** finalMultiplier の別名（PHASE 2 からの互換） */
  total: number;
  /** conditionModifier の別名（PHASE 2 からの互換） */
  condition: number;
  fatigue: number;
  motivation: number;
  slump: number;
  morale: number;
  personality: number;
  /** カテゴリごとの最終倍率 */
  byCategory: Record<AbilityCategory, number>;
}

/** 調子によるカテゴリ別の補正量（性格の影響込み） */
export function conditionModifierFor(
  condition: ConditionId,
  category: AbilityCategory,
  personalityId: Player['ext']['personality'],
): number {
  const personality = personalityEffects(personalityId);
  const raw = CONDITION_CATEGORY_MODIFIER[condition][category];
  if (raw >= 0) return raw * personality.conditionSwing;
  // 不調・絶不調は「粘り強さ」で軽減できる（絶不調では効果を弱める）
  const resist =
    condition === 'worst'
      ? 1 + (personality.badConditionResist - 1) * 0.75
      : personality.badConditionResist;
  return raw * personality.conditionSwing * resist;
}

/** 調子以外の、選手全体にかかる補正の合計 */
function commonModifier(player: Player, ctx: EffectiveContext): {
  fatigue: number;
  motivation: number;
  slump: number;
  morale: number;
  personality: number;
} {
  const ext = player.ext;
  const personality = personalityEffects(ext.personality);

  const fatigue = -fatiguePenalty(ext.fatigue) * personality.fatigueSensitivity;
  const motivation = ((ext.motivation - 50) / 50) * 0.04;
  const slump = ext.slump ? -ext.slump.severity : 0;
  const morale =
    ctx.teamMorale === undefined
      ? 0
      : teamMoraleModifier(ctx.teamMorale) * personality.moraleSensitivity;

  let personalityBonus = 0;
  if (ctx.closeGame) personalityBonus += personality.closeGame - 1;
  if (ctx.pressure) {
    personalityBonus -= ctx.pressure * 0.06 * personality.pressureSensitivity;
  }

  return { fatigue, motivation, slump, morale, personality: personalityBonus };
}

function clampMultiplier(value: number): number {
  return Math.max(EFFECTIVE_MIN, Math.min(EFFECTIVE_MAX, value));
}

export function effectiveBreakdown(
  player: Player,
  ctx: EffectiveContext = {},
): EffectiveBreakdown {
  const common = commonModifier(player, ctx);
  const sum = common.fatigue + common.motivation + common.slump + common.morale + common.personality;

  const categories: AbilityCategory[] = [
    'contact', 'power', 'speed', 'defense',
    'pitchPower', 'pitchControl', 'pitchMovement', 'stamina',
  ];
  const byCategory = {} as Record<AbilityCategory, number>;
  let conditionTotal = 0;
  for (const category of categories) {
    const conditionModifier = conditionModifierFor(
      player.ext.condition,
      category,
      player.ext.personality,
    );
    conditionTotal += conditionModifier;
    byCategory[category] = clampMultiplier(1 + sum + conditionModifier);
  }
  const conditionAverage = conditionTotal / categories.length;

  const finalMultiplier = clampMultiplier(1 + sum + conditionAverage);
  return {
    base: 1,
    conditionModifier: conditionAverage,
    fatigueModifier: common.fatigue,
    motivationModifier: common.motivation,
    slumpModifier: common.slump,
    moraleModifier: common.morale,
    personalityModifier: common.personality,
    finalMultiplier,
    byCategory,
    // PHASE 2 からの互換のための別名
    total: finalMultiplier,
    condition: conditionAverage,
    fatigue: common.fatigue,
    motivation: common.motivation,
    slump: common.slump,
    morale: common.morale,
    personality: common.personality,
  };
}

/** カテゴリを指定した実効能力倍率 */
export function effectiveMultiplierFor(
  player: Player,
  category: AbilityCategory,
  ctx: EffectiveContext = {},
): number {
  const common = commonModifier(player, ctx);
  const sum = common.fatigue + common.motivation + common.slump + common.morale + common.personality;
  const conditionModifier = conditionModifierFor(
    player.ext.condition,
    category,
    player.ext.personality,
  );
  return clampMultiplier(1 + sum + conditionModifier);
}

/** カテゴリを指定しない代表倍率（守備や走塁など、まとめて扱う場面用） */
export function effectiveMultiplier(player: Player, ctx: EffectiveContext = {}): number {
  return effectiveBreakdown(player, ctx).finalMultiplier;
}

function scale(value: number, multiplier: number): number {
  return Math.max(1, Math.min(110, value * multiplier));
}

/** 打者の実効能力 */
export function effectiveBatting(player: Player, ctx: EffectiveContext = {}): BatterAbilities {
  const b = player.batting;
  const contact = effectiveMultiplierFor(player, 'contact', ctx);
  const power = effectiveMultiplierFor(player, 'power', ctx);
  const speed = effectiveMultiplierFor(player, 'speed', ctx);
  const defense = effectiveMultiplierFor(player, 'defense', ctx);
  return {
    // 弾道は打球の性質であり、調子では変わらない
    trajectory: b.trajectory,
    contact: scale(b.contact, contact),
    power: scale(b.power, power),
    speed: scale(b.speed, speed),
    arm: scale(b.arm, defense),
    fielding: scale(b.fielding, defense),
    catching: scale(b.catching, defense),
  };
}

/** 投手の実効能力 */
export function effectivePitching(
  player: Player,
  ctx: EffectiveContext = {},
): PitcherAbilities | null {
  if (!player.pitching) return null;
  const p = player.pitching;
  const pitchPower = effectiveMultiplierFor(player, 'pitchPower', ctx);
  const control = effectiveMultiplierFor(player, 'pitchControl', ctx);
  const movement = effectiveMultiplierFor(player, 'pitchMovement', ctx);
  const stamina = effectiveMultiplierFor(player, 'stamina', ctx);
  return {
    // 球速は km/h なので変化幅を小さくする
    velocity: Math.round(p.velocity * (1 + (pitchPower - 1) * 0.35)),
    control: scale(p.control, control),
    stamina: scale(p.stamina, stamina),
    power: scale(p.power, pitchPower),
    movement: scale(p.movement, movement),
  };
}

/** 守備の実効能力倍率（守備位置ペナルティとは別に掛ける） */
export function effectiveDefenseMultiplier(player: Player, ctx: EffectiveContext = {}): number {
  return effectiveMultiplierFor(player, 'defense', ctx);
}

/** 走塁・盗塁の実効能力倍率 */
export function effectiveSpeedMultiplier(player: Player, ctx: EffectiveContext = {}): number {
  return effectiveMultiplierFor(player, 'speed', ctx);
}
