import { useMemo, useState } from 'react';
import { useGame, usePlayerMap } from '../store';
import { formatDateFull, formatDateJa } from '../../domain/dates';
import { nextGameForTeam } from '../../domain/schedule';
import { nextStarterId } from '../../domain/setup';
import { teamPower } from '../../domain/rating';
import { rankOfTeam, formatWinPct, winPct } from '../../domain/standings';
import { KeyValue, RankBadge } from '../components/common';
import { GrowthReportSheet } from '../components/GrowthReport';
import { FinanceRows } from './ContractScreen';
import {
  formatMoney,
  isExpiring,
  remainingBudget,
  teamPayroll,
} from '../../domain/contract';
import { championshipCount } from '../../domain/history';
import { recentNews, unreadCount } from '../../domain/news';
import {
  DIRECTION_LABELS,
  FACILITY_KINDS,
  FACILITY_LABELS,
  clubRating,
  objectiveText,
  pendingEvents,
} from '../../domain/club';
import { NewsCard } from '../components/NewsCard';
import { isTradeOpen, pendingOffersForPlayer } from '../../domain/trade';
import {
  faActivityLabel,
  planSummary,
  targetLabels,
  tradeActivityLabel,
} from '../../domain/teamAi';

export function HomeScreen() {
  const { state, playNextGame, skipOneDay, setScreen, advanceSeason, pendingReport, dismissReport, showFA } =
    useGame();
  const [showReport, setShowReport] = useState(false);
  const reportOpen = showReport || pendingReport;
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

  const plan = state.teamPlans?.[team.id];
  const tradeOffers = pendingOffersForPlayer(state);
  const tradeOpen = isTradeOpen(state);
  const finance = state.finances[team.id];
  const payroll = teamPayroll(state, team.id);
  const remaining = remainingBudget(state, team.id);
  const expiringCount = state.players.filter(
    (p) => p.teamId === team.id && isExpiring(p),
  ).length;

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

      {state.fa && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>FA市場開催中</h2>
          <div className="spread" style={{ padding: '4px 0' }}>
            <span className="muted">市場に出ている選手</span>
            <span style={{ fontWeight: 700 }}>
              {state.fa.listings.filter((l) => l.status !== 'SIGNED').length}人
            </span>
          </div>
          <div className="spread" style={{ padding: '4px 0' }}>
            <span className="muted">提示中</span>
            <span style={{ fontWeight: 700 }}>
              {state.fa.offers.filter(
                (o) => o.teamId === team.id && o.status === 'PENDING',
              ).length}
              人
            </span>
          </div>
          <button className="btn primary" style={{ marginTop: 10 }} onClick={() => showFA()}>
            FA市場を見る
          </button>
        </div>
      )}

      <div className="card" style={{ borderColor: tradeOffers.length > 0 ? 'var(--accent)' : undefined }}>
        <h2>トレード</h2>
        {tradeOffers.length > 0 ? (
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
            トレード提案 {tradeOffers.length}件
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 6 }}>
            {tradeOpen
              ? `トレード期限は ${state.trade.deadline} までです`
              : 'トレード市場は閉鎖されています'}
          </div>
        )}
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">今季の成立数</span>
          <span style={{ fontWeight: 700 }}>
            {state.trade.history.filter((r) => r.year === state.year).length}件
          </span>
        </div>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setScreen('trade')}>
          トレードを見る
        </button>
      </div>

      <ClubSummary />

      <LatestNews />

      <div className="card">
        <h2>歴史・記録</h2>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">記録しているシーズン</span>
          <span style={{ fontWeight: 700 }}>{state.history.seasons.length}年</span>
        </div>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">優勝回数</span>
          <span style={{ fontWeight: 700 }}>
            {championshipCount(state.history, state.playerTeamId)}回
          </span>
        </div>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">殿堂入り</span>
          <span style={{ fontWeight: 700 }}>{state.history.hallOfFame.length}人</span>
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setScreen('history')}>
            歴史
          </button>
          <button className="btn secondary" onClick={() => setScreen('records')}>
            記録
          </button>
        </div>
      </div>

      {plan && (
        <div className="card">
          <h2>今季の方針</h2>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{planSummary(plan)}</div>
          {plan.reasons.length > 0 && (
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              {plan.reasons[0]}
            </div>
          )}
          <div className="spread" style={{ padding: '6px 0', marginTop: 6 }}>
            <span className="muted">補強ポイント</span>
            <span style={{ fontWeight: 700 }}>
              {targetLabels(plan).join('・') || '特になし'}
            </span>
          </div>
          <div className="spread" style={{ padding: '4px 0' }}>
            <span className="muted">FA積極度 / トレード積極度</span>
            <span style={{ fontWeight: 700 }}>
              {faActivityLabel(plan)} / {tradeActivityLabel(plan)}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <h2>球団経営</h2>
        <FinanceRows
          cash={finance.cash}
          budget={finance.budget}
          payroll={payroll}
          lastResult={finance.lastResult}
        />
        <div className="spread" style={{ padding: '6px 0' }}>
          <span className="muted">契約満了</span>
          <span style={{ fontWeight: 700 }}>{expiringCount}人</span>
        </div>
        {state.lastOffseason && state.lastOffseason.faListed > 0 && (
          <div className="spread" style={{ padding: '6px 0' }}>
            <span className="muted">今オフのFA補強</span>
            <span style={{ fontWeight: 700 }}>
              {state.lastOffseason.faSignedByPlayer}人（市場{state.lastOffseason.faListed}人）
            </span>
          </div>
        )}
        {remaining < 0 && (
          <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 6, fontSize: 13 }}>
            ⚠ 総年俸が年間予算（{formatMoney(finance.budget)}）を超えています
          </div>
        )}
        {finance.cash < 0 && (
          <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 6, fontSize: 13 }}>
            ⚠ 球団資金が赤字です
          </div>
        )}
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
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>シーズン終了</h2>
          <div style={{ marginBottom: 10 }}>
            {state.year}年シーズンが終了しました。最終成績は {record.wins}勝{record.losses}敗
            {record.draws}分（{rank}位）です。
          </div>
          <PostseasonNotice />
          <button className="btn primary" onClick={() => advanceSeason()}>
            オフシーズンへ（引退・ドラフト）
          </button>
          <div className="muted" style={{ marginTop: 8 }}>
            ポストシーズンが残っていれば最後まで進めたあと、選手が1歳年をとって
            成長・衰退し、引退者が出たあとドラフト会議を行います。
          </div>
        </div>
      )}

      {state.notices.length > 0 && (
        <div className="card">
          <h2>球団ニュース</h2>
          {state.notices
            .slice(-5)
            .reverse()
            .map((notice, i) => (
              <div key={i} style={{ padding: '5px 0', fontSize: 14 }}>
                <span className="muted">{formatDateJa(notice.date)}　</span>
                {notice.message}
              </div>
            ))}
        </div>
      )}

      {state.lastGrowthReport && !state.seasonFinished && (
        <button className="btn secondary" onClick={() => setShowReport(true)}>
          {state.lastGrowthReport.year}年オフの成長・引退を見る
        </button>
      )}

      {reportOpen && state.lastGrowthReport && (
        <GrowthReportSheet
          report={state.lastGrowthReport}
          onClose={() => {
            setShowReport(false);
            dismissReport();
          }}
        />
      )}
    </div>
  );
}

/** シーズン終了カードの中に出す、ポストシーズンの状況（PHASE 3.8） */
function PostseasonNotice() {
  const { state, setScreen } = useGame();
  const postseason = state.postseason;
  if (!postseason) return null;
  const myTeam = state.playerTeamId;
  const entered = Object.values(postseason.participants).some((ids) => ids.includes(myTeam));
  const champion = postseason.championTeamId;
  const teamName = (id: string | null) =>
    state.teams.find((t) => t.id === id)?.shortName ?? '―';

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: 10,
        marginBottom: 10,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 4 }}>
        {champion
          ? `🏆 ${state.year}年 日本一　${teamName(champion)}`
          : entered
            ? 'クライマックスシリーズ進出'
            : 'ポストシーズン進出はなりませんでした'}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        {champion
          ? champion === myTeam
            ? 'おめでとうございます。日本一です。'
            : '今年の日本一が決まりました。'
          : '各リーグの上位3球団でクライマックスシリーズを行い、勝者が日本シリーズに進みます。'}
      </div>
      <button className="btn secondary" onClick={() => setScreen('postseason')}>
        ポストシーズンを見る
      </button>
    </div>
  );
}

/** ホームに出す最新ニュース（PHASE 3.9） */
function LatestNews() {
  const { state, setScreen } = useGame();
  const items = recentNews(state, 5);
  const unread = unreadCount(state);
  if (items.length === 0) return null;
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>最新ニュース</h2>
        {unread > 0 && <span className="chip on">未読 {unread}</span>}
      </div>
      {items.map((item) => (
        <NewsCard key={item.id} item={item} />
      ))}
      <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setScreen('news')}>
        すべて見る
      </button>
    </div>
  );
}

/** ホームに出す球団経営のまとめ（PHASE 4.0） */
function ClubSummary() {
  const { state, setScreen } = useGame();
  const teamId = state.playerTeamId;
  const club = state.clubs?.[teamId];
  if (!club) return null;
  const rating = clubRating(state, teamId);
  const events = pendingEvents(state);
  const facilities = FACILITY_KINDS.map((kind) => `${FACILITY_LABELS[kind].slice(0, 2)}${club.facilities[kind]}`);

  return (
    <div
      className="card"
      style={{ borderColor: events.length > 0 ? 'var(--accent)' : undefined }}
    >
      <h2>球団経営</h2>
      {events.length > 0 && (
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
          判断が必要な案件が{events.length}件あります
        </div>
      )}
      <div className="spread" style={{ padding: '4px 0' }}>
        <span className="muted">今季の方針</span>
        <span style={{ fontWeight: 700 }}>{DIRECTION_LABELS[club.direction]}</span>
      </div>
      <div className="spread" style={{ padding: '4px 0' }}>
        <span className="muted">球団評価</span>
        <span style={{ fontWeight: 700 }}>
          {rating.total} <span className="muted">（戦力{rating.strength} 将来{rating.future}）</span>
        </span>
      </div>
      <div className="spread" style={{ padding: '4px 0' }}>
        <span className="muted">チーム士気</span>
        <span style={{ fontWeight: 700 }}>{Math.round(state.teamMorale[teamId] ?? 50)}</span>
      </div>
      <div className="spread" style={{ padding: '4px 0' }}>
        <span className="muted">施設</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{facilities.join(' / ')}</span>
      </div>
      {club.objectives.length > 0 && (
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">今季の目標</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {objectiveText(club.objectives[0])}
          </span>
        </div>
      )}
      <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setScreen('club')}>
        球団経営を見る
      </button>
    </div>
  );
}
