/**
 * PHASE 3.4 FA市場のバランス確認。
 *
 *   npx tsx scripts/fa-balance.ts [seasons] [seeds] [--log]
 *
 * 既定は 30 シーズン × 100 シード。異常を検出した場合は FAIL を表示して終了コード 1。
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState, validateState } from '../src/domain/engine';
import {
  completeOffseason,
  resolveFAPhase,
  startContractPhase,
  startFAPhase,
  startOffseason,
} from '../src/domain/season';
import { overallRating } from '../src/domain/rating';
import { MINIMUM_ROSTER, runCpuFAOffers } from '../src/domain/freeAgency';
import type { GameState } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 100);
/**
 * シードの開始位置。--from=25 のように渡すと、100シードを何回かに分けて回せる。
 * （長時間の実行が途中で止まる環境向け。既定では従来どおり先頭から）
 */
const SEED_FROM = Number(
  (process.argv.find((a) => a.startsWith('--from=')) ?? '--from=0').slice(7),
);
const VERBOSE = process.argv.includes('--log');

function playSeason(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while (!next.seasonFinished && guard++ < 6000) next = advanceDay(next).state;
  return next;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const avg = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const round1 = (value: number) => Math.round(value * 10) / 10;

interface YearRow {
  avgPayroll: number;
  avgSalary: number;
  medianSalary: number;
  maxSalary: number;
  avgCash: number;
  faPlayers: number;
  faSignings: number;
  faUnsigned: number;
  userSignings: number;
  cpuSignings: number;
  avgContractYears: number;
  avgFaSalary: number;
  topTeamFaSpend: number;
  bottomTeamFaSpend: number;
  avgOverall: number;
  avgAge: number;
  minRoster: number;
  bankrupt: number;
}

const failures: string[] = [];
const rowsBySeason = new Map<number, YearRow[]>();
/** 球団ごとの通算FA獲得数（独占の検出） */
const signingsByTeam = new Map<string, number>();
let totalListed = 0;
let totalSigned = 0;
let totalUserSigned = 0;
let totalOffers = 0;

for (let s = SEED_FROM; s < SEED_FROM + SEEDS; s++) {
  const seed = 1000 + s * 7919;
  let state = createNewGame('phoenix', 30, seed);

  for (let season = 1; season <= SEASONS; season++) {
    state = playSeason(state);
    state = cloneState(state);

    // 前年の順位（強豪／下位の FA 支出を比べるため）
    const standings = [...state.teams]
      .map((t) => ({ id: t.id, wins: state.records[t.id].wins }))
      .sort((a, b) => b.wins - a.wins);
    const strongest = standings[0].id;
    const weakest = standings[standings.length - 1].id;

    // ---- オフシーズンを段階ごとに進める（FA の内訳を見るため） ----
    startOffseason(state);
    startContractPhase(state);
    const fa = startFAPhase(state);
    // プレイヤー球団も CPU と同じ基準で参加させ、ユーザー側の獲得数を測る
    runCpuFAOffers(state, { includePlayerTeam: true });
    const listed = fa.listings.length;
    const offerCount = fa.offers.length;
    resolveFAPhase(state);
    const results = [...fa.results];
    completeOffseason(state);

    const spendByTeam = new Map<string, number>();
    for (const r of results) {
      spendByTeam.set(r.teamId, (spendByTeam.get(r.teamId) ?? 0) + r.salary);
      signingsByTeam.set(r.teamId, (signingsByTeam.get(r.teamId) ?? 0) + 1);
    }
    const userSignings = results.filter((r) => r.teamId === state.playerTeamId).length;

    totalListed += listed;
    totalSigned += results.length;
    totalUserSigned += userSignings;
    totalOffers += offerCount;

    const salaries = state.players.map((p) => p.ext.contract?.salary ?? 0);
    const payrolls = state.teams.map((t) => state.finances[t.id].payroll);
    const cash = state.teams.map((t) => state.finances[t.id].cash);
    const rosterSizes = state.teams.map(
      (t) => state.players.filter((p) => p.teamId === t.id).length,
    );

    const row: YearRow = {
      avgPayroll: Math.round(avg(payrolls)),
      avgSalary: Math.round(avg(salaries)),
      medianSalary: median(salaries),
      maxSalary: Math.max(...salaries),
      avgCash: Math.round(avg(cash)),
      faPlayers: listed,
      faSignings: results.length,
      faUnsigned: state.freeAgents.length,
      userSignings,
      cpuSignings: results.length - userSignings,
      avgContractYears: round1(avg(results.map((r) => r.years))),
      avgFaSalary: Math.round(avg(results.map((r) => r.salary))),
      topTeamFaSpend: spendByTeam.get(strongest) ?? 0,
      bottomTeamFaSpend: spendByTeam.get(weakest) ?? 0,
      avgOverall: round1(avg(state.players.map((p) => overallRating(p)))),
      avgAge: round1(avg(state.players.map((p) => p.age))),
      minRoster: Math.min(...rosterSizes),
      bankrupt: cash.filter((c) => c < 0).length,
    };

    if (!rowsBySeason.has(season)) rowsBySeason.set(season, []);
    rowsBySeason.get(season)!.push(row);

    if (VERBOSE && s === 0) {
      for (const r of results) {
        console.log(
          `[FA] year=${season} player=${r.name} offers=${r.offers} winner=${r.teamId} salary=${r.salary} years=${r.years}`,
        );
      }
    }

    // ---- 異常検出 ----
    for (const error of validateState(state)) failures.push(`seed${seed} Y${season}: ${error}`);

    const ids = new Set<string>();
    for (const p of state.players) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: 同じ選手が複数球団にいます (${p.id})`);
      ids.add(p.id);
    }
    const faIds = new Set<string>();
    for (const p of state.freeAgents) {
      if (ids.has(p.id)) failures.push(`seed${seed} Y${season}: FA選手が球団にも所属しています (${p.id})`);
      if (faIds.has(p.id)) failures.push(`seed${seed} Y${season}: FA市場に重複登録があります (${p.id})`);
      faIds.add(p.id);
      if (p.teamId !== '') failures.push(`seed${seed} Y${season}: FA選手に球団IDが残っています`);
      if (p.ext.contract) failures.push(`seed${seed} Y${season}: FA選手に契約が残っています`);
    }
    for (const record of state.retiredPlayers) {
      if (faIds.has(record.playerId)) {
        failures.push(`seed${seed} Y${season}: 引退選手がFA市場にいます`);
      }
    }
    if (payrolls.some((v) => v < 0)) failures.push(`seed${seed} Y${season}: 総年俸がマイナス`);
    if (salaries.some((v) => v <= 0)) failures.push(`seed${seed} Y${season}: 年俸が0以下の選手がいます`);
    if (row.maxSalary > 1500) failures.push(`seed${seed} Y${season}: 年俸が上限を超えた`);
    if (row.minRoster < MINIMUM_ROSTER) {
      failures.push(`seed${seed} Y${season}: ロスターが${row.minRoster}人（24人未満）`);
    }
    for (const t of state.teams) {
      const first = state.players.filter((p) => p.teamId === t.id && p.roster === 'first');
      if (first.filter((p) => !p.isPitcher).length < 9) {
        failures.push(`seed${seed} Y${season}: ${t.name}の1軍野手が9人未満`);
      }
      if (first.filter((p) => p.isPitcher).length < 5) {
        failures.push(`seed${seed} Y${season}: ${t.name}の1軍投手が5人未満`);
      }
    }
  }
}

function summarize(season: number): YearRow | null {
  const rows = rowsBySeason.get(season);
  if (!rows || rows.length === 0) return null;
  const pick = (fn: (r: YearRow) => number) => round1(avg(rows.map(fn)));
  return {
    avgPayroll: pick((r) => r.avgPayroll),
    avgSalary: pick((r) => r.avgSalary),
    medianSalary: pick((r) => r.medianSalary),
    maxSalary: pick((r) => r.maxSalary),
    avgCash: pick((r) => r.avgCash),
    faPlayers: pick((r) => r.faPlayers),
    faSignings: pick((r) => r.faSignings),
    faUnsigned: pick((r) => r.faUnsigned),
    userSignings: pick((r) => r.userSignings),
    cpuSignings: pick((r) => r.cpuSignings),
    avgContractYears: pick((r) => r.avgContractYears),
    avgFaSalary: pick((r) => r.avgFaSalary),
    topTeamFaSpend: pick((r) => r.topTeamFaSpend),
    bottomTeamFaSpend: pick((r) => r.bottomTeamFaSpend),
    avgOverall: pick((r) => r.avgOverall),
    avgAge: pick((r) => r.avgAge),
    minRoster: Math.min(...rows.map((r) => r.minRoster)),
    bankrupt: pick((r) => r.bankrupt),
  };
}

console.log(`=== PHASE 3.4 FAバランス（${SEASONS}シーズン × ${SEEDS}シード）===\n`);
console.log(
  [
    'Year',
    'Payroll',
    'AvgSal',
    'MedSal',
    'MaxSal',
    'Cash',
    'FA',
    'Sign',
    'Unsig',
    'User',
    'CPU',
    'FaSal',
    'FaYrs',
    'TopSpd',
    'BtmSpd',
    'Ovr',
    'Age',
    'MinR',
    'Debt',
  ].join('\t'),
);
const milestones = [1, 5, 10, 15, 20, 25, 30].filter((y) => y <= SEASONS);
for (const season of milestones) {
  const r = summarize(season);
  if (!r) continue;
  console.log(
    [
      season,
      r.avgPayroll,
      r.avgSalary,
      r.medianSalary,
      r.maxSalary,
      r.avgCash,
      r.faPlayers,
      r.faSignings,
      r.faUnsigned,
      r.userSignings,
      r.cpuSignings,
      r.avgFaSalary,
      r.avgContractYears,
      r.topTeamFaSpend,
      r.bottomTeamFaSpend,
      r.avgOverall,
      r.avgAge,
      r.minRoster,
      r.bankrupt,
    ].join('\t'),
  );
}

const rate = totalListed > 0 ? (totalSigned / totalListed) * 100 : 0;
console.log(`\nFA市場に出た延べ人数: ${totalListed} / オファー総数: ${totalOffers}`);
console.log(`FA契約成立: ${totalSigned}（成立率 ${rate.toFixed(1)}%）`);
console.log(`うちプレイヤー球団: ${totalUserSigned}`);

const perTeam = [...signingsByTeam.entries()].sort((a, b) => b[1] - a[1]);
if (perTeam.length > 0) {
  const share = perTeam[0][1] / Math.max(1, totalSigned);
  console.log(
    `球団別のFA獲得数 最多 ${perTeam[0][0]}=${perTeam[0][1]} / 最少 ${perTeam[perTeam.length - 1][0]}=${
      perTeam[perTeam.length - 1][1]
    }（最多球団のシェア ${(share * 100).toFixed(1)}%）`,
  );
  if (share > 0.3) failures.push(`1球団がFA市場を独占しています（シェア ${(share * 100).toFixed(1)}%）`);
}

const problems: string[] = [];
if (totalListed === 0) problems.push('FA市場に誰も出ていない');
if (totalListed > 0 && totalSigned === 0) problems.push('FA契約が1件も成立していない');
if (totalListed > 0 && (rate < 70 || rate > 98)) {
  problems.push(`FA成立率が目標(70〜95%)から外れている: ${rate.toFixed(1)}%`);
}
const last = summarize(SEASONS);
const first = summarize(1);
if (last && first) {
  if (last.avgSalary > first.avgSalary * 2) problems.push('年俸がインフレしている');
  if (last.avgOverall > 50 || last.avgOverall < 30) problems.push(`平均総合が異常: ${last.avgOverall}`);
  if (last.avgAge > 32 || last.avgAge < 23) problems.push(`平均年齢が異常: ${last.avgAge}`);
}
const unique = [...new Set(failures)];
problems.push(...unique.slice(0, 10));

if (problems.length > 0) {
  console.log(`\n=== FAIL（異常 ${unique.length} 種類）===`);
  for (const p of problems) console.log(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n=== PASS ===');
}
