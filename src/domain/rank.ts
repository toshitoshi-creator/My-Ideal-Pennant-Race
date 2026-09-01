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

export const RANK_COLORS: Record<AbilityRank, string> = {
  A: '#ff4d6d',
  B: '#ff9f43',
  C: '#ffd93d',
  D: '#4dd07a',
  E: '#4db4ff',
  F: '#9aa4b2',
  G: '#6b7280',
};

/** 球速 km/h を 1〜100 のスケールに変換（125km/h=1, 165km/h=100 あたり） */
export function velocityToScale(kmh: number): number {
  return clamp1to100(((kmh - 122) / 43) * 100);
}

export function clamp1to100(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}
