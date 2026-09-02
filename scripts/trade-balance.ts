/**
 * PHASE 3.5 トレードの長期バランス確認。
 *   npx tsx scripts/trade-balance.ts [seasons] [seeds] [--log]
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { overallRating } from '../src/domain/rating';
import { MINIMUM_ROSTER, teamPayroll } from '../src/domain/contract';
import { canTradePlayer } from '../src/domain/trade';
import { standingsForLeague } from '../src/domain/standings';
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
  trades: number;
  playersMoved: number;
  avgPayroll: number;
  avgSalary: number;
  maxSalary: number;
  avgOverall: number;
  avgAge: number;
  minRoster: number;
}
const failures: string[] = [];
const rows = new Map<number, Row[]>();
const acquiredByTeam = new Map<string, number>();
const titlesByTeam = new Map<string, number>();
const lastByTeam = new Map<string, number>();
let totalTrades = 0;
let totalMoved = 0;

for (let s = 0; s < SEEDS; s++) {
  const seed = 2000 + s * 7907;
  let state = createNewGame('phoenix', 30, seed);

  for (let season = 1; season <= SEASONS; season++) {
    const before = state.trade.history.length;
    state = playSeason(state);

    const seasonTrades = state.trade.history.slice(before);
    totalTrades += seasonTrades.length;
    for (const rec of seasonTrades) {
      const moved = rec.playerIdsFrom.length + rec.playerIdsTo.length;
      totalMoved += moved;
      acquiredByTeam.set(rec.toTeamId, (acquiredByTeam.get(rec.toTeamId) ?? 0) + rec.playerIdsFrom.length);
      acquiredByTeam.set(rec.fromTeamId, (acquiredByTeam.get(rec.fromTeamId) ?? 0) + rec.playerIdsTo.length);
    }
    if (VERBOSE && s === 0) {
      for (const rec of seasonTrades) {
        console.log(`[TRADE] year=${season} ${rec.fromTeamId} ${rec.playerNamesFrom.join('・')} ⇄ ${rec.toTeamId} ${rec.playerNamesTo.join('・')}`);
      }
    }

    for (const league of state.leagues) {
      const table = standingsForLeague(state, league.id);
      titlesByTeam.set(table[0].teamId, (titlesByTeam.get(table[0].teamId) ?? 0) + 1);
      const bottom = table[table.length - 1];
      lastByTeam.set(bottom.teamId, (lastByTeam.get(bottom.teamId) ?? 0) + 1);
    }

    const salaries = state.players.map((p) => p.ext.contract?.salary ?? 0);
    const rosterSizes = state.teams.map((t) => state.players.filter((p) => p.teamId === t.id).length);
    const row: Row = {
      trades: seasonTrades.length,
      playersMoved: seasonTrades.reduce((a, r) => a + r.playerIdsFrom.length + r.playerIdsTo.length, 0),
      avgPayroll: Math.round(avg(state.teams.map((t) => teamPayroll(state, t.id)))),
      avgSalary: Math.round(avg(salaries)),
      maxSalary: Math.max(...salaries),
      avgOverall: r1(avg(state.players.map((p) => overallRating(p)))),
      avgAge: r1(avg(state.players.map((p) => p.age))),
      minRoster: Math.min(...rosterSizes),
    };
    if (!rows.has(season)) rows.set(season, []);
    rows.get(season)!.push(row);

    // ---- 異常検出 ----
    for (const e of validateState(state)) failures.push(`seed${seed} Y${season}: ${e}`);
    const ids = new Set<string>();
    for (const p of state.players) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: 同じ選手が複数球団にいます`);
      ids.add(p.id);
      if ((p.ext.contract?.salary ?? 0) < 0) failures.push(`seed${seed} Y${season}: 年俸がマイナス`);
    }
    for (const p of state.freeAgents) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: FA選手が球団にも所属`);
    }
    const retired = new Set(state.retiredPlayers.map((r) => r.playerId));
    for (const rec of seasonTrades) {
      for (const id of [...rec.playerIdsFrom, ...rec.playerIdsTo]) {
        if (retired.has(id) && !ids.has(id)) continue;
        if (state.freeAgents.some((p) => p.id === id)) {
          failures.push(`seed${seed} Y${season}: FA選手がトレードされた`);
        }
      }
    }
    if (row.minRoster < MINIMUM_ROSTER) failures.push(`seed${seed} Y${season}: ロスター${row.minRoster}人`);
    for (const t of state.teams) {
      if (teamPayroll(state, t.id) < 0) failures.push(`seed${seed} Y${season}: 総年俸マイナス`);
      const first = state.players.filter((p) => p.teamId === t.id && p.roster === 'first');
      if (first.filter((p) => !p.isPitcher).length < 9) failures.push(`seed${seed} Y${season}: 1軍野手不足`);
      if (first.filter((p) => p.isPitcher).length < 5) failures.push(`seed${seed} Y${season}: 1軍投手不足`);
    }
    void canTradePlayer;

    state = cloneState(state);
    startNextSeason(state);
  }
}

function summarize(season: number): Row | null {
  const list = rows.get(season);
  if (!list) return null;
  const p = (fn: (r: Row) => number) => r1(avg(list.map(fn)));
  return {
    trades: p((r) => r.trades),
    playersMoved: p((r) => r.playersMoved),
    avgPayroll: p((r) => r.avgPayroll),
    avgSalary: p((r) => r.avgSalary),
    maxSalary: p((r) => r.maxSalary),
    avgOverall: p((r) => r.avgOverall),
    avgAge: p((r) => r.avgAge),
    minRoster: Math.min(...list.map((r) => r.minRoster)),
  };
}

console.log(`=== PHASE 3.5 トレードバランス（${SEASONS}シーズン × ${SEEDS}シード）===\n`);
console.log(['Year', 'Trades', 'Moved', 'Payroll', 'AvgSal', 'MaxSal', 'Ovr', 'Age', 'MinR'].join('\t'));
for (const season of [1, 5, 10, 15, 20, 25, 30].filter((y) => y <= SEASONS)) {
  const r = summarize(season);
  if (!r) continue;
  console.log([season, r.trades, r.playersMoved, r.avgPayroll, r.avgSalary, r.maxSalary, r.avgOverall, r.avgAge, r.minRoster].join('\t'));
}

const seasonsRun = SEEDS * SEASONS;
console.log(`\n総トレード数: ${totalTrades}（1シーズンあたり ${(totalTrades / seasonsRun).toFixed(1)}件）`);
console.log(`移籍した延べ人数: ${totalMoved}（1件あたり ${(totalMoved / Math.max(1, totalTrades)).toFixed(2)}人）`);

const acq = [...acquiredByTeam.entries()].sort((a, b) => b[1] - a[1]);
const totalAcq = acq.reduce((a, b) => a + b[1], 0);
if (acq.length) {
  const share = acq[0][1] / Math.max(1, totalAcq);
  console.log(`獲得数 最多 ${acq[0][0]}=${acq[0][1]} / 最少 ${acq[acq.length - 1][0]}=${acq[acq.length - 1][1]}（シェア ${(share * 100).toFixed(1)}%）`);
  if (share > 0.25) failures.push(`1球団が全移籍の${(share * 100).toFixed(1)}%を獲得している`);
}
const titles = [...titlesByTeam.entries()].sort((a, b) => b[1] - a[1]);
const totalTitles = titles.reduce((a, b) => a + b[1], 0);
if (titles.length) {
  console.log(`優勝 最多 ${titles[0][0]}=${titles[0][1]} / 最少 ${titles[titles.length - 1][0]}=${titles[titles.length - 1][1]}（シェア ${((titles[0][1] / totalTitles) * 100).toFixed(1)}%）`);
  if (titles[0][1] / totalTitles > 0.35) failures.push('1球団がリーグを独走している');
}
const lasts = [...lastByTeam.entries()].sort((a, b) => b[1] - a[1]);
if (lasts.length) console.log(`最下位 最多 ${lasts[0][0]}=${lasts[0][1]}`);

const problems: string[] = [];
const first = summarize(1);
const last = summarize(SEASONS);
const perSeason = totalTrades / seasonsRun;
if (perSeason < 5) problems.push(`トレードが少なすぎる: ${perSeason.toFixed(1)}件/年`);
if (perSeason > 40) problems.push(`トレードが多すぎる: ${perSeason.toFixed(1)}件/年`);
if (first && last) {
  if (last.avgSalary > first.avgSalary * 2) problems.push('年俸がインフレしている');
  if (last.avgOverall > 50 || last.avgOverall < 30) problems.push(`平均総合が異常: ${last.avgOverall}`);
  if (last.avgAge > 32 || last.avgAge < 23) problems.push(`平均年齢が異常: ${last.avgAge}`);
}
const unique = [...new Set(failures)];
problems.push(...unique.slice(0, 10));
if (problems.length) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const p of problems) console.log(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
