/**
 * ゲーム内ニュース（PHASE 3.9）。
 *
 * ニュースは「起きたことの二次表現」であり、演出でしかない。
 *
 * 設計上の約束：
 *  - ニュースを作ってもゲームの結果は一切変わらない。
 *    能力・契約・順位・乱数のどれにも触れない。
 *  - 乱数を使わない。同じ GameState からは必ず同じニュースができる。
 *  - IDは決定的に決まる。同じ出来事から二度ニュースを作らない。
 *  - 出来事が起きたその場で1回だけ作る。毎日すべての歴史を走査しない。
 *  - 保存量を抑えるため、ニュース本体は直近ぶんだけ残す
 *    （年度別の物語 SeasonStory は消さない）。
 */
import type {
  GameResult,
  GameState,
  NewsCategory,
  NewsItem,
  NewsPriority,
  NewsState,
  Player,
  PostseasonGame,
  RecordEvent,
  SeriesState,
} from './types';
import { formatInnings } from './stats';


/**
 * 段階の呼び名。
 * postseason.ts から取ると読み込みが循環するので、表示用にここへ置く。
 */
const STAGE_LABELS = {
  FIRST: 'ファーストステージ',
  FINAL: 'ファイナルステージ',
  JAPAN_SERIES: '日本シリーズ',
} as const;

/** 保存しておくニュースの件数（古いものから消える） */
export const NEWS_LIMIT = 800;

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  GAME: '試合',
  PLAYER: '選手',
  TEAM: '球団',
  TRANSFER: '移籍',
  CONTRACT: '契約',
  FA: 'FA',
  TRADE: 'トレード',
  DRAFT: 'ドラフト',
  INJURY: '怪我',
  RECORD: '記録',
  AWARD: '表彰',
  POSTSEASON: 'ポストシーズン',
  CHAMPIONSHIP: '優勝',
  RETIREMENT: '引退',
  RIVALRY: 'ライバル',
  SYSTEM: 'お知らせ',
};

export const PRIORITY_LABELS: Record<NewsPriority, string> = {
  LOW: '小',
  NORMAL: '中',
  HIGH: '大',
  BREAKING: '速報',
};

/* ---------------- 入れ物 ---------------- */

export function createNewsState(): NewsState {
  return { items: [], stories: [] };
}

/** 保存データにニュースが無い（PHASE 3.8 以前のセーブ）場合に備える */
export function ensureNews(state: GameState): NewsState {
  if (!state.news) state.news = createNewsState();
  if (!Array.isArray(state.news.items)) state.news.items = [];
  if (!Array.isArray(state.news.stories)) state.news.stories = [];
  return state.news;
}

/** 決定的なニュースID。同じ出来事からは必ず同じIDになる */
export function newsId(year: number, category: NewsCategory, source: string): string {
  return `${year}:${category}:${source}`;
}

export interface NewsDraft {
  category: NewsCategory;
  priority: NewsPriority;
  title: string;
  body: string;
  source: string;
  teamId?: string | null;
  playerId?: string | null;
  relatedTeamIds?: string[];
  relatedPlayerIds?: string[];
}

/**
 * ニュースを1件追加する。
 * すでに同じIDのニュースがあれば何もしない（二重生成の防止）。
 */
export function pushNews(state: GameState, draft: NewsDraft): NewsItem | null {
  const news = ensureNews(state);
  const id = newsId(state.year, draft.category, draft.source);
  // 直近から探す。同じ出来事は近い時期に来るので、全件を走査しない
  for (let i = news.items.length - 1; i >= 0; i--) {
    if (news.items[i].id === id) return null;
    // 年が変わったらそれ以上は遡らない
    if (news.items[i].year < state.year) break;
  }
  const item: NewsItem = {
    id,
    year: state.year,
    date: state.date,
    category: draft.category,
    priority: draft.priority,
    title: draft.title,
    body: draft.body,
    teamId: draft.teamId ?? null,
    playerId: draft.playerId ?? null,
    source: draft.source,
  };
  if (draft.relatedTeamIds?.length) item.relatedTeamIds = draft.relatedTeamIds;
  if (draft.relatedPlayerIds?.length) item.relatedPlayerIds = draft.relatedPlayerIds;
  news.items.push(item);
  if (news.items.length > NEWS_LIMIT) {
    news.items.splice(0, news.items.length - NEWS_LIMIT);
  }
  return item;
}

/* ---------------- 取り出し ---------------- */

/** 新しい順のニュース */
export function recentNews(state: GameState, limit = 20): NewsItem[] {
  const items = state.news?.items ?? [];
  return items.slice(Math.max(0, items.length - limit)).reverse();
}

/** カテゴリで絞り込む */
export function newsOfCategory(state: GameState, category: NewsCategory | 'ALL'): NewsItem[] {
  const items = [...(state.news?.items ?? [])].reverse();
  return category === 'ALL' ? items : items.filter((n) => n.category === category);
}

/** ある球団に関係するニュース */
export function newsForTeam(state: GameState, teamId: string, limit = 30): NewsItem[] {
  const items = state.news?.items ?? [];
  const list: NewsItem[] = [];
  for (let i = items.length - 1; i >= 0 && list.length < limit; i--) {
    const item = items[i];
    if (item.teamId === teamId || item.relatedTeamIds?.includes(teamId)) list.push(item);
  }
  return list;
}

/** ある選手に関係するニュース */
export function newsForPlayer(state: GameState, playerId: string, limit = 30): NewsItem[] {
  const items = state.news?.items ?? [];
  const list: NewsItem[] = [];
  for (let i = items.length - 1; i >= 0 && list.length < limit; i--) {
    const item = items[i];
    if (item.playerId === playerId || item.relatedPlayerIds?.includes(playerId)) {
      list.push(item);
    }
  }
  return list;
}

/** ある年のニュース */
export function newsOfYear(state: GameState, year: number): NewsItem[] {
  return (state.news?.items ?? []).filter((n) => n.year === year).reverse();
}

export function unreadCount(state: GameState): number {
  return (state.news?.items ?? []).filter((n) => !n.read).length;
}

/** 表示したニュースを既読にする */
export function markNewsRead(state: GameState, ids?: string[]): void {
  const news = ensureNews(state);
  const target = ids ? new Set(ids) : null;
  for (const item of news.items) {
    if (!target || target.has(item.id)) item.read = true;
  }
}

/* ---------------- 試合ニュース ---------------- */

const teamName = (state: GameState, id: string | null | undefined) =>
  state.teams.find((t) => t.id === id)?.shortName ?? '―';

/** その球団の現在の連勝・連敗（正なら連勝、負なら連敗） */
export function currentStreak(state: GameState, teamId: string): number {
  let streak = 0;
  let sign = 0;
  for (let i = state.results.length - 1; i >= 0 && streak < 40; i--) {
    const result = state.results[i];
    if (result.homeTeamId !== teamId && result.awayTeamId !== teamId) continue;
    if (result.winnerTeamId === null) break; // 引き分けで途切れる
    const won = result.winnerTeamId === teamId;
    const s = won ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) break;
    streak += 1;
  }
  return sign * streak;
}

/** 逆転した最大の点差（勝ったチームが何点差から追いついたか） */
export function comebackMargin(result: GameResult, winnerTeamId: string): number {
  const winnerIsHome = result.homeTeamId === winnerTeamId;
  const winnerRuns = winnerIsHome ? result.home.inningRuns : result.away.inningRuns;
  const loserRuns = winnerIsHome ? result.away.inningRuns : result.home.inningRuns;
  let win = 0;
  let lose = 0;
  let worst = 0;
  const innings = Math.max(winnerRuns.length, loserRuns.length);
  for (let i = 0; i < innings; i++) {
    win += winnerRuns[i] ?? 0;
    lose += loserRuns[i] ?? 0;
    worst = Math.max(worst, lose - win);
  }
  return worst;
}

/** サヨナラ勝ちか（ホームが最終回に勝ち越した） */
export function isWalkOff(result: GameResult): boolean {
  if (result.winnerTeamId !== result.homeTeamId) return false;
  const last = result.home.inningRuns[result.home.inningRuns.length - 1] ?? 0;
  if (last <= 0) return false;
  return result.home.runs - last <= result.away.runs;
}

/**
 * 試合からニュースを作る（PHASE 3.9）。
 *
 * すべての試合をニュースにすると量が多すぎるので、
 * 実際に取れた成績から「特筆すべき試合」だけを選ぶ。
 */
export function generateGameNews(state: GameState, result: GameResult): void {
  const nameOf = (playerId: string) =>
    state.players.find((p) => p.id === playerId)?.name ?? '選手';

  // ---- 個人の活躍 ----
  for (const line of result.playerLines) {
    const batting = line.batting;
    if (batting) {
      if (batting.homeRuns >= 3) {
        pushNews(state, {
          category: 'PLAYER',
          priority: 'HIGH',
          title: `${nameOf(line.playerId)}が1試合${batting.homeRuns}本塁打`,
          body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が1試合で${batting.homeRuns}本塁打。${batting.rbi}打点をあげた。`,
          source: `${result.id}:hr:${line.playerId}`,
          teamId: line.teamId,
          playerId: line.playerId,
        });
      } else if (batting.hits >= 4) {
        pushNews(state, {
          category: 'PLAYER',
          priority: 'NORMAL',
          title: `${nameOf(line.playerId)}が${batting.hits}安打の固め打ち`,
          body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が${batting.atBats}打数${batting.hits}安打${batting.rbi}打点と当たった。`,
          source: `${result.id}:hits:${line.playerId}`,
          teamId: line.teamId,
          playerId: line.playerId,
        });
      } else if (batting.rbi >= 5) {
        pushNews(state, {
          category: 'PLAYER',
          priority: 'NORMAL',
          title: `${nameOf(line.playerId)}が${batting.rbi}打点`,
          body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が1試合${batting.rbi}打点と打線を牽引した。`,
          source: `${result.id}:rbi:${line.playerId}`,
          teamId: line.teamId,
          playerId: line.playerId,
        });
      }
    }

    const pitching = line.pitching;
    if (!pitching || pitching.starts === 0) continue;
    const complete = pitching.outs >= 27;
    const opponent =
      line.teamId === result.homeTeamId ? result.away : result.home;
    if (complete && opponent.hits === 0) {
      pushNews(state, {
        category: 'PLAYER',
        priority: 'BREAKING',
        title: `${nameOf(line.playerId)}が無安打無得点を達成`,
        body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が${teamName(state, opponent.teamId)}を1本の安打も許さず抑えた。${formatInnings(pitching.outs)}回${pitching.strikeouts}奪三振。`,
        source: `${result.id}:nohit:${line.playerId}`,
        teamId: line.teamId,
        playerId: line.playerId,
      });
    } else if (complete && pitching.runsAllowed === 0) {
      pushNews(state, {
        category: 'PLAYER',
        priority: 'HIGH',
        title: `${nameOf(line.playerId)}が完封勝利`,
        body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が${formatInnings(pitching.outs)}回を投げて無失点。${pitching.strikeouts}奪三振${pitching.hitsAllowed}被安打だった。`,
        source: `${result.id}:shutout:${line.playerId}`,
        teamId: line.teamId,
        playerId: line.playerId,
      });
    } else if (pitching.strikeouts >= 10) {
      pushNews(state, {
        category: 'PLAYER',
        priority: 'NORMAL',
        title: `${nameOf(line.playerId)}が${pitching.strikeouts}奪三振`,
        body: `${teamName(state, line.teamId)}の${nameOf(line.playerId)}が${formatInnings(pitching.outs)}回で${pitching.strikeouts}三振を奪った。`,
        source: `${result.id}:k:${line.playerId}`,
        teamId: line.teamId,
        playerId: line.playerId,
      });
    }
  }

  // ---- 試合そのもの ----
  const winner = result.winnerTeamId;
  if (winner) {
    const diff = Math.abs(result.home.runs - result.away.runs);
    const comeback = comebackMargin(result, winner);
    const loser = winner === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
    if (comeback >= 5) {
      pushNews(state, {
        category: 'GAME',
        priority: 'HIGH',
        title: `${teamName(state, winner)}が${comeback}点差を大逆転`,
        body: `${teamName(state, winner)}が${comeback}点のビハインドをはね返し、${result.home.runs}-${result.away.runs}で${teamName(state, loser)}に勝利した。`,
        source: `${result.id}:comeback`,
        teamId: winner,
        relatedTeamIds: [loser],
      });
    } else if (isWalkOff(result)) {
      pushNews(state, {
        category: 'GAME',
        priority: 'NORMAL',
        title: `${teamName(state, winner)}がサヨナラ勝ち`,
        body: `${teamName(state, winner)}が最終回に勝ち越し、${result.home.runs}-${result.away.runs}で${teamName(state, loser)}を下した。`,
        source: `${result.id}:walkoff`,
        teamId: winner,
        relatedTeamIds: [loser],
      });
    } else if (diff >= 10) {
      pushNews(state, {
        category: 'GAME',
        priority: 'NORMAL',
        title: `${teamName(state, winner)}が${diff}点差の大勝`,
        body: `${teamName(state, winner)}が${result.home.runs}-${result.away.runs}で${teamName(state, loser)}に大勝した。`,
        source: `${result.id}:blowout`,
        teamId: winner,
        relatedTeamIds: [loser],
      });
    } else if (result.innings > 9) {
      pushNews(state, {
        category: 'GAME',
        priority: 'LOW',
        title: `${teamName(state, winner)}が延長${result.innings}回の熱戦を制す`,
        body: `${teamName(state, winner)}が延長${result.innings}回の末、${result.home.runs}-${result.away.runs}で${teamName(state, loser)}を振り切った。`,
        source: `${result.id}:extra`,
        teamId: winner,
        relatedTeamIds: [loser],
      });
    }
  }

  // ---- 連勝・連敗（節目だけ） ----
  for (const teamId of [result.homeTeamId, result.awayTeamId]) {
    const streak = currentStreak(state, teamId);
    if (streak >= 5 && streak % 5 === 0) {
      pushNews(state, {
        category: 'TEAM',
        priority: streak >= 10 ? 'HIGH' : 'NORMAL',
        title: `${teamName(state, teamId)}が${streak}連勝`,
        body: `${teamName(state, teamId)}が${streak}連勝を記録した。`,
        source: `${state.date}:streak:${teamId}:${streak}`,
        teamId,
      });
    } else if (streak <= -5 && streak % 5 === 0) {
      pushNews(state, {
        category: 'TEAM',
        priority: streak <= -10 ? 'HIGH' : 'NORMAL',
        title: `${teamName(state, teamId)}が${-streak}連敗`,
        body: `${teamName(state, teamId)}が${-streak}連敗となり、苦しい戦いが続いている。`,
        source: `${state.date}:streak:${teamId}:${streak}`,
        teamId,
      });
    }
  }
}

/* ---------------- 怪我 ---------------- */

/** 長期離脱だけニュースにする（日単位の調子の上下は扱わない） */
export function generateInjuryNews(state: GameState, player: Player, days: number): void {
  if (days < 14) return;
  pushNews(state, {
    category: 'INJURY',
    priority: days >= 30 ? 'HIGH' : 'NORMAL',
    title: `${player.name}が離脱`,
    body: `${teamName(state, player.teamId)}の${player.name}が${player.ext.injury?.name ?? '故障'}のため約${days}日の離脱となる。`,
    source: `${state.date}:injury:${player.id}`,
    teamId: player.teamId,
    playerId: player.id,
  });
}

/* ---------------- 移籍 ---------------- */

export function generateTradeNews(
  state: GameState,
  fromTeamId: string,
  toTeamId: string,
  fromNames: string[],
  toNames: string[],
  fromIds: string[],
  toIds: string[],
  tradeId: string,
): void {
  const total = fromNames.length + toNames.length;
  const big = total >= 4;
  pushNews(state, {
    category: 'TRADE',
    priority: big ? 'HIGH' : 'NORMAL',
    title: big
      ? `${teamName(state, fromTeamId)}と${teamName(state, toTeamId)}が大型トレード`
      : `${teamName(state, fromTeamId)}と${teamName(state, toTeamId)}がトレード成立`,
    body:
      `${teamName(state, fromTeamId)}から${fromNames.join('、')}、` +
      `${teamName(state, toTeamId)}から${toNames.join('、')}が移籍する。`,
    source: `trade:${tradeId}`,
    teamId: fromTeamId,
    relatedTeamIds: [toTeamId],
    relatedPlayerIds: [...fromIds, ...toIds],
  });
}

export function generateFaNews(
  state: GameState,
  player: Player,
  fromTeamId: string | null,
  toTeamId: string,
  salary: number,
  years: number,
  bigContract: boolean,
): void {
  const stayed = fromTeamId === toTeamId;
  pushNews(state, {
    category: 'FA',
    priority: bigContract ? 'HIGH' : 'NORMAL',
    title: stayed
      ? `${player.name}が${teamName(state, toTeamId)}に残留`
      : `${player.name}が${teamName(state, toTeamId)}へ移籍`,
    body: stayed
      ? `FA権を行使した${player.name}が${teamName(state, toTeamId)}との契約に合意した（${years}年契約）。`
      : `${player.name}がFAで${teamName(state, toTeamId)}への移籍を決めた（${years}年契約）。`,
    source: `fa:${player.id}:${toTeamId}`,
    teamId: toTeamId,
    playerId: player.id,
    relatedTeamIds: fromTeamId && !stayed ? [fromTeamId] : undefined,
  });
  if (bigContract) {
    pushNews(state, {
      category: 'CONTRACT',
      priority: 'NORMAL',
      title: `${player.name}が大型契約`,
      body: `${teamName(state, toTeamId)}が${player.name}と${years}年の大型契約を結んだ（年俸${salary}）。`,
      source: `contract:${player.id}:${toTeamId}`,
      teamId: toTeamId,
      playerId: player.id,
    });
  }
}

export function generateDraftNews(
  state: GameState,
  player: Player,
  teamId: string,
  round: number,
  evaluation: string,
): void {
  pushNews(state, {
    category: 'DRAFT',
    priority: round === 1 ? 'HIGH' : 'LOW',
    title:
      round === 1
        ? `${player.name}がドラフト1位で${teamName(state, teamId)}へ`
        : `${teamName(state, teamId)}が${player.name}を${round}位指名`,
    body: `${teamName(state, teamId)}がドラフト${round}位で${player.name}（${player.age}歳）を指名した。球団の評価は「${evaluation}」。`,
    source: `draft:${state.year}:${player.id}`,
    teamId,
    playerId: player.id,
  });
}

/* ---------------- 引退 ---------------- */

export function generateRetirementNews(
  state: GameState,
  record: { playerId: string; name: string; teamId: string; age: number; years: number },
  career: string,
): void {
  pushNews(state, {
    category: 'RETIREMENT',
    priority: 'HIGH',
    title: `${record.name}が現役引退`,
    body: `${teamName(state, record.teamId)}の${record.name}（${record.age}歳）が現役引退。在籍${record.years}年。${career}`,
    source: `retire:${record.playerId}`,
    teamId: record.teamId,
    playerId: record.playerId,
  });
}

/* ---------------- ポストシーズン ---------------- */

/** シリーズが決着したときのニュース */
export function generateSeriesNews(state: GameState, series: SeriesState): void {
  if (!series.winnerTeamId) return;
  const winner = series.winnerTeamId;
  const loser = series.loserTeamId;
  const winnerWins = winner === series.teamAId ? series.teamAWins : series.teamBWins;
  const loserWins = winner === series.teamAId ? series.teamBWins : series.teamAWins;

  if (series.stage === 'FIRST') {
    pushNews(state, {
      category: 'POSTSEASON',
      priority: 'NORMAL',
      title: `${teamName(state, winner)}がファイナルステージ進出`,
      body: `${STAGE_LABELS.FIRST}は${teamName(state, winner)}が${winnerWins}勝${loserWins}敗で${teamName(state, loser)}を下した。`,
      source: `series:${series.id}`,
      teamId: winner,
      relatedTeamIds: loser ? [loser] : undefined,
    });
    return;
  }
  if (series.stage === 'FINAL') {
    pushNews(state, {
      category: 'CHAMPIONSHIP',
      priority: 'HIGH',
      title: `${teamName(state, winner)}がリーグ優勝`,
      body: `${STAGE_LABELS.FINAL}を${winnerWins}勝${loserWins}敗で制し、${teamName(state, winner)}が日本シリーズ進出を決めた。`,
      source: `series:${series.id}`,
      teamId: winner,
      relatedTeamIds: loser ? [loser] : undefined,
    });
    if (loser) {
      pushNews(state, {
        category: 'POSTSEASON',
        priority: 'NORMAL',
        title: `${teamName(state, loser)}、あと一歩届かず`,
        body: `${teamName(state, loser)}は${STAGE_LABELS.FINAL}で敗れ、今季を終えた。`,
        source: `series:${series.id}:loser`,
        teamId: loser,
        relatedTeamIds: [winner],
      });
    }
    return;
  }
  pushNews(state, {
    category: 'CHAMPIONSHIP',
    priority: 'BREAKING',
    title: `${teamName(state, winner)}が日本一`,
    body: `${state.year}年の日本シリーズは${teamName(state, winner)}が${winnerWins}勝${loserWins}敗で${teamName(state, loser)}を破り、日本一に輝いた。`,
    source: `series:${series.id}`,
    teamId: winner,
    relatedTeamIds: loser ? [loser] : undefined,
  });
}

/** 日本シリーズの重要な試合だけニュースにする */
export function generatePostseasonGameNews(
  state: GameState,
  series: SeriesState,
  game: PostseasonGame,
): void {
  if (series.stage !== 'JAPAN_SERIES') return;
  if (!game.winnerTeamId) return;
  // 王手がかかった試合だけ
  const winnerWins = game.winnerTeamId === series.teamAId ? series.teamAWins : series.teamBWins;
  if (winnerWins !== series.winsRequired - 1) return;
  pushNews(state, {
    category: 'POSTSEASON',
    priority: 'NORMAL',
    title: `${teamName(state, game.winnerTeamId)}が日本シリーズ第${game.gameNumber}戦を制す`,
    body: `${teamName(state, game.winnerTeamId)}が${game.awayRuns}-${game.homeRuns}で勝ち、日本一に王手をかけた。`,
    source: `psgame:${series.id}:${game.gameNumber}`,
    teamId: game.winnerTeamId,
  });
}

/* ---------------- 記録・表彰 ---------------- */

/**
 * 記録更新をニュースにする（PHASE 3.7 の RecordEvent をそのまま使う）。
 * 記録の判定はやり直さない。
 */
export function generateRecordNews(
  state: GameState,
  event: RecordEvent,
  keyLabel: string,
): void {
  // 球団の記録は毎年たくさん入れ替わるので、ニュースにするのはリーグ記録だけにする。
  // 球団記録そのものは PHASE 3.7 の記録画面で見られる。
  if (event.scope !== 'league') return;
  const scope = 'リーグ';
  const kind = event.kind === 'career' ? '通算' : 'シーズン';
  const player = state.players.find((p) => p.id === event.playerId);
  pushNews(state, {
    category: 'RECORD',
    priority: event.scope === 'league' ? 'HIGH' : 'NORMAL',
    title: `${event.name}が${scope}${kind}${keyLabel}記録を更新`,
    body:
      `${event.name}が${scope}の${kind}${keyLabel}記録を更新した` +
      (event.previous === null ? '。' : `（これまでの記録を上回った）。`),
    source: `record:${event.scope}:${event.ownerId}:${event.kind}:${event.key}:${event.playerId}`,
    teamId: player?.teamId ?? null,
    playerId: event.playerId,
  });
}

/** 表彰をニュースにする */
export function generateAwardNews(
  state: GameState,
  playerId: string,
  awardLabel: string,
  leagueName: string,
  priority: NewsPriority = 'NORMAL',
): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  pushNews(state, {
    category: 'AWARD',
    priority,
    title: `${player.name}が${awardLabel}`,
    body: `${leagueName}の${awardLabel}に${teamName(state, player.teamId)}の${player.name}が選ばれた。`,
    source: `award:${awardLabel}:${playerId}`,
    teamId: player.teamId,
    playerId,
  });
}

/* ---------------- ライバル関係 ---------------- */

/**
 * 歴史から見た「よく当たる相手」。
 * ポストシーズンで何度も対戦している組み合わせをライバルと呼ぶ。
 * ゲームの結果には一切影響しない（能力補正も報酬もない）。
 */
export function rivalryCount(state: GameState, a: string, b: string): number {
  let count = 0;
  for (const season of state.history?.seasons ?? []) {
    for (const series of season.postseason?.series ?? []) {
      const pair =
        (series.teamAId === a && series.teamBId === b) ||
        (series.teamAId === b && series.teamBId === a);
      if (pair) count += 1;
    }
  }
  return count;
}

/** 何度も対戦している相手との顔合わせをニュースにする */
export function generateRivalryNews(state: GameState, series: SeriesState): void {
  const count = rivalryCount(state, series.teamAId, series.teamBId);
  if (count < 3) return;
  pushNews(state, {
    category: 'RIVALRY',
    priority: 'NORMAL',
    title: `${teamName(state, series.teamAId)}と${teamName(state, series.teamBId)}が再び激突`,
    body: `両球団のポストシーズンでの対戦はこれで${count + 1}度目となる。`,
    source: `rivalry:${series.id}`,
    teamId: series.teamAId,
    relatedTeamIds: [series.teamBId],
  });
}
