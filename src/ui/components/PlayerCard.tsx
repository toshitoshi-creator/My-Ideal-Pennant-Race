import type { Player } from '../../domain/types';
import { POSITION_SHORT } from '../../domain/positions';
import { overallRating, defenseRating } from '../../domain/rating';
import { rankOf } from '../../domain/rank';
import { RankBadge } from './common';
import { daysUntilChangeable } from '../../domain/roster';
import { CONDITION_ICONS, CONDITION_LABELS } from '../../domain/condition';
import { daysUntilReturn } from '../../domain/injury';
import { PlayerVisualSmall } from './PlayerVisual';
import { useGame } from '../store';

export function PlayerCard({
  player,
  today,
  onClick,
  showRoster = true,
  right,
}: {
  player: Player;
  today: string;
  onClick?: () => void;
  showRoster?: boolean;
  right?: React.ReactNode;
}) {
  const lock = daysUntilChangeable(player, today);
  const summary = player.isPitcher
    ? `球速${player.pitching!.velocity} 制球${rankOf(player.pitching!.control)} スタミナ${rankOf(
        player.pitching!.stamina,
      )}`
    : `ミート${rankOf(player.batting.contact)} パワー${rankOf(
        player.batting.power,
      )} 走力${rankOf(player.batting.speed)} 守備${rankOf(defenseRating(player))}`;

  return (
    <button
      className="player-card"
      // 同姓同名でも1人に絞り込めるようにしておく（E2E から使う）
      data-player-id={player.id}
      onClick={onClick}
      disabled={!onClick}
    >
      {/* PHASE 4.5: 一覧でも顔が出る。詳細と同じ顔になる（§7） */}
      <RowPortrait player={player} />
      <span className="pos">{POSITION_SHORT[player.mainPosition]}</span>
      <span className="grow">
        <span className="row" style={{ gap: 6 }}>
          <span className="name">{player.name}</span>
          <span className="meta">{player.age}歳</span>
          {showRoster &&
            (player.roster === 'first' ? (
              <span className="badge-1st">1軍</span>
            ) : (
              <span className="badge-2nd">2軍</span>
            ))}
          {lock > 0 && <span className="badge-lock">あと{lock}日</span>}
          {player.ext.injury && (
            <span className="badge-lock">
              🏥{daysUntilReturn(player, today)}日
            </span>
          )}
          <span
            style={{ fontSize: 11, fontWeight: 800, color: conditionColor(player) }}
          >
            {CONDITION_ICONS[player.ext.condition]}
            {CONDITION_LABELS[player.ext.condition]}
          </span>
        </span>
        <span className="meta">{summary}</span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        {right}
        <RankBadge value={overallRating(player)} />
      </span>
    </button>
  );
}

function conditionColor(player: Player): string {
  switch (player.ext.condition) {
    case 'best':
      return 'var(--brass)';
    case 'good':
      return 'var(--good)';
    case 'bad':
      return 'var(--accent)';
    case 'worst':
      return 'var(--bad)';
    default:
      return 'var(--text-dim)';
  }
}


/**
 * 一覧に並ぶ小さな顔（§6）。
 * 詳細画面と同じ playerId から作るので、必ず同じ人物になる。
 */
function RowPortrait({ player }: { player: Player }) {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === player.teamId);
  return (
    <PlayerVisualSmall player={player} teamColor={team?.color} className="portrait-row" />
  );
}
