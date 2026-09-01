/**
 * PHASE 2 のバランス確認：143試合シーズンを複数年まわして、
 * 能力インフレ・成長・衰退・怪我・疲労・特殊能力の偏りを点検する。
 *
 *   npx vite-node scripts/balance.ts [シーズン数] [シード]
 */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { standingsForLeague } from '../src/domain/standings';
import { overallRating } from '../src/domain/rating';
import { rankOf } from '../src/domain/rank';
import { CONDITION_LABELS } from '../src/domain/condition';
import { specialAbilityDef } from '../src/domain/specialAbilities';
import { GROWTH_TYPES } from '../src/domain/growth';
import type { GameState, Player } from '../src/domain/types';

const SEASONS = Number(process.argv[2] ?? 10);
const SEED = Number(process.argv[3] ?? 20260901);

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function abilityAverage(players: Player[]): number {
  return avg(players.map((p) => overallRating(p)));
}

let state: GameState = createNewGame('phoenix', 143, SEED);
let injuriesThisSeason = 0;
let injuryDaysLost = 0;
const injured = new Set<string>();

console.log('=== 初期状態 ===');
console.log(
  `全選手 平均総合 ${abilityAverage(state.players).toFixed(1)} / 平均年齢 ${avg(
    state.players.map((p) => p.age),
  ).toFixed(1)}`,
);
const growthTypeCount: Record<string, number> = {};
for (const p of state.players) {
  growthTypeCount[p.ext.growthType] = (growthTypeCount[p.ext.growthType] ?? 0) + 1;
}
console.log(
  '成長タイプ分布',
  GROWTH_TYPES.map((g) => `${g.name}:${growthTypeCount[g.id] ?? 0}`).join(' '),
);
const abilityCount0 = state.players.reduce((a, p) => a + p.ext.specialAbilities.length, 0);
console.log(`特殊能力 合計 ${abilityCount0} 個（1人あたり ${(abilityCount0 / state.players.length).toFixed(2)}）`);

for (let season = 1; season <= SEASONS; season++) {
  injuriesThisSeason = 0;
  injuryDaysLost = 0;
  injured.clear();
  const conditionCount: Record<string, number> = {};
  let fatigueSum = 0;
  let fatigueSamples = 0;

  while (!state.seasonFinished) {
    state = advanceDay(state).state;
    for (const p of state.players) {
      if (p.ext.injury) {
        injuryDaysLost += 1;
        if (!injured.has(p.id)) {
          injured.add(p.id);
          injuriesThisSeason += 1;
        }
      } else {
        injured.delete(p.id);
      }
      if (p.roster === 'first') {
        conditionCount[p.ext.condition] = (conditionCount[p.ext.condition] ?? 0) + 1;
        fatigueSum += p.ext.fatigue;
        fatigueSamples += 1;
      }
    }
  }

  const rows = state.leagues.flatMap((l) => standingsForLeague(state, l.id));
  const runs = Object.values(state.records).reduce((a, r) => a + r.runsScored, 0);
  const games = Object.values(state.records).reduce((a, r) => a + r.games, 0);
  const playerRow = rows.find((r) => r.teamId === 'phoenix')!;
  const best = Math.max(...rows.map((r) => r.winPct));
  const worst = Math.min(...rows.map((r) => r.winPct));

  const young = state.players.filter((p) => p.age <= 23);
  const prime = state.players.filter((p) => p.age >= 24 && p.age <= 29);
  const veteran = state.players.filter((p) => p.age >= 32);

  const before = new Map(state.players.map((p) => [p.id, overallRating(p)]));
  const rollover = startNextSeason(state);
  const grown = rollover.all.filter((r) => r.total > 0.5).length;
  const declined = rollover.all.filter((r) => r.total < -0.5).length;
  const awakened = rollover.all.filter((r) => r.awakened).length;
  const youngGrowth = avg(
    rollover.all.filter((r) => r.ageBefore <= 22).map((r) => overallRating(state.players.find((p) => p.id === r.playerId)!) - (before.get(r.playerId) ?? 0)),
  );
  const vetGrowth = avg(
    rollover.all.filter((r) => r.ageBefore >= 33).map((r) => overallRating(state.players.find((p) => p.id === r.playerId)!) - (before.get(r.playerId) ?? 0)),
  );

  const abilityCount = state.players.reduce((a, p) => a + p.ext.specialAbilities.length, 0);
  const conditionTotal = Object.values(conditionCount).reduce((a, b) => a + b, 0) || 1;
  const conditionText = (['best', 'good', 'normal', 'bad', 'worst'] as const)
    .map((c) => `${CONDITION_LABELS[c]}${((conditionCount[c] ?? 0) / conditionTotal * 100).toFixed(0)}%`)
    .join(' ');

  console.log(
    `\n--- ${season}年目 (${state.year - 1}年) ---\n` +
      `プレイヤー球団: ${playerRow.wins}勝${playerRow.losses}敗 (${playerRow.winPct.toFixed(3)}, ${playerRow.rank}位)  ` +
      `リーグ最高 ${best.toFixed(3)} / 最低 ${worst.toFixed(3)}\n` +
      `1試合平均得点 ${(runs / games).toFixed(2)}  ` +
      `平均疲労 ${(fatigueSum / Math.max(1, fatigueSamples)).toFixed(1)}  ${conditionText}\n` +
      `怪我 ${injuriesThisSeason}件 / 延べ離脱 ${injuryDaysLost}日（1球団あたり ${(injuriesThisSeason / 12).toFixed(1)}件）\n` +
      `成長 ${grown}人 / 衰退 ${declined}人 / 覚醒 ${awakened}人  ` +
      `22歳以下の平均成長 ${youngGrowth.toFixed(2)}  33歳以上 ${vetGrowth.toFixed(2)}\n` +
      `全選手 平均総合 ${abilityAverage(state.players).toFixed(1)}  平均年齢 ${avg(state.players.map((p) => p.age)).toFixed(1)}  ` +
      `特殊能力 ${(abilityCount / state.players.length).toFixed(2)}個/人`,
  );
}

console.log('\n=== 最終状態 ===');
const ranks: Record<string, number> = {};
for (const p of state.players) {
  const r = rankOf(overallRating(p));
  ranks[r] = (ranks[r] ?? 0) + 1;
}
console.log('総合ランク分布', ranks);
const overalls = state.players.map((p) => overallRating(p)).sort((a, b) => a - b);
console.log(
  `総合 最小 ${overalls[0]} / 中央 ${overalls[Math.floor(overalls.length / 2)]} / 最大 ${overalls[overalls.length - 1]}`,
);
const top = [...state.players].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 5);
for (const p of top) {
  const def = p.ext.specialAbilities.map((a) => specialAbilityDef(a.id)?.name).filter(Boolean);
  console.log(
    `  ${p.name} ${p.age}歳 総合${overallRating(p)} 潜在${p.ext.potential} ${p.ext.growthType} [${def.join(',')}]`,
  );
}
