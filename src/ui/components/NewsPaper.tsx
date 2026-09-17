/**
 * ニュースの「誌面」表示。
 *
 * 1件のニュース、または「順位・成績」「ファーム情報」「コラム」の
 * 特集ページを、新聞の1ページ（○面）に見立てて表示する。
 * 材料はすべて domain/newspaper.ts が実在するデータから作ったものだけで、
 * ここでは並べ方を決めているだけ（新しい事実は書かない）。
 */
import { useMemo, useState } from 'react';
import type { NewsItem } from '../../domain/types';
import { CATEGORY_LABELS, PRIORITY_LABELS } from '../../domain/news';
import {
  KICKER_LABELS,
  columnFacts,
  farmHighlights,
  pageKindOf,
  playerProfileFacts,
  recentResultsFor,
  type PageKind,
} from '../../domain/newspaper';
import { formatDateJa } from '../../domain/dates';
import { standingsForLeague, formatWinPct } from '../../domain/standings';
import { average, formatAverage } from '../../domain/stats';
import { teamVisual } from '../../domain/visuals';
import { PlayerVisualById } from './PlayerVisual';
import { TeamMark } from './visuals/TeamVisuals';
import { PlayerLink } from './PlayerLink';
import { useGame } from '../store';
import paperLogo from '../../assets/ui/paper-logo.webp';

/** 誌面に出す1ページ。ニュース由来と、特集（順位・ファーム・コラム）の2種 */
type Page =
  | { kind: 'news'; item: NewsItem }
  | { kind: 'standings' }
  | { kind: 'farm' }
  | { kind: 'column' };

/**
 * 「3面」から始まる紙面。
 * 1・2面（表紙・目次に相当）は作らないので、最初から3を振る。
 */
const FIRST_PAGE_NO = 3;

export function NewsPaperReader({ items }: { items: NewsItem[] }) {
  const { state } = useGame();
  const teamId = state.playerTeamId;
  const hasColumn = !!state.clubs?.[teamId];

  const pages: Page[] = useMemo(() => {
    const specials: Page[] = [{ kind: 'standings' }, { kind: 'farm' }];
    if (hasColumn) specials.push({ kind: 'column' });
    return [...specials, ...items.map((item): Page => ({ kind: 'news', item }))];
  }, [items, hasColumn]);

  const [index, setIndex] = useState(0);
  const shown = Math.min(index, pages.length - 1);
  const page = pages[shown];

  if (pages.length === 0) {
    return (
      <div className="paper-page">
        <div className="paper-empty">まだ誌面にできる記事がありません。</div>
      </div>
    );
  }

  const pageNo = FIRST_PAGE_NO + shown;
  const jump = (kind: Page['kind']) => {
    const at = pages.findIndex((p) => p.kind === kind);
    if (at >= 0) setIndex(at);
  };

  return (
    <div>
      {/* 特集ページへの近道。ニュースが少ない開幕直後でも読むものがある */}
      <div className="paper-quick">
        <button className={page.kind === 'standings' ? 'chip on' : 'chip'} onClick={() => jump('standings')}>
          順位・成績
        </button>
        <button className={page.kind === 'farm' ? 'chip on' : 'chip'} onClick={() => jump('farm')}>
          ファーム情報
        </button>
        {hasColumn && (
          <button className={page.kind === 'column' ? 'chip on' : 'chip'} onClick={() => jump('column')}>
            コラム
          </button>
        )}
      </div>

      <PaperPage page={page} pageNo={pageNo} />

      <div className="paper-nav">
        <button
          className="chip"
          disabled={shown === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          ← 前の面
        </button>
        <span className="paper-nav-count">
          {pageNo}面 ({shown + 1}/{pages.length})
        </span>
        <button
          className="chip"
          disabled={shown >= pages.length - 1}
          onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
        >
          次の面 →
        </button>
      </div>
    </div>
  );
}

function PaperPage({ page, pageNo }: { page: Page; pageNo: number }) {
  const { state } = useGame();

  if (page.kind === 'standings') return <StandingsPage pageNo={pageNo} />;
  if (page.kind === 'farm') return <FarmPage pageNo={pageNo} />;
  if (page.kind === 'column') return <ColumnPage pageNo={pageNo} />;

  const item = page.item;
  const kind = pageKindOf(item.category);
  return <NewsItemPage item={item} kind={kind} pageNo={pageNo} state={state} />;
}

function Masthead({ pageNo, dateLabel }: { pageNo: number; dateLabel: string }) {
  return (
    <div className="paper-masthead">
      <span className="paper-page-no">{pageNo}面</span>
      <img className="paper-logo" src={paperLogo} alt="ベースボールニュース" />
      <span>{dateLabel}</span>
    </div>
  );
}

function Kicker({ kind, label }: { kind: PageKind; label: string }) {
  return <span className={`paper-kicker k-${kind}`}>{label}</span>;
}

/* ---------------- ニュース由来のページ ---------------- */

function NewsItemPage({
  item,
  kind,
  pageNo,
  state,
}: {
  item: NewsItem;
  kind: PageKind;
  pageNo: number;
  state: ReturnType<typeof useGame>['state'];
}) {
  const player = item.playerId ? playerProfileFacts(state, item.playerId) : null;
  const recent = item.teamId ? recentResultsFor(state, item.teamId) : [];
  const team = item.teamId ? state.teams.find((t) => t.id === item.teamId) : null;

  return (
    <div className="paper-page">
      <Masthead pageNo={pageNo} dateLabel={formatDateJa(item.date)} />
      <Kicker kind={kind} label={KICKER_LABELS[kind]} />
      <h2 className="paper-headline">{item.title}</h2>
      <p className="paper-subhead">
        {CATEGORY_LABELS[item.category]}・{PRIORITY_LABELS[item.priority]}ニュース
      </p>

      {player && item.playerId && (
        <div className="paper-figure">
          <PlayerVisualById
            playerId={item.playerId}
            name={player.name}
            age={player.age}
            isPitcher={player.isPitcher}
            size="medium"
            teamColor={team?.color}
          />
          <div>
            <div style={{ fontWeight: 800 }}>
              <PlayerLink playerId={item.playerId}>{player.name}</PlayerLink> 選手プロフィール
            </div>
            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              背番号{player.number}・{player.age}歳・{player.positionLabel}
            </div>
          </div>
        </div>
      )}

      {!player && team && (
        <div className="paper-figure">
          <TeamMark visual={teamVisual(team)} name={team.name} size={40} />
          <div style={{ fontWeight: 800 }}>{team.name}</div>
        </div>
      )}

      <p className="paper-body">{item.body}</p>

      {player?.battingLine && (
        <div className="paper-box">
          <div className="paper-box-title">打撃成績（今季）</div>
          <div>{player.battingLine}</div>
        </div>
      )}
      {player?.pitchingLine && (
        <div className="paper-box">
          <div className="paper-box-title">投手成績（今季）</div>
          <div>{player.pitchingLine}</div>
        </div>
      )}

      {kind === 'game' && recent.length > 0 && (
        <div className="paper-box">
          <div className="paper-box-title">試合結果</div>
          <table className="data">
            <tbody>
              {recent.map((r) => (
                <tr key={r.date}>
                  <td className="l">{formatDateJa(r.date)}</td>
                  <td className="l">
                    {r.home ? '対' : '＠'}
                    {r.opponentName}
                  </td>
                  <td>
                    {r.outcome === 'W' ? '○' : r.outcome === 'L' ? '●' : '△'} {r.runsFor}-
                    {r.runsAgainst}
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

/* ---------------- 順位・成績 ---------------- */

function StandingsPage({ pageNo }: { pageNo: number }) {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const league = state.leagues.find((l) => l.id === team.leagueId)!;
  const rows = standingsForLeague(state, league.id);

  const batters = state.players
    .filter((p) => !p.isPitcher && state.stats[p.id].batting.atBats >= 10)
    .sort((a, b) => average(state.stats[b.id].batting) - average(state.stats[a.id].batting))
    .slice(0, 5);

  return (
    <div className="paper-page">
      <Masthead pageNo={pageNo} dateLabel={formatDateJa(state.date)} />
      <Kicker kind="record" label="順位・成績" />
      <h2 className="paper-headline">{league.name}順位表</h2>
      <p className="paper-subhead">現在の順位と、規定打席前を含む打率上位</p>

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const t = state.teams.find((x) => x.id === row.teamId)!;
              return (
                <tr key={row.teamId} style={{ fontWeight: t.id === state.playerTeamId ? 800 : undefined }}>
                  <td>{i + 1}</td>
                  <td className="l">{t.shortName}</td>
                  <td>{row.games}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{row.draws}</td>
                  <td>{formatWinPct(row.winPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {batters.length > 0 && (
        <div className="paper-box" style={{ marginTop: 10 }}>
          <div className="paper-box-title">チーム打撃成績（打率上位）</div>
          <table className="data">
            <tbody>
              {batters.map((p, i) => (
                <tr key={p.id}>
                  <td className="l">{i + 1}</td>
                  <td className="l">
                    <PlayerLink playerId={p.id}>{p.name}</PlayerLink>
                  </td>
                  <td>{formatAverage(average(state.stats[p.id].batting))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- ファーム情報 ---------------- */

function FarmPage({ pageNo }: { pageNo: number }) {
  const { state } = useGame();
  const teamId = state.playerTeamId;
  const highlights = farmHighlights(state, teamId);

  return (
    <div className="paper-page">
      <Masthead pageNo={pageNo} dateLabel={formatDateJa(state.date)} />
      <Kicker kind="team" label="ファーム情報" />
      <h2 className="paper-headline">2軍の主な成績</h2>
      <p className="paper-subhead">今シーズン、2軍で実際に出場している選手から</p>

      {highlights.length === 0 ? (
        <p className="muted">まだ2軍での成績が十分にありません。</p>
      ) : (
        <table className="data">
          <tbody>
            {highlights.map((h) => (
              <tr key={h.playerId}>
                <td className="l">
                  <PlayerLink playerId={h.playerId}>{h.name}</PlayerLink>
                </td>
                <td className="l">{h.positionLabel}</td>
                <td className="l">{h.battingLine ?? h.pitchingLine ?? '―'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- コラム ---------------- */

function ColumnPage({ pageNo }: { pageNo: number }) {
  const { state } = useGame();
  const teamId = state.playerTeamId;
  const facts = columnFacts(state, teamId);
  const team = state.teams.find((t) => t.id === teamId)!;

  if (!facts) return null;

  return (
    <div className="paper-page">
      <Masthead pageNo={pageNo} dateLabel={formatDateJa(state.date)} />
      <Kicker kind="feature" label="コラム" />
      <h2 className="paper-headline">今季の方針</h2>
      <p className="paper-subhead">{team.name}が今季かかげている方針</p>

      <div className="paper-box">
        <div className="paper-box-title">球団方針</div>
        <div>{facts.directionLabel}</div>
      </div>

      {facts.objectiveLine && (
        <div className="paper-box">
          <div className="paper-box-title">今季の目標</div>
          <div>{facts.objectiveLine}</div>
        </div>
      )}

      {facts.latestDecisionTitle && (
        <div className="paper-box">
          <div className="paper-box-title">直近の判断（GM日誌より）</div>
          <div style={{ fontWeight: 700 }}>{facts.latestDecisionTitle}</div>
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {facts.latestDecisionChoice}
          </div>
        </div>
      )}
    </div>
  );
}
