import type { Player } from '../../domain/types';
import { overallRating, defenseRating } from '../../domain/rating';
import { velocityToScale } from '../../domain/rank';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import { AbilityChip, StatChip, avgTone, eraTone } from './StatTone';
import { RankBadge, PositionBadge } from './common';
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
  view = 'ability',
}: {
  player: Player;
  today: string;
  onClick?: () => void;
  showRoster?: boolean;
  right?: React.ReactNode;
  /** 2行目に能力を出すか、今季成績を出すか */
  view?: 'ability' | 'stats';
}) {
  const lock = daysUntilChangeable(player, today);
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
      <PositionBadge player={player} />
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
        <span className="meta pc-chips">
          {view === 'stats' ? <StatsSummary player={player} /> : <AbilitySummary player={player} />}
        </span>
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

/** 能力の要約。ランクの文字を色付きの札で出す */
function AbilitySummary({ player }: { player: Player }) {
  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    return (
      <>
        <AbilityChip label="球速" value={velocityToScale(p.velocity)} display={`${p.velocity}`} />
        <AbilityChip label="制球" value={p.control} />
        <AbilityChip label="スタミナ" value={p.stamina} />
        <AbilityChip label="球威" value={p.power} />
      </>
    );
  }
  const b = player.batting;
  return (
    <>
      <AbilityChip label="ミート" value={b.contact} />
      <AbilityChip label="パワー" value={b.power} />
      <AbilityChip label="走力" value={b.speed} />
      <AbilityChip label="守備" value={defenseRating(player)} />
    </>
  );
}

/** 今季成績の要約。野手は打率、投手は防御率を先頭に */
function StatsSummary({ player }: { player: Player }) {
  const { state } = useGame();
  const stats = state.stats[player.id];
  if (!stats) return <span className="muted">成績なし</span>;
  if (player.isPitcher) {
    const q = stats.pitching;
    return (
      <>
        <StatChip label="防御率" value={formatEra(q)} tone={eraTone(q)} />
        <StatChip label="勝敗" value={`${q.wins}-${q.losses}`} />
        <StatChip label="回" value={formatInnings(q.outs)} />
        {q.saves > 0 && <StatChip label="S" value={q.saves} />}
      </>
    );
  }
  const b = stats.batting;
  return (
    <>
      <StatChip label="打率" value={formatAverage(average(b))} tone={avgTone(b)} />
      <StatChip label="本" value={b.homeRuns} />
      <StatChip label="点" value={b.rbi} />
      <StatChip label="打数" value={b.atBats} />
    </>
  );
}
