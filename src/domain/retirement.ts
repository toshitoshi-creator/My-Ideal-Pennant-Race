/**
 * 引退（PHASE 3.1）。
 *
 * 年齢を最重要要素とした確率判定で、同じ年齢でも能力・出場状況・怪我によって
 * 少しだけ引退しやすさが変わる。「一定年齢で全員引退」にはしない。
 */
import type { Player, PlayerSeasonStats } from './types';
import { Rng } from './rng';
import { overallRating } from './rating';

/** 年齢別の基礎引退確率 */
const BASE_RETIREMENT_RATE: Array<[number, number]> = [
  [25, 0],
  [28, 0.002],
  [30, 0.005],
  [32, 0.012],
  [33, 0.03],
  [34, 0.06],
  [35, 0.12],
  [36, 0.22],
  [37, 0.35],
  [38, 0.5],
  [39, 0.65],
  [40, 0.8],
];

/** その年齢の基礎引退確率 */
export function baseRetirementRate(age: number): number {
  for (const [limit, rate] of BASE_RETIREMENT_RATE) {
    if (age <= limit) return rate;
  }
  return 0.95;
}

export interface RetirementContext {
  /** 今季の出場度合い 0〜1（少ないほど引退しやすい） */
  playingTime: number;
  /** 長期離脱中か */
  seriouslyInjured: boolean;
}

/**
 * 引退確率。年齢が最重要で、能力・出場機会・怪我は補正にとどめる。
 * 能力が高ければ 40 代でも必ず残る、という形にはしない。
 */
export function retirementChance(player: Player, ctx: RetirementContext): number {
  const base = baseRetirementRate(player.age);
  if (base <= 0) return 0;

  // 能力補正：高能力はやや残り、低能力はやや辞めやすい（±35% まで）
  const overall = overallRating(player);
  const abilityFactor = Math.max(0.65, Math.min(1.35, 1 - (overall - 42) / 60));

  // 出場機会が少ないベテランは引退しやすい
  const playingFactor = 1 + (1 - Math.max(0, Math.min(1, ctx.playingTime))) * 0.35;

  // 長期離脱は少しだけ後押しする（怪我だけで即引退にはしない）
  const injuryFactor = ctx.seriouslyInjured ? 1.25 : 1;

  return Math.max(0, Math.min(0.98, base * abilityFactor * playingFactor * injuryFactor));
}

/** 今季の出場度合いを 0〜1 で求める */
export function playingTimeOf(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  seasonLength: number,
): number {
  if (!stats || seasonLength <= 0) return 0;
  if (player.isPitcher) {
    return Math.min(1, stats.pitching.outs / 3 / (seasonLength * 0.45));
  }
  return Math.min(1, stats.batting.plateAppearances / (seasonLength * 2.8));
}

export function rollRetirement(rng: Rng, player: Player, ctx: RetirementContext): boolean {
  return rng.chance(retirementChance(player, ctx));
}
