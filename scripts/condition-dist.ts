/** 1シーズン回して調子の出現率を測る（PHASE 2.5 のチューニング用） */
import { createNewGame } from '../src/domain/newGame';
import { advanceDay } from '../src/domain/engine';
import { CONDITIONS, CONDITION_LABELS, ABILITY_CATEGORIES } from '../src/domain/condition';
import { effectiveBreakdown, EFFECTIVE_MIN, EFFECTIVE_MAX } from '../src/domain/effective';
import type { ConditionId } from '../src/domain/types';

const SEED = Number(process.argv[2] ?? 20260901);
let state = createNewGame('phoenix', 143, SEED);
const counts: Record<ConditionId, number> = { worst: 0, bad: 0, normal: 0, good: 0, best: 0 };
let fatigue = 0;
let motivation = 0;
let samples = 0;
let minMultiplier = Infinity;
let maxMultiplier = -Infinity;
let minCategory = Infinity;
let maxCategory = -Infinity;
let sumMultiplier = 0;

while (!state.seasonFinished) {
  state = advanceDay(state).state;
  for (const p of state.players) {
    counts[p.ext.condition] += 1;
    fatigue += p.ext.fatigue;
    motivation += p.ext.motivation;
    samples += 1;
    const breakdown = effectiveBreakdown(p, { teamMorale: state.teamMorale[p.teamId] });
    minMultiplier = Math.min(minMultiplier, breakdown.finalMultiplier);
    maxMultiplier = Math.max(maxMultiplier, breakdown.finalMultiplier);
    sumMultiplier += breakdown.finalMultiplier;
    for (const category of ABILITY_CATEGORIES) {
      minCategory = Math.min(minCategory, breakdown.byCategory[category]);
      maxCategory = Math.max(maxCategory, breakdown.byCategory[category]);
    }
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const target: Record<ConditionId, number> = { best: 8, good: 19, normal: 32, bad: 25, worst: 15 };
console.log('調子の出現率（目標との差）');
for (const c of [...CONDITIONS].reverse()) {
  const rate = (counts[c] / total) * 100;
  console.log(
    `  ${CONDITION_LABELS[c].padEnd(4)} ${rate.toFixed(1).padStart(5)}%  目標 ${String(target[c]).padStart(2)}%  差 ${(rate - target[c]).toFixed(1).padStart(5)}`,
  );
}
console.log(`平均疲労 ${(fatigue / samples).toFixed(1)} / 平均モチベーション ${(motivation / samples).toFixed(1)}`);
console.log(
  `実効能力倍率 最小 ${minMultiplier.toFixed(4)} / 平均 ${(sumMultiplier / samples).toFixed(4)} / 最大 ${maxMultiplier.toFixed(4)}` +
    `（カテゴリ別 最小 ${minCategory.toFixed(4)} / 最大 ${maxCategory.toFixed(4)}｜許容 ${EFFECTIVE_MIN}〜${EFFECTIVE_MAX}）`,
);
