/**
 * PHASE 3.1 の長期バランス検証：引退→ドラフト→新人加入の世代交代が回るかを見る。
 *   npx vite-node scripts/longterm.ts [シーズン数] [シード]
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay } from '../src/domain/engine';
import { startOffseason, completeOffseason } from '../src/domain/season';
import { overallRating } from '../src/domain/rating';
import { rankOf } from '../src/domain/rank';
import { rosterCount } from '../src/domain/draft';
import type { GameState, Player } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 20);
const SEED = Number(process.argv[3] ?? 20260901);

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function ageBuckets(players: Player[]): string {
  const buckets = [
    ['18-22', players.filter((p) => p.age <= 22).length],
    ['23-27', players.filter((p) => p.age >= 23 && p.age <= 27).length],
    ['28-32', players.filter((p) => p.age >= 28 && p.age <= 32).length],
    ['33-36', players.filter((p) => p.age >= 33 && p.age <= 36).length],
    ['37+', players.filter((p) => p.age >= 37).length],
  ] as const;
  const total = players.length || 1;
  return buckets.map(([label, n]) => `${label}:${((n / total) * 100).toFixed(0)}%`).join(' ');
}

let state: GameState = createNewGame('phoenix', 143, SEED);
console.log(
  `開始: 選手${state.players.length}人 平均年齢 ${avg(state.players.map((p) => p.age)).toFixed(1)} ` +
    `平均総合 ${avg(state.players.map((p) => overallRating(p))).toFixed(1)}  ${ageBuckets(state.players)}`,
);

let totalRetirements = 0;
let totalRookies = 0;
const retirementAges: number[] = [];

for (let season = 1; season <= SEASONS; season++) {
  while (!state.seasonFinished) {
    state = advanceDay(state).state;
  }
  const { retirements } = startOffseason(state);
  const draftCount = state.draft?.prospects.length ?? 0;
  const rookies = completeOffseason(state);

  totalRetirements += retirements.length;
  totalRookies += rookies.length;
  retirementAges.push(...retirements.map((r) => r.age));

  const overalls = state.players.map((p) => overallRating(p)).sort((a, b) => a - b);
  const rosterSizes = state.teams.map((t) => rosterCount(state, t.id));
  const young = state.players.filter((p) => p.age <= 22);

  if (season <= 3 || season % 5 === 0 || season === SEASONS) {
    console.log(
      `\n--- ${season}年目 (${state.year - 1}年オフ) ---\n` +
        `引退 ${retirements.length}人（平均${avg(retirements.map((r) => r.age)).toFixed(1)}歳） / ` +
        `候補 ${draftCount}人 → 新人 ${rookies.length}人（平均${avg(rookies.map((r) => r.age)).toFixed(1)}歳・` +
        `総合${avg(rookies.map((r) => overallRating(r))).toFixed(1)}・潜在${avg(rookies.map((r) => r.ext.potential)).toFixed(1)}）\n` +
        `選手 ${state.players.length}人  平均年齢 ${avg(state.players.map((p) => p.age)).toFixed(1)}  ${ageBuckets(state.players)}\n` +
        `平均総合 ${avg(overalls).toFixed(1)}  最小 ${overalls[0]}  最大 ${overalls[overalls.length - 1]}  ` +
        `22歳以下 ${young.length}人  ロスター ${Math.min(...rosterSizes)}〜${Math.max(...rosterSizes)}人`,
    );
  }
}

console.log('\n=== 通算 ===');
console.log(
  `引退 ${totalRetirements}人（1シーズン平均 ${(totalRetirements / SEASONS).toFixed(1)}人 / 平均引退年齢 ${avg(retirementAges).toFixed(1)}歳）`,
);
console.log(`新人 ${totalRookies}人（1シーズン平均 ${(totalRookies / SEASONS).toFixed(1)}人）`);
const ranks: Record<string, number> = {};
for (const p of state.players) {
  const r = rankOf(overallRating(p));
  ranks[r] = (ranks[r] ?? 0) + 1;
}
console.log('総合ランク分布', ranks);
const top = [...state.players].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 3);
for (const p of top) {
  console.log(`  ${p.name} ${p.age}歳 総合${overallRating(p)} 潜在${p.ext.potential} ${p.ext.growthType}`);
}
