/**
 * PHASE 3.8 ポストシーズンの長期バランス検証。
 *   npx tsx scripts/postseason-balance.ts [seasons] [seeds] [--from=N] [--out=file]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 * --out=file を渡すと1シードごとに結果を追記し、途中から再開できる。
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { standingsForLeague } from '../src/domain/standings';
import { overallRating } from '../src/domain/rating';
import { maxGames } from '../src/domain/postseason';
import type { GameState } from '../src/domain/types';

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
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

interface SeedResult {
  seed: number;
  failures: string[];
  /** 順位ごとの「ファイナルステージ進出」「リーグ優勝」「日本一」 */
  bySeed: Array<{
    rank: number;
    reachedFinal: boolean;
    leagueChampion: boolean;
    japanChampion: boolean;
  }>;
  /** 日本一になった球団 */
  champions: string[];
  /** 日本一球団の平均総合・平均年齢 */
  championOverall: number[];
  championAge: number[];
  /** 日本シリーズの試合数 */
  japanSeriesGames: number[];
}

function runSeed(seed: number): SeedResult {
  const result: SeedResult = {
    seed,
    failures: [],
    bySeed: [],
    champions: [],
    championOverall: [],
    championAge: [],
    japanSeriesGames: [],
  };
  let state = createNewGame('phoenix', 30, seed);

  for (let season = 1; season <= SEASONS; season++) {
    state = playRegularSeason(state);
    const say = (msg: string) => result.failures.push(`seed${seed} Y${season}: ${msg}`);

    // レギュラーシーズン終了時点の順位を控える
    const rankOf = new Map<string, number>();
    for (const league of state.leagues) {
      for (const row of standingsForLeague(state, league.id)) rankOf.set(row.teamId, row.rank);
    }

    state = cloneState(state);
    startNextSeason(state);

    const history = state.history.seasons.find((s) => s.year === season + 2025);
    const postseason = history?.postseason;
    if (!postseason) {
      say('ポストシーズンの記録が残っていない');
      continue;
    }

    // ---- 異常検出 ----
    const champion = postseason.japanSeriesChampionTeamId;
    if (!champion) say('日本一が決まっていない');
    const japanChampions = history!.teams.filter((t) => t.japanChampion);
    if (japanChampions.length !== 1) say(`日本一が${japanChampions.length}球団いる`);
    const leagueChampions = history!.teams.filter((t) => t.leagueChampion);
    if (leagueChampions.length !== 2) say(`リーグ優勝が${leagueChampions.length}球団いる`);
    const participants = Object.values(postseason.participants).flat();
    if (participants.length !== 6) say(`進出球団が${participants.length}球団`);
    if (new Set(participants).size !== participants.length) say('進出球団が重複している');
    for (const id of participants) {
      const rank = rankOf.get(id) ?? 99;
      if (rank > 3) say(`4位以下がポストシーズンに参加している（${rank}位）`);
    }
    if (champion && !participants.includes(champion)) say('非進出球団が日本一になっている');

    const seriesIds = new Set<string>();
    for (const x of postseason.series) {
      const key = `${x.stage}:${x.leagueId}`;
      if (seriesIds.has(key)) say('同じシリーズが二重にある');
      seriesIds.add(key);
      if (x.teamAId === x.teamBId) say('同一球団同士のシリーズがある');
      if (!x.winnerTeamId) say('勝者のいないシリーズがある');
      const winsRequired = x.stage === 'FIRST' ? 2 : 4;
      if (x.teamAWins > winsRequired || x.teamBWins > winsRequired) {
        say('必要勝利数を超えている');
      }
      const cap = maxGames({ bestOf: x.stage === 'FIRST' ? 3 : 7 - x.advantageA } as never);
      if (x.games > cap) say(`試合数が上限を超えている（${x.games}）`);
      if (![x.teamAId, x.teamBId].includes(x.winnerTeamId ?? '')) {
        say('シリーズの勝者が参加球団でない');
      }
    }
    if (postseason.series.length !== 5) say(`シリーズ数が${postseason.series.length}`);

    for (const e of validateState(state)) say(e);

    // ---- 集計 ----
    for (const league of state.leagues) {
      const ids = postseason.participants[league.id] ?? [];
      const final = postseason.series.find(
        (x) => x.stage === 'FINAL' && x.leagueId === league.id,
      );
      const first = postseason.series.find(
        (x) => x.stage === 'FIRST' && x.leagueId === league.id,
      );
      ids.forEach((id, index) => {
        const rank = index + 1;
        const reachedFinal =
          rank === 1 || first?.winnerTeamId === id;
        result.bySeed.push({
          rank,
          reachedFinal,
          leagueChampion: final?.winnerTeamId === id,
          japanChampion: champion === id,
        });
      });
    }
    if (champion) {
      result.champions.push(champion);
      const roster = state.players.filter((p) => p.teamId === champion);
      result.championOverall.push(avg(roster.map((p) => overallRating(p))));
      result.championAge.push(avg(roster.map((p) => p.age)));
    }
    const japan = postseason.series.find((x) => x.stage === 'JAPAN_SERIES');
    if (japan) result.japanSeriesGames.push(japan.games);

    if (result.failures.length > 40) break;
  }
  return result;
}

/* ---------------- 実行（途中再開に対応） ---------------- */

const seedOf = (index: number) => 8000 + index * 7873;
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

console.log(
  `=== PHASE 3.8 ポストシーズンのバランス（${SEASONS}シーズン × ${results.length}シード）===\n`,
);

const rows = results.flatMap((r) => r.bySeed);
console.log(['順位', '球団数', 'ファイナル進出', 'リーグ優勝', '日本一'].join('\t'));
for (const rank of [1, 2, 3]) {
  const list = rows.filter((r) => r.rank === rank);
  console.log(
    [
      `${rank}位`,
      list.length,
      `${pct(list.filter((r) => r.reachedFinal).length, list.length)}%`,
      `${pct(list.filter((r) => r.leagueChampion).length, list.length)}%`,
      `${pct(list.filter((r) => r.japanChampion).length, list.length)}%`,
    ].join('\t'),
  );
}

const upsets = rows.filter((r) => r.rank > 1 && r.leagueChampion).length;
const leagueTitles = rows.filter((r) => r.leagueChampion).length;
console.log(`\n1位以外のリーグ優勝（アップセット）: ${pct(upsets, leagueTitles)}%`);

const champions = results.flatMap((r) => r.champions);
const byTeam = new Map<string, number>();
for (const id of champions) byTeam.set(id, (byTeam.get(id) ?? 0) + 1);
const sorted = [...byTeam.entries()].sort((a, b) => b[1] - a[1]);
if (sorted.length > 0) {
  console.log(
    `日本一 最多 ${sorted[0][0]}=${sorted[0][1]} / 最少 ${sorted[sorted.length - 1][0]}=${sorted[sorted.length - 1][1]}` +
      `（シェア ${pct(sorted[0][1], champions.length)}%・均等値 ${r1(100 / 12)}%）`,
  );
  console.log(`日本一になった球団数: ${sorted.length} / 12`);
}
console.log(
  `日本一球団の平均総合 ${r1(avg(results.flatMap((r) => r.championOverall)))} / ` +
    `平均年齢 ${r1(avg(results.flatMap((r) => r.championAge)))}`,
);
console.log(
  `日本シリーズの平均試合数 ${r1(avg(results.flatMap((r) => r.japanSeriesGames)))}`,
);

const problems: string[] = [];
const rate = (rank: number, key: 'leagueChampion' | 'japanChampion') => {
  const list = rows.filter((r) => r.rank === rank);
  return list.length === 0 ? 0 : list.filter((r) => r[key]).length / list.length;
};
const finalRate = (rank: number) => {
  const list = rows.filter((r) => r.rank === rank);
  return list.length === 0 ? 0 : list.filter((r) => r.reachedFinal).length / list.length;
};

if (finalRate(1) < 0.999) problems.push('1位がファイナルステージに進めていない');
if (rate(1, 'leagueChampion') <= rate(2, 'leagueChampion')) {
  problems.push('1位のリーグ優勝率が2位以下になっている');
}
if (rate(2, 'leagueChampion') <= rate(3, 'leagueChampion')) {
  problems.push('2位のリーグ優勝率が3位以下になっている');
}
if (rate(1, 'leagueChampion') > 0.9) problems.push('1位が強すぎる（アップセットがほぼ無い）');
if (rate(3, 'leagueChampion') < 0.02) problems.push('3位に勝ち目がなさすぎる');
if (sorted.length > 0 && sorted[0][1] / champions.length > 0.3) {
  problems.push(`1球団が日本一を独占している（${pct(sorted[0][1], champions.length)}%）`);
}
if (sorted.length < 8) problems.push(`日本一になる球団が偏っている（${sorted.length}球団のみ）`);

const failures = results.flatMap((r) => r.failures);
const unique = [...new Set(failures)];
problems.push(...unique.slice(0, 12));

if (problems.length > 0) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const p of problems) console.log(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
