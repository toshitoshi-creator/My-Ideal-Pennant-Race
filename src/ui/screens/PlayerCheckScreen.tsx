/**
 * 選手チェック（PHASE 4.9-A）。
 *
 * 「最近調子悪い選手いないかな」と思ったときに、不調・打撃不振・投手不振の
 * 選手をまとめて見つけるための画面。ここでは何も判断しない
 * （「この選手を落とすべき」のような推薦文は出さない。§26）。
 * 事実（不調・打率・防御率）を並べるだけで、決めるのはGM＝プレイヤー。
 *
 * 選手名をタップすれば PlayerDetail が開き、そこから1軍/2軍を入れ替えられる。
 */
import { useMemo, useState } from 'react';
import { Sec } from '../components/Sec';
import { Tabs } from '../components/common';
import { PlayerLink } from '../components/PlayerLink';
import { ScreenBackground } from '../components/ScreenBackground';
import { useGame } from '../store';
import type { Player } from '../../domain/types';
import { checkTeamPlayers, type PlayerCheckStatus } from '../../domain/playerEvaluation';
import { CONDITION_LABELS, fatigueLabel } from '../../domain/condition';
import { POSITION_LABELS } from '../../domain/positions';
import { formatAverage, formatInnings } from '../../domain/stats';
import playerCheckBg from '../../assets/backgrounds/bg-player-check.webp';

type CheckFilter = 'all' | 'condition' | 'batting' | 'pitching';
type RosterFilter = 'all' | 'first' | 'second';

const CHECK_TABS: Array<{ id: CheckFilter; label: string }> = [
  { id: 'all', label: '全員' },
  { id: 'condition', label: '不調' },
  { id: 'batting', label: '打撃不振' },
  { id: 'pitching', label: '投手不振' },
];

const ROSTER_TABS: Array<{ id: RosterFilter; label: string }> = [
  { id: 'all', label: '全員' },
  { id: 'first', label: '1軍' },
  { id: 'second', label: '2軍' },
];

export function PlayerCheckScreen() {
  const { state } = useGame();
  const [filter, setFilter] = useState<CheckFilter>('all');
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);

  const statuses = useMemo(
    () => checkTeamPlayers(state, state.playerTeamId),
    [state],
  );

  const rows = useMemo(() => {
    return statuses
      .map((status) => ({ status, player: byId.get(status.playerId) }))
      .filter((row): row is { status: PlayerCheckStatus; player: Player } => !!row.player)
      .filter(({ status }) => {
        if (filter === 'condition') return status.conditionBad;
        if (filter === 'batting') return status.battingSlump !== null;
        if (filter === 'pitching') return status.pitchingSlump !== null;
        return true;
      })
      .filter(({ player }) => {
        if (rosterFilter === 'all') return true;
        return player.roster === rosterFilter;
      });
  }, [statuses, byId, filter, rosterFilter]);

  return (
    <>
      <Tabs tabs={CHECK_TABS} value={filter} onChange={setFilter} />
      <div className="screen">
        <ScreenBackground src={playerCheckBg} alt="" />
        <div className="screen-content">
        <div className="card">
          <Sec en="PLAYER CHECK" ja="選手チェック" size="lead" note={`${rows.length}人`} />
          <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>
            不調・打撃不振・投手不振の選手です。判断そのものはここでは行いません。
            選手名をタップすると詳細から1軍/2軍を入れ替えられます。
          </p>
          <Tabs tabs={ROSTER_TABS} value={rosterFilter} onChange={setRosterFilter} />
        </div>

        {rows.length === 0 ? (
          <div className="muted" style={{ padding: '12px 0' }}>
            該当する選手はいません。
          </div>
        ) : (
          <div className="card">
            {rows.map(({ status, player }) => (
              <PlayerCheckRow key={player.id} player={player} status={status} />
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}

function PlayerCheckRow({ player, status }: { player: Player; status: PlayerCheckStatus }) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
      <div className="spread">
        <span style={{ fontWeight: 700 }}>
          <PlayerLink playerId={player.id}>{player.name}</PlayerLink>
        </span>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {player.roster === 'first' ? '1軍' : '2軍'} / {POSITION_LABELS[player.mainPosition]}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
        {status.conditionBad && (
          <span style={{ color: status.conditionWorst ? 'var(--bad)' : 'var(--accent)', fontWeight: 700 }}>
            {CONDITION_LABELS[player.ext.condition]}　疲労 {Math.round(player.ext.fatigue)}（
            {fatigueLabel(player.ext.fatigue)}） {' '}
          </span>
        )}
        {status.battingSlump && (
          <span>
            打率 {formatAverage(status.battingSlump.average)}　打数 {status.battingSlump.atBats}{' '}
          </span>
        )}
        {status.pitchingSlump && (
          <span>
            防御率 {status.pitchingSlump.era.toFixed(2)}　投球回{' '}
            {formatInnings(status.pitchingSlump.outs)}
          </span>
        )}
        {!status.conditionBad && !status.battingSlump && !status.pitchingSlump && '―'}
      </div>
    </div>
  );
}
