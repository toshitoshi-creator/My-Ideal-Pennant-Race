/**
 * PHASE 3.7 歴史・記録の長期検証。
 *   npx tsx scripts/history-balance.ts [seasons] [seeds] [--from=N] [--out=file]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 * --out=file を渡すと1シードごとに結果を追記し、途中から再開できる。
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { statsOfEntry, seasonTotalOf, teamSeasonStats } from '../src/domain/history';
import { BATTING_FIELDS, PITCHING_FIELDS } from '../src/domain/stats';
import type { BattingStats, GameState, PitchingStats } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 100);
const SEED_FROM = Number(
  (process.argv.find((a) => a.startsWith('--from=')) ?? '--from=0').slice(7),
);
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '';

function playSeason(state: GameState): GameState {
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
  /** 年 → 記録の件数など */
  marks: Array<{
    year: number;
    seasons: number;
    players: number;
    retired: number;
    hof: number;
    events: number;
    sizeKb: number;
  }>;
}

/**
 * その年までの歴史に矛盾がないか調べる。
 * 見つかった問題を文章で返す（空なら問題なし）。
 */
function checkHistory(state: GameState, seed: number): string[] {
  const problems: string[] = [];
  const history = state.history;
  const say = (msg: string) => problems.push(`seed${seed} Y${state.year}: ${msg}`);

  // ---- シーズンの重複・順序 ----
  const years = history.seasons.map((s) => s.year);
  if (new Set(years).size !== years.length) say('同じシーズンが二重に記録されている');
  for (let i = 1; i < years.length; i++) {
    if (years[i] <= years[i - 1]) say('シーズンの年が逆転している');
  }

  // ---- 選手の歴史 ----
  const teamIds = new Set(state.teams.map((t) => t.id));
  for (const [key, player] of Object.entries(history.players)) {
    if (player.playerId !== key) say('選手IDと歴史のキーが一致しない');

    // 年度別の行が「年 × 球団」で重複しない
    const seen = new Set<string>();
    let previousYear = 0;
    const career = { batting: zeroBatting(), pitching: zeroPitching() };
    for (const entry of player.seasons) {
      const id = `${entry.year}:${entry.teamId}`;
      if (seen.has(id)) say(`同じ年・同じ球団の成績が二重にある（${player.name}）`);
      seen.add(id);
      if (entry.year < previousYear) say(`年度が逆転している（${player.name}）`);
      previousYear = entry.year;
      if (!teamIds.has(entry.teamId)) say(`存在しない球団の成績がある（${player.name}）`);
      const stats = statsOfEntry(entry);
      for (const f of BATTING_FIELDS) career.batting[f] += stats.batting[f];
      for (const f of PITCHING_FIELDS) career.pitching[f] += stats.pitching[f];
      for (const f of BATTING_FIELDS) {
        if (stats.batting[f] < 0) say(`打撃成績がマイナス（${player.name}）`);
      }
      for (const f of PITCHING_FIELDS) {
        if (stats.pitching[f] < 0) say(`投手成績がマイナス（${player.name}）`);
      }
    }

    // 通算成績 = 年度別の合計
    for (const f of BATTING_FIELDS) {
      if (player.career.batting[f] !== career.batting[f]) {
        say(`通算打撃が年度別の合計と合わない（${player.name} / ${f}）`);
        break;
      }
    }
    for (const f of PITCHING_FIELDS) {
      if (player.career.pitching[f] !== career.pitching[f]) {
        say(`通算投手成績が年度別の合計と合わない（${player.name} / ${f}）`);
        break;
      }
    }

    // 通算 >= 各シーズン
    for (const year of new Set(player.seasons.map((s) => s.year))) {
      const season = seasonTotalOf(player, year);
      if (season.batting.hits > player.career.batting.hits) {
        say(`シーズン安打が通算を超えている（${player.name}）`);
      }
      if (season.pitching.wins > player.career.pitching.wins) {
        say(`シーズン勝利が通算を超えている（${player.name}）`);
      }
    }

    // 引退した選手はロスターにいない
    if (player.retiredAt !== null && state.players.some((p) => p.id === player.playerId)) {
      say(`引退した選手がロスターにいる（${player.name}）`);
    }
    if (player.retiredAt !== null && player.retiredAt < player.debutYear) {
      say(`引退年がデビュー年より前（${player.name}）`);
    }
  }

  // ---- 球団のシーズン成績 = その年その球団の選手の合計 ----
  const teamTotals = new Map<string, BattingStats>();
  for (const player of Object.values(history.players)) {
    for (const entry of player.seasons) {
      const id = `${entry.year}:${entry.teamId}`;
      let sum = teamTotals.get(id);
      if (!sum) {
        sum = zeroBatting();
        teamTotals.set(id, sum);
      }
      const stats = statsOfEntry(entry);
      for (const f of BATTING_FIELDS) sum[f] += stats.batting[f];
    }
  }
  for (const season of history.seasons) {
    for (const row of season.teams) {
      const expected = teamTotals.get(`${season.year}:${row.teamId}`) ?? zeroBatting();
      const actual = teamSeasonStats(row).batting;
      for (const f of BATTING_FIELDS) {
        if (actual[f] !== expected[f]) {
          say(`球団のシーズン成績が選手の合計と合わない（${row.teamId} / ${f}）`);
          break;
        }
      }
      if (row.wins + row.losses + row.draws !== row.games) {
        say(`球団の勝敗数が試合数と合わない（${row.teamId}）`);
      }
    }
    // 各リーグの優勝は1球団
    for (const league of season.leagues) {
      const champions = season.teams.filter(
        (t) => t.leagueId === league.leagueId && t.champion,
      );
      if (champions.length !== 1) say(`優勝球団が1つでない（${league.leagueId}）`);
      if (champions[0]?.teamId !== league.championTeamId) {
        say(`優勝球団の記録が食い違っている（${league.leagueId}）`);
      }
    }
  }

  // ---- 記録保持者が歴史に存在する ----
  const books = [
    ...Object.values(history.leagueRecords),
    ...Object.values(history.teamRecords),
  ];
  for (const book of books) {
    for (const holder of Object.values(book.season)) {
      if (!history.players[holder.playerId]) say('シーズン記録の保持者が歴史にいない');
    }
    for (const holder of Object.values(book.career)) {
      if (!history.players[holder.playerId]) say('通算記録の保持者が歴史にいない');
    }
  }

  // ---- 殿堂 ----
  const hofIds = history.hallOfFame.map((e) => e.playerId);
  if (new Set(hofIds).size !== hofIds.length) say('同じ選手が二度殿堂入りしている');
  for (const entry of history.hallOfFame) {
    const player = history.players[entry.playerId];
    if (!player) say('殿堂入りした選手が歴史にいない');
    else if (player.retiredAt === null) say(`現役の選手が殿堂入りしている（${entry.name}）`);
  }

  // ---- 記録更新の出来事 ----
  const knownYears = new Set(years);
  for (const event of history.events) {
    if (!knownYears.has(event.year)) say('記録更新の年が確定シーズンにない');
    if (!history.players[event.playerId]) say('記録更新した選手が歴史にいない');
    if (event.previous === null) continue;
    if (event.key === 'era') {
      if (event.value >= event.previous) say('防御率の記録更新が改善になっていない');
    } else if (event.value <= event.previous) {
      say('記録更新が前の記録を超えていない');
    }
  }

  return problems;
}

function zeroBatting(): BattingStats {
  const stats = {} as BattingStats;
  for (const f of BATTING_FIELDS) stats[f] = 0;
  return stats;
}
function zeroPitching(): PitchingStats {
  const stats = {} as PitchingStats;
  for (const f of PITCHING_FIELDS) stats[f] = 0;
  return stats;
}

function runSeed(seed: number): SeedResult {
  const result: SeedResult = { seed, failures: [], marks: [] };
  let state = createNewGame('phoenix', 30, seed);

  for (let season = 1; season <= SEASONS; season++) {
    state = playSeason(state);
    const retiredBefore = state.retiredPlayers.length;
    state = cloneState(state);
    startNextSeason(state);
    void retiredBefore;

    for (const e of validateState(state)) result.failures.push(`seed${seed} Y${season}: ${e}`);
    result.failures.push(...checkHistory(state, seed));

    if (season % 10 === 0 || season === SEASONS) {
      const history = state.history;
      result.marks.push({
        year: season,
        seasons: history.seasons.length,
        players: Object.keys(history.players).length,
        retired: Object.values(history.players).filter((p) => p.retiredAt !== null).length,
        hof: history.hallOfFame.length,
        events: history.events.length,
        sizeKb: Math.round(JSON.stringify(state).length / 1024),
      });
    }
    // 早く落ちたほうが直しやすいので、大量に出たら打ち切る
    if (result.failures.length > 40) break;
  }
  return result;
}

/* ---------------- 実行（途中再開に対応） ---------------- */

const seedOf = (index: number) => 5000 + index * 7877;
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

console.log(`=== PHASE 3.7 歴史・記録の検証（${SEASONS}シーズン × ${results.length}シード）===\n`);
console.log(['Year', 'Seasons', 'Players', 'Retired', 'HOF', 'Events', 'SaveKB'].join('\t'));
const marksByYear = new Map<number, SeedResult['marks']>();
for (const result of results) {
  for (const mark of result.marks) {
    if (!marksByYear.has(mark.year)) marksByYear.set(mark.year, []);
    marksByYear.get(mark.year)!.push(mark);
  }
}
for (const year of [...marksByYear.keys()].sort((a, b) => a - b)) {
  const list = marksByYear.get(year)!;
  console.log(
    [
      year,
      r1(avg(list.map((m) => m.seasons))),
      Math.round(avg(list.map((m) => m.players))),
      Math.round(avg(list.map((m) => m.retired))),
      r1(avg(list.map((m) => m.hof))),
      Math.round(avg(list.map((m) => m.events))),
      Math.round(avg(list.map((m) => m.sizeKb))),
    ].join('\t'),
  );
}

const maxSize = Math.max(0, ...results.flatMap((r) => r.marks.map((m) => m.sizeKb)));
console.log(`\nセーブサイズ 最大 ${maxSize}KB`);

const failures = results.flatMap((r) => r.failures);
const unique = [...new Set(failures)];
if (unique.length > 0) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const f of unique.slice(0, 15)) console.log(` - ${f}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
