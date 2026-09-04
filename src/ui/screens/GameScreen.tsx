import { useState } from 'react';
import { useGame } from '../store';
import type { GameResult } from '../../domain/types';
import { formatDateJa } from '../../domain/dates';
import { nextGameForTeam } from '../../domain/schedule';
import { nextStarterId } from '../../domain/setup';
import { Sheet } from '../components/common';
import { useCountUp, usePlayback } from '../anim';

export function GameScreen() {
  const { state, lastResult, playNextGame } = useGame();
  const [detail, setDetail] = useState<GameResult | null>(null);
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const next = nextGameForTeam(state.schedule, team.id, state.date);
  const opponent = next
    ? state.teams.find(
        (t) => t.id === (next.homeTeamId === team.id ? next.awayTeamId : next.homeTeamId),
      )!
    : null;
  const starterId = nextStarterId(state.setups[team.id]);
  const starter = state.players.find((p) => p.id === starterId);

  const playerResults = state.results
    .filter((r) => r.homeTeamId === team.id || r.awayTeamId === team.id)
    .slice()
    .reverse();

  const sameDayResults = lastResult
    ? state.results.filter((r) => r.date === lastResult.date && r.id !== lastResult.id)
    : [];

  return (
    <div className="screen">
      <div className="card">
        <h2>次の試合</h2>
        {next && opponent ? (
          <>
            <div className="muted">{formatDateJa(next.date)}</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
              {next.homeTeamId === team.id
                ? `${opponent.name} @ ${team.name}`
                : `${team.name} @ ${opponent.name}`}
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>
              先発予定： {starter ? starter.name : '未設定'}
            </div>
            <button className="btn primary" onClick={() => playNextGame()}>
              試合開始
            </button>
          </>
        ) : (
          <div className="muted">予定されている試合はありません。</div>
        )}
      </div>

      {lastResult && (
        <>
          <div className="card">
            <h2>試合結果</h2>
            <GameResultView state={state} result={lastResult} />
          </div>
          <div className="card">
            <h2>簡易実況</h2>
            <div className="commentary">
              {lastResult.commentary.map((line, i) => (
                <div key={i} className={line.startsWith('　') ? '' : 'head'}>
                  {line}
                </div>
              ))}
            </div>
          </div>
          {sameDayResults.length > 0 && (
            <div className="card">
              <h2>同日の他球団の結果</h2>
              {sameDayResults.map((r) => (
                <ResultRow key={r.id} state={state} result={r} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="card">
        <h2>これまでの試合</h2>
        {playerResults.length === 0 && <div className="muted">まだ試合を行っていません。</div>}
        {playerResults.slice(0, 20).map((r) => (
          <button
            key={r.id}
            className="player-card"
            onClick={() => setDetail(r)}
            style={{ padding: '10px 12px' }}
          >
            <span className="grow">
              <ResultRow state={state} result={r} inline />
            </span>
            <span className="muted">{r.commentary.length > 0 ? '詳細 ›' : ''}</span>
          </button>
        ))}
      </div>

      {detail && (
        <Sheet title={`${formatDateJa(detail.date)} の試合`} onClose={() => setDetail(null)}>
          <div className="card">
            <GameResultView state={state} result={detail} />
          </div>
          {detail.commentary.length > 0 && (
            <div className="card">
              <h2>簡易実況</h2>
              <div className="commentary" style={{ maxHeight: 'none' }}>
                {detail.commentary.map((line, i) => (
                  <div key={i} className={line.startsWith('　') ? '' : 'head'}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function ResultRow({
  state,
  result,
  inline,
}: {
  state: ReturnType<typeof useGame>['state'];
  result: GameResult;
  inline?: boolean;
}) {
  const home = state.teams.find((t) => t.id === result.homeTeamId)!;
  const away = state.teams.find((t) => t.id === result.awayTeamId)!;
  const playerTeam = state.playerTeamId;
  const isPlayerGame = result.homeTeamId === playerTeam || result.awayTeamId === playerTeam;
  let mark = '△';
  if (isPlayerGame && result.winnerTeamId) {
    mark = result.winnerTeamId === playerTeam ? '○' : '●';
  }
  return (
    <div
      className="spread"
      style={{ padding: inline ? 0 : '6px 0', borderBottom: inline ? 'none' : '1px solid var(--line)' }}
    >
      <span style={{ fontSize: 14 }}>
        {isPlayerGame && (
          <strong style={{ color: mark === '○' ? 'var(--good)' : mark === '●' ? 'var(--bad)' : 'var(--text-dim)' }}>
            {mark}{' '}
          </strong>
        )}
        {formatDateJa(result.date)} {away.shortName} {result.away.runs} - {result.home.runs}{' '}
        {home.shortName}
      </span>
      {result.innings > 9 && <span className="muted">延{result.innings}回</span>}
    </div>
  );
}

export function GameResultView({
  state,
  result,
}: {
  state: ReturnType<typeof useGame>['state'];
  result: GameResult;
}) {
  const home = state.teams.find((t) => t.id === result.homeTeamId)!;
  const away = state.teams.find((t) => t.id === result.awayTeamId)!;
  const winner = result.winnerTeamId
    ? state.teams.find((t) => t.id === result.winnerTeamId)!
    : null;
  const winPitcher = state.players.find((p) => p.id === result.winningPitcherId);
  const losePitcher = state.players.find((p) => p.id === result.losingPitcherId);

  /*
   * PHASE 4.1: 試合の結果を回ごとに再生する。
   * 試合そのものは engine が一括で計算済みで、ここでやっているのは
   * 「すでに決まっている結果を順番に見せる」だけ。
   * 途中でスキップしても、リロードしても、結果は 1 ミリも変わらない。
   */
  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length);
  const play = usePlayback(innings + 1, 190, true);
  // step 回まで進んだ時点の得点（表示専用）
  const shownInnings = Math.min(innings, play.step);
  const partial = (runs: number[]) =>
    runs.slice(0, shownInnings).reduce((a, b) => a + b, 0);
  const awayRuns = play.done ? result.away.runs : partial(result.away.inningRuns);
  const homeRuns = play.done ? result.home.runs : partial(result.home.inningRuns);
  const awayShown = useCountUp(awayRuns, 240);
  const homeShown = useCountUp(homeRuns, 240);

  return (
    <>
      <div className="big-score">
        <span className="t">{away.shortName}</span>
        <span className="s">
          {awayShown} - {homeShown}
        </span>
        <span className="t">{home.shortName}</span>
      </div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {play.done ? '試合終了' : `${shownInnings}回まで`}
        </span>
        {!play.done && (
          <button className="skip-btn" onClick={play.skip}>
            スキップ
          </button>
        )}
      </div>
      <div
        style={{ textAlign: 'center', marginBottom: 10, fontWeight: 700, minHeight: 24 }}
      >
        {play.done && (
          <span className="pop-in">{winner ? `勝利球団：${winner.name}` : '引き分け'}</span>
        )}
      </div>
      <div className="scroll-x">
        <table className="linescore">
          <thead>
            <tr>
              <th />
              {result.away.inningRuns.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th>R</th>
              <th>H</th>
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="team">{away.shortName}</td>
              {result.away.inningRuns.map((r, i) => (
                <td key={i}>{i < shownInnings ? r : ''}</td>
              ))}
              <td className="total">{awayRuns}</td>
              <td>{play.done ? result.away.hits : ''}</td>
              <td>{play.done ? result.away.errors : ''}</td>
            </tr>
            <tr>
              <td className="team">{home.shortName}</td>
              {result.home.inningRuns.map((r, i) => (
                <td key={i}>
                  {i >= shownInnings
                    ? ''
                    : i === result.innings - 1 &&
                        result.home.inningRuns.length === result.innings &&
                        r === 0 &&
                        result.home.runs > result.away.runs
                      ? 'X'
                      : r}
                </td>
              ))}
              <td className="total">{homeRuns}</td>
              <td>{play.done ? result.home.hits : ''}</td>
              <td>{play.done ? result.home.errors : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {play.done && (winPitcher || losePitcher) && (
        <div className="muted" style={{ marginTop: 8 }}>
          勝：{winPitcher?.name ?? '－'} ／ 敗：{losePitcher?.name ?? '－'}
        </div>
      )}
    </>
  );
}
