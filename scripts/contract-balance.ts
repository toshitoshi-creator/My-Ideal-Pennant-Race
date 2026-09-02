/**
 * PHASE 3.3 の契約・年俸・球団資金の長期バランス検証。
 *   npx vite-node scripts/contract-balance.ts [シーズン数] [シード]
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay } from '../src/domain/engine';
import { startOffseason, completeOffseason } from '../src/domain/season';
import { overallRating } from '../src/domain/rating';
import { formatMoney, formatSalary, teamPayroll, marketValue } from '../src/domain/contract';
import type { GameState, Player } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 30);
const SEED = Number(process.argv[3] ?? 20260901);

const avg = (v: number[]) => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);
const median = (v: number[]) => {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

let state: GameState = createNewGame('phoenix', 143, SEED);
const salaries = (players: Player[]) => players.map((p) => p.ext.contract?.salary ?? 0);

console.log(
  `開始: 平均年俸 ${avg(salaries(state.players)).toFixed(0)} 中央値 ${median(salaries(state.players))} ` +
    `最高 ${Math.max(...salaries(state.players))} / 総年俸 ${(avg(state.teams.map((t) => teamPayroll(state, t.id)))).toFixed(0)}`,
);

let totalRejected = 0;
let totalRenewalTargets = 0;

for (let season = 1; season <= SEASONS; season++) {
  while (!state.seasonFinished) state = advanceDay(state).state;

  startOffseason(state);
  // 契約更改の対象数と拒否数を測る
  completeOffseason(state);
  totalRejected += state.lastOffseason?.released ?? 0;
  totalRenewalTargets += state.lastOffseason?.renewalTargets ?? 0;

  if (season <= 2 || season % 5 === 0 || season === SEASONS) {
    const all = salaries(state.players);
    const payrolls = state.teams.map((t) => teamPayroll(state, t.id));
    const cash = state.teams.map((t) => state.finances[t.id].cash);
    const deficit = state.teams.filter((t) => state.finances[t.id].cash < 0).length;
    const rookies = state.players.filter((p) => p.ext.debutYear === state.year);
    const veterans = state.players.filter((p) => p.age >= 33);
    const young = state.players.filter(
      (p) => p.age >= 23 && p.age <= 26 && p.ext.debutYear !== state.year,
    );
    const stars = [...state.players].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 12);

    console.log(
      `\n--- ${season}年目 (${state.year}年) ---\n` +
        `年俸: 平均 ${avg(all).toFixed(0)} / 中央値 ${median(all)} / 最高 ${Math.max(...all)} (${formatSalary(Math.max(...all))})\n` +
        `総年俸: 平均 ${avg(payrolls).toFixed(0)} (${formatMoney(avg(payrolls))}) / 最大 ${Math.max(...payrolls).toFixed(0)}\n` +
        `球団資金: 平均 ${avg(cash).toFixed(0)} (${formatMoney(avg(cash))}) / 最小 ${Math.min(...cash).toFixed(0)} / 赤字球団 ${deficit}球団\n` +
        `新人 ${avg(rookies.map((p) => p.ext.contract?.salary ?? 0)).toFixed(0)} / 若手(23-26) ${avg(young.map((p) => p.ext.contract?.salary ?? 0)).toFixed(0)} / ` +
        `33歳以上 ${avg(veterans.map((p) => p.ext.contract?.salary ?? 0)).toFixed(0)} / 主力12人 ${avg(stars.map((p) => p.ext.contract?.salary ?? 0)).toFixed(0)}\n` +
        `平均総合 ${avg(state.players.map((p) => overallRating(p))).toFixed(1)} / 平均年齢 ${avg(state.players.map((p) => p.age)).toFixed(1)} / 選手数 ${state.players.length}`,
    );
  }
}

console.log('\n=== 通算 ===');
console.log(
  `契約更改の対象 ${totalRenewalTargets}人 / 契約に至らなかった選手 ${totalRejected}人 ` +
    `(${((totalRejected / Math.max(1, totalRenewalTargets)) * 100).toFixed(1)}%)`,
);
const finalSalaries = salaries(state.players);
console.log(
  `最終: 平均年俸 ${avg(finalSalaries).toFixed(0)} / 中央値 ${median(finalSalaries)} / 最高 ${Math.max(...finalSalaries)}`,
);
console.log('能力と年俸の対応（サンプル）');
const sample = [...state.players].sort((a, b) => overallRating(b) - overallRating(a));
for (const p of [sample[0], sample[30], sample[100], sample[200], sample[sample.length - 1]]) {
  if (!p) continue;
  console.log(
    `  総合${String(overallRating(p)).padStart(3)} ${String(p.age).padStart(2)}歳 ` +
      `年俸 ${formatSalary(p.ext.contract?.salary ?? 0).padStart(9)} ` +
      `(市場価値 ${marketValue(p, state.stats[p.id], state.year)}) 残り${p.ext.contract?.yearsRemaining ?? 0}年`,
  );
}
