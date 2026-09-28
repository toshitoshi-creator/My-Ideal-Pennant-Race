/**
 * 投手の適性（先発・中継ぎ・抑え）の表示。
 * どの画面でも同じ書き方にそろえる：
 *   一覧 … 「先◎ 中○ 抑△」（いちばん向いている役割を強調）
 *   守備位置の表記 … 「投手（先発）」
 */
import type { Player } from '../../domain/types';
import { POSITION_LABELS, POSITION_SHORT } from '../../domain/positions';
import {
  ROLE_BADGE,
  ROLE_LABEL,
  ROLE_ORDER,
  ROLE_SHORT,
  pitcherAptitude,
  type PitcherRoleKey,
} from '../../domain/pitcherAptitude';

/** 守備位置の表記。投手は向いている役割を添える */
export function positionText(player: Pick<Player, 'isPitcher' | 'pitching' | 'mainPosition'>): string {
  const apt = pitcherAptitude(player);
  return apt ? `投手（${ROLE_LABEL[apt.best]}）` : POSITION_LABELS[player.mainPosition];
}

/** 短い守備位置。投手は「先発」「中継」「抑え」（1文字の「中」は中堅と紛らわしい） */
export function positionShort(player: Pick<Player, 'isPitcher' | 'pitching' | 'mainPosition'>): string {
  const apt = pitcherAptitude(player);
  return apt ? ROLE_BADGE[apt.best] : POSITION_SHORT[player.mainPosition];
}

export const ROLE_COLOR: Record<PitcherRoleKey, string> = {
  starter: 'oklch(84% 0.08 245)',
  relief: 'oklch(86% 0.08 150)',
  closer: 'oklch(82% 0.1 25)',
};

/** 「先◎ 中○ 抑△」。いちばん向いている役割に色を付ける */
export function RoleGrades({ player }: { player: Pick<Player, 'isPitcher' | 'pitching'> }) {
  const apt = pitcherAptitude(player);
  if (!apt) return null;
  return (
    <span
      className="role-grades"
      aria-label={`適性 ${ROLE_ORDER.map((r) => `${ROLE_LABEL[r]}${apt.grades[r]}`).join(' ')}`}
    >
      {ROLE_ORDER.map((r) => (
        <span
          key={r}
          className={`rg${r === apt.best ? ' best' : ''} g-${gradeClass(apt.grades[r])}`}
          style={r === apt.best ? { background: ROLE_COLOR[r] } : undefined}
        >
          {ROLE_SHORT[r]}
          <b>{apt.grades[r]}</b>
        </span>
      ))}
    </span>
  );
}

/** 選手詳細の「投手適性」。3つの役割を並べ、向いている役割を強調する */
export function RoleAptitudePanel({ player }: { player: Player }) {
  const apt = pitcherAptitude(player);
  if (!apt) return null;
  return (
    <div className="role-panel">
      <div className="role-panel-head">
        <span className="label">PITCHER ROLE</span>
        <span>投手適性</span>
        <strong style={{ background: ROLE_COLOR[apt.best] }}>{ROLE_LABEL[apt.best]}向き</strong>
      </div>
      <div className="role-panel-cells">
        {ROLE_ORDER.map((r) => (
          <div key={r} className={`role-cell${r === apt.best ? ' best' : ''}`}>
            <span className="role-cell-name">{ROLE_LABEL[r]}</span>
            <span className={`role-cell-grade g-${gradeClass(apt.grades[r])}`}>{apt.grades[r]}</span>
            <span className="role-cell-note">{ROLE_NOTE[r]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ROLE_NOTE: Record<PitcherRoleKey, string> = {
  starter: 'スタミナ・制球',
  relief: '総合力・制球',
  closer: '球速・球威',
};

function gradeClass(grade: string): string {
  return grade === '◎' ? 'a' : grade === '○' ? 'b' : grade === '△' ? 'c' : 'd';
}
