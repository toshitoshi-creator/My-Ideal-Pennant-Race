import type { Player } from '../../domain/types';
import { POSITION_SHORT } from '../../domain/positions';
import { overallRating, battingRating, pitchingRating, defenseRating } from '../../domain/rating';
import { rankOf, velocityToScale } from '../../domain/rank';
import { RankBadge } from './common';
import { daysUntilChangeable } from '../../domain/roster';

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
    <button className="player-card" onClick={onClick} disabled={!onClick}>
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

export function playerMainRatings(player: Player): Array<[string, number]> {
  if (player.isPitcher && player.pitching) {
    return [
      ['球速', velocityToScale(player.pitching.velocity)],
      ['制球', player.pitching.control],
      ['スタミナ', player.pitching.stamina],
    ];
  }
  return [
    ['ミート', player.batting.contact],
    ['パワー', player.batting.power],
    ['守備', defenseRating(player)],
  ];
}

export function playerSummaryRating(player: Player): number {
  return player.isPitcher ? pitchingRating(player) : battingRating(player);
}
