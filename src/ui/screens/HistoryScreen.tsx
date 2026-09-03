import { useMemo, useState } from 'react';
import { useGame } from '../store';
import { Sheet, Tabs } from '../components/common';
import {
  AWARD_LABELS,
  LEADER_LABELS,
  championshipCount,
  japanChampionshipCount,
  japanSeriesAppearanceCount,
  leagueChampionshipCount,
  postseasonAppearanceCount,
  retiredHistories,
  teamSeasons,
} from '../../domain/history';
import { TIER_LABELS, playerTier } from '../../domain/hallOfFame';
import { formatAverage } from '../../domain/stats';
import { formatWinPct } from '../../domain/standings';
import { PlayerHistoryView } from '../components/PlayerHistoryView';
import { NewsCard } from '../components/NewsCard';
import { newsForTeam } from '../../domain/news';
import { storyOf } from '../../domain/story';
import type { PlayerHistory } from '../../domain/types';

type Tab = 'timeline' | 'teams' | 'hof';

export function HistoryScreen() {
  const { state } = useGame();
  const [tab, setTab] = useState<Tab>('timeline');

  if (state.history.seasons.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <h2>球団の歴史</h2>
          <p className="muted">
            まだ記録がありません。1シーズンを終えると、その年の順位・タイトル・記録が
            ここに残っていきます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Tabs
        tabs={[
          { id: 'timeline', label: '年表' },
          { id: 'teams', label: '球団の歩み' },
          { id: 'hof', label: '殿堂' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen">
        {tab === 'timeline' && <Timeline />}
        {tab === 'teams' && <TeamWalk />}
        {tab === 'hof' && <HallOfFame />}
      </div>
    </>
  );
}

function Timeline() {
  const { state } = useGame();
  const seasons = [...state.history.seasons].reverse();
  const nameOf = (id: string) => state.teams.find((t) => t.id === id)?.shortName ?? '―';
  const playerName = (id: string | null) =>
    id ? (state.history.players[id]?.name ?? '―') : '―';

  return (
    <>
      {seasons.map((season) => {
        const mine = season.teams.find((t) => t.teamId === state.playerTeamId);
        return (
          <div className="card" key={season.year}>
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 17 }}>{season.year}年</strong>
              {mine && (
                <span className="chip">
                  自球団 {mine.rank}位 {mine.wins}勝{mine.losses}敗
                </span>
              )}
            </div>
            <SeasonHeadline year={season.year} />
            {season.postseason?.japanSeriesChampionTeamId && (
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: 'var(--accent)',
                  marginBottom: 8,
                }}
              >
                🏆 日本一　{nameOf(season.postseason.japanSeriesChampionTeamId)}
                {season.postseason.japanSeriesMvpPlayerId && (
                  <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                    MVP {playerName(season.postseason.japanSeriesMvpPlayerId)}
                  </span>
                )}
              </div>
            )}
            {season.leagues.map((league) => (
              <div key={league.leagueId} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>
                  {league.leagueChampionTeamId ? (
                    <>
                      リーグ優勝 {nameOf(league.leagueChampionTeamId)}
                      <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                        1位 {nameOf(league.championTeamId)}
                      </span>
                    </>
                  ) : (
                    <>🏆 {nameOf(league.championTeamId)}</>
                  )}
                  <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                    {state.leagues.find((l) => l.id === league.leagueId)?.name}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  MVP {playerName(league.mvpPlayerId)} ／ 最優秀投手{' '}
                  {playerName(league.bestPitcherPlayerId)} ／ 新人王{' '}
                  {playerName(league.rookiePlayerId)}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {league.leaders.average &&
                    `首位打者 ${league.leaders.average.name} ${formatAverage(
                      league.leaders.average.value,
                    )}`}
                  {league.leaders.homeRuns &&
                    ` ／ 本塁打王 ${league.leaders.homeRuns.name} ${league.leaders.homeRuns.value}`}
                  {league.leaders.wins &&
                    ` ／ 最多勝 ${league.leaders.wins.name} ${league.leaders.wins.value}`}
                </div>
              </div>
            ))}
            <SeasonEvents year={season.year} />
          </div>
        );
      })}
    </>
  );
}

function SeasonEvents({ year }: { year: number }) {
  const { state } = useGame();
  const events = state.history.events.filter((e) => e.year === year && e.scope === 'league');
  if (events.length === 0) return null;
  const label = (key: string) =>
    LEADER_LABELS[key as keyof typeof LEADER_LABELS] ?? key;
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
      {events.slice(0, 4).map((e, i) => (
        <div key={i} style={{ fontSize: 13 }}>
          📜 {e.name} がリーグ{e.kind === 'career' ? '通算' : 'シーズン'}
          {label(e.key)}記録を更新
        </div>
      ))}
    </div>
  );
}

function TeamWalk() {
  const { state } = useGame();
  const [teamId, setTeamId] = useState(state.playerTeamId);
  const rows = teamSeasons(state.history, teamId);
  const titles = championshipCount(state.history, teamId);
  const leagueTitles = leagueChampionshipCount(state.history, teamId);
  const japanTitles = japanChampionshipCount(state.history, teamId);
  const csAppearances = postseasonAppearanceCount(state.history, teamId);
  const jsAppearances = japanSeriesAppearanceCount(state.history, teamId);

  return (
    <>
      <div className="card">
        <h2>球団</h2>
        <div className="scroll-x" style={{ paddingBottom: 4 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {state.teams.map((team) => (
              <button
                key={team.id}
                className={team.id === teamId ? 'chip on' : 'chip'}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setTeamId(team.id)}
              >
                {team.shortName}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span className="chip">1位 {titles}回</span>
          <span className="chip">リーグ優勝 {leagueTitles}回</span>
          <span className="chip on">日本一 {japanTitles}回</span>
          <span className="chip">CS進出 {csAppearances}回</span>
          <span className="chip">日本シリーズ出場 {jsAppearances}回</span>
        </div>
      </div>
      <TeamNews teamId={teamId} />
      <div className="card">
        <h2>年度別</h2>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>年</th>
                <th>順位</th>
                <th>PS</th>
                <th>勝</th>
                <th>敗</th>
                <th>分</th>
                <th>勝率</th>
                <th>得点</th>
                <th>失点</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ year, row }) => (
                <tr key={year}>
                  <td>{year}</td>
                  <td style={{ fontWeight: row.champion ? 800 : undefined }}>{row.rank}</td>
                  <td>
                    {row.japanChampion ? '🏆' : row.leagueChampion ? '優勝' : row.postseason ? 'CS' : ''}
                  </td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{row.draws}</td>
                  <td>{formatWinPct(row.winPct)}</td>
                  <td>{row.runsScored}</td>
                  <td>{row.runsAllowed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function HallOfFame() {
  const { state } = useGame();
  const [selected, setSelected] = useState<PlayerHistory | null>(null);
  const entries = [...state.history.hallOfFame].sort((a, b) => b.inductedYear - a.inductedYear);

  return (
    <>
      <div className="card">
        <h2>殿堂</h2>
        {entries.length === 0 ? (
          <p className="muted">
            まだ殿堂入りした選手はいません。長く活躍して記録を積み上げた選手が、
            引退後に選ばれます。
          </p>
        ) : (
          entries.map((entry) => {
            const history = state.history.players[entry.playerId];
            return (
              <button
                key={entry.playerId}
                className="row-btn"
                onClick={() => history && setSelected(history)}
              >
                <div className="spread">
                  <strong>{entry.name}</strong>
                  <span className="chip">{entry.inductedYear}年</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {entry.debutYear}〜{entry.retiredAt}年
                  {history && ` ／ ${TIER_LABELS[playerTier(history, state.seasonLength)]}`}
                  {history && history.awards.length > 0 &&
                    ` ／ ${AWARD_LABELS[history.awards[0].kind]}など${history.awards.length}冠`}
                </div>
              </button>
            );
          })
        )}
      </div>
      <RetiredList onSelect={setSelected} />
      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <PlayerHistoryView history={selected} />
        </Sheet>
      )}
    </>
  );
}

function RetiredList({ onSelect }: { onSelect: (h: PlayerHistory) => void }) {
  const { state } = useGame();
  const retired = useMemo(() => {
    return retiredHistories(state.history)
      .sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0))
      .slice(0, 40);
  }, [state.history]);

  if (retired.length === 0) return null;
  return (
    <div className="card">
      <h2>最近引退した選手</h2>
      {retired.map((history) => (
        <button key={history.playerId} className="row-btn" onClick={() => onSelect(history)}>
          <div className="spread">
            <strong>{history.name}</strong>
            <span className="chip">{history.retiredAt}年引退</span>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {history.debutYear}年デビュー ／{' '}
            {history.isPitcher
              ? `通算 ${history.career.pitching.wins}勝 ${history.career.pitching.strikeouts}奪三振`
              : `通算 ${history.career.batting.hits}安打 ${history.career.batting.homeRuns}本塁打`}
          </div>
        </button>
      ))}
    </div>
  );
}

/** その年の物語の見出し（PHASE 3.9） */
function SeasonHeadline({ year }: { year: number }) {
  const { state } = useGame();
  const story = storyOf(state, year);
  if (!story) return null;
  return (
    <div
      style={{
        borderLeft: '3px solid var(--accent)',
        paddingLeft: 8,
        marginBottom: 8,
        fontWeight: 700,
      }}
    >
      {story.headline}
    </div>
  );
}

/** その球団に関係するニュース（PHASE 3.9） */
function TeamNews({ teamId }: { teamId: string }) {
  const { state } = useGame();
  const items = newsForTeam(state, teamId, 12);
  if (items.length === 0) return null;
  return (
    <div className="card">
      <h2>球団ニュース</h2>
      {items.map((item) => (
        <NewsCard key={item.id} item={item} />
      ))}
    </div>
  );
}
