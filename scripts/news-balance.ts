/**
 * PHASE 3.9 ニュース・物語の長期検証。
 *   npx tsx scripts/news-balance.ts [seasons] [seeds] [--from=N] [--out=file]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { CATEGORY_LABELS, NEWS_LIMIT } from '../src/domain/news';
import type { GameState, NewsCategory } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 100);
const SEED_FROM = Number(
  (process.argv.find((a) => a.startsWith('--from=')) ?? '--from=0').slice(7),
);
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '';

function playRegularSeason(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.seasonFinished && guard++ < 6000) s = advanceDay(s).state;
  return s;
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

interface SeedResult {
  seed: number;
  failures: string[];
  /** 年ごとに作られたニュース件数 */
  perSeason: number[];
  stories: number;
  upsets: number;
  majorUpsets: number;
  byCategory: Record<string, number>;
  newsKb: number;
  saveKb: number;
}

function runSeed(seed: number): SeedResult {
  const result: SeedResult = {
    seed,
    failures: [],
    perSeason: [],
    stories: 0,
    upsets: 0,
    majorUpsets: 0,
    byCategory: {},
    newsKb: 0,
    saveKb: 0,
  };
  let state = createNewGame('phoenix', 30, seed);
  let previousTotal = 0;
  let trimmed = 0;

  for (let season = 1; season <= SEASONS; season++) {
    state = playRegularSeason(state);
    state = cloneState(state);
    startNextSeason(state);
    const say = (msg: string) => result.failures.push(`seed${seed} Y${season}: ${msg}`);
    const news = state.news;

    // ---- 上限 ----
    if (news.items.length > NEWS_LIMIT) say(`ニュースが上限を超えている（${news.items.length}）`);
    // 上限に達する前は、作られたぶんだけ増える
    const total = news.items.length;
    if (total < NEWS_LIMIT) result.perSeason.push(total - previousTotal);
    else trimmed += 1;
    previousTotal = total;

    // ---- 重複 ----
    const ids = news.items.map((n) => n.id);
    if (new Set(ids).size !== ids.length) say('ニュースIDが重複している');
    const storyYears = news.stories.map((s) => s.year);
    if (new Set(storyYears).size !== storyYears.length) say('物語が二重に作られている');
    if (news.stories.length !== season) say(`物語の数が${news.stories.length}（${season}のはず）`);

    // ---- 不正なニュース ----
    const teamIds = new Set(state.teams.map((t) => t.id));
    const knownYears = new Set(state.history.seasons.map((s) => s.year));
    knownYears.add(state.year);
    for (const item of news.items) {
      if (!item.title) say('タイトルの無いニュースがある');
      if (!item.body) say('本文の無いニュースがある');
      if (!CATEGORY_LABELS[item.category]) say(`不明なカテゴリ（${item.category}）`);
      if (item.teamId && !teamIds.has(item.teamId)) say('存在しない球団のニュース');
      for (const id of item.relatedTeamIds ?? []) {
        if (!teamIds.has(id)) say('存在しない球団が関連づけられている');
      }
      if (!knownYears.has(item.year)) say('歴史に無い年のニュース');
      if (!item.date.startsWith(String(item.year))) say('年と日付が食い違うニュース');
      result.byCategory[item.category] = (result.byCategory[item.category] ?? 0) + 1;
    }

    // ---- 事実との一致 ----
    const activeIds = new Set(state.players.map((p) => p.id));
    for (const item of news.items) {
      if (item.playerId && !activeIds.has(item.playerId) && !state.history.players[item.playerId]) {
        say('実在しない選手のニュース');
      }
      // 引退ニュースは実際に引退していること
      if (item.category === 'RETIREMENT' && item.playerId) {
        const history = state.history.players[item.playerId];
        if (!history || history.retiredAt === null) say('引退していない選手の引退ニュース');
      }
      // トレードニュースは実際のトレードと対応すること
      if (item.category === 'TRADE') {
        const id = item.source.replace('trade:', '');
        if (!state.trade.history.some((r) => r.id === id)) say('実在しないトレードのニュース');
      }
      // 日本一ニュースは歴史の日本一と一致すること
      if (item.category === 'CHAMPIONSHIP' && item.title.includes('日本一')) {
        const history = state.history.seasons.find((s) => s.year === item.year);
        const champion = history?.postseason?.japanSeriesChampionTeamId;
        if (champion && item.teamId !== champion) say('日本一のニュースが歴史と食い違う');
      }
      // 記録ニュースはリーグ記録だけ
      if (item.category === 'RECORD' && !item.source.startsWith('record:league:')) {
        say('球団記録のニュースが出ている');
      }
    }

    // ---- 物語と歴史の一致 ----
    for (const story of news.stories) {
      const history = state.history.seasons.find((s) => s.year === story.year);
      if (!history) {
        say('歴史に無い年の物語がある');
        continue;
      }
      if (!story.headline) say('見出しの無い物語がある');
      const champion = history.postseason?.japanSeriesChampionTeamId ?? null;
      if (story.championTeamId !== champion) say('物語の日本一が歴史と食い違う');
      for (const league of history.leagues) {
        if (story.pennantWinners[league.leagueId] !== league.championTeamId) {
          say('物語の1位が歴史と食い違う');
        }
      }
      for (const id of story.retirementPlayerIds) {
        const player = state.history.players[id];
        if (!player || player.retiredAt === null) say('物語の引退選手が実際に引退していない');
      }
    }

    for (const e of validateState(state)) say(e);
    if (result.failures.length > 30) break;
  }

  result.stories = state.news.stories.length;
  result.upsets = state.news.stories.filter((s) => s.upset === 'UPSET').length;
  result.majorUpsets = state.news.stories.filter((s) => s.upset === 'MAJOR_UPSET').length;
  result.newsKb = Math.round(JSON.stringify(state.news).length / 1024);
  result.saveKb = Math.round(JSON.stringify(state).length / 1024);
  void trimmed;
  return result;
}

/* ---------------- 実行（途中再開に対応） ---------------- */

const seedOf = (index: number) => 9000 + index * 7867;
const done = new Map<number, SeedResult>();
if (OUT && existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SeedResult;
      done.set(parsed.seed, parsed);
    } catch {
      // 途中で切れた行は読み飛ばす
    }
  }
  if (done.size > 0) console.log(`（記録済み ${done.size} シードを再利用します）`);
}

const results: SeedResult[] = [];
for (let s = SEED_FROM; s < SEED_FROM + SEEDS; s++) {
  const seed = seedOf(s);
  const cached = done.get(seed);
  if (cached) {
    results.push(cached);
    continue;
  }
  const result = runSeed(seed);
  if (OUT) appendFileSync(OUT, JSON.stringify(result) + '\n');
  results.push(result);
}

/* ---------------- 集計 ---------------- */

console.log(`=== PHASE 3.9 ニュース・物語の検証（${SEASONS}シーズン × ${results.length}シード）===\n`);
const perSeason = results.flatMap((r) => r.perSeason).filter((n) => n > 0);
console.log(`1シーズンあたりのニュース ${r1(avg(perSeason))}件`);
console.log(`物語 ${results.reduce((a, b) => a + b.stories, 0)}件（1シードあたり ${r1(avg(results.map((r) => r.stories)))}年）`);

const byCategory: Record<string, number> = {};
for (const r of results) {
  for (const [k, v] of Object.entries(r.byCategory)) byCategory[k] = (byCategory[k] ?? 0) + v;
}
const catTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
console.log(
  '内訳: ' +
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${CATEGORY_LABELS[k as NewsCategory]}=${((v / catTotal) * 100).toFixed(1)}%`)
      .join(' / '),
);

const upsets = results.reduce((a, b) => a + b.upsets, 0);
const majors = results.reduce((a, b) => a + b.majorUpsets, 0);
const stories = results.reduce((a, b) => a + b.stories, 0);
console.log(
  `下剋上の物語 ${upsets}件（${((upsets / stories) * 100).toFixed(1)}%）/ ` +
    `大下剋上 ${majors}件（${((majors / stories) * 100).toFixed(1)}%）`,
);
console.log(
  `セーブサイズ 平均 ${Math.round(avg(results.map((r) => r.saveKb)))}KB / ` +
    `うちニュース 平均 ${Math.round(avg(results.map((r) => r.newsKb)))}KB ` +
    `（最大 ${Math.max(0, ...results.map((r) => r.newsKb))}KB）`,
);

const failures = results.flatMap((r) => r.failures);
const unique = [...new Set(failures)];
if (unique.length > 0) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const f of unique.slice(0, 15)) console.log(` - ${f}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
