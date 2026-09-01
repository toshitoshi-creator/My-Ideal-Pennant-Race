/**
 * 弾道（1〜100）。
 *
 * 弾道は他の能力値と同じ 1〜100・G〜A ランクで扱うが、
 * 意味が異なるため試合計算では他能力と同じ割合で足し込まない。
 * MatchEngine（simulation.ts）は、ここで定義した**独立した係数**を通してのみ弾道を参照する。
 */

/** 旧仕様（1〜4の4段階）の弾道を 1〜100 に変換する */
export const LEGACY_TRAJECTORY_MAP: Record<number, number> = {
  1: 25,
  2: 50,
  3: 75,
  4: 100,
};

/** 旧セーブデータかどうかの判定に使う上限値 */
export const LEGACY_TRAJECTORY_MAX = 4;

export function migrateLegacyTrajectory(value: number): number {
  return LEGACY_TRAJECTORY_MAP[value] ?? Math.max(1, Math.min(100, Math.round(value)));
}

/**
 * 本塁打・長打の発生率にかける係数。
 * 弾道25 → 0.55 / 50 → 0.85 / 75 → 1.15 / 100 → 1.45
 */
export function homeRunFactor(trajectory: number): number {
  return clamp(0.25 + trajectory * 0.012, 0.25, 1.5);
}

/**
 * 長打（二塁打）の出やすさにかける係数。弾道50を基準(1.0)とし、
 * 本塁打ほど大きくは動かさない。
 */
export function extraBaseFactor(trajectory: number): number {
  return clamp(1 + (trajectory - 50) * 0.005, 0.75, 1.3);
}

/**
 * 打球のゴロ率。弾道が高いほどフライが増える。
 * 弾道25 → 0.65 / 50 → 0.56 / 100 → 0.38
 */
export function groundBallRate(trajectory: number): number {
  return clamp(0.56 - (trajectory - 50) * 0.0036, 0.28, 0.72);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
