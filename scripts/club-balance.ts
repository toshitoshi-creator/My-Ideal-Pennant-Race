/**
 * PHASE 4.0 球団経営の長期検証。
 *   npx tsx scripts/club-balance.ts [seasons] [seeds] [--from=N] [--out=file]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import {
  DIRECTION_LABELS,
  FACILITY_KINDS,
  FACILITY_LABELS,
  IDENTITY_LABELS,
  MAX_FACILITY_LEVEL,
  clubRating,
  setDirection,
} from '../src/domain/club';
import { overallRating } from '../src/domain/rating';
import { MINIMUM_ROSTER } from '../src/domain/contract';
import type { ClubDirection, FacilityKind, GameState, TeamIdentity } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 100);
const SEED_FROM = Number((process.argv.find((a) => a.startsWith('--from=')) ?? '--from=0').slice(7));
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function playRegularSeason(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.seasonFinished && guard++ < 6000) s = advanceDay(s).state;
  return s;
}

/** シードごとに自球団の方針を変えて、全方針を等しく試す */
const DIRECTION_CYCLE: ClubDirection[] = ['WIN_NOW', 'DEVELOP', 'REBUILD', 'BALANCED', 'THRIFTY'];

interface SeedResult {
  seed: number;
  direction: ClubDirection;
  failures: string[];
  age: number[];
  overall: number[];
  rookieOverall: number[];
  retirements: number[];
  draftees: number[];
  faMoves: number[];
  trades: number[];
  salary: number[];
  payroll: number[];
  cash: number[];
  facilityLevel: number[];
  facilityByKind: Record<string, number>;
  morale: number[];
  youngGrowth: number[];
  events: number;
  objectivesAchieved: number;
  ratingTotal: number[];
  /** 球団評価（総合）と勝率の組 */
  ratingVsWin: [number, number][];
  pennants: Record<string, number>;
  japanTitles: Record<string, number>;
  identity: Record<string, number>;
  cpuDirections: Record<string, number>;
  saveKb: number;
}

function emptyResult(seed: number, direction: ClubDirection): SeedResult {
  return {
    seed,
    direction,
    failures: [],
    age: [],
    overall: [],
    rookieOverall: [],
    retirements: [],
    draftees: [],
    faMoves: [],
    trades: [],
    salary: [],
    payroll: [],
    cash: [],
    facilityLevel: [],
    facilityByKind: {},
    morale: [],
    youngGrowth: [],
    events: 0,
    objectivesAchieved: 0,
    ratingTotal: [],
    ratingVsWin: [],
    pennants: {},
    japanTitles: {},
    identity: {},
    cpuDirections: {},
    saveKb: 0,
  };
}

function runSeed(seed: number, direction: ClubDirection): SeedResult {
  const result = emptyResult(seed, direction);
  let state = createNewGame('phoenix', 30, seed);
  state = cloneState(state);
  setDirection(state, 'phoenix', direction);

  let previousRetired = 0;
  let previousTrades = 0;
  let previousFa = 0;
  let previousEvents = 0;

  for (let season = 1; season <= SEASONS; season++) {
    const say = (msg: string) => result.failures.push(`seed${seed} Y${season}: ${msg}`);

    // 若手の成長を測るため、シーズン前の能力を控える
    const before = new Map(
      state.players.filter((p) => p.age <= 23).map((p) => [p.id, overallRating(p)]),
    );
    // 球団評価と、その年の勝率の関係
    const ratings = state.teams.map((t) => ({ id: t.id, total: clubRating(state, t.id).total }));

    state = playRegularSeason(state);

    for (const r of ratings) {
      const record = state.records[r.id];
      const games = record ? record.wins + record.losses : 0;
      if (games > 0) result.ratingVsWin.push([r.total, record.wins / games]);
    }

    state = cloneState(state);
    startNextSeason(state);

    // ---- 選手 ----
    const roster = state.players;
    result.age.push(avg(roster.map((p) => p.age)));
    result.overall.push(avg(roster.map((p) => overallRating(p))));
    result.salary.push(avg(roster.map((p) => (p.ext.contract?.salary ?? 0))));

    const rookies = roster.filter((p) => p.ext.debutYear === state.year);
    if (rookies.length > 0) result.rookieOverall.push(avg(rookies.map((p) => overallRating(p))));

    let grown = 0;
    let growth = 0;
    for (const [id, was] of before) {
      const now = state.players.find((p) => p.id === id);
      if (!now) continue;
      grown += 1;
      growth += overallRating(now) - was;
    }
    if (grown > 0) result.youngGrowth.push(growth / grown);

    // ---- 球団 ----
    let facilitySum = 0;
    let facilityCount = 0;
    for (const team of state.teams) {
      const club = state.clubs[team.id];
      if (!club) {
        say(`${team.id} の球団状態が無い`);
        continue;
      }
      for (const kind of FACILITY_KINDS) {
        const level = club.facilities[kind];
        if (level < 1 || level > MAX_FACILITY_LEVEL || !Number.isInteger(level)) {
          say(`${team.id} の${FACILITY_LABELS[kind]}が Lv${level}`);
        }
        facilitySum += level;
        facilityCount += 1;
        result.facilityByKind[kind] = (result.facilityByKind[kind] ?? 0) + level;
      }
      result.identity[club.identity] = (result.identity[club.identity] ?? 0) + 1;
      if (team.id !== 'phoenix') {
        result.cpuDirections[club.direction] = (result.cpuDirections[club.direction] ?? 0) + 1;
      }

      const finance = state.finances[team.id];
      if (finance.cash < 0) say(`${team.id} の資金がマイナス（${Math.round(finance.cash)}）`);
      const payroll = state.players
        .filter((p) => p.teamId === team.id)
        .reduce((a, p) => a + (p.ext.contract?.salary ?? 0), 0);
      if (payroll > finance.budget * 1.25) {
        say(`${team.id} の年俸総額が予算を大きく超えている（${Math.round(payroll)}/${Math.round(finance.budget)}）`);
      }
      const size = state.players.filter((p) => p.teamId === team.id).length;
      if (size < MINIMUM_ROSTER) say(`${team.id} の選手が${size}人`);

      const morale = state.teamMorale[team.id];
      if (morale < 0 || morale > 100) say(`${team.id} の士気が${morale}`);
      result.morale.push(morale);
    }
    result.facilityLevel.push(facilitySum / Math.max(1, facilityCount));

    const me = state.finances.phoenix;
    result.cash.push(me.cash);
    result.payroll.push(
      state.players.filter((p) => p.teamId === 'phoenix').reduce((a, p) => a + (p.ext.contract?.salary ?? 0), 0),
    );
    result.ratingTotal.push(clubRating(state, 'phoenix').total);
    result.objectivesAchieved = state.clubs.phoenix.achieved;

    // ---- 出入り ----
    const retired = Object.values(state.history.players).filter((p) => p.retiredAt !== null).length;
    result.retirements.push(retired - previousRetired);
    previousRetired = retired;
    result.draftees.push(state.lastOffseason?.rookies ?? rookies.length);
    const trades = state.trade.history.length;
    result.trades.push(trades - previousTrades);
    previousTrades = trades;
    result.faMoves.push(state.lastOffseason?.faSigned ?? 0);
    void previousFa;

    const events = state.events.length;
    result.events += Math.max(0, events - previousEvents);
    previousEvents = events;

    // ---- 優勝 ----
    const history = state.history.seasons[state.history.seasons.length - 1];
    if (history) {
      for (const league of history.leagues) {
        const champion = league.championTeamId;
        if (champion) result.pennants[champion] = (result.pennants[champion] ?? 0) + 1;
      }
      const japan = history.postseason?.japanSeriesChampionTeamId;
      if (japan) result.japanTitles[japan] = (result.japanTitles[japan] ?? 0) + 1;
    }

    for (const e of validateState(state)) say(e);
    if (result.failures.length > 30) break;
  }

  result.saveKb = Math.round(JSON.stringify(state).length / 1024);
  return result;
}

/* ---------------- 実行（途中再開に対応） ---------------- */

const seedOf = (index: number) => 40000 + index * 6151;
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
  const result = runSeed(seed, DIRECTION_CYCLE[s % DIRECTION_CYCLE.length]);
  if (OUT) appendFileSync(OUT, JSON.stringify(result) + '\n');
  results.push(result);
}

/* ---------------- 集計 ---------------- */

console.log(`=== PHASE 4.0 球団経営の検証（${SEASONS}シーズン × ${results.length}シード）===\n`);

const flat = (pick: (r: SeedResult) => number[]) => results.flatMap(pick);
const meanAge = avg(flat((r) => r.age));
const meanOverall = avg(flat((r) => r.overall));
console.log(`平均年齢 ${r1(meanAge)}歳 / 平均総合 ${r1(meanOverall)}`);
console.log(
  `新人の平均総合 ${r1(avg(flat((r) => r.rookieOverall)))} / ` +
    `若手(23歳以下)の年間成長 ${r2(avg(flat((r) => r.youngGrowth)))}`,
);
console.log(
  `1年あたり 引退${r1(avg(flat((r) => r.retirements)))}人 / ` +
    `新人${r1(avg(flat((r) => r.draftees)))}人 / ` +
    `FA移籍${r1(avg(flat((r) => r.faMoves)))}人 / ` +
    `トレード${r1(avg(flat((r) => r.trades)))}件`,
);
console.log(
  `平均年俸 ${Math.round(avg(flat((r) => r.salary)))}万 / ` +
    `自球団の年俸総額 ${Math.round(avg(flat((r) => r.payroll)))}万 / ` +
    `資金 ${Math.round(avg(flat((r) => r.cash)))}万`,
);

const facilityAvg = avg(flat((r) => r.facilityLevel));
const byKind: Record<string, number> = {};
let kindTotal = 0;
for (const r of results) {
  for (const [k, v] of Object.entries(r.facilityByKind)) {
    byKind[k] = (byKind[k] ?? 0) + v;
    kindTotal += v;
  }
}
const teamSeasons = results.reduce((a, r) => a + r.facilityLevel.length, 0) * 12;
void kindTotal;
console.log(
  `施設 平均Lv${r2(facilityAvg)}（` +
    FACILITY_KINDS.map(
      (k) => `${FACILITY_LABELS[k]}=${r2((byKind[k] ?? 0) / Math.max(1, teamSeasons))}`,
    ).join(' / ') +
    `）`,
);

console.log(`士気 平均 ${r1(avg(flat((r) => r.morale)))}`);
console.log(
  `経営イベント 1シードあたり ${r1(avg(results.map((r) => r.events)))}件 / ` +
    `目標達成 ${r1(avg(results.map((r) => r.objectivesAchieved)))}回`,
);
console.log(`自球団の球団評価（総合） 平均 ${r1(avg(flat((r) => r.ratingTotal)))}`);

// 球団評価が勝率を完全には予測しないこと（相関係数）
const pairs = results.flatMap((r) => r.ratingVsWin);
const mx = avg(pairs.map((p) => p[0]));
const my = avg(pairs.map((p) => p[1]));
let sxy = 0;
let sxx = 0;
let syy = 0;
for (const [x, y] of pairs) {
  sxy += (x - mx) * (y - my);
  sxx += (x - mx) ** 2;
  syy += (y - my) ** 2;
}
const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
console.log(`球団評価と勝率の相関 ${r2(corr)}`);

const sumMap = (pick: (r: SeedResult) => Record<string, number>) => {
  const total: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(pick(r))) total[k] = (total[k] ?? 0) + v;
  }
  return total;
};
const pennants = sumMap((r) => r.pennants);
const japan = sumMap((r) => r.japanTitles);
const pennantTotal = Object.values(pennants).reduce((a, b) => a + b, 0);
const japanTotal = Object.values(japan).reduce((a, b) => a + b, 0);
const share = (m: Record<string, number>, total: number) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${((v / total) * 100).toFixed(1)}%`)
    .join(' ');
console.log(`\nリーグ優勝の分布: ${share(pennants, pennantTotal)}`);
console.log(`日本一の分布: ${share(japan, japanTotal)}`);

const identity = sumMap((r) => r.identity);
const identityTotal = Object.values(identity).reduce((a, b) => a + b, 0);
console.log(
  `球団の色: ` +
    Object.entries(identity)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${IDENTITY_LABELS[k as TeamIdentity]}=${((v / identityTotal) * 100).toFixed(1)}%`)
      .join(' / '),
);
const cpu = sumMap((r) => r.cpuDirections);
const cpuTotal = Object.values(cpu).reduce((a, b) => a + b, 0);
console.log(
  `CPUの方針: ` +
    Object.entries(cpu)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${DIRECTION_LABELS[k as ClubDirection]}=${((v / cpuTotal) * 100).toFixed(1)}%`)
      .join(' / '),
);
console.log(`セーブサイズ 平均 ${Math.round(avg(results.map((r) => r.saveKb)))}KB`);

/* ---------------- 判定 ---------------- */

const problems: string[] = [...new Set(results.flatMap((r) => r.failures))];
const check = (okCond: boolean, msg: string) => {
  if (!okCond) problems.push(msg);
};
check(meanAge >= 26 && meanAge <= 29, `平均年齢が範囲外（${r1(meanAge)}）`);
check(meanOverall >= 39 && meanOverall <= 41, `平均総合が範囲外（${r1(meanOverall)}）`);
check(facilityAvg <= MAX_FACILITY_LEVEL, `施設の平均Lvが上限を超えている（${r2(facilityAvg)}）`);
check(Math.abs(corr) < 0.95, `球団評価が勝率を予測しすぎている（相関${r2(corr)}）`);
check(
  Object.keys(pennants).length >= 6,
  `リーグ優勝が偏りすぎている（${Object.keys(pennants).length}球団）`,
);

if (problems.length > 0) {
  console.log(`\n=== FAIL（異常 ${problems.length} 種類）===`);
  for (const p of problems.slice(0, 15)) console.log(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
