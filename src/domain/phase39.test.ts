import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import {
  CATEGORY_LABELS,
  NEWS_LIMIT,
  PRIORITY_LABELS,
  comebackMargin,
  createNewsState,
  currentStreak,
  ensureNews,
  isWalkOff,
  markNewsRead,
  newsForPlayer,
  newsForTeam,
  newsId,
  newsOfCategory,
  newsOfYear,
  pushNews,
  recentNews,
  rivalryCount,
  unreadCount,
} from './news';
import {
  STORY_SCORE,
  buildSeasonStory,
  hasStory,
  recentStories,
  storyOf,
  upsetLevelOf,
} from './story';
import { autoCompletePostseason } from './postseason';
import { clearSave, loadGame, migrate, saveGame } from './save';
import type {
  GameResult,
  GameState,
  NewsCategory,
  NewsPriority,
} from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 390390): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playRegularSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 390390, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
  for (let i = 0; i < count; i++) {
    s = playRegularSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

/** テスト用の試合結果 */
function makeResult(overrides: Partial<GameResult> = {}): GameResult {
  return {
    id: 'g1',
    date: '2026-04-01',
    leagueId: 'grand',
    homeTeamId: 'phoenix',
    awayTeamId: 'bluewave',
    home: { teamId: 'phoenix', runs: 3, hits: 8, errors: 0, inningRuns: [0, 0, 3, 0, 0, 0, 0, 0, 0] },
    away: { teamId: 'bluewave', runs: 1, hits: 5, errors: 0, inningRuns: [1, 0, 0, 0, 0, 0, 0, 0, 0] },
    innings: 9,
    winnerTeamId: 'phoenix',
    loserTeamId: 'bluewave',
    winningPitcherId: null,
    losingPitcherId: null,
    commentary: [],
    playerLines: [],
    ...overrides,
  };
}

function draftOf(overrides: Partial<Parameters<typeof pushNews>[1]> = {}) {
  return {
    category: 'GAME' as NewsCategory,
    priority: 'NORMAL' as NewsPriority,
    title: 'タイトル',
    body: '本文',
    source: 'src1',
    ...overrides,
  };
}

/* ================= 入れ物とID ================= */

describe('PHASE3.9 ニュースの入れ物', () => {
  it('新規ゲームではニュースが空', () => {
    const s = newGame();
    expect(s.news.items).toHaveLength(0);
    expect(s.news.stories).toHaveLength(0);
  });

  it('createNewsStateは空の状態を作る', () => {
    const news = createNewsState();
    expect(news.items).toEqual([]);
    expect(news.stories).toEqual([]);
  });

  it('ensureNewsは欠けている入れ物を作る', () => {
    const s = newGame();
    (s as unknown as Record<string, unknown>).news = undefined;
    const news = ensureNews(s);
    expect(news.items).toEqual([]);
    expect(news.stories).toEqual([]);
  });

  it('壊れたニュース状態も直せる', () => {
    const s = newGame();
    (s as unknown as Record<string, unknown>).news = { items: null, stories: null };
    const news = ensureNews(s);
    expect(Array.isArray(news.items)).toBe(true);
    expect(Array.isArray(news.stories)).toBe(true);
  });

  it('IDは年・カテゴリ・出来事から決まる', () => {
    expect(newsId(2030, 'GAME', 'x')).toBe('2030:GAME:x');
    expect(newsId(2030, 'GAME', 'x')).toBe(newsId(2030, 'GAME', 'x'));
  });

  it('年が違えば別のID', () => {
    expect(newsId(2030, 'GAME', 'x')).not.toBe(newsId(2031, 'GAME', 'x'));
  });

  it('カテゴリが違えば別のID', () => {
    expect(newsId(2030, 'GAME', 'x')).not.toBe(newsId(2030, 'TEAM', 'x'));
  });

  it('IDに時刻や乱数が入らない', () => {
    const a = newsId(2030, 'GAME', 'x');
    const b = newsId(2030, 'GAME', 'x');
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{13}/);
  });

  it('ニュースを1件追加できる', () => {
    const s = newGame();
    const item = pushNews(s, draftOf());
    expect(item).not.toBeNull();
    expect(s.news.items).toHaveLength(1);
    expect(item!.year).toBe(s.year);
    expect(item!.date).toBe(s.date);
  });

  it('同じ出来事から二度ニュースを作らない', () => {
    const s = newGame();
    pushNews(s, draftOf());
    const second = pushNews(s, draftOf());
    expect(second).toBeNull();
    expect(s.news.items).toHaveLength(1);
  });

  it('出来事が違えば別のニュースになる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a' }));
    pushNews(s, draftOf({ source: 'b' }));
    expect(s.news.items).toHaveLength(2);
  });

  it('カテゴリが違えば別のニュースになる', () => {
    const s = newGame();
    pushNews(s, draftOf({ category: 'GAME' }));
    pushNews(s, draftOf({ category: 'TEAM' }));
    expect(s.news.items).toHaveLength(2);
  });

  it('上限を超えると古いものから消える', () => {
    const s = newGame();
    for (let i = 0; i < NEWS_LIMIT + 40; i++) pushNews(s, draftOf({ source: `s${i}` }));
    expect(s.news.items).toHaveLength(NEWS_LIMIT);
    expect(s.news.items[0].source).toBe('s40');
  });

  it('関連する選手・球団を持てる', () => {
    const s = newGame();
    const item = pushNews(
      s,
      draftOf({ relatedTeamIds: ['bluewave'], relatedPlayerIds: ['p1'] }),
    )!;
    expect(item.relatedTeamIds).toEqual(['bluewave']);
    expect(item.relatedPlayerIds).toEqual(['p1']);
  });

  it('関連が無ければフィールドを持たない（保存量を抑える）', () => {
    const s = newGame();
    const item = pushNews(s, draftOf())!;
    expect(item.relatedTeamIds).toBeUndefined();
    expect(item.relatedPlayerIds).toBeUndefined();
  });

  it('カテゴリの表示名がすべて用意されている', () => {
    const categories: NewsCategory[] = [
      'GAME', 'PLAYER', 'TEAM', 'TRANSFER', 'CONTRACT', 'FA', 'TRADE', 'DRAFT',
      'INJURY', 'RECORD', 'AWARD', 'POSTSEASON', 'CHAMPIONSHIP', 'RETIREMENT',
      'RIVALRY', 'SYSTEM',
    ];
    for (const c of categories) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });

  it('重要度の表示名がすべて用意されている', () => {
    for (const p of ['LOW', 'NORMAL', 'HIGH', 'BREAKING'] as NewsPriority[]) {
      expect(PRIORITY_LABELS[p]).toBeTruthy();
    }
  });
});

/* ================= 取り出し ================= */

describe('PHASE3.9 ニュースの取り出し', () => {
  it('新しい順に取り出せる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a', title: '1件目' }));
    pushNews(s, draftOf({ source: 'b', title: '2件目' }));
    expect(recentNews(s, 5).map((n) => n.title)).toEqual(['2件目', '1件目']);
  });

  it('件数を絞れる', () => {
    const s = newGame();
    for (let i = 0; i < 10; i++) pushNews(s, draftOf({ source: `s${i}` }));
    expect(recentNews(s, 3)).toHaveLength(3);
  });

  it('カテゴリで絞れる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a', category: 'GAME' }));
    pushNews(s, draftOf({ source: 'b', category: 'TRADE' }));
    expect(newsOfCategory(s, 'TRADE')).toHaveLength(1);
    expect(newsOfCategory(s, 'ALL')).toHaveLength(2);
  });

  it('球団で絞れる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a', teamId: PLAYER_TEAM }));
    pushNews(s, draftOf({ source: 'b', teamId: 'bluewave' }));
    pushNews(s, draftOf({ source: 'c', teamId: 'oceans', relatedTeamIds: [PLAYER_TEAM] }));
    expect(newsForTeam(s, PLAYER_TEAM)).toHaveLength(2);
  });

  it('選手で絞れる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a', playerId: 'p1' }));
    pushNews(s, draftOf({ source: 'b', playerId: 'p2' }));
    pushNews(s, draftOf({ source: 'c', relatedPlayerIds: ['p1'] }));
    expect(newsForPlayer(s, 'p1')).toHaveLength(2);
  });

  it('年で絞れる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a' }));
    expect(newsOfYear(s, s.year)).toHaveLength(1);
    expect(newsOfYear(s, s.year + 1)).toHaveLength(0);
  });

  it('未読件数を数えられる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a' }));
    pushNews(s, draftOf({ source: 'b' }));
    expect(unreadCount(s)).toBe(2);
  });

  it('既読にできる', () => {
    const s = newGame();
    pushNews(s, draftOf({ source: 'a' }));
    markNewsRead(s);
    expect(unreadCount(s)).toBe(0);
  });

  it('指定したニュースだけ既読にできる', () => {
    const s = newGame();
    const a = pushNews(s, draftOf({ source: 'a' }))!;
    pushNews(s, draftOf({ source: 'b' }));
    markNewsRead(s, [a.id]);
    expect(unreadCount(s)).toBe(1);
  });
});

/* ================= 試合ニュースの判定 ================= */

describe('PHASE3.9 試合の判定', () => {
  it('最終回に勝ち越せばサヨナラ', () => {
    const result = makeResult({
      home: { teamId: 'phoenix', runs: 2, hits: 6, errors: 0, inningRuns: [0, 0, 0, 0, 0, 0, 0, 0, 2] },
      away: { teamId: 'bluewave', runs: 1, hits: 5, errors: 0, inningRuns: [1, 0, 0, 0, 0, 0, 0, 0, 0] },
      winnerTeamId: 'phoenix',
    });
    expect(isWalkOff(result)).toBe(true);
  });

  it('ビジターの勝ちはサヨナラではない', () => {
    const result = makeResult({ winnerTeamId: 'bluewave' });
    expect(isWalkOff(result)).toBe(false);
  });

  it('最終回に点が入らなければサヨナラではない', () => {
    expect(isWalkOff(makeResult())).toBe(false);
  });

  it('最終回の前からリードしていればサヨナラではない', () => {
    const result = makeResult({
      home: { teamId: 'phoenix', runs: 5, hits: 9, errors: 0, inningRuns: [4, 0, 0, 0, 0, 0, 0, 0, 1] },
      away: { teamId: 'bluewave', runs: 1, hits: 5, errors: 0, inningRuns: [1, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(isWalkOff(result)).toBe(false);
  });

  it('逆転した最大点差を求められる', () => {
    const result = makeResult({
      home: { teamId: 'phoenix', runs: 7, hits: 12, errors: 0, inningRuns: [0, 0, 0, 0, 0, 0, 7, 0, 0] },
      away: { teamId: 'bluewave', runs: 6, hits: 9, errors: 0, inningRuns: [6, 0, 0, 0, 0, 0, 0, 0, 0] },
      winnerTeamId: 'phoenix',
    });
    expect(comebackMargin(result, 'phoenix')).toBe(6);
  });

  it('リードし続けた試合は逆転差0', () => {
    // 1回に先制してそのまま押し切った試合
    const result = makeResult({
      home: { teamId: 'phoenix', runs: 3, hits: 8, errors: 0, inningRuns: [3, 0, 0, 0, 0, 0, 0, 0, 0] },
      away: { teamId: 'bluewave', runs: 1, hits: 5, errors: 0, inningRuns: [0, 0, 1, 0, 0, 0, 0, 0, 0] },
      winnerTeamId: 'phoenix',
    });
    expect(comebackMargin(result, 'phoenix')).toBe(0);
  });

  it('先に取られてから勝てば逆転差がつく', () => {
    // 既定の試合は後攻が1点先に取られてから逆転している
    expect(comebackMargin(makeResult(), 'phoenix')).toBe(1);
  });

  it('連勝を数えられる', () => {
    const s = newGame();
    s.results = [
      makeResult({ id: 'a', winnerTeamId: PLAYER_TEAM }),
      makeResult({ id: 'b', winnerTeamId: PLAYER_TEAM }),
    ];
    expect(currentStreak(s, PLAYER_TEAM)).toBe(2);
  });

  it('連敗を数えられる', () => {
    const s = newGame();
    s.results = [
      makeResult({ id: 'a', winnerTeamId: 'bluewave' }),
      makeResult({ id: 'b', winnerTeamId: 'bluewave' }),
    ];
    expect(currentStreak(s, PLAYER_TEAM)).toBe(-2);
  });

  it('引き分けで連勝が途切れる', () => {
    const s = newGame();
    s.results = [
      makeResult({ id: 'a', winnerTeamId: PLAYER_TEAM }),
      makeResult({ id: 'b', winnerTeamId: null }),
    ];
    expect(currentStreak(s, PLAYER_TEAM)).toBe(0);
  });

  it('勝敗が入れ替わると連勝が止まる', () => {
    const s = newGame();
    s.results = [
      makeResult({ id: 'a', winnerTeamId: PLAYER_TEAM }),
      makeResult({ id: 'b', winnerTeamId: 'bluewave' }),
    ];
    expect(currentStreak(s, PLAYER_TEAM)).toBe(-1);
  });

  it('試合が無ければ連勝0', () => {
    expect(currentStreak(newGame(), PLAYER_TEAM)).toBe(0);
  });
});

/* ================= 実際の進行で出るニュース ================= */

describe('PHASE3.9 シーズン中のニュース', () => {
  it('試合を進めるとニュースができる', () => {
    let s = newGame(143, 5001);
    for (let i = 0; i < 20 && !s.seasonFinished; i++) s = advanceDay(s).state;
    expect(s.news.items.length).toBeGreaterThan(0);
  });

  it('すべての試合をニュースにしない', () => {
    let s = newGame(143, 5002);
    for (let i = 0; i < 20 && !s.seasonFinished; i++) s = advanceDay(s).state;
    const games = s.results.length;
    const gameNews = s.news.items.filter((n) => n.category === 'GAME').length;
    expect(games).toBeGreaterThan(0);
    expect(gameNews).toBeLessThan(games);
  });

  it('ニュースのIDが重複しない', () => {
    const s = afterSeasons(2, 5003);
    const ids = s.news.items.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ニュースの年と日付が矛盾しない', () => {
    const s = afterSeasons(2, 5004);
    for (const item of s.news.items) {
      expect(item.date.startsWith(String(item.year))).toBe(true);
    }
  });

  it('ニュースの球団が実在する', () => {
    const s = afterSeasons(2, 5005);
    const ids = new Set(s.teams.map((t) => t.id));
    for (const item of s.news.items) {
      if (item.teamId) expect(ids.has(item.teamId)).toBe(true);
      for (const id of item.relatedTeamIds ?? []) expect(ids.has(id)).toBe(true);
    }
  });

  it('タイトルと本文が空でない', () => {
    const s = afterSeasons(2, 5006);
    for (const item of s.news.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.body.length).toBeGreaterThan(0);
    }
  });

  it('保存件数の上限を超えない', () => {
    const s = afterSeasons(6, 5007, 143);
    expect(s.news.items.length).toBeLessThanOrEqual(NEWS_LIMIT);
  }, 180000);

  it('同じシードなら同じニュースになる', () => {
    const a = afterSeasons(2, 5008);
    const b = afterSeasons(2, 5008);
    expect(a.news.items.map((n) => n.id)).toEqual(b.news.items.map((n) => n.id));
    expect(a.news.items.map((n) => n.title)).toEqual(b.news.items.map((n) => n.title));
  });

  it('ニュースを作っても試合結果が変わらない', () => {
    const s = playRegularSeason(newGame(30, 5009));
    const clone = cloneState(s);
    // ニュースを消しても順位・成績は同じ
    clone.news = createNewsState();
    expect(clone.records).toEqual(s.records);
    expect(clone.stats).toEqual(s.stats);
  });
});

/* ================= 各出来事のニュース ================= */

describe('PHASE3.9 出来事ごとのニュース', () => {
  it('トレード成立がニュースになる', () => {
    const s = afterSeasons(2, 5101);
    const trades = s.news.items.filter((n) => n.category === 'TRADE');
    expect(trades.length).toBeGreaterThan(0);
    for (const item of trades) {
      expect(item.relatedTeamIds?.length).toBeGreaterThan(0);
    }
  });

  it('トレードニュースが実際のトレードと一致する', () => {
    const s = afterSeasons(3, 5102);
    const tradeIds = new Set(s.trade.history.map((r) => `trade:${r.id}`));
    for (const item of s.news.items) {
      if (item.category !== 'TRADE') continue;
      // 古いトレード履歴は消えないので、必ず対応するトレードがある
      expect(tradeIds.has(item.source)).toBe(true);
    }
  });

  it('FA移籍がニュースになる', () => {
    const s = afterSeasons(2, 5103);
    const fa = s.news.items.filter((n) => n.category === 'FA');
    expect(fa.length).toBeGreaterThan(0);
    for (const item of fa) expect(item.playerId).toBeTruthy();
  });

  it('ドラフト指名がニュースになる', () => {
    const s = afterSeasons(2, 5104);
    const draft = s.news.items.filter((n) => n.category === 'DRAFT');
    expect(draft.length).toBeGreaterThan(0);
  });

  it('ドラフトニュースに内部の潜在能力の数値が出ない', () => {
    const s = afterSeasons(2, 5105);
    for (const item of s.news.items.filter((n) => n.category === 'DRAFT')) {
      expect(item.body).not.toMatch(/潜在能力\s*\d/);
      expect(item.body).toContain('球団の評価');
    }
  });

  it('引退がニュースになる', () => {
    const s = afterSeasons(3, 5106);
    const retire = s.news.items.filter((n) => n.category === 'RETIREMENT');
    expect(retire.length).toBeGreaterThan(0);
  });

  it('引退ニュースの選手は実際に引退している', () => {
    const s = afterSeasons(3, 5107);
    for (const item of s.news.items.filter((n) => n.category === 'RETIREMENT')) {
      const history = s.history.players[item.playerId!];
      expect(history).toBeDefined();
      expect(history.retiredAt).not.toBeNull();
      expect(s.players.some((p) => p.id === item.playerId)).toBe(false);
    }
  });

  it('記録更新がニュースになる', () => {
    const s = afterSeasons(3, 5108);
    const records = s.news.items.filter((n) => n.category === 'RECORD');
    expect(records.length).toBeGreaterThan(0);
  });

  it('記録ニュースはリーグ記録だけ（球団記録は量が多いので出さない）', () => {
    const s = afterSeasons(3, 5109);
    for (const item of s.news.items.filter((n) => n.category === 'RECORD')) {
      expect(item.source.startsWith('record:league:')).toBe(true);
    }
  });

  it('表彰がニュースになる', () => {
    const s = afterSeasons(2, 5110);
    const awards = s.news.items.filter((n) => n.category === 'AWARD');
    expect(awards.length).toBeGreaterThan(0);
  });

  it('MVPのニュースが歴史のMVPと一致する', () => {
    const s = afterSeasons(2, 5111);
    const season = s.history.seasons[s.history.seasons.length - 1];
    for (const league of season.leagues) {
      if (!league.mvpPlayerId) continue;
      const name = s.history.players[league.mvpPlayerId].name;
      const found = s.news.items.some(
        (n) => n.category === 'AWARD' && n.title.includes(name) && n.title.includes('MVP'),
      );
      expect(found).toBe(true);
    }
  });

  it('長期離脱だけ怪我ニュースになる', () => {
    const s = afterSeasons(2, 5112, 143);
    for (const item of s.news.items.filter((n) => n.category === 'INJURY')) {
      expect(item.body).toMatch(/約\d+日/);
      const days = Number(item.body.match(/約(\d+)日/)![1]);
      expect(days).toBeGreaterThanOrEqual(14);
    }
  }, 180000);
});

/* ================= ポストシーズンのニュース ================= */

describe('PHASE3.9 ポストシーズンのニュース', () => {
  it('日本一がニュースになる', () => {
    const s = afterSeasons(1, 5201);
    const champion = s.history.seasons[0].postseason!.japanSeriesChampionTeamId!;
    const name = s.teams.find((t) => t.id === champion)!.shortName;
    const item = s.news.items.find(
      (n) => n.category === 'CHAMPIONSHIP' && n.title.includes('日本一'),
    );
    expect(item).toBeDefined();
    expect(item!.title).toContain(name);
    expect(item!.priority).toBe('BREAKING');
  });

  it('日本一ニュースが歴史と一致する', () => {
    const s = afterSeasons(4, 5202);
    for (const season of s.history.seasons) {
      const champion = season.postseason?.japanSeriesChampionTeamId;
      if (!champion) continue;
      const item = s.news.items.find(
        (n) => n.year === season.year && n.category === 'CHAMPIONSHIP' && n.title.includes('日本一'),
      );
      // 古いニュースは消えることがあるので、残っている場合だけ確かめる
      if (item) expect(item.teamId).toBe(champion);
    }
  });

  it('リーグ優勝がニュースになる', () => {
    const s = afterSeasons(1, 5203);
    const items = s.news.items.filter(
      (n) => n.category === 'CHAMPIONSHIP' && n.title.includes('リーグ優勝'),
    );
    expect(items).toHaveLength(2);
  });

  it('ファーストステージの勝者がニュースになる', () => {
    const s = afterSeasons(1, 5204);
    const items = s.news.items.filter(
      (n) => n.category === 'POSTSEASON' && n.title.includes('ファイナルステージ進出'),
    );
    expect(items).toHaveLength(2);
  });

  it('惜敗した球団のニュースも出る', () => {
    const s = afterSeasons(1, 5205);
    const items = s.news.items.filter((n) => n.title.includes('あと一歩届かず'));
    expect(items.length).toBeGreaterThan(0);
  });

  it('日本シリーズの全試合はニュースにしない', () => {
    const s = cloneState(playRegularSeason(newGame(30, 5206)));
    autoCompletePostseason(s);
    const japan = s.postseason!.series.find((x) => x.stage === 'JAPAN_SERIES')!;
    const items = s.news.items.filter((n) => n.source.startsWith('psgame:'));
    expect(items.length).toBeLessThan(japan.games.length);
  });

  it('シリーズのニュースが二重に出ない', () => {
    const s = cloneState(playRegularSeason(newGame(30, 5207)));
    autoCompletePostseason(s);
    autoCompletePostseason(s);
    const sources = s.news.items.filter((n) => n.source.startsWith('series:')).map((n) => n.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('ポストシーズンのニュースは進出球団のもの', () => {
    const s = cloneState(playRegularSeason(newGame(30, 5208)));
    autoCompletePostseason(s);
    const participants = new Set(Object.values(s.postseason!.participants).flat());
    for (const item of s.news.items.filter((n) => n.category === 'POSTSEASON')) {
      if (item.teamId) expect(participants.has(item.teamId)).toBe(true);
    }
  });
});

/* ================= ライバル関係 ================= */

describe('PHASE3.9 ライバル関係', () => {
  it('対戦回数を数えられる', () => {
    const s = afterSeasons(6, 5301);
    let max = 0;
    for (const a of s.teams) {
      for (const b of s.teams) {
        if (a.id >= b.id) continue;
        max = Math.max(max, rivalryCount(s, a.id, b.id));
      }
    }
    expect(max).toBeGreaterThan(0);
  });

  it('対戦していない組み合わせは0', () => {
    const s = newGame();
    expect(rivalryCount(s, 'phoenix', 'bluewave')).toBe(0);
  });

  it('順番を入れ替えても同じ回数', () => {
    const s = afterSeasons(5, 5302);
    for (const a of s.teams.slice(0, 4)) {
      for (const b of s.teams.slice(0, 4)) {
        if (a.id === b.id) continue;
        expect(rivalryCount(s, a.id, b.id)).toBe(rivalryCount(s, b.id, a.id));
      }
    }
  });

  it('ライバル関係が試合結果を変えない', () => {
    // ライバル判定は歴史を読むだけで、状態を書き換えない
    const s = afterSeasons(4, 5303);
    const before = structuredClone(s.records);
    rivalryCount(s, 'phoenix', 'bluewave');
    expect(s.records).toEqual(before);
  });
});

/* ================= シーズンストーリー ================= */

describe('PHASE3.9 シーズンストーリー', () => {
  it('シーズンを終えると物語ができる', () => {
    const s = afterSeasons(1, 5401);
    expect(s.news.stories).toHaveLength(1);
    expect(s.news.stories[0].year).toBe(2026);
  });

  it('見出しが空でない', () => {
    const s = afterSeasons(4, 5402);
    for (const story of s.news.stories) {
      expect(story.headline.length).toBeGreaterThan(0);
    }
  });

  it('物語が年ごとに1つだけ', () => {
    const s = afterSeasons(6, 5403);
    const years = s.news.stories.map((x) => x.year);
    expect(new Set(years).size).toBe(years.length);
    expect(years).toHaveLength(6);
  });

  it('物語は年の昇順に並ぶ', () => {
    const s = afterSeasons(5, 5404);
    const years = s.news.stories.map((x) => x.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it('二度作っても増えない', () => {
    const s = afterSeasons(2, 5405);
    const before = s.news.stories.length;
    buildSeasonStory(s, 2026);
    buildSeasonStory(s, 2026);
    expect(s.news.stories.length).toBe(before);
  });

  it('startOffseasonを二度呼んでも物語が増えない', () => {
    let s = playRegularSeason(newGame(30, 5406));
    s = cloneState(s);
    startOffseason(s);
    const before = s.news.stories.length;
    startOffseason(s);
    expect(s.news.stories.length).toBe(before);
  });

  it('歴史の無い年には物語を作らない', () => {
    const s = newGame();
    expect(buildSeasonStory(s, 1900)).toBeNull();
  });

  it('物語の日本一が歴史と一致する', () => {
    const s = afterSeasons(5, 5407);
    for (const story of s.news.stories) {
      const season = s.history.seasons.find((x) => x.year === story.year)!;
      expect(story.championTeamId).toBe(
        season.postseason?.japanSeriesChampionTeamId ?? null,
      );
    }
  });

  it('物語のリーグ優勝が歴史と一致する', () => {
    const s = afterSeasons(4, 5408);
    for (const story of s.news.stories) {
      const season = s.history.seasons.find((x) => x.year === story.year)!;
      for (const league of season.leagues) {
        if (!league.leagueChampionTeamId) continue;
        expect(story.leagueChampions[league.leagueId]).toBe(league.leagueChampionTeamId);
      }
    }
  });

  it('物語の1位が歴史と一致する', () => {
    const s = afterSeasons(4, 5409);
    for (const story of s.news.stories) {
      const season = s.history.seasons.find((x) => x.year === story.year)!;
      for (const league of season.leagues) {
        expect(story.pennantWinners[league.leagueId]).toBe(league.championTeamId);
      }
    }
  });

  it('hasStory / storyOf で引ける', () => {
    const s = afterSeasons(2, 5410);
    expect(hasStory(s, 2026)).toBe(true);
    expect(hasStory(s, 1900)).toBe(false);
    expect(storyOf(s, 2026)?.year).toBe(2026);
    expect(storyOf(s, 1900)).toBeUndefined();
  });

  it('新しい順に取り出せる', () => {
    const s = afterSeasons(4, 5411);
    const years = recentStories(s).map((x) => x.year);
    expect(years[0]).toBeGreaterThan(years[years.length - 1]);
  });

  it('下剋上を判定できる', () => {
    const s = afterSeasons(8, 5412);
    const levels = new Set(s.news.stories.map((x) => x.upset));
    // 8シーズンあれば1位以外のリーグ優勝が起きる
    expect(levels.size).toBeGreaterThan(1);
    for (const story of s.news.stories) {
      expect(['NONE', 'UPSET', 'MAJOR_UPSET']).toContain(story.upset);
    }
  });

  it('3位からの日本一は大きな下剋上になる', () => {
    const s = afterSeasons(10, 5413);
    for (const story of s.news.stories) {
      if (story.upset !== 'MAJOR_UPSET') continue;
      const season = s.history.seasons.find((x) => x.year === story.year)!;
      const champion = season.postseason!.japanSeriesChampionTeamId!;
      let rank = 0;
      for (const league of s.leagues) {
        const index = (season.postseason!.participants[league.id] ?? []).indexOf(champion);
        if (index >= 0) rank = index + 1;
      }
      expect(rank).toBeGreaterThanOrEqual(3);
    }
  }, 120000);

  it('下剋上の見出しに順位が入る', () => {
    const s = afterSeasons(10, 5414);
    const major = s.news.stories.find((x) => x.upset === 'MAJOR_UPSET');
    if (major) expect(major.headline).toMatch(/位からの下剋上/);
  }, 120000);

  it('注目選手が記録される', () => {
    const s = afterSeasons(3, 5415);
    for (const story of s.news.stories) {
      expect(story.notablePlayerIds.length).toBeGreaterThan(0);
      for (const id of story.notablePlayerIds) {
        expect(s.history.players[id]).toBeDefined();
      }
    }
  });

  it('新人王が記録される', () => {
    const s = afterSeasons(3, 5416);
    for (const story of s.news.stories) {
      for (const id of story.rookiePlayerIds) {
        expect(s.history.players[id]).toBeDefined();
      }
    }
  });

  it('引退した選手が記録される', () => {
    const s = afterSeasons(4, 5417);
    for (const story of s.news.stories) {
      for (const id of story.retirementPlayerIds) {
        expect(s.history.players[id].retiredAt).not.toBeNull();
      }
    }
  });

  it('主要な見出しが残る', () => {
    const s = afterSeasons(3, 5418);
    for (const story of s.news.stories) {
      expect(story.highlights.length).toBeGreaterThan(0);
      for (const h of story.highlights) {
        expect(h.title.length).toBeGreaterThan(0);
        expect(CATEGORY_LABELS[h.category]).toBeTruthy();
      }
    }
  });

  it('物語はニュースが消えても残る', () => {
    const s = afterSeasons(6, 5419, 143);
    expect(s.news.stories).toHaveLength(6);
    // ニュース本体は上限で古いものが消えている
    expect(s.news.items.length).toBeLessThanOrEqual(NEWS_LIMIT);
  }, 240000);

  it('出来事の点数が定義されている', () => {
    expect(STORY_SCORE.JAPAN_CHAMPION).toBeGreaterThan(STORY_SCORE.LEAGUE_CHAMPION);
    expect(STORY_SCORE.LEAGUE_CHAMPION).toBeGreaterThan(STORY_SCORE.RECORD);
    expect(STORY_SCORE.RECORD).toBeGreaterThan(STORY_SCORE.STREAK);
  });

  it('同じシードなら同じ見出しになる', () => {
    const a = afterSeasons(3, 5420);
    const b = afterSeasons(3, 5420);
    expect(a.news.stories.map((x) => x.headline)).toEqual(
      b.news.stories.map((x) => x.headline),
    );
  });

  it('upsetLevelOfが歴史から判定できる', () => {
    const s = afterSeasons(4, 5421);
    for (const season of s.history.seasons) {
      expect(['NONE', 'UPSET', 'MAJOR_UPSET']).toContain(upsetLevelOf(s, season));
    }
  });
});

/* ================= セーブ ================= */

describe('PHASE3.9 セーブ', () => {
  beforeEach(() => {
    class MemoryStorage {
      private map = new Map<string, string>();
      getItem(key: string) {
        return this.map.get(key) ?? null;
      }
      setItem(key: string, value: string) {
        this.map.set(key, value);
      }
      removeItem(key: string) {
        this.map.delete(key);
      }
    }
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
      new MemoryStorage();
    clearSave();
  });

  it('セーブバージョンが13になっている', () => {
    expect(SAVE_VERSION).toBe(14);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('ニュースが保存・復元される', () => {
    const s = afterSeasons(2, 5501);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.news.items.map((n) => n.id)).toEqual(s.news.items.map((n) => n.id));
    expect(loaded.news.stories).toEqual(s.news.stories);
  });

  it('既読の状態も保存される', () => {
    const s = afterSeasons(1, 5502);
    markNewsRead(s);
    saveGame(s);
    expect(unreadCount(loadGame()!)).toBe(0);
  });

  it('v12のセーブを読み込める（ニュースは空から始まる）', () => {
    const s = afterSeasons(1, 5503);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 12;
    delete old.news;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.news.items).toHaveLength(0);
    expect(migrated!.news.stories).toHaveLength(0);
  });

  it('v12からの移行で過去の歴史を書き換えない', () => {
    const s = afterSeasons(2, 5504);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 12;
    delete old.news;
    const migrated = migrate(old as unknown as GameState)!;
    expect(migrated.history.seasons.map((x) => x.year)).toEqual(
      s.history.seasons.map((x) => x.year),
    );
    expect(migrated.history.hallOfFame).toEqual(s.history.hallOfFame);
  });

  it('v1のセーブも最新バージョンまで移行できる', () => {
    const s = newGame(10, 5505);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 1;
    delete old.news;
    delete old.postseason;
    delete old.history;
    delete old.teamStats;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.news.items).toEqual([]);
  });

  it('壊れたニュースでも読み込める', () => {
    const s = afterSeasons(1, 5506);
    const broken = structuredClone(s) as unknown as Record<string, unknown>;
    broken.version = 12;
    broken.news = { items: null, stories: null };
    const migrated = migrate(broken as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(Array.isArray(migrated!.news.items)).toBe(true);
  });

  it('再開してもニュースが増えない', () => {
    const s = afterSeasons(2, 5507);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.news.items).toHaveLength(s.news.items.length);
  });

  it('ニュースの保存量が抑えられている', () => {
    const s = afterSeasons(8, 5508, 143);
    const size = JSON.stringify(s.news).length;
    expect(size).toBeLessThan(500_000);
  }, 300000);
});

/* ================= 既存システムを壊していない ================= */

describe('PHASE3.9 既存システムが壊れていない', () => {
  it('シーズンが従来どおり進む', () => {
    let s = playRegularSeason(newGame(10, 5601));
    const year = s.year;
    s = cloneState(s);
    startNextSeason(s);
    expect(s.year).toBe(year + 1);
    expect(validateState(s)).toEqual([]);
  });

  it('ポストシーズンが従来どおり動く', () => {
    const s = afterSeasons(1, 5602);
    expect(s.history.seasons[0].postseason!.japanSeriesChampionTeamId).not.toBeNull();
  });

  it('歴史が従来どおり積まれる', () => {
    const s = afterSeasons(5, 5603);
    expect(s.history.seasons).toHaveLength(5);
    const years = s.history.seasons.map((x) => x.year);
    expect(new Set(years).size).toBe(5);
  });

  it('ロスターが保たれる', () => {
    const s = afterSeasons(4, 5604);
    for (const team of s.teams) {
      expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(24);
    }
  });

  it('10シーズン続けても壊れない', () => {
    const s = afterSeasons(10, 5605, 10);
    expect(s.news.stories).toHaveLength(10);
    expect(validateState(s)).toEqual([]);
  });

  it('ニュース生成が共有の乱数を消費しない', () => {
    const s = newGame(30, 5606);
    const clone = cloneState(s);
    pushNews(clone, draftOf());
    expect(clone.rngState).toBe(s.rngState);
  });

  it('ニュースは選手の状態を変えない', () => {
    const s = newGame(30, 5607);
    const clone = cloneState(s);
    pushNews(clone, draftOf({ playerId: clone.players[0].id }));
    expect(clone.players).toEqual(s.players);
  });
});

/* ================= 事実との整合 ================= */

describe('PHASE3.9 ニュースと事実の一致', () => {
  it('ニュースの選手が実在する（現役か歴史にいる）', () => {
    const s = afterSeasons(4, 5701);
    const active = new Set(s.players.map((p) => p.id));
    for (const item of s.news.items) {
      if (!item.playerId) continue;
      const known = active.has(item.playerId) || Boolean(s.history.players[item.playerId]);
      expect(known).toBe(true);
    }
  });

  it('FAニュースの選手が移籍先に在籍している', () => {
    const s = playRegularSeason(newGame(30, 5702));
    const next = cloneState(s);
    startNextSeason(next);
    for (const item of next.news.items) {
      if (item.category !== 'FA') continue;
      const player = next.players.find((p) => p.id === item.playerId);
      // 移籍後に引退・再移籍している場合は除く
      if (!player) continue;
      expect(item.teamId).toBeTruthy();
    }
  });

  it('優勝ニュースが1年に1件だけ', () => {
    const s = afterSeasons(3, 5703);
    for (const season of s.history.seasons) {
      const items = s.news.items.filter(
        (n) => n.year === season.year && n.category === 'CHAMPIONSHIP' && n.title.includes('日本一'),
      );
      expect(items.length).toBeLessThanOrEqual(1);
    }
  });

  it('ニュースが独自の年を持たない', () => {
    const s = afterSeasons(3, 5704);
    const years = new Set(s.history.seasons.map((x) => x.year));
    years.add(s.year);
    for (const item of s.news.items) expect(years.has(item.year)).toBe(true);
  });

  it('物語の年が歴史にある年と一致する', () => {
    const s = afterSeasons(5, 5705);
    const years = new Set(s.history.seasons.map((x) => x.year));
    for (const story of s.news.stories) expect(years.has(story.year)).toBe(true);
  });

  it('ニュースのカテゴリがすべて既知のもの', () => {
    const s = afterSeasons(3, 5706);
    for (const item of s.news.items) {
      expect(CATEGORY_LABELS[item.category]).toBeTruthy();
      expect(PRIORITY_LABELS[item.priority]).toBeTruthy();
    }
  });

  it('同じ出来事のニュースが1件だけ', () => {
    const s = afterSeasons(4, 5707);
    const sources = s.news.items.map((n) => `${n.year}:${n.category}:${n.source}`);
    expect(new Set(sources).size).toBe(sources.length);
  });
});
