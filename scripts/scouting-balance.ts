/**
 * PHASE 3.2 のスカウト精度検証。
 *   npx vite-node scripts/scouting-balance.ts [シード]
 */
import { Rng } from '../src/domain/rng';
import { generateProspects } from '../src/domain/draft';
import {
  SCOUT_CATEGORIES,
  SCOUT_COST,
  SCOUT_POINTS_PER_YEAR,
  SCOUT_PROGRESS_STEP,
  buildInitialReport,
  investigate,
  scoutAccuracy,
  confidenceLabel,
} from '../src/domain/scouting';
import { overallRating } from '../src/domain/rating';
import { potentialLabel } from '../src/domain/growth';
import { specialAbilityDef } from '../src/domain/specialAbilities';
import type { ScoutingState, TeamScoutAbility, ScoutCategory } from '../src/domain/types';

const SEED = Number(process.argv[2] ?? 20260901);
const rng = new Rng(SEED);
const prospects = generateProspects(rng, 2026, 12);

const LEVELS: Array<[string, TeamScoutAbility]> = [
  ['低', { currentAbility: 35, potential: 35, personality: 35, skills: 35 }],
  ['平均', { currentAbility: 55, potential: 55, personality: 55, skills: 55 }],
  ['高', { currentAbility: 80, potential: 80, personality: 80, skills: 80 }],
];

const POTENTIAL_ORDER = ['非常に低い', '低い', '普通', '高い', '非常に高い'];

function makeScouting(ability: TeamScoutAbility): ScoutingState {
  return { year: 2026, teams: { t: { ability, points: 99999, reports: {} } } };
}

/** 指定の進行度まで調査したレポートを作る */
function reportAt(ability: TeamScoutAbility, prospectIndex: number, progress: number) {
  const scouting = makeScouting(ability);
  const prospect = prospects[prospectIndex];
  for (const category of SCOUT_CATEGORIES) {
    let current = category === 'currentAbility' ? 20 : 0;
    while (current < progress) {
      investigate(scouting, 't', prospect, category);
      current += SCOUT_PROGRESS_STEP;
    }
  }
  return scouting.teams.t.reports[prospect.id] ?? buildInitialReport(prospect, ability, 't', 2026);
}

console.log('=== 情報精度（スカウト能力 × 調査進行度） ===');
console.log('能力  進行度  現在能力の平均誤差  評価幅  将来性ラベル誤差  正解率  信頼度');
for (const [label, ability] of LEVELS) {
  for (const progress of [0, 34, 68, 100]) {
    let abilityError = 0;
    let width = 0;
    let potentialError = 0;
    let potentialExact = 0;
    let accuracySum = 0;
    const n = Math.min(120, prospects.length);
    for (let i = 0; i < n; i++) {
      const report = reportAt(ability, i, progress);
      const truth = overallRating(prospects[i].player);
      const center = (report.estimate.abilityLow + report.estimate.abilityHigh) / 2;
      abilityError += Math.abs(center - truth);
      width += report.estimate.abilityHigh - report.estimate.abilityLow;
      const trueLabel = potentialLabel(prospects[i].player.ext.potential);
      if (report.estimate.potential) {
        const diff = Math.abs(
          POTENTIAL_ORDER.indexOf(report.estimate.potential) - POTENTIAL_ORDER.indexOf(trueLabel),
        );
        potentialError += diff;
        if (diff === 0) potentialExact += 1;
      } else {
        potentialError += 2; // 未調査は最大誤差として扱う
      }
      accuracySum += report.accuracy.potential;
    }
    console.log(
      `${label.padEnd(3)}  ${String(progress).padStart(4)}%  ` +
        `${(abilityError / n).toFixed(2).padStart(8)}  ` +
        `${(width / n).toFixed(1).padStart(6)}  ` +
        `${(potentialError / n).toFixed(2).padStart(10)}段階  ` +
        `${((potentialExact / n) * 100).toFixed(0).padStart(4)}%  ` +
        `${confidenceLabel(accuracySum / n)}`,
    );
  }
}

console.log('\n=== 特殊能力の発見率 ===');
console.log('能力  進行度  プラス  マイナス  Lvまで判明');
for (const [label, ability] of LEVELS) {
  for (const progress of [34, 68, 100]) {
    let pTotal = 0;
    let pFound = 0;
    let nTotal = 0;
    let nFound = 0;
    let full = 0;
    let foundTotal = 0;
    const n = Math.min(120, prospects.length);
    for (let i = 0; i < n; i++) {
      const report = reportAt(ability, i, progress);
      const found = new Set(report.estimate.skills.map((s) => s.id));
      full += report.estimate.skills.filter((s) => s.detail === 'full').length;
      foundTotal += report.estimate.skills.length;
      for (const entry of prospects[i].player.ext.specialAbilities) {
        const def = specialAbilityDef(entry.id);
        if (!def) continue;
        if (def.polarity === 'positive') {
          pTotal += 1;
          if (found.has(entry.id)) pFound += 1;
        } else {
          nTotal += 1;
          if (found.has(entry.id)) nFound += 1;
        }
      }
    }
    console.log(
      `${label.padEnd(3)}  ${String(progress).padStart(4)}%  ` +
        `${((pFound / Math.max(1, pTotal)) * 100).toFixed(0).padStart(5)}%  ` +
        `${((nFound / Math.max(1, nTotal)) * 100).toFixed(0).padStart(6)}%  ` +
        `${((full / Math.max(1, foundTotal)) * 100).toFixed(0).padStart(8)}%`,
    );
  }
}

console.log('\n=== 調査リソース ===');
console.log(`年間スカウトポイント: ${SCOUT_POINTS_PER_YEAR}`);
console.log(
  `1回の調査コスト: ` +
    SCOUT_CATEGORIES.map((c) => `${c} ${SCOUT_COST[c]}pt`).join(' / ') +
    `（1回で +${SCOUT_PROGRESS_STEP}%）`,
);
const fullOne =
  (SCOUT_COST.currentAbility * 3 +
    SCOUT_COST.potential * 3 +
    SCOUT_COST.personality * 3 +
    SCOUT_COST.skills * 3) as number;
console.log(`1人を全項目100%まで調べる: 約${fullOne}pt → ${(SCOUT_POINTS_PER_YEAR / fullOne).toFixed(1)}人`);
console.log(
  `将来性だけ100%: ${SCOUT_COST.potential * 3}pt → ${Math.floor(SCOUT_POINTS_PER_YEAR / (SCOUT_COST.potential * 3))}人`,
);
console.log(
  `現在能力を1段階だけ: ${SCOUT_COST.currentAbility}pt → ${Math.floor(SCOUT_POINTS_PER_YEAR / SCOUT_COST.currentAbility)}人`,
);
console.log(
  `現在能力+将来性を1段階ずつ: ${SCOUT_COST.currentAbility + SCOUT_COST.potential}pt → ${Math.floor(
    SCOUT_POINTS_PER_YEAR / (SCOUT_COST.currentAbility + SCOUT_COST.potential),
  )}人`,
);
console.log(`\n精度の目安: 低×100% = ${scoutAccuracy(35, 100).toFixed(2)} / 平均×100% = ${scoutAccuracy(55, 100).toFixed(2)} / 高×100% = ${scoutAccuracy(80, 100).toFixed(2)}`);
