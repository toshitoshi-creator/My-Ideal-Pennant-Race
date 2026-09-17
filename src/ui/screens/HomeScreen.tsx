import { useMemo, useState } from 'react';
import { Sec } from '../components/Sec';
import { useGame, usePlayerMap } from '../store';
import { formatDateFull, formatDateJa } from '../../domain/dates';
import { nextGameForTeam } from '../../domain/schedule';
import { nextStarterId } from '../../domain/setup';
import { teamPower } from '../../domain/rating';
import { rankOfTeam, formatWinPct, winPct } from '../../domain/standings';
import { RankBadge } from '../components/common';
import { GrowthReportSheet } from '../components/GrowthReport';
import { FinanceRows } from './ContractScreen';
import { isExpiring, teamPayroll } from '../../domain/contract';
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
import { GmDeskNote } from '../components/GmDeskNote';
import { buildGmDesk, type GmDeskLink } from '../../domain/gmDesk';
import { buildPreGameBrief } from '../../domain/gameBrief';
import { teamVisual, stadiumMoodForDate } from '../../domain/visuals';
import { TeamMark, StadiumScene } from '../components/visuals/TeamVisuals';
import { PlayerVisual } from '../components/PlayerVisual';
import { PlayerLink } from '../components/PlayerLink';
import { PictureButton } from '../components/PictureButton';
// 次の試合ボタンの絵。Vite が同梱するので、実行時に外へ取りに行くことはない
import nextGameArt from '../../assets/ui/next-game.webp';
import nextGamePressArt from '../../assets/ui/next-game-active.webp';
import nextDayArt from '../../assets/ui/next-day.webp';
import playerCheckArt from '../../assets/ui/player-check.webp';
import clubFinanceArt from '../../assets/ui/club-finance.webp';
import historyArt from '../../assets/ui/history.webp';
import recordsArt from '../../assets/ui/records.webp';
import discoveryArt from '../../assets/ui/discovery.webp';
import tradeArt from '../../assets/ui/trade.webp';
import gmJournalArt from '../../assets/ui/gm-journal.webp';
import {
  planSummary,
  targetLabels,
  faActivityLabel,
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
  const finance = state.finances[team.id];
  const payroll = teamPayroll(state, team.id);
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

  /*
   * PHASE 4.4: 机の上に置く案件（§2・§4）。
   *
   * ここは「問題を見つけて知らせる」だけ。判断は一切自動実行しない。
   * 同じ state からは必ず同じ案件が同じ順で出る（buildGmDesk は乱数を使わない）。
   */
  const desk = useMemo(() => buildGmDesk(state), [state]);
  const brief = useMemo(() => buildPreGameBrief(state), [state]);

  /** 案件の［決められる場所］から実際の画面へ移る。移るだけで、何も決めない */
  const openLink = (link: GmDeskLink) => {
    if (link === 'fa') showFA();
    else setScreen(link);
  };

  return (
    <div className="screen">
      {/* ── 1. 今日の状況 ── 記録用紙の頭 ── */}
      <header className="desk-head">
        <div className="desk-head-top">
          <span className="label">{state.year} SEASON</span>
          <span className="label">{league.name}</span>
        </div>
        {/* PHASE 4.5: 机の上に球団の資料が置かれている（§13）。カードは増やさない */}
        <h2 className="desk-team" style={{ borderBottomColor: team.color }}>
          <TeamMark visual={teamVisual(team)} name={team.name} size={28} />
          {team.name}
        </h2>
        <div className="desk-line">
          {record.games > 0 && (
            <div className="desk-standing">
              <span className="figure">{rank}</span>
              <span className="desk-standing-unit">位</span>
            </div>
          )}
          <div className="desk-record">
            <span className="label">GAME STATUS</span>
            <div className="desk-wl">
              <b>{record.wins}</b>勝 <b>{record.losses}</b>敗 <b>{record.draws}</b>分
            </div>
            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              {record.games > 0
                ? `${record.games}試合 / 勝率 ${formatWinPct(winPct(record))}`
                : '開幕前'}
            </div>
          </div>
        </div>
        <div className="desk-date">
          <span className="label">TODAY</span>
          {formatDateFull(state.date)}
        </div>
      </header>

      {/* ── 2. 試合前資料 ── いちばん面積を取る（§14） ── */}
      <section className="next-game">
        <Sec en="PRE-GAME BRIEF" ja="試合前資料" size="lead" />
        {next && opponent && brief ? (
          <>
            <StadiumScene
              visual={teamVisual(brief.homeAway === 'HOME' ? team : opponent)}
              name={teamVisual(brief.homeAway === 'HOME' ? team : opponent).stadiumName}
              mood={stadiumMoodForDate(next.date)}
              height={92}
            />
            <div className="next-matchup">
              <span className="next-team">
                <TeamMark visual={teamVisual(team)} name={team.name} size={22} />
                {team.shortName}
              </span>
              <span className="next-vs">vs</span>
              <span className="next-team">
                <TeamMark visual={teamVisual(opponent)} name={opponent.name} size={22} />
                {opponent.shortName}
              </span>
            </div>
            <div className="next-meta">
              {formatDateJa(next.date)}・{brief.homeAway === 'HOME' ? 'ホーム' : 'ビジター'}
              　{opponent.shortName} {brief.opponentRecord}
            </div>
            {/*
              PHASE 4.5 §17: 次の試合の先発を顔でも出す。
              名前と寸評は必ず文字でも残す（画像だけで伝えない。§36）
            */}
            <div className="next-starter-face">
              {starter && <PlayerVisual player={starter} size="small" teamColor={team.color} />}
              <span className="next-starter-face-text">
                <span className="label">先発</span>
                <span>
                  {starter ? (
                    <>
                      <PlayerLink playerId={starter.id}>{starter.name}</PlayerLink>　{brief.starterNote}
                    </>
                  ) : (
                    '未設定'
                  )}
                </span>
              </span>
            </div>
            <div className="next-starter">
              <span className="label">TEAM FORM</span>
              <span>{brief.teamForm}</span>
            </div>
            {brief.watch.length > 0 && (
              <div className="brief-watch">
                <span className="label">WATCH</span>
                <span className="brief-watch-ja">今日の見どころ</span>
                <ul className="brief-watch-list">
                  {brief.watch.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="muted" style={{ padding: '10px 0' }}>
            残り試合はありません（シーズン終了）
          </div>
        )}
        {/*
          次の試合はこの画面でいちばん強い動線なので、絵の入ったボタンにしている。
          押している間だけ2枚目に差し替わる（画像は2枚とも最初から読み込んでおく）。
          読み上げには「次の試合へ」と伝わるよう、文字も残してある。
        */}
        <button
          className="btn-next-game"
          disabled={!next}
          onClick={() => {
            const result = playNextGame();
            if (result) setScreen('game');
          }}
        >
          <img className="next-game-idle" src={nextGameArt} alt="" />
          <img className="next-game-press" src={nextGamePressArt} alt="" />
          <span className="sr-only">次の試合へ</span>
        </button>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <PictureButton src={nextDayArt} alt="1日進める" onClick={() => skipOneDay()} />
        </div>
      </section>

      {state.seasonFinished && (
        <div className="panel">
          <div className="label" style={{ color: 'var(--accent)' }}>SEASON CLOSED</div>
          <div style={{ margin: '4px 0 10px', fontWeight: 700 }}>
            {state.year}年シーズン終了。{record.wins}勝{record.losses}敗{record.draws}分（{rank}位）
          </div>
          <PostseasonNotice />
          <button className="btn primary" onClick={() => advanceSeason()}>
            オフシーズンへ
          </button>
        </div>
      )}

      {/* ── 3. GMの机 ── 今日の判断材料（§4） ── */}
      {desk.length > 0 && (
        <div className="card">
          <Sec en="GM NOTE" ja="今日の判断材料" size="lead" note={`${desk.length}件`} />
          <p className="gm-desk-lead">
            見つけた案件です。どれも自動では動きません。決めるのはGMであるあなたです。
          </p>
          {desk.map((item, i) => (
            <GmDeskNote
              key={item.id}
              item={item}
              index={i}
              dateLabel={formatDateJa(state.date)}
              onOpen={openLink}
            />
          ))}
        </div>
      )}

      {/*
        PHASE 4.9-A: 「最近調子悪い選手いないかな」から1〜2操作で確認できる入り口。
        GM Desk の案件（問題があるときだけ出る）とは別に、いつでも自分から開ける。
      */}
      <div className="card">
        <Sec en="PLAYER CHECK" ja="選手チェック" size="sub" />
        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 10 }}>
          不調・打撃不振・投手不振の選手をまとめて確認できます。
        </p>
        <PictureButton
          src={playerCheckArt}
          alt="選手チェックを開く"
          onClick={() => setScreen('playerCheck')}
        />
      </div>

      {/* ── 4. チーム状態 ── */}
      <div className="card">
        <Sec en="TEAM STATUS" ja="チーム状態" />
        <PowerLine label="総合" value={power.total} lead />
        <PowerLine label="打撃" value={power.batting} />
        <PowerLine label="投手" value={power.pitching} />
        <PowerLine label="守備" value={power.defense} />
        {plan && (
          <div className="stat-line" style={{ marginTop: 6 }}>
            <span className="muted">今季の方針</span>
            <span style={{ fontWeight: 700 }}>{planSummary(plan)}</span>
          </div>
        )}
        {plan && (
          <div className="stat-line">
            <span className="muted">補強ポイント</span>
            <span style={{ fontWeight: 700 }}>
              {targetLabels(plan).join('・') || '特になし'}
            </span>
          </div>
        )}
        {plan && (
          <div className="stat-line">
            <span className="muted">FA積極度 / トレード積極度</span>
            <span style={{ fontWeight: 700 }}>
              {faActivityLabel(plan)} / {tradeActivityLabel(plan)}
            </span>
          </div>
        )}
      </div>

      <ClubSummary />

      {/* ── 5. ニュース ── */}
      <LatestNews />

      {state.notices.length > 0 && (
        <div className="card">
          <Sec en="CLUB BULLETIN" ja="球団報" size="sub" />
          {state.notices
            .slice(-5)
            .reverse()
            .map((notice, i) => (
              <div key={i} className="notice-line">
                <span className="notice-date">{formatDateJa(notice.date)}</span>
                {notice.message}
              </div>
            ))}
        </div>
      )}

      {/* ── 6. 資料 ── 参照するだけのものは下 ── */}
      <div className="card">
        <Sec en="FINANCE" ja="球団経営" size="sub" />
        <FinanceRows
          cash={finance.cash}
          budget={finance.budget}
          payroll={payroll}
          lastResult={finance.lastResult}
        />
        <div className="stat-line">
          <span className="muted">契約満了</span>
          <span style={{ fontWeight: 700 }}>{expiringCount}人</span>
        </div>
      </div>

      <div className="card">
        <Sec en="RECORD BOOK" ja="歴史・記録" size="sub" />
        <div className="stat-line">
          <span className="muted">記録しているシーズン</span>
          <span style={{ fontWeight: 700 }}>{state.history.seasons.length}年</span>
        </div>
        <div className="stat-line">
          <span className="muted">優勝 / 殿堂入り</span>
          <span style={{ fontWeight: 700 }}>
            {championshipCount(state.history, state.playerTeamId)}回 /{' '}
            {state.history.hallOfFame.length}人
          </span>
        </div>
        <div className="icon-grid" style={{ marginTop: 10 }}>
          <PictureButton src={historyArt} alt="歴史" onClick={() => setScreen('history')} />
          <PictureButton src={recordsArt} alt="記録" onClick={() => setScreen('records')} />
          <PictureButton src={discoveryArt} alt="発掘" onClick={() => setScreen('discovery')} />
          <PictureButton src={tradeArt} alt="トレードを見る" onClick={() => setScreen('trade')} />
        </div>
        <PictureButton src={gmJournalArt} alt="GM日誌" onClick={() => setScreen('news')} />
      </div>

      {state.lastGrowthReport && !state.seasonFinished && (
        <button
          className="btn secondary"
          style={{ marginTop: 12 }}
          onClick={() => setShowReport(true)}
        >
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

/**
 * 絵だけのボタン（PHASE: ホームの各入り口を絵に差し替え）。
 * 読み上げには alt でラベルが伝わる。押した／押せないの見た目は CSS 側で付ける。
 */
/** チーム状態の1行。数値・ランク・棒をまとめて出す */
function PowerLine({ label, value, lead }: { label: string; value: number; lead?: boolean }) {
  return (
    <div className={`power-line${lead ? ' lead' : ''}`}>
      <span className="power-label">{label}</span>
      <span className="power-bar">
        <span style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
      </span>
      <span className="power-value">{value}</span>
      <RankBadge value={value} />
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
      {items.map((item, i) => (
        <NewsCard key={item.id} item={item} index={i} />
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
      <Sec en="CLUB STATUS" ja="球団の状態" />
      {events.length > 0 && (
        <div className="panel" style={{ marginTop: 0 }}>
          <span className="label" style={{ color: 'var(--accent)' }}>要判断</span>
          <div style={{ fontWeight: 700, marginTop: 2 }}>
            判断が必要な案件が{events.length}件あります
          </div>
        </div>
      )}
      <div className="stat-line">
        <span className="muted">球団方針</span>
        <span style={{ fontWeight: 700 }}>{DIRECTION_LABELS[club.direction]}</span>
      </div>
      <div className="stat-line">
        <span className="muted">球団評価</span>
        <span style={{ fontWeight: 700 }}>
          {rating.total}
          <span className="muted" style={{ marginLeft: 6 }}>
            戦力{rating.strength}・将来{rating.future}
          </span>
        </span>
      </div>
      <div className="stat-line">
        <span className="muted">チーム士気</span>
        <span style={{ fontWeight: 700 }}>{Math.round(state.teamMorale[teamId] ?? 50)}</span>
      </div>
      <div className="stat-line">
        <span className="muted">施設</span>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
          {facilities.join(' / ')}
        </span>
      </div>
      {club.objectives.length > 0 && (
        <div className="stat-line">
          <span className="muted">今季の目標</span>
          <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
            {objectiveText(club.objectives[0])}
          </span>
        </div>
      )}
      <PictureButton
        src={clubFinanceArt}
        alt="球団経営を見る"
        onClick={() => setScreen('club')}
      />
    </div>
  );
}
