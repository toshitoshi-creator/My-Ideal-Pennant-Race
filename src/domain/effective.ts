/**
 * 実効能力（PHASE 2）。
 *
 * 基本能力そのものは試合ごとに書き換えず、
 * 性格・疲労・コンディション・モチベーション・スランプから
 * 「その試合の実効能力」を計算する。
 *
 * 各補正を単純に掛け続けると極端になるため、最終的な倍率に上限・下限を設ける。
 */
import type { BatterAbilities, PitcherAbilities, Player } from './types';
import {
  CONDITION_MODIFIER,
  fatiguePenalty,
  teamMoraleModifier,
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
  fatigue: number;
  condition: number;
  motivation: number;
  slump: number;
  personality: number;
  morale: number;
  total: number;
}

export function effectiveBreakdown(
  player: Player,
  ctx: EffectiveContext = {},
): EffectiveBreakdown {
  const ext = player.ext;
  const personality = personalityEffects(ext.personality);

  const fatigue = -fatiguePenalty(ext.fatigue) * personality.fatigueSensitivity;
  const condition = CONDITION_MODIFIER[ext.condition] * personality.conditionSwing;
  const motivation = ((ext.motivation - 50) / 50) * 0.04;
  const slump = ext.slump ? -ext.slump.severity : 0;
  const morale = ctx.teamMorale === undefined ? 0 : teamMoraleModifier(ctx.teamMorale);

  let personalityBonus = 0;
  if (ctx.closeGame) personalityBonus += personality.closeGame - 1;
  if (ctx.pressure) {
    personalityBonus -= ctx.pressure * 0.06 * personality.pressureSensitivity;
  }

  const total = Math.max(
    EFFECTIVE_MIN,
    Math.min(
      EFFECTIVE_MAX,
      1 + fatigue + condition + motivation + slump + morale + personalityBonus,
    ),
  );

  return { fatigue, condition, motivation, slump, personality: personalityBonus, morale, total };
}

export function effectiveMultiplier(player: Player, ctx: EffectiveContext = {}): number {
  return effectiveBreakdown(player, ctx).total;
}

function scale(value: number, multiplier: number): number {
  return Math.max(1, Math.min(110, value * multiplier));
}

/** 打者の実効能力 */
export function effectiveBatting(player: Player, ctx: EffectiveContext = {}): BatterAbilities {
  const m = effectiveMultiplier(player, ctx);
  const b = player.batting;
  return {
    trajectory: b.trajectory,
    contact: scale(b.contact, m),
    power: scale(b.power, m),
    speed: scale(b.speed, m),
    arm: scale(b.arm, m),
    fielding: scale(b.fielding, m),
    catching: scale(b.catching, m),
  };
}

/** 投手の実効能力 */
export function effectivePitching(
  player: Player,
  ctx: EffectiveContext = {},
): PitcherAbilities | null {
  if (!player.pitching) return null;
  const m = effectiveMultiplier(player, ctx);
  const p = player.pitching;
  return {
    // 球速は km/h なので変化幅を小さくする
    velocity: Math.round(p.velocity * (1 + (m - 1) * 0.35)),
    control: scale(p.control, m),
    stamina: scale(p.stamina, m),
    power: scale(p.power, m),
    movement: scale(p.movement, m),
  };
}

/** 守備の実効能力倍率（守備位置ペナルティとは別に掛ける） */
export function effectiveDefenseMultiplier(player: Player, ctx: EffectiveContext = {}): number {
  return effectiveMultiplier(player, ctx);
}
