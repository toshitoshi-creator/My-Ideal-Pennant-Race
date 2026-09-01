/**
 * 怪我（PHASE 2）。
 *
 * 疲労と連続出場で確率が上がるが、理不尽に怪我が続かないよう
 * 全体の発生率は低めに抑え、復帰直後は怪我しにくくしている。
 */
import type { InjuryLevel, InjuryState, Player } from './types';
import { Rng } from './rng';
import { addDays, diffDays } from './dates';
import { fatiguePenalty } from './condition';

export const INJURY_LABELS: Record<InjuryLevel, string> = {
  minor: '軽傷',
  moderate: '中傷',
  major: '重傷',
};

const MINOR_NAMES = ['軽い張り', '打撲', '軽度の筋疲労', '突き指'];
const MODERATE_NAMES = ['肉離れ', '腰痛', '肩の炎症', '足首の捻挫'];
const MAJOR_NAMES = ['靭帯損傷', '疲労骨折', '肘の手術', '重度の肉離れ'];

/** 怪我の離脱日数 */
function injuryDays(rng: Rng, level: InjuryLevel): number {
  switch (level) {
    case 'minor':
      return rng.int(3, 9);
    case 'moderate':
      return rng.int(14, 35);
    case 'major':
      return rng.int(60, 150);
  }
}

/** 1試合出場あたりの怪我発生確率 */
export function injuryChance(player: Player, options: { pitched: boolean }): number {
  const ext = player.ext;
  const fatigue = fatiguePenalty(ext.fatigue);
  // 基礎確率はかなり低い。疲労と連続出場で上がる
  let chance = 0.0016 + fatigue * 0.012 + ext.consecutiveGames * 0.00012;
  if (options.pitched) chance *= 1.25;
  if (player.age >= 33) chance *= 1.3;
  else if (player.age <= 22) chance *= 0.85;
  return Math.min(0.05, chance);
}

/** 怪我を発生させる（発生しなければ null） */
export function rollInjury(
  rng: Rng,
  player: Player,
  today: string,
  options: { pitched: boolean },
): InjuryState | null {
  if (player.ext.injury) return null;
  // 復帰直後は怪我しにくい猶予をもうける
  const lastReturn = player.ext.hiddenAttributes.lastInjuryReturn;
  if (typeof lastReturn === 'number' && lastReturn > 0) return null;

  if (!rng.chance(injuryChance(player, options))) return null;

  const roll = rng.next();
  const level: InjuryLevel = roll < 0.68 ? 'minor' : roll < 0.94 ? 'moderate' : 'major';
  const names = level === 'minor' ? MINOR_NAMES : level === 'moderate' ? MODERATE_NAMES : MAJOR_NAMES;
  const days = injuryDays(rng, level);
  return {
    level,
    name: rng.pick(names),
    startDate: today,
    returnDate: addDays(today, days),
  };
}

/** 復帰したら true */
export function resolveInjury(player: Player, today: string): boolean {
  const injury = player.ext.injury;
  if (!injury) return false;
  if (today < injury.returnDate) return false;
  player.ext.injury = null;
  // 復帰直後は疲労を抜き、しばらく再発しにくくする
  player.ext.fatigue = Math.min(player.ext.fatigue, 25);
  player.ext.consecutiveGames = 0;
  player.ext.hiddenAttributes.lastInjuryReturn = 10;
  return true;
}

/** 怪我明けの猶予カウンタを1日進める */
export function tickInjuryGrace(player: Player): void {
  const grace = player.ext.hiddenAttributes.lastInjuryReturn;
  if (typeof grace === 'number' && grace > 0) {
    player.ext.hiddenAttributes.lastInjuryReturn = grace - 1;
  }
}

export function isAvailable(player: Player): boolean {
  return player.ext.injury === null;
}

/** 復帰までの残り日数 */
export function daysUntilReturn(player: Player, today: string): number {
  if (!player.ext.injury) return 0;
  return Math.max(0, diffDays(player.ext.injury.returnDate, today));
}

export function injuryText(player: Player, today: string): string | null {
  const injury = player.ext.injury;
  if (!injury) return null;
  return `${INJURY_LABELS[injury.level]}：${injury.name}（あと${daysUntilReturn(player, today)}日）`;
}
