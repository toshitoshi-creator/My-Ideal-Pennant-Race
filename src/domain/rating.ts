import type { Player, PositionId, LineupSlot } from './types';
import { velocityToScale, clamp1to100, rankOf } from './rank';
import { effectiveDefense } from './positions';

/**
 * 打撃力（ミート・パワー・弾道） 1〜100。
 * 画面表示とオーダー自動編成のための指標であり、試合計算には使わない。
 * 弾道は長打への寄与ぶんだけを小さく反映する。
 */
export function battingRating(player: Player): number {
  const b = player.batting;
  return clamp1to100(b.contact * 0.44 + b.power * 0.42 + b.trajectory * 0.14);
}

/** 守備力（守備・捕球・肩） 1〜100 */
export function defenseRating(player: Player): number {
  const b = player.batting;
  return clamp1to100(b.fielding * 0.5 + b.catching * 0.3 + b.arm * 0.2);
}

/** 投手力（球速・制球・スタミナ・球威・変化量） 1〜100 */
export function pitchingRating(player: Player): number {
  const p = player.pitching;
  if (!p) return 1;
  return clamp1to100(
    velocityToScale(p.velocity) * 0.24 +
      p.control * 0.26 +
      p.stamina * 0.14 +
      p.power * 0.22 +
      p.movement * 0.14,
  );
}

/** 選手の総合評価 1〜100 */
export function overallRating(player: Player): number {
  if (player.isPitcher) return pitchingRating(player);
  const b = player.batting;
  return clamp1to100(
    b.contact * 0.28 +
      b.power * 0.24 +
      b.trajectory * 0.06 +
      b.speed * 0.12 +
      b.fielding * 0.14 +
      b.catching * 0.08 +
      b.arm * 0.08,
  );
}

export function overallRank(player: Player) {
  return rankOf(overallRating(player));
}

export interface TeamPower {
  batting: number;
  defense: number;
  pitching: number;
  total: number;
}

/**
 * 球団総合力。
 * スタメン（打順）の打撃力・守備力と、ローテーション投手の投手力から算出する。
 */
export function teamPower(
  lineup: LineupSlot[],
  rotationPitchers: Player[],
  byId: Map<string, Player>,
): TeamPower {
  const starters = lineup
    .map((slot) => ({ player: byId.get(slot.playerId), position: slot.position }))
    .filter((s): s is { player: Player; position: PositionId | 'DH' } => !!s.player);

  const batters = starters.filter((s) => !(s.player.isPitcher && s.position === 'P'));
  const batting = batters.length
    ? batters.reduce((sum, s) => sum + battingRating(s.player), 0) / batters.length
    : 1;

  const fielders = starters.filter((s) => s.position !== 'DH' && s.position !== 'P');
  const defense = fielders.length
    ? fielders.reduce(
        (sum, s) => sum + effectiveDefense(s.player, s.position as PositionId),
        0,
      ) / fielders.length
    : 1;

  const pitching = rotationPitchers.length
    ? rotationPitchers.reduce((sum, p) => sum + pitchingRating(p), 0) / rotationPitchers.length
    : 1;

  return {
    batting: clamp1to100(batting),
    defense: clamp1to100(defense),
    pitching: clamp1to100(pitching),
    total: clamp1to100(batting * 0.4 + pitching * 0.42 + defense * 0.18),
  };
}
