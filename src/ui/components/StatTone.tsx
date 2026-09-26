/**
 * 能力と成績の「色分け」表示（表示専用。計算には使わない）。
 *
 * 能力は既存のランク（A〜G）と同じ色、成績（打率・防御率）も
 * 同じ A〜G の段階に当てはめて色を付ける。色だけに頼らないよう、
 * 必ずランクの文字か数値そのものを並べて出す。
 */
import type { ReactNode } from 'react';
import type { AbilityRank, BattingStats, PitchingStats } from '../../domain/types';
import { RANK_COLORS, rankOf } from '../../domain/rank';
import { average, era } from '../../domain/stats';

/** 打率の段階。打数が少ないうちは色を付けない */
export function avgTone(stats: BattingStats): AbilityRank | null {
  if (stats.atBats < 10) return null;
  const v = average(stats);
  if (v >= 0.32) return 'A';
  if (v >= 0.3) return 'B';
  if (v >= 0.28) return 'C';
  if (v >= 0.26) return 'D';
  if (v >= 0.24) return 'E';
  if (v >= 0.22) return 'F';
  return 'G';
}

/** 防御率の段階。投球回が少ないうちは色を付けない */
export function eraTone(stats: PitchingStats): AbilityRank | null {
  if (stats.outs < 9) return null;
  const v = era(stats);
  if (v <= 1.5) return 'A';
  if (v <= 2.5) return 'B';
  if (v <= 3.2) return 'C';
  if (v <= 3.8) return 'D';
  if (v <= 4.5) return 'E';
  if (v <= 5.5) return 'F';
  return 'G';
}

/** 大きな数字1つ（選手詳細の今季成績の先頭） */
export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: AbilityRank | null;
}) {
  return (
    <div className="stat-tile" style={tone ? { borderTopColor: RANK_COLORS[tone] } : undefined}>
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value" style={tone ? { color: RANK_COLORS[tone] } : undefined}>
        {value}
      </span>
    </div>
  );
}

/** 能力名 + ランク文字（色付き）の小さな札。一覧の1行に並べる */
export function AbilityChip({ label, value, display }: { label: string; value: number; display?: string }) {
  const rank = rankOf(value);
  return (
    <span className="ab-chip">
      <span className="ab-name">{label}</span>
      <span className="ab-rank" style={{ background: RANK_COLORS[rank] }}>
        {display ?? rank}
      </span>
    </span>
  );
}

/** 成績の札。段階があれば色を付ける */
export function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: AbilityRank | null;
}) {
  return (
    <span className="ab-chip">
      <span className="ab-name">{label}</span>
      <span
        className={`st-val${tone ? ' toned' : ''}`}
        style={tone ? { background: RANK_COLORS[tone] } : undefined}
      >
        {value}
      </span>
    </span>
  );
}
