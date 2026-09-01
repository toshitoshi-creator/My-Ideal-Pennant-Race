import { useState } from 'react';
import { useGame } from '../store';
import { formatGamesBehind, formatWinPct, standingsForLeague } from '../../domain/standings';
import { Tabs } from '../components/common';
import { average, era, formatAverage, formatInnings } from '../../domain/stats';

type Tab = 'standings' | 'leaders';

export function StandingsScreen() {
  const { state } = useGame();
  const [tab, setTab] = useState<Tab>('standings');

  return (
    <>
      <Tabs
        tabs={[
          { id: 'standings', label: '順位表' },
          { id: 'leaders', label: 'リーグ個人成績' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen">
        {tab === 'standings'
          ? state.leagues.map((league) => (
              <div className="card" key={league.id}>
                <h2>
                  {league.name}
                  {league.useDH ? '（DH制）' : ''}
                </h2>
                <div className="scroll-x">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>順</th>
                        <th className="l">球団</th>
                        <th>試合</th>
                        <th>勝</th>
                        <th>敗</th>
                        <th>分</th>
                        <th>勝率</th>
                        <th>差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standingsForLeague(state, league.id).map((row) => {
                        const team = state.teams.find((t) => t.id === row.teamId)!;
                        const mine = team.id === state.playerTeamId;
                        return (
                          <tr
                            key={row.teamId}
                            style={{
                              background: mine ? 'rgba(255,183,3,0.12)' : undefined,
                              fontWeight: mine ? 800 : undefined,
                            }}
                          >
                            <td>{row.rank}</td>
                            <td className="l">{team.name}</td>
                            <td>{row.games}</td>
                            <td>{row.wins}</td>
                            <td>{row.losses}</td>
                            <td>{row.draws}</td>
                            <td>{formatWinPct(row.winPct)}</td>
                            <td>{formatGamesBehind(row.gamesBehind)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          : <Leaders />}
      </div>
    </>
  );
}

function Leaders() {
  const { state } = useGame();
  const teamName = (teamId: string) => state.teams.find((t) => t.id === teamId)!.shortName;
  const games = Math.max(...Object.values(state.records).map((r) => r.games));
  const qualifiedPa = Math.floor(games * 3.1);
  const qualifiedOuts = Math.floor(games * 3);

  const batters = state.players
    .filter((p) => !p.isPitcher && state.stats[p.id].batting.plateAppearances >= qualifiedPa && qualifiedPa > 0)
    .sort((a, b) => average(state.stats[b.id].batting) - average(state.stats[a.id].batting))
    .slice(0, 10);
  const homers = state.players
    .filter((p) => state.stats[p.id].batting.homeRuns > 0)
    .sort((a, b) => state.stats[b.id].batting.homeRuns - state.stats[a.id].batting.homeRuns)
    .slice(0, 10);
  const pitchers = state.players
    .filter((p) => p.isPitcher && state.stats[p.id].pitching.outs >= qualifiedOuts && qualifiedOuts > 0)
    .sort((a, b) => era(state.stats[a.id].pitching) - era(state.stats[b.id].pitching))
    .slice(0, 10);

  if (games === 0) {
    return <div className="muted">まだ試合が行われていません。</div>;
  }

  return (
    <>
      <div className="card">
        <h2>打率（規定打席到達者）</h2>
        {batters.length === 0 ? (
          <div className="muted">規定打席に到達した選手がいません。</div>
        ) : (
          <table className="data">
            <tbody>
              {batters.map((p, i) => (
                <tr key={p.id}>
                  <td className="l">{i + 1}</td>
                  <td className="l">{p.name}</td>
                  <td className="l">{teamName(p.teamId)}</td>
                  <td>{formatAverage(average(state.stats[p.id].batting))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>本塁打</h2>
        <table className="data">
          <tbody>
            {homers.map((p, i) => (
              <tr key={p.id}>
                <td className="l">{i + 1}</td>
                <td className="l">{p.name}</td>
                <td className="l">{teamName(p.teamId)}</td>
                <td>{state.stats[p.id].batting.homeRuns}本</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>防御率（規定投球回到達者）</h2>
        {pitchers.length === 0 ? (
          <div className="muted">規定投球回に到達した投手がいません。</div>
        ) : (
          <table className="data">
            <tbody>
              {pitchers.map((p, i) => (
                <tr key={p.id}>
                  <td className="l">{i + 1}</td>
                  <td className="l">{p.name}</td>
                  <td className="l">{teamName(p.teamId)}</td>
                  <td>{era(state.stats[p.id].pitching).toFixed(2)}</td>
                  <td>{formatInnings(state.stats[p.id].pitching.outs)}回</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
