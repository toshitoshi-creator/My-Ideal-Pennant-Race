import type { PositionId, Player } from './types';

export const POSITIONS: PositionId[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** 守備につく 8 ポジション（投手を除く） */
export const FIELD_POSITIONS: PositionId[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export const POSITION_LABELS: Record<PositionId, string> = {
  P: '投手',
  C: '捕手',
  '1B': '一塁',
  '2B': '二塁',
  '3B': '三塁',
  SS: '遊撃',
  LF: '左翼',
  CF: '中堅',
  RF: '右翼',
};

export const POSITION_SHORT: Record<PositionId, string> = {
  P: '投',
  C: '捕',
  '1B': '一',
  '2B': '二',
  '3B': '三',
  SS: '遊',
  LF: '左',
  CF: '中',
  RF: '右',
};

export type PositionGroup = 'P' | 'C' | 'IF' | 'OF';

export function positionGroup(pos: PositionId): PositionGroup {
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  return pos === 'LF' || pos === 'CF' || pos === 'RF' ? 'OF' : 'IF';
}

/** 守備難易度（大きいほど難しい） */
const DIFFICULTY: Record<PositionId, number> = {
  P: 9,
  C: 9,
  SS: 8,
  CF: 7,
  '2B': 6,
  '3B': 5,
  RF: 4,
  LF: 3,
  '1B': 1,
};

export function positionDifficulty(pos: PositionId): number {
  return DIFFICULTY[pos];
}

/**
 * 本職と異なる守備位置で起用したときのペナルティ係数（0〜0.6）。
 * 0 ならペナルティなし。守備力・捕球・肩に (1 - penalty) を掛け、
 * さらにエラー率が増える。
 *
 * 例）本職遊撃手を二塁 → 軽いペナルティ
 * 　　本職捕手を遊撃　 → 大きなペナルティ
 */
export function positionPenalty(player: Player, assigned: PositionId): number {
  if (assigned === player.mainPosition) return 0;
  if (player.subPositions.includes(assigned)) return 0.05;

  const from = positionGroup(player.mainPosition);
  const to = positionGroup(assigned);

  let base: number;
  if (from === 'P') base = 0.6;
  else if (to === 'C') base = 0.55;
  else if (from === 'C') base = 0.4;
  else if (from === to) base = 0.1;
  else base = 0.3; // 内野 <-> 外野

  // 一塁と左翼は誰でもある程度こなせるので負担を半分にする
  if ((assigned === '1B' || assigned === 'LF') && from !== 'P') base *= 0.5;

  const gap = Math.max(0, DIFFICULTY[assigned] - DIFFICULTY[player.mainPosition]);
  return Math.min(0.6, base + gap * 0.04);
}

/** ペナルティ込みの守備力（守備・捕球・肩の総合、1〜100） */
export function effectiveDefense(player: Player, assigned: PositionId): number {
  const b = player.batting;
  const raw = b.fielding * 0.5 + b.catching * 0.3 + b.arm * 0.2;
  return raw * (1 - positionPenalty(player, assigned));
}

/** 守備適性ラベル */
export function aptitudeLabel(player: Player, assigned: PositionId): '本職' | '適性' | '可' | '苦手' | '不慣れ' {
  const p = positionPenalty(player, assigned);
  if (p === 0) return '本職';
  if (p <= 0.05) return '適性';
  if (p <= 0.15) return '可';
  if (p <= 0.35) return '苦手';
  return '不慣れ';
}
