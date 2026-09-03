import { useGame } from '../store';
import {
  AWARD_LABELS,
  careerTeamSpans,
  seasonTotalOf,
  statsOfEntry,
} from '../../domain/history';
import { TIER_LABELS, playerTier } from '../../domain/hallOfFame';
import {
  average,
  era,
  formatAverage,
  formatEra,
  formatInnings,
} from '../../domain/stats';
import { POSITION_LABELS } from '../../domain/positions';
import type { PlayerHistory } from '../../domain/types';

/**
 * 選手の歴史（年度別成績・通算成績・所属球団・表彰）。
 * 引退した選手にも使うので、現在の能力値は一切出さない。
 */
export function PlayerHistoryView({ history }: { history: PlayerHistory }) {
  const { state } = useGame();
  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.shortName ?? '―';
  const years = [...new Set(history.seasons.map((s) => s.year))].sort((a, b) => a - b);
  const spans = careerTeamSpans(history);
  const tier = playerTier(history, state.seasonLength);
  const career = history.career;
  const pitcher = history.isPitcher;

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="chip">{POSITION_LABELS[history.mainPosition]}</span>
        <span className="chip">{TIER_LABELS[tier]}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {history.debutYear}年デビュー
          {history.retiredAt ? ` ／ ${history.retiredAt}年引退` : '（現役）'}
        </span>
      </div>

      <h3 className="sec">所属</h3>
      <div style={{ marginBottom: 12 }}>
        {spans.length === 0 ? (
          <span className="muted">記録なし</span>
        ) : (
          spans.map((span, i) => (
            <div key={i}>
              {span.from === span.to ? span.from : `${span.from}〜${span.to}`}　
              {teamName(span.teamId)}
            </div>
          ))
        )}
      </div>

      <h3 className="sec">通算成績</h3>
      <div className="scroll-x" style={{ marginBottom: 12 }}>
        {pitcher ? (
          <table className="data">
            <thead>
              <tr>
                <th>登板</th>
                <th>勝</th>
                <th>敗</th>
                <th>S</th>
                <th>H</th>
                <th>投球回</th>
                <th>奪三振</th>
                <th>防御率</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{career.pitching.games}</td>
                <td>{career.pitching.wins}</td>
                <td>{career.pitching.losses}</td>
                <td>{career.pitching.saves}</td>
                <td>{career.pitching.holds}</td>
                <td>{formatInnings(career.pitching.outs)}</td>
                <td>{career.pitching.strikeouts}</td>
                <td>{formatEra(career.pitching)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>試合</th>
                <th>打数</th>
                <th>安打</th>
                <th>本塁打</th>
                <th>打点</th>
                <th>盗塁</th>
                <th>打率</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{career.batting.games}</td>
                <td>{career.batting.atBats}</td>
                <td>{career.batting.hits}</td>
                <td>{career.batting.homeRuns}</td>
                <td>{career.batting.rbi}</td>
                <td>{career.batting.steals}</td>
                <td>{formatAverage(average(career.batting))}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {history.awards.length > 0 && (
        <>
          <h3 className="sec">表彰</h3>
          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {history.awards.map((award, i) => (
              <span className="chip" key={i}>
                {award.year} {AWARD_LABELS[award.kind]}
              </span>
            ))}
          </div>
        </>
      )}

      <h3 className="sec">年度別成績</h3>
      <div className="scroll-x">
        <table className="data">
          <thead>
            {pitcher ? (
              <tr>
                <th>年</th>
                <th className="l">球団</th>
                <th>登板</th>
                <th>勝</th>
                <th>敗</th>
                <th>S</th>
                <th>投球回</th>
                <th>防御率</th>
              </tr>
            ) : (
              <tr>
                <th>年</th>
                <th className="l">球団</th>
                <th>試合</th>
                <th>打数</th>
                <th>安打</th>
                <th>本</th>
                <th>点</th>
                <th>打率</th>
              </tr>
            )}
          </thead>
          <tbody>
            {years.map((year) => {
              const rows = history.seasons.filter((s) => s.year === year);
              const total = seasonTotalOf(history, year);
              // 同じ年に複数球団（シーズン途中の移籍）なら球団ごとに出して合計も出す
              const list = rows.map((row, i) => {
                const stats = statsOfEntry(row);
                return (
                  <tr key={`${year}-${i}`}>
                    <td>{i === 0 ? year : ''}</td>
                    <td className="l">{teamName(row.teamId)}</td>
                    {pitcher ? (
                      <>
                        <td>{stats.pitching.games}</td>
                        <td>{stats.pitching.wins}</td>
                        <td>{stats.pitching.losses}</td>
                        <td>{stats.pitching.saves}</td>
                        <td>{formatInnings(stats.pitching.outs)}</td>
                        <td>{formatEra(stats.pitching)}</td>
                      </>
                    ) : (
                      <>
                        <td>{stats.batting.games}</td>
                        <td>{stats.batting.atBats}</td>
                        <td>{stats.batting.hits}</td>
                        <td>{stats.batting.homeRuns}</td>
                        <td>{stats.batting.rbi}</td>
                        <td>{formatAverage(average(stats.batting))}</td>
                      </>
                    )}
                  </tr>
                );
              });
              if (rows.length > 1) {
                list.push(
                  <tr key={`${year}-total`} style={{ opacity: 0.75 }}>
                    <td />
                    <td className="l">計</td>
                    {pitcher ? (
                      <>
                        <td>{total.pitching.games}</td>
                        <td>{total.pitching.wins}</td>
                        <td>{total.pitching.losses}</td>
                        <td>{total.pitching.saves}</td>
                        <td>{formatInnings(total.pitching.outs)}</td>
                        <td>{total.pitching.outs === 0 ? '-.--' : era(total.pitching).toFixed(2)}</td>
                      </>
                    ) : (
                      <>
                        <td>{total.batting.games}</td>
                        <td>{total.batting.atBats}</td>
                        <td>{total.batting.hits}</td>
                        <td>{total.batting.homeRuns}</td>
                        <td>{total.batting.rbi}</td>
                        <td>{formatAverage(average(total.batting))}</td>
                      </>
                    )}
                  </tr>,
                );
              }
              return list;
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
