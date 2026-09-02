/**
 * PHASE 3.6 球団経営AIの長期バランス検証。
 *   npx tsx scripts/team-ai-balance.ts [seasons] [seeds] [--log]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { overallRating } from '../src/domain/rating';
import { MINIMUM_ROSTER, teamPayroll } from '../src/domain/contract';
import { standingsForLeague } from '../src/domain/standings';
import { STRATEGY_SHORT } from '../src/domain/teamStrategy';
import { POSITION_KEYS } from '../src/domain/rosterAnalysis';
import type { GameState } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 100);
const VERBOSE = process.argv.includes('--log');

function playSeason(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.seasonFinished && guard++ < 6000) s = advanceDay(s).state;
  return s;
}
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

interface Row {
  overall: number;
  age: number;
  payroll: number;
  cash: number;
  faSigned: number;
  trades: number;
  draftPicks: number;
  retirements: number;
  minRoster: number;
  maxPayrollRatio: number;
  holes: number;
}

const failures: string[] = [];
const rows = new Map<number, Row[]>();
const strategyCount: Record<string, number> = {};
const titles = new Map<string, number>();
const lasts = new Map<string, number>();
const winsByTeam = new Map<string, number>();
let totalFa = 0;
let totalTrades = 0;
let totalDraft = 0;

for (let s = 0; s < SEEDS; s++) {
  const seed = 3000 + s * 7883;
  let state = createNewGame('phoenix', 30, seed);

  for (let season = 1; season <= SEASONS; season++) {
    const tradesBefore = state.trade.history.length;
    const retiredBefore = state.retiredPlayers.length;
    state = playSeason(state);

    for (const league of state.leagues) {
      const table = standingsForLeague(state, league.id);
      titles.set(table[0].teamId, (titles.get(table[0].teamId) ?? 0) + 1);
      lasts.set(
        table[table.length - 1].teamId,
        (lasts.get(table[table.length - 1].teamId) ?? 0) + 1,
      );
    }
    for (const team of state.teams) {
      winsByTeam.set(team.id, (winsByTeam.get(team.id) ?? 0) + state.records[team.id].wins);
    }

    const payrolls = state.teams.map((t) => teamPayroll(state, t.id));
    const cash = state.teams.map((t) => state.finances[t.id].cash);
    const rosterSizes = state.teams.map(
      (t) => state.players.filter((p) => p.teamId === t.id).length,
    );
    const ratios = state.teams.map((t) => teamPayroll(state, t.id) / state.finances[t.id].budget);

    // 経営プランの集計
    let faSigned = 0;
    let draftPicks = 0;
    let holes = 0;
    for (const team of state.teams) {
      const plan = state.teamPlans[team.id];
      if (!plan) continue;
      strategyCount[plan.strategy] = (strategyCount[plan.strategy] ?? 0) + 1;
      faSigned += plan.log.faSigned;
      draftPicks += plan.log.draftPicks;
      holes += POSITION_KEYS.filter((key) => (plan.needs[key] ?? 0) >= 85).length;
      if (VERBOSE && s === 0 && season % 10 === 0) {
        console.log(
          `[AI] year=${season} ${team.shortName} ${STRATEGY_SHORT[plan.strategy]} ` +
            `faBudget=${plan.faBudget} faSpent=${plan.faSpent} log=${JSON.stringify(plan.log)}`,
        );
      }
    }
    const seasonTrades = state.trade.history.length - tradesBefore;
    totalFa += faSigned;
    totalTrades += seasonTrades;
    totalDraft += draftPicks;

    const row: Row = {
      overall: r1(avg(state.players.map((p) => overallRating(p)))),
      age: r1(avg(state.players.map((p) => p.age))),
      payroll: Math.round(avg(payrolls)),
      cash: Math.round(avg(cash)),
      faSigned,
      trades: seasonTrades,
      draftPicks,
      retirements: state.retiredPlayers.length - retiredBefore,
      minRoster: Math.min(...rosterSizes),
      maxPayrollRatio: Math.max(...ratios),
      holes,
    };
    if (!rows.has(season)) rows.set(season, []);
    rows.get(season)!.push(row);

    // ---- 異常検出 ----
    for (const e of validateState(state)) failures.push(`seed${seed} Y${season}: ${e}`);
    const ids = new Set<string>();
    for (const p of state.players) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: 同じ選手が複数球団にいます`);
      ids.add(p.id);
      const contract = p.ext.contract;
      if (contract) {
        if (contract.salary < 0) failures.push(`seed${seed} Y${season}: 年俸がマイナス`);
        if (contract.yearsRemaining < 0) failures.push(`seed${seed} Y${season}: 契約残年数が不正`);
      }
      if (p.age < 15 || p.age > 50) failures.push(`seed${seed} Y${season}: 年齢が不正 (${p.age})`);
    }
    const retiredIds = new Set(state.retiredPlayers.map((r) => r.playerId));
    for (const id of retiredIds) {
      if (ids.has(id)) failures.push(`seed${seed} Y${season}: 引退選手がロスターにいます`);
    }
    for (const p of state.freeAgents) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: FA選手が球団にも所属`);
    }
    if (row.minRoster < MINIMUM_ROSTER) {
      failures.push(`seed${seed} Y${season}: ロスター${row.minRoster}人`);
    }
    if (row.maxPayrollRatio > 1.25) {
      failures.push(`seed${seed} Y${season}: 総年俸が予算の${r1(row.maxPayrollRatio)}倍`);
    }
    for (const t of state.teams) {
      const first = state.players.filter((p) => p.teamId === t.id && p.roster === 'first');
      if (first.filter((p) => !p.isPitcher).length < 9) {
        failures.push(`seed${seed} Y${season}: 1軍野手不足`);
      }
      if (first.filter((p) => p.isPitcher).length < 5) {
        failures.push(`seed${seed} Y${season}: 1軍投手不足`);
      }
    }

    state = cloneState(state);
    startNextSeason(state);
    row.retirements = state.retiredPlayers.length - retiredBefore;

    // オフシーズン明け（契約更改・ドラフト・FAのあと）の状態も検査する
    for (const team of state.teams) {
      const size = state.players.filter((p) => p.teamId === team.id).length;
      if (size < MINIMUM_ROSTER) failures.push(`seed${seed} Y${season}: オフ明けロスター${size}人`);
      const ratio = teamPayroll(state, team.id) / state.finances[team.id].budget;
      if (ratio > 1.25) failures.push(`seed${seed} Y${season}: オフ明け総年俸が予算の${r1(ratio)}倍`);
    }
  }
}

function summarize(season: number): Row | null {
  const list = rows.get(season);
  if (!list) return null;
  const p = (fn: (r: Row) => number) => r1(avg(list.map(fn)));
  return {
    overall: p((r) => r.overall),
    age: p((r) => r.age),
    payroll: p((r) => r.payroll),
    cash: p((r) => r.cash),
    faSigned: p((r) => r.faSigned),
    trades: p((r) => r.trades),
    draftPicks: p((r) => r.draftPicks),
    retirements: p((r) => r.retirements),
    minRoster: Math.min(...list.map((r) => r.minRoster)),
    maxPayrollRatio: r1(Math.max(...list.map((r) => r.maxPayrollRatio))),
    holes: p((r) => r.holes),
  };
}

console.log(`=== PHASE 3.6 球団経営AIバランス（${SEASONS}シーズン × ${SEEDS}シード）===\n`);
console.log(
  ['Year', 'Ovr', 'Age', 'Payroll', 'Cash', 'FA', 'Trade', 'Draft', 'Retire', 'MinR', 'MaxRatio', 'Holes'].join('\t'),
);
for (const season of [1, 5, 10, 15, 20, 25, 30, 40, 50].filter((y) => y <= SEASONS)) {
  const r = summarize(season);
  if (!r) continue;
  console.log(
    [season, r.overall, r.age, r.payroll, r.cash, r.faSigned, r.trades, r.draftPicks, r.retirements, r.minRoster, r.maxPayrollRatio, r.holes].join('\t'),
  );
}

const seasonsRun = SEEDS * SEASONS;
console.log(`\nFA獲得 合計 ${totalFa}（${r1(totalFa / seasonsRun)}件/年）`);
console.log(`トレード 合計 ${totalTrades}（${r1(totalTrades / seasonsRun)}件/年）`);
console.log(`ドラフト 合計 ${totalDraft}（${r1(totalDraft / seasonsRun)}人/年）`);

const strategyTotal = Object.values(strategyCount).reduce((a, b) => a + b, 0);
console.log(
  'CPU戦略の分布: ' +
    Object.entries(strategyCount)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${STRATEGY_SHORT[k as never]}=${((v / strategyTotal) * 100).toFixed(1)}%`)
      .join(' / '),
);

const titleList = [...titles.entries()].sort((a, b) => b[1] - a[1]);
const titleTotal = titleList.reduce((a, b) => a + b[1], 0);
if (titleList.length) {
  console.log(
    `優勝 最多 ${titleList[0][0]}=${titleList[0][1]} / 最少 ${titleList[titleList.length - 1][0]}=${titleList[titleList.length - 1][1]}` +
      `（シェア ${((titleList[0][1] / titleTotal) * 100).toFixed(1)}%）`,
  );
}
const lastList = [...lasts.entries()].sort((a, b) => b[1] - a[1]);
if (lastList.length) console.log(`最下位 最多 ${lastList[0][0]}=${lastList[0][1]}`);
const winList = [...winsByTeam.values()];
const winTotal = winList.reduce((a, b) => a + b, 0);
console.log(`勝利数シェア 最大 ${((Math.max(...winList) / winTotal) * 100).toFixed(1)}%（均等値 ${(100 / 12).toFixed(1)}%）`);

const problems: string[] = [];
const first = summarize(1);
const last = summarize(SEASONS);
if (strategyTotal > 0) {
  const used = Object.keys(strategyCount).length;
  if (used < 3) problems.push(`CPUの戦略が偏りすぎている（${used}種類のみ）`);
  const top = Math.max(...Object.values(strategyCount));
  if (top / strategyTotal > 0.75) problems.push('CPUの戦略がほぼ1種類に固まっている');
}
if (titleList.length && titleList[0][1] / titleTotal > 0.3) {
  problems.push(`1球団が優勝を独占している（${((titleList[0][1] / titleTotal) * 100).toFixed(1)}%）`);
}
if (winTotal > 0 && Math.max(...winList) / winTotal > 0.12) {
  problems.push('1球団が勝利数を独占している');
}
if (first && last) {
  if (last.payroll > first.payroll * 2.2) problems.push('総年俸がインフレしている');
  if (last.overall > 50 || last.overall < 30) problems.push(`平均総合が異常: ${last.overall}`);
  if (last.age > 32 || last.age < 23) problems.push(`平均年齢が異常: ${last.age}`);
}
const perSeasonTrades = totalTrades / seasonsRun;
if (perSeasonTrades > 40) problems.push(`トレードが多すぎる: ${r1(perSeasonTrades)}件/年`);
if (perSeasonTrades < 3) problems.push(`トレードが少なすぎる: ${r1(perSeasonTrades)}件/年`);

const unique = [...new Set(failures)];
problems.push(...unique.slice(0, 10));

if (problems.length) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const p of problems) console.log(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
