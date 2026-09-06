import type { AbilityRank } from './types';

/**
 * 能力値（1〜100）→ ランク
 * 1〜19:G / 20〜29:F / 30〜39:E / 40〜49:D / 50〜59:C / 60〜69:B / 70〜100:A
 */
export function rankOf(value: number): AbilityRank {
  const v = Math.max(1, Math.min(100, Math.round(value)));
  if (v >= 70) return 'A';
  if (v >= 60) return 'B';
  if (v >= 50) return 'C';
  if (v >= 40) return 'D';
  if (v >= 30) return 'E';
  if (v >= 20) return 'F';
  return 'G';
}

/**
 * ランクの色（表示専用。計算には一切使わない）。
 * 紙にインクで刷った等級表として読めるよう、明るい web カラーではなく
 * 紙の上で沈む濃さにそろえてある。
 * 色だけで等級を伝えないよう、UI では必ずランクの文字も並べて出す。
 */
export const RANK_COLORS: Record<AbilityRank, string> = {
  A: 'oklch(43.5% 0.148 26)',
  B: 'oklch(50% 0.115 52)',
  C: 'oklch(52% 0.105 78)',
  D: 'oklch(46% 0.085 148)',
  E: 'oklch(50% 0.060 240)',
  F: 'oklch(60% 0.020 265)',
  G: 'oklch(70% 0.008 265)',
};

/** 球速 km/h を 1〜100 のスケールに変換（125km/h=1, 165km/h=100 あたり） */
export function velocityToScale(kmh: number): number {
  return clamp1to100(((kmh - 122) / 43) * 100);
}

export function clamp1to100(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}
