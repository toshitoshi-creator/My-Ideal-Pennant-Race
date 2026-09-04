import { useGame } from '../store';
import {
  STAGE_LABELS,
  currentSeries,
  isSeriesComplete,
  playNextPostseasonGame,
  seriesOfStage,
  winsRemaining,
} from '../../domain/postseason';
import type { SeriesState } from '../../domain/types';

/**
 * ポストシーズン画面（PHASE 3.8）。
 * トーナメント表とシリーズの進行を、縦スクロールで見られるようにする。
 */
export function PostseasonScreen() {
  const { state, mutate } = useGame();
  const postseason = state.postseason;

  if (!postseason) {
    return (
      <div className="screen">
        <div className="card">
          <h2>ポストシーズン</h2>
          <p className="muted">
            レギュラーシーズンが終わると、各リーグの上位3球団による
            クライマックスシリーズが始まります。
          </p>
        </div>
      </div>
    );
  }

  const teamName = (id: string | null | undefined) =>
    state.teams.find((t) => t.id === id)?.shortName ?? '―';
  const myTeam = state.playerTeamId;
  const next = currentSeries(state);
  const champion = postseason.championTeamId;
  // リーグ優勝が決まっていて日本一がまだのときだけ、リーグ優勝を大きく見せる
  const leagueWinners = state.leagues
    .map((league) => postseason.leagueChampions[league.id])
    .filter((id): id is string => !!id);

  // 1試合ずつ進める（段階の切り替えはドメイン側で行う）
  const playOne = () => mutate((draft) => void playNextPostseasonGame(draft));

  return (
    <div className="screen">
      <div className="card">
        <h2>{state.year}年 ポストシーズン</h2>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{phaseLabel(postseason.phase)}</div>
        {/* PHASE 4.1: 日本一だけ特別な演出にする（毎回派手にはしない） */}
        {champion && (
          <div className="banner japan pop-in" style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, letterSpacing: '0.16em', color: 'var(--text-dim)' }}>
              JAPAN SERIES CHAMPION
            </div>
            🏆 {state.year}年 日本一　{teamName(champion)}
          </div>
        )}
        {champion === myTeam && (
          <div className="muted" style={{ marginTop: 6, textAlign: 'center' }}>
            おめでとうございます。日本一です。
          </div>
        )}
        {!champion && leagueWinners.length > 0 && (
          <div className="banner league pop-in" style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--text-dim)' }}>
              LEAGUE CHAMPION
            </div>
            {leagueWinners.map((id) => teamName(id)).join('　/　')}
          </div>
        )}
      </div>

      <div className="card">
        <h2>進出球団</h2>
        {state.leagues.map((league) => (
          <div key={league.id} style={{ marginBottom: 10 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              {league.name}
            </div>
            {(postseason.participants[league.id] ?? []).map((id, i) => (
              <div key={id} className="spread" style={{ padding: '3px 0' }}>
                <span style={{ fontWeight: id === myTeam ? 800 : undefined }}>
                  {i + 1}位　{teamName(id)}
                  {id === myTeam && '（自球団）'}
                </span>
                {postseason.leagueChampions[league.id] === id && (
                  <span className="chip on">リーグ優勝</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {(['FIRST', 'FINAL', 'JAPAN_SERIES'] as const).map((stage) => {
        const list = seriesOfStage(postseason, stage);
        if (list.length === 0) return null;
        return (
          <div className="card" key={stage}>
            <h2>{STAGE_LABELS[stage]}</h2>
            {list.map((series) => (
              <SeriesCard key={series.id} series={series} />
            ))}
          </div>
        );
      })}

      {next && (
        <button className="btn primary" onClick={playOne}>
          第{next.games.length + 1}戦を進める（{teamName(next.teamAId)} vs{' '}
          {teamName(next.teamBId)}）
        </button>
      )}
    </div>
  );
}

function phaseLabel(phase: string): string {
  if (phase === 'FIRST_STAGE') return 'ファーストステージ';
  if (phase === 'FINAL_STAGE') return 'ファイナルステージ';
  if (phase === 'JAPAN_SERIES') return '日本シリーズ';
  return 'ポストシーズン終了';
}

function SeriesCard({ series }: { series: SeriesState }) {
  const { state } = useGame();
  const teamName = (id: string | null) =>
    state.teams.find((t) => t.id === id)?.shortName ?? '―';
  const done = isSeriesComplete(series);
  const myTeam = state.playerTeamId;
  const mine = series.teamAId === myTeam || series.teamBId === myTeam;

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: 10,
        marginBottom: 8,
        background: mine ? 'rgba(255,183,3,0.08)' : undefined,
      }}
    >
      <div className="spread">
        <span style={{ fontWeight: series.winnerTeamId === series.teamAId ? 800 : 400 }}>
          {teamName(series.teamAId)}
          {series.advantageA > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              （アドバンテージ{series.advantageA}勝）
            </span>
          )}
        </span>
        <span style={{ fontSize: 18, fontWeight: 800 }}>
          {series.teamAWins} - {series.teamBWins}
        </span>
        <span style={{ fontWeight: series.winnerTeamId === series.teamBId ? 800 : 400 }}>
          {teamName(series.teamBId)}
        </span>
      </div>
      {/* PHASE 4.1: シリーズが決まった瞬間だけ WIN を出す */}
      {done && (
        <div className="banner win pop-in" style={{ marginTop: 8, padding: '8px 10px' }}>
          WIN　{teamName(series.winnerTeamId)}
        </div>
      )}
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {done
          ? `${teamName(series.winnerTeamId)}が${series.teamAWins}勝${series.teamBWins}敗でシリーズ突破`
          : series.games.length === 0
            ? `${series.winsRequired}勝先取（第1戦から）`
            : `第${series.games.length + 1}戦　あと${Math.min(
                winsRemaining(series, series.teamAId),
                winsRemaining(series, series.teamBId),
              )}勝で決着`}
      </div>
      {series.games.length > 0 && (
        <div className="scroll-x" style={{ marginTop: 6 }}>
          <table className="data">
            <thead>
              <tr>
                <th>戦</th>
                <th className="l">対戦</th>
                <th>スコア</th>
              </tr>
            </thead>
            <tbody>
              {series.games.map((game) => (
                <tr key={game.gameNumber}>
                  <td>{game.gameNumber}</td>
                  <td className="l">
                    {teamName(game.awayTeamId)} @ {teamName(game.homeTeamId)}
                  </td>
                  <td>
                    {game.awayRuns} - {game.homeRuns}
                    {game.winnerTeamId === null && <span className="muted">（分）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
