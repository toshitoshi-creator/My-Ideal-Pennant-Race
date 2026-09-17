/**
 * ニュースの「誌面」表示。
 *
 * 見た目は、もらったテンプレート画像（3面〜10面）をそのまま使う。
 * 中身（見出し・本文・数字）はすべて domain/newspaper.ts が実在するデータ
 * から作ったものだけで、ここでは並べ方を決めているだけ（新しい事実は書かない）。
 */
import { useMemo, useState } from 'react';
import type { NewsItem, Player } from '../../domain/types';
import { CATEGORY_LABELS, PRIORITY_LABELS, currentStreak } from '../../domain/news';
import {
  columnFacts,
  farmHighlights,
  playerProfileFacts,
  recentResultsFor,
} from '../../domain/newspaper';
import { formatDateFull } from '../../domain/dates';
import { standingsForLeague, formatWinPct, formatGamesBehind, rankOfTeam } from '../../domain/standings';
import { average, formatAverage } from '../../domain/stats';
import { POSITION_LABELS } from '../../domain/positions';
import { teamVisual } from '../../domain/visuals';
import { PlayerVisualById } from './PlayerVisual';
import { TeamMark, StadiumScene } from './visuals/TeamVisuals';
import {
  Page3Topics,
  Page4Batter,
  Page5Pitcher,
  Page6Team,
  Page7Standings,
  Page8Farm,
  Page9Column,
  Page10Feature,
  type BattingLeaderFacts,
  type FarmRowFacts,
  type StandingsRowFacts,
} from './NewsPaperTemplates';
import { useGame } from '../store';

/** 誌面に出す1ページ。ニュース由来と、特集（順位・ファーム・コラム）の2種 */
type Page =
  | { kind: 'news'; item: NewsItem }
  | { kind: 'standings' }
  | { kind: 'farm' }
  | { kind: 'column' };

/** どのテンプレート画像を使うか。選手ニュースだけ、投手か打者かで分ける */
type TemplateKind = 'page3' | 'page4' | 'page5' | 'page6' | 'page10';

function templateFor(item: NewsItem, player: Player | null): TemplateKind {
  switch (item.category) {
    case 'GAME':
      return 'page3';
    case 'PLAYER':
      return player?.isPitcher ? 'page5' : 'page4';
    case 'RECORD':
    case 'AWARD':
      return player ? (player.isPitcher ? 'page5' : 'page4') : 'page6';
    case 'POSTSEASON':
    case 'CHAMPIONSHIP':
    case 'RIVALRY':
      return 'page10';
    default:
      return 'page6';
  }
}

/** テンプレート画像自体に焼き込まれているページ番号（架空の連番を出さないよう、これに合わせる） */
const TEMPLATE_PAGE_NO: Record<TemplateKind, number> = { page3: 3, page4: 4, page5: 5, page6: 6, page10: 10 };

function pageNumberFor(page: Page, players: Player[]): number {
  if (page.kind === 'standings') return 7;
  if (page.kind === 'farm') return 8;
  if (page.kind === 'column') return 9;
  const player = page.item.playerId ? (players.find((p) => p.id === page.item.playerId) ?? null) : null;
  return TEMPLATE_PAGE_NO[templateFor(page.item, player)];
}

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
      <div className="paper-empty-wrap">
        <div className="paper-empty">まだ誌面にできる記事がありません。</div>
      </div>
    );
  }

  const pageNo = pageNumberFor(page, state.players);
  const jump = (kind: Page['kind']) => {
    const at = pages.findIndex((p) => p.kind === kind);
    if (at >= 0) setIndex(at);
  };

  return (
    <div>
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

      <PaperPage page={page} />

      <div className="paper-nav">
        <button className="chip" disabled={shown === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
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

function PaperPage({ page }: { page: Page }) {
  const { state } = useGame();

  if (page.kind === 'standings') return <StandingsPageView />;
  if (page.kind === 'farm') return <FarmPageView />;
  if (page.kind === 'column') return <ColumnPageView />;

  const item = page.item;
  const player = item.playerId ? (state.players.find((p) => p.id === item.playerId) ?? null) : null;
  const kind = templateFor(item, player);
  const date = formatDateFull(item.date);
  const subhead = `${CATEGORY_LABELS[item.category]}・${PRIORITY_LABELS[item.priority]}ニュース`;
  const team = item.teamId ? state.teams.find((t) => t.id === item.teamId) : null;

  if (kind === 'page3') {
    const recent = item.teamId ? recentResultsFor(state, item.teamId, 3) : [];
    const streak = item.teamId ? currentStreak(state, item.teamId) : 0;
    const highlights: string[] = [];
    if (streak >= 3) highlights.push(`${streak}連勝が続いています`);
    else if (streak <= -3) highlights.push(`${-streak}連敗が続いています`);
    if (recent.length > 0) {
      const w = recent.filter((r) => r.outcome === 'W').length;
      const l = recent.filter((r) => r.outcome === 'L').length;
      const d = recent.filter((r) => r.outcome === 'D').length;
      highlights.push(`直近${recent.length}試合${w}勝${l}敗${d}分`);
    }
    return (
      <Page3Topics
        date={date}
        headline={item.title}
        subhead={subhead}
        lead={item.body}
        results={recent.map((r) => ({
          opponent: `${r.home ? '対' : '＠'}${r.opponentName}`,
          score: `${r.runsFor}-${r.runsAgainst}`,
          outcome: r.outcome === 'W' ? '○' : r.outcome === 'L' ? '●' : '△',
        }))}
        highlights={highlights}
        photo={team ? <TeamMark visual={teamVisual(team)} name={team.name} size={72} /> : undefined}
      />
    );
  }

  if ((kind === 'page4' || kind === 'page5') && item.playerId) {
    const facts = playerProfileFacts(state, item.playerId);
    const salary = player?.ext.contract ? `${player.ext.contract.salary.toLocaleString()}万円` : '未契約';
    const throwsBats = player ? `${player.throws === 'R' ? '右' : '左'}投${player.bats === 'R' ? '右' : '左'}打` : '―';
    const highlight = item.title.length > 0 ? item.title.slice(0, 12) : null;
    const commonProps = {
      date,
      headline: item.title,
      subhead,
      body: item.body,
      highlight,
      photo: (
        <PlayerVisualById
          playerId={item.playerId}
          name={facts?.name ?? ''}
          age={facts?.age ?? player?.age ?? 0}
          isPitcher={!!player?.isPitcher}
          size="medium"
          teamColor={team?.color}
        />
      ),
    };
    if (kind === 'page5' && player) {
      const stats = state.stats[player.id]?.pitching;
      return (
        <Page5Pitcher
          {...commonProps}
          rows={[
            { label: '登板数', value: `${stats?.games ?? 0}` },
            { label: '勝敗', value: `${stats?.wins ?? 0}勝${stats?.losses ?? 0}敗` },
            { label: '防御率', value: stats && stats.outs > 0 ? (stats.earnedRuns / (stats.outs / 27)).toFixed(2) : '0.00' },
            { label: '奪三振', value: `${stats?.strikeouts ?? 0}` },
            { label: '投球回', value: `${Math.floor((stats?.outs ?? 0) / 3)}.${(stats?.outs ?? 0) % 3}` },
          ]}
        />
      );
    }
    return (
      <Page4Batter
        {...commonProps}
        rows={[
          { label: '選手名', value: facts?.name ?? player?.name ?? '' },
          { label: '年齢', value: `${facts?.age ?? player?.age ?? '―'}歳` },
          { label: 'ポジション', value: facts?.positionLabel ?? (player ? POSITION_LABELS[player.mainPosition] : '―') },
          { label: '投打', value: throwsBats },
          { label: '年俸', value: salary },
        ]}
      />
    );
  }

  if (kind === 'page10') {
    return (
      <Page10Feature
        date={date}
        headline={item.title}
        subhead={subhead}
        body={item.body}
        catchphrase={CATEGORY_LABELS[item.category]}
        scene={
          team ? (
            <StadiumScene visual={teamVisual(team)} name={teamVisual(team).stadiumName} height={110} />
          ) : undefined
        }
      />
    );
  }

  // page6: チーム情報（球団に関わるお知らせ全般）
  const record = team ? state.records[team.id] : null;
  const league = team ? state.leagues.find((l) => l.id === team.leagueId) : null;
  const rows = team
    ? [
        { label: '球団名', value: team.name },
        { label: '本拠地', value: teamVisual(team).stadiumName },
        { label: 'リーグ', value: league?.name ?? '―' },
        { label: '今季成績', value: record ? `${record.wins}勝${record.losses}敗${record.draws}分` : '―' },
        { label: '順位', value: team ? `${rankOfTeam(state, team.id)}位` : '―' },
      ]
    : [];
  return (
    <Page6Team
      date={date}
      headline={item.title}
      subhead={subhead}
      body={item.body}
      rows={rows}
      highlight={null}
      photo={team ? <TeamMark visual={teamVisual(team)} name={team.name} size={72} /> : undefined}
    />
  );
}

/* ---------------- 順位・成績 ---------------- */

function StandingsPageView() {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const league = state.leagues.find((l) => l.id === team.leagueId)!;
  const standingsRows = standingsForLeague(state, league.id);

  const standings: StandingsRowFacts[] = standingsRows.map((row, i) => {
    const t = state.teams.find((x) => x.id === row.teamId)!;
    return {
      rank: i + 1,
      teamShort: t.shortName,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      winPct: formatWinPct(row.winPct),
      gamesBehind: formatGamesBehind(row.gamesBehind),
    };
  });

  const leaders: BattingLeaderFacts[] = state.players
    .filter((p) => !p.isPitcher && state.stats[p.id].batting.atBats >= 10)
    .sort((a, b) => average(state.stats[b.id].batting) - average(state.stats[a.id].batting))
    .slice(0, 5)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      average: formatAverage(average(state.stats[p.id].batting)),
      homeRuns: state.stats[p.id].batting.homeRuns,
      rbi: state.stats[p.id].batting.rbi,
    }));

  const rank = rankOfTeam(state, team.id);
  const record = state.records[team.id];

  return (
    <Page7Standings
      date={formatDateFull(state.date)}
      headline={`${league.name}順位表`}
      subhead="現在の順位と、規定打席前を含む打率上位"
      standings={standings}
      leaders={leaders}
      catchphrase={`${team.name}は${rank}位（${record.wins}勝${record.losses}敗${record.draws}分）`}
    />
  );
}

/* ---------------- ファーム情報 ---------------- */

function FarmPageView() {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const highlights = farmHighlights(state, team.id, 5);
  const rows: FarmRowFacts[] = highlights.map((h, i) => ({
    rank: i + 1,
    name: h.name,
    line: h.battingLine ?? h.pitchingLine ?? '―',
  }));

  return (
    <Page8Farm
      date={formatDateFull(state.date)}
      headline="2軍の主な成績"
      subhead="今シーズン、2軍で実際に出場している選手から"
      body={
        highlights.length > 0
          ? `${team.name}の2軍で成績を残している選手をまとめました。`
          : 'まだ2軍での成績が十分にありません。'
      }
      rows={rows}
      catchphrase="若手の成長がチームの未来をつくる"
      photo={<TeamMark visual={teamVisual(team)} name={team.name} size={72} />}
    />
  );
}

/* ---------------- コラム ---------------- */

function ColumnPageView() {
  const { state } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const facts = columnFacts(state, team.id);
  if (!facts) return null;

  const quote = facts.latestDecisionChoice ?? facts.objectiveLine ?? facts.directionLabel;

  return (
    <Page9Column
      date={formatDateFull(state.date)}
      headline="今季の方針"
      subhead={`${team.name}が今季かかげている方針`}
      body={`球団方針は「${facts.directionLabel}」。${facts.objectiveLine ? `今季の目標は${facts.objectiveLine}。` : ''}${facts.latestDecisionTitle ? `直近の判断は「${facts.latestDecisionTitle}」。` : ''}`}
      authorLabel={`${team.name} GM`}
      quote={quote}
      photo={<TeamMark visual={teamVisual(team)} name={team.name} size={72} />}
      scene={<StadiumScene visual={teamVisual(team)} name={teamVisual(team).stadiumName} height={90} />}
    />
  );
}
