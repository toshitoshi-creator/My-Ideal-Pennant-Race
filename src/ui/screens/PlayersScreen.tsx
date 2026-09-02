import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { Player } from '../../domain/types';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerDetail } from '../components/PlayerDetail';
import { Tabs } from '../components/common';
import { overallRating } from '../../domain/rating';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import { formatMoney, formatSalary, isExpiring, teamPayroll } from '../../domain/contract';

type Filter = 'all' | 'pitcher' | 'fielder' | 'first' | 'second' | 'stats' | 'contract';

const TABS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全選手' },
  { id: 'pitcher', label: '投手' },
  { id: 'fielder', label: '野手' },
  { id: 'first', label: '1軍' },
  { id: 'second', label: '2軍' },
  { id: 'stats', label: '成績' },
  { id: 'contract', label: '契約' },
];

export function PlayersScreen() {
  const { state } = useGame();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Player | null>(null);

  const roster = useMemo(
    () =>
      state.players
        .filter((p) => p.teamId === state.playerTeamId)
        .sort((a, b) => overallRating(b) - overallRating(a)),
    [state.players, state.playerTeamId],
  );

  const shown = useMemo(() => {
    switch (filter) {
      case 'pitcher':
        return roster.filter((p) => p.isPitcher);
      case 'fielder':
        return roster.filter((p) => !p.isPitcher);
      case 'first':
        return roster.filter((p) => p.roster === 'first');
      case 'second':
        return roster.filter((p) => p.roster === 'second');
      default:
        return roster;
    }
  }, [roster, filter]);

  const selectedLive = selected ? state.players.find((p) => p.id === selected.id) ?? null : null;

  return (
    <>
      <Tabs tabs={TABS} value={filter} onChange={setFilter} />
      <div className="screen">
        {filter === 'contract' ? (
          <ContractTable onSelect={setSelected} />
        ) : filter === 'stats' ? (
          <StatsTables />
        ) : (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>
              {shown.length}人（保有 {roster.length}人 / 上限 70人）　選手をタップで詳細
            </div>
            {shown.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                today={state.date}
                onClick={() => setSelected(player)}
              />
            ))}
          </>
        )}
      </div>
      {selectedLive && <PlayerDetail player={selectedLive} onClose={() => setSelected(null)} />}
    </>
  );
}

function ContractTable({ onSelect }: { onSelect: (player: Player) => void }) {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const finance = state.finances[team.id];
  const payroll = teamPayroll(state, team.id);
  const roster = state.players
    .filter((p) => p.teamId === state.playerTeamId)
    .sort((a, b) => (b.ext.contract?.salary ?? 0) - (a.ext.contract?.salary ?? 0));

  return (
    <>
      <div className="card">
        <h2>球団の資金</h2>
        <div className="spread" style={{ padding: '5px 0' }}>
          <span className="muted">球団資金</span>
          <span style={{ fontWeight: 700, color: finance.cash < 0 ? 'var(--bad)' : undefined }}>
            {formatMoney(finance.cash)}
          </span>
        </div>
        <div className="spread" style={{ padding: '5px 0' }}>
          <span className="muted">年間予算 / 総年俸</span>
          <span style={{ fontWeight: 700 }}>
            {formatMoney(finance.budget)} / {formatMoney(payroll)}
          </span>
        </div>
      </div>
      <div className="card">
        <h2>契約一覧</h2>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th className="l">選手</th>
                <th>年齢</th>
                <th>総合</th>
                <th>年俸</th>
                <th>残り</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => {
                const contract = player.ext.contract;
                const expiring = isExpiring(player);
                return (
                  <tr
                    key={player.id}
                    onClick={() => onSelect(player)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="l">{player.name}</td>
                    <td>{player.age}</td>
                    <td>{overallRating(player)}</td>
                    <td>{contract ? formatSalary(contract.salary) : '－'}</td>
                    <td style={{ color: expiring ? 'var(--accent)' : undefined }}>
                      {expiring ? '満了' : `${contract?.yearsRemaining}年`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StatsTables() {
  const { state } = useGame();
  const roster = state.players.filter((p) => p.teamId === state.playerTeamId);
  const batters = roster
    .filter((p) => !p.isPitcher && state.stats[p.id].batting.plateAppearances > 0)
    .sort((a, b) => state.stats[b.id].batting.atBats - state.stats[a.id].batting.atBats);
  const pitchers = roster
    .filter((p) => p.isPitcher && state.stats[p.id].pitching.games > 0)
    .sort((a, b) => state.stats[b.id].pitching.outs - state.stats[a.id].pitching.outs);

  if (batters.length === 0 && pitchers.length === 0) {
    return <div className="muted">まだ試合を行っていないため、成績はありません。</div>;
  }

  return (
    <>
      <div className="card">
        <h2>野手成績</h2>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th className="l">選手</th>
                <th>試合</th>
                <th>打数</th>
                <th>安打</th>
                <th>本</th>
                <th>点</th>
                <th>得</th>
                <th>盗</th>
                <th>三振</th>
                <th>四球</th>
                <th>打率</th>
              </tr>
            </thead>
            <tbody>
              {batters.map((p) => {
                const b = state.stats[p.id].batting;
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}</td>
                    <td>{b.games}</td>
                    <td>{b.atBats}</td>
                    <td>{b.hits}</td>
                    <td>{b.homeRuns}</td>
                    <td>{b.rbi}</td>
                    <td>{b.runs}</td>
                    <td>{b.steals}</td>
                    <td>{b.strikeouts}</td>
                    <td>{b.walks}</td>
                    <td>{formatAverage(average(b))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>投手成績</h2>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th className="l">選手</th>
                <th>登板</th>
                <th>先発</th>
                <th>勝</th>
                <th>敗</th>
                <th>S</th>
                <th>投球回</th>
                <th>奪三</th>
                <th>失点</th>
                <th>自責</th>
                <th>防御率</th>
              </tr>
            </thead>
            <tbody>
              {pitchers.map((p) => {
                const q = state.stats[p.id].pitching;
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}</td>
                    <td>{q.games}</td>
                    <td>{q.starts}</td>
                    <td>{q.wins}</td>
                    <td>{q.losses}</td>
                    <td>{q.saves}</td>
                    <td>{formatInnings(q.outs)}</td>
                    <td>{q.strikeouts}</td>
                    <td>{q.runsAllowed}</td>
                    <td>{q.earnedRuns}</td>
                    <td>{formatEra(q)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
