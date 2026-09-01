import { useMemo } from 'react';
import { useGame, usePlayerMap } from '../store';
import { formatDateFull, formatDateJa } from '../../domain/dates';
import { nextGameForTeam } from '../../domain/schedule';
import { nextStarterId } from '../../domain/setup';
import { teamPower } from '../../domain/rating';
import { rankOfTeam, formatWinPct, winPct } from '../../domain/standings';
import { KeyValue, RankBadge } from '../components/common';

export function HomeScreen() {
  const { state, playNextGame, skipOneDay, setScreen } = useGame();
  const byId = usePlayerMap();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const league = state.leagues.find((l) => l.id === team.leagueId)!;
  const record = state.records[team.id];
  const setup = state.setups[team.id];

  const power = useMemo(
    () =>
      teamPower(
        setup.lineup,
        setup.rotation.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p),
        byId,
      ),
    [setup, byId],
  );

  const next = nextGameForTeam(state.schedule, team.id, state.date);
  const opponentId = next
    ? next.homeTeamId === team.id
      ? next.awayTeamId
      : next.homeTeamId
    : null;
  const opponent = opponentId ? state.teams.find((t) => t.id === opponentId)! : null;
  const starter = byId.get(nextStarterId(setup) ?? '');
  const rank = rankOfTeam(state, team.id);

  return (
    <div className="screen">
      <div className="card" style={{ borderLeft: `5px solid ${team.color}` }}>
        <div className="spread">
          <div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{team.name}</div>
            <div className="muted">
              {state.year}年 / {league.name}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)' }}>
              {record.games > 0 ? `${rank}位` : '－'}
            </div>
            <div className="muted">
              {record.games > 0 ? formatWinPct(winPct(record)) : '開幕前'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 15 }}>{formatDateFull(state.date)}</div>
        <div style={{ marginTop: 4, fontSize: 17, fontWeight: 700 }}>
          {record.wins}勝 {record.losses}敗 {record.draws}分（{record.games}試合）
        </div>
      </div>

      <div className="card">
        <h2>球団総合力</h2>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 15 }}>総合</span>
          <span className="row">
            <strong style={{ fontSize: 22 }}>{power.total}</strong>
            <RankBadge value={power.total} />
          </span>
        </div>
        <KeyValue
          label="打撃力"
          value={
            <span className="row">
              {power.batting} <RankBadge value={power.batting} />
            </span>
          }
        />
        <KeyValue
          label="投手力"
          value={
            <span className="row">
              {power.pitching} <RankBadge value={power.pitching} />
            </span>
          }
        />
        <KeyValue
          label="守備力"
          value={
            <span className="row">
              {power.defense} <RankBadge value={power.defense} />
            </span>
          }
        />
      </div>

      <div className="card">
        <h2>次の試合</h2>
        {next && opponent ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 800 }}>
              {formatDateJa(next.date)}　vs {opponent.name}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {next.homeTeamId === team.id ? 'ホーム' : 'ビジター'} / {opponent.name}は
              {state.records[opponent.id].wins}勝{state.records[opponent.id].losses}敗
            </div>
            <KeyValue
              label="次回先発投手"
              value={
                starter
                  ? `${starter.name}（球速${starter.pitching?.velocity ?? '-'}km/h）`
                  : '未設定'
              }
            />
          </>
        ) : (
          <div className="muted">残り試合はありません（シーズン終了）</div>
        )}
      </div>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button
          className="btn primary"
          disabled={!next}
          onClick={() => {
            const result = playNextGame();
            if (result) setScreen('game');
          }}
        >
          次の試合へ
        </button>
        <button
          className="btn secondary"
          onClick={() => skipOneDay()}
        >
          1日進める
        </button>
      </div>

      {state.seasonFinished && (
        <div className="card">
          <h2>シーズン終了</h2>
          <div>
            {state.year}年シーズンが終了しました。最終成績は {record.wins}勝{record.losses}敗
            {record.draws}分（{rank}位）です。
          </div>
        </div>
      )}
    </div>
  );
}
