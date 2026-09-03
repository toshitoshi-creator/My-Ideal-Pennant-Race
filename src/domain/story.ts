/**
 * シーズンストーリー（PHASE 3.9）。
 *
 * その年に起きた出来事をスコアづけして、
 * 「その年を象徴する1文」と要点をまとめる。
 *
 * 設計上の約束：
 *  - 乱数も外部のAIも使わない。同じ結果からは必ず同じ文章ができる。
 *  - ニュース本体は古いものから消えるが、この物語は全年度残す。
 *  - 事実は歴史（PHASE 3.7 / 3.8）から取る。物語が独自の事実を持たない。
 */
import type {
  GameState,
  NewsCategory,
  NewsItem,
  SeasonHistory,
  SeasonStory,
  UpsetLevel,
} from './types';
import { ensureNews, newsOfYear } from './news';

/** 出来事の重さ（見出しを選ぶときの点数） */
export const STORY_SCORE: Record<string, number> = {
  JAPAN_CHAMPION: 100,
  MAJOR_UPSET: 95,
  UPSET: 85,
  LEAGUE_CHAMPION: 80,
  RECORD: 70,
  BIG_TRADE: 60,
  BIG_FA: 60,
  STAR_RETIREMENT: 60,
  ROOKIE: 50,
  STREAK: 40,
};

const teamName = (state: GameState, id: string | null | undefined) =>
  state.teams.find((t) => t.id === id)?.shortName ?? '―';
const playerName = (state: GameState, id: string | null | undefined) =>
  (id ? state.history?.players?.[id]?.name : null) ?? '―';

/** その年の物語がすでにあるか（二重生成の防止） */
export function hasStory(state: GameState, year: number): boolean {
  return (state.news?.stories ?? []).some((s) => s.year === year);
}

export function storyOf(state: GameState, year: number): SeasonStory | undefined {
  return (state.news?.stories ?? []).find((s) => s.year === year);
}

/** レギュラーシーズンの順位からみた下剋上の度合い */
export function upsetLevelOf(state: GameState, season: SeasonHistory): UpsetLevel {
  const postseason = season.postseason;
  if (!postseason) return 'NONE';
  const champion = postseason.japanSeriesChampionTeamId;
  let level: UpsetLevel = 'NONE';
  for (const league of state.leagues) {
    const ids = postseason.participants[league.id] ?? [];
    const leagueChampion = season.leagues.find((l) => l.leagueId === league.id)
      ?.leagueChampionTeamId;
    if (!leagueChampion) continue;
    const rank = ids.indexOf(leagueChampion) + 1;
    if (rank < 2) continue;
    // 3位からのリーグ優勝は大きな下剋上。日本一まで行けばさらに大きい
    if (leagueChampion === champion && rank >= 3) return 'MAJOR_UPSET';
    if (rank >= 2) level = 'UPSET';
  }
  return level;
}

/** その年に目立った選手（表彰を受けた選手を古い順に重複なく） */
function notablePlayersOf(season: SeasonHistory): string[] {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  add(season.postseason?.japanSeriesMvpPlayerId);
  for (const league of season.leagues) {
    add(league.mvpPlayerId);
    add(league.bestPitcherPlayerId);
    add(league.rookiePlayerId);
    add(league.csMvpPlayerId);
  }
  return ids.slice(0, 6);
}

/**
 * その年を象徴する1文を作る。
 * 出来事の点数がいちばん高いものを選ぶ（決まった規則だけで作る）。
 */
export function buildHeadline(
  state: GameState,
  season: SeasonHistory,
  upset: UpsetLevel,
  items: NewsItem[],
): string {
  const postseason = season.postseason;
  const champion = postseason?.japanSeriesChampionTeamId ?? null;
  const championName = teamName(state, champion);

  if (champion && upset === 'MAJOR_UPSET') {
    const rank = championRank(state, season, champion);
    return `${rank}位からの下剋上、${championName}が日本一`;
  }
  if (champion && upset === 'UPSET') {
    return `${championName}がクライマックスシリーズを勝ち抜き日本一`;
  }

  // 記録更新が目立った年
  const record = items.find((n) => n.category === 'RECORD' && n.priority === 'HIGH');
  if (champion && record) {
    return `${record.title}、${championName}が日本一`;
  }

  // 大物の引退があった年
  const retirement = items.find((n) => n.category === 'RETIREMENT');
  if (champion && retirement && items.filter((n) => n.category === 'RETIREMENT').length >= 3) {
    return `${retirement.playerId ? playerName(state, retirement.playerId) : ''}らが引退、${championName}が日本一`;
  }

  if (champion) {
    const pennant = isPennantChampion(season, champion);
    return pennant
      ? `${championName}が圧倒的なシーズンを送り日本一`
      : `${championName}が日本一`;
  }

  // ポストシーズンがまだ無い年（PHASE 3.8 より前のセーブ）
  const winners = season.leagues.map((l) => teamName(state, l.championTeamId));
  return `${winners.join('と')}がリーグを制したシーズン`;
}

/** 日本一球団のレギュラーシーズン順位 */
function championRank(state: GameState, season: SeasonHistory, champion: string): number {
  for (const league of state.leagues) {
    const ids = season.postseason?.participants[league.id] ?? [];
    const index = ids.indexOf(champion);
    if (index >= 0) return index + 1;
  }
  return 1;
}

/** 日本一球団がレギュラーシーズンも1位だったか */
function isPennantChampion(season: SeasonHistory, champion: string): boolean {
  return season.leagues.some((l) => l.championTeamId === champion);
}

/**
 * その年の物語を作る。
 * すでに作ってあれば何もしない（二重生成の防止）。
 */
export function buildSeasonStory(state: GameState, year: number): SeasonStory | null {
  const news = ensureNews(state);
  const existing = storyOf(state, year);
  if (existing) return existing;
  const season = state.history?.seasons?.find((s) => s.year === year);
  if (!season) return null;

  const items = newsOfYear(state, year);
  const upset = upsetLevelOf(state, season);

  const pennantWinners: Record<string, string> = {};
  const leagueChampions: Record<string, string> = {};
  for (const league of season.leagues) {
    pennantWinners[league.leagueId] = league.championTeamId;
    if (league.leagueChampionTeamId) {
      leagueChampions[league.leagueId] = league.leagueChampionTeamId;
    }
  }

  const retirementPlayerIds = items
    .filter((n) => n.category === 'RETIREMENT' && n.playerId)
    .map((n) => n.playerId!)
    .slice(0, 8);
  const rookiePlayerIds = season.leagues
    .map((l) => l.rookiePlayerId)
    .filter((id): id is string => Boolean(id));
  const transferCount = items.filter(
    (n) => n.category === 'TRADE' || n.category === 'FA',
  ).length;
  const recordCount = items.filter((n) => n.category === 'RECORD').length;

  // 重要なニュースを見出しだけ残す（保存量を抑えるため本文は持たない）
  const rank: Record<string, number> = { BREAKING: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const highlights = [...items]
    .sort((a, b) => rank[a.priority] - rank[b.priority])
    .slice(0, 8)
    .map((n) => ({ category: n.category as NewsCategory, title: n.title }));

  const story: SeasonStory = {
    year,
    headline: buildHeadline(state, season, upset, items),
    championTeamId: season.postseason?.japanSeriesChampionTeamId ?? null,
    leagueChampions,
    pennantWinners,
    upset,
    notablePlayerIds: notablePlayersOf(season),
    retirementPlayerIds,
    rookiePlayerIds,
    recordCount,
    transferCount,
    highlights,
  };
  news.stories.push(story);
  news.stories.sort((a, b) => a.year - b.year);
  return story;
}

/** 新しい順の物語 */
export function recentStories(state: GameState, limit = 50): SeasonStory[] {
  const stories = state.news?.stories ?? [];
  return [...stories].reverse().slice(0, limit);
}
