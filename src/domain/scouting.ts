/**
 * スカウト（PHASE 3.2）。
 *
 * 「選手の真のデータ」と「プレイヤーが見える情報」を完全に分離する。
 *   Player       … 真の能力・潜在能力・性格・成長タイプ・特殊能力
 *   ScoutReport  … 球団が調査して得た推定情報（真のデータは書き換えない）
 *
 * 推定は「調査した時点で確定」して保存する。表示のたびに値が変わることはない。
 * 調査を進めると誤差が縮んで真値へ収束する（別の値へ飛ばない）。
 */
import type {
  DraftProspect,
  GameState,
  Player,
  ScoutCategory,
  ScoutReport,
  ScoutingState,
  TeamScoutAbility,
  DiscoveredAbility,
  Team,
} from './types';
import { Rng, seedFrom } from './rng';
import { overallRating } from './rating';
import {
  growthTypeDef,
  potentialLabel,
  scoutedPotentialLabel,
  GROWTH_TYPE_IDS,
  type GrowthTypeId,
  type PotentialLabel,
} from './growth';
import { PERSONALITIES, PERSONALITY_IDS, personalityDef } from './personality';
import { specialAbilityDef, type SpecialAbilityId } from './specialAbilities';
import { rankOf } from './rank';

/** 1シーズンに使えるスカウトポイント */
export const SCOUT_POINTS_PER_YEAR = 60;

/** 1回の調査で進む調査進行度 */
export const SCOUT_PROGRESS_STEP = 34;

/** 調査1回あたりの消費ポイント */
export const SCOUT_COST: Record<ScoutCategory, number> = {
  currentAbility: 2,
  potential: 4,
  personality: 3,
  skills: 4,
};

export const SCOUT_CATEGORIES: ScoutCategory[] = [
  'currentAbility',
  'potential',
  'personality',
  'skills',
];

export const SCOUT_CATEGORY_LABELS: Record<ScoutCategory, string> = {
  currentAbility: '現在能力',
  potential: '将来性',
  personality: '性格・成長タイプ',
  skills: '特殊能力',
};

/** ドラフト開始時点で公開されている現在能力の調査進行度 */
const INITIAL_ABILITY_PROGRESS = 20;

/**
 * 情報精度。球団のスカウト能力と、その選手の調査進行度の両方で決まる。
 * スカウト能力が高いほど、同じ調査量でも精度が高く、100%調査時の精度も高い。
 */
export function scoutAccuracy(scoutAbility: number, progress: number): number {
  const ability = Math.max(0, Math.min(100, scoutAbility));
  const done = Math.max(0, Math.min(100, progress)) / 100;
  const scoutFactor = 0.25 + (ability / 100) * 0.45; // 0.25〜0.70
  return Math.max(0.15, Math.min(0.97, 0.18 + scoutFactor * done * 1.18));
}

export type ConfidenceLabel = '低' | '普通' | '高' | '非常に高い';

export function confidenceLabel(accuracy: number): ConfidenceLabel {
  if (accuracy >= 0.85) return '非常に高い';
  if (accuracy >= 0.65) return '高';
  if (accuracy >= 0.42) return '普通';
  return '低';
}

/** 球団ごとのスカウト能力を作る（初期格差は大きくしすぎない） */
export function createScoutAbilities(teams: Team[], rng: Rng): Record<string, TeamScoutAbility> {
  const abilities: Record<string, TeamScoutAbility> = {};
  for (const team of teams) {
    // 球団ごとの「スカウト部門の総合力」を決めてから各項目にばらつきを付ける
    const base = Math.max(30, Math.min(82, rng.normal(56, 12)));
    const spread = () => Math.max(25, Math.min(88, Math.round(base + rng.normal(0, 7))));
    abilities[team.id] = {
      currentAbility: spread(),
      potential: spread(),
      personality: spread(),
      skills: spread(),
    };
  }
  return abilities;
}

export function createScoutingState(teams: Team[], rng: Rng, year: number): ScoutingState {
  const abilities = createScoutAbilities(teams, rng);
  const state: ScoutingState = { year, teams: {} };
  for (const team of teams) {
    state.teams[team.id] = {
      ability: abilities[team.id],
      points: SCOUT_POINTS_PER_YEAR,
      reports: {},
    };
  }
  return state;
}

/** ドラフトのたびにポイントを回復し、前年の調査結果を片付ける */
export function resetScoutingForDraft(scouting: ScoutingState, year: number): void {
  scouting.year = year;
  for (const team of Object.values(scouting.teams)) {
    team.points = SCOUT_POINTS_PER_YEAR;
    team.reports = {};
  }
}

/** 調査の種を作る（同じ球団・候補・項目なら常に同じ誤差になる） */
function categorySeed(teamId: string, prospectId: string, category: ScoutCategory): number {
  return seedFrom(`${teamId}|${prospectId}|${category}`);
}

function emptyReport(prospectId: string, year: number): ScoutReport {
  return {
    prospectId,
    progress: {
      currentAbility: INITIAL_ABILITY_PROGRESS,
      potential: 0,
      personality: 0,
      skills: 0,
    },
    estimate: {
      abilityLow: 0,
      abilityHigh: 0,
      potential: null,
      growthType: null,
      personality: null,
      skills: [],
    },
    accuracy: { currentAbility: 0, potential: 0, personality: 0, skills: 0 },
    updatedAt: year,
  };
}

/** 未調査の状態の推定情報を作る（保存はしない） */
export function buildInitialReport(
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
  year: number,
): ScoutReport {
  const report = emptyReport(prospect.id, year);
  for (const category of SCOUT_CATEGORIES) {
    refreshEstimate(report, prospect, ability, teamId, category);
  }
  return report;
}

/** 球団の調査記録を取り出す（なければ初期状態を作って保存する） */
export function reportFor(
  scouting: ScoutingState,
  teamId: string,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
): ScoutReport {
  const team = scouting.teams[teamId];
  let report = team.reports[prospect.id];
  if (!report) {
    report = buildInitialReport(prospect, ability, teamId, scouting.year);
    team.reports[prospect.id] = report;
  }
  return report;
}

/**
 * 表示用に調査結果を読み出す（state を書き換えない）。
 * 未調査の候補には、公開情報だけの初期レポートを返す。
 */
export function viewReport(
  scouting: ScoutingState,
  teamId: string,
  prospect: DraftProspect,
): ScoutReport {
  const team = scouting.teams[teamId];
  const stored = team?.reports[prospect.id];
  if (stored) return stored;
  const ability = team?.ability ?? {
    currentAbility: 50,
    potential: 50,
    personality: 50,
    skills: 50,
  };
  return buildInitialReport(prospect, ability, teamId, scouting.year);
}

/* ---------------- 推定の生成 ---------------- */

/** 現在能力の推定（幅のある評価にする。真の総合値そのものは出さない） */
function estimateCurrentAbility(
  report: ScoutReport,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
): void {
  const accuracy = scoutAccuracy(ability.currentAbility, report.progress.currentAbility);
  const truth = overallRating(prospect.player);
  const rng = new Rng(categorySeed(teamId, prospect.id, 'currentAbility'));
  // 誤差は固定の標準正規に (1 - 精度) を掛ける。調査が進むほど真値へ寄る
  const z = rng.normal(0, 1);
  const center = truth + z * (1 - accuracy) * 16;
  const half = (1 - accuracy) * 20 + 2;
  report.estimate.abilityLow = Math.max(1, Math.round(center - half));
  report.estimate.abilityHigh = Math.min(100, Math.round(center + half));
  report.accuracy.currentAbility = accuracy;
}

/** 将来性の推定（既存の scoutedPotentialLabel をそのまま使う） */
function estimatePotential(
  report: ScoutReport,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
): void {
  const accuracy = scoutAccuracy(ability.potential, report.progress.potential);
  report.accuracy.potential = accuracy;
  if (report.progress.potential <= 0) {
    report.estimate.potential = null;
    return;
  }
  report.estimate.potential = scoutedPotentialLabel(
    prospect.player.ext.potential,
    accuracy,
    categorySeed(teamId, prospect.id, 'potential'),
  );
}

/** 成長タイプの傾向 */
const GROWTH_TENDENCY_TEXT: Record<GrowthTypeId, string> = {
  early: '早熟傾向',
  genius: '早熟傾向',
  normal: '標準的',
  stable: '標準的',
  late: '晩成傾向',
  superLate: '晩成傾向',
  volatile: '波の大きいタイプ',
};

/** 性格・成長タイプの推定 */
function estimatePersonality(
  report: ScoutReport,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
): void {
  const accuracy = scoutAccuracy(ability.personality, report.progress.personality);
  report.accuracy.personality = accuracy;
  const progress = report.progress.personality;
  if (progress <= 0) {
    report.estimate.personality = null;
    report.estimate.growthType = null;
    return;
  }

  const rng = new Rng(categorySeed(teamId, prospect.id, 'personality'));
  const personalityRoll = rng.next();
  const growthRoll = rng.next();
  const truePersonality = prospect.player.ext.personality;
  const trueGrowth = prospect.player.ext.growthType;

  // 精度が上がるほど当たる。同じ種を使うので、当たった評価が外れに戻ることはない
  const personalityCorrect = personalityRoll < accuracy;
  const guessedPersonality = personalityCorrect
    ? truePersonality
    : PERSONALITY_IDS[Math.floor(rng.next() * PERSONALITY_IDS.length)];
  const personalityName = personalityDef(guessedPersonality).name;

  if (progress < 60) {
    report.estimate.personality = `${personalityName}タイプの傾向`;
  } else if (accuracy < 0.8) {
    report.estimate.personality = `${personalityName}？`;
  } else {
    report.estimate.personality = personalityName;
  }

  const growthCorrect = growthRoll < accuracy;
  const guessedGrowth: GrowthTypeId = growthCorrect
    ? trueGrowth
    : GROWTH_TYPE_IDS[Math.floor(rng.next() * GROWTH_TYPE_IDS.length)];
  if (progress < 45) {
    report.estimate.growthType = GROWTH_TENDENCY_TEXT[guessedGrowth];
  } else if (accuracy < 0.8) {
    report.estimate.growthType = `${growthTypeDef(guessedGrowth).name}？`;
  } else {
    report.estimate.growthType = growthTypeDef(guessedGrowth).name;
  }
}

/** 特殊能力の「ぼんやりした兆候」 */
const ABILITY_HINTS: Partial<Record<SpecialAbilityId, string>> = {
  powerHitter: '長打力に関する才能あり',
  contactHitter: '打撃の確実性に光るものがある',
  sprayHitter: '打球を広角に飛ばせそう',
  goodEye: '選球に関する素質あり',
  basestealer: '走塁センスが目を引く',
  baserunning: '走塁センスが目を引く',
  fieldingMaster: '守備に光るものがある',
  laserBeam: '強肩の噂がある',
  clutch: '勝負強さがありそう',
  vsLeftBatter: '左投手を苦にしない様子',
  adversity: '苦しい展開でも粘れそう',
  grandSlam: '大舞台に強いという評判',
  walkOff: '終盤に強いという評判',
  foulOff: '打席での粘り強さがある',
  intimidation: '打席での存在感がある',
  strikeoutPitcher: '三振を奪う球威がありそう',
  risingBall: '直球に伸びがある様子',
  sharpBreak: '変化球のキレに定評あり',
  pinchStrong: '土壇場に強いという評判',
  vsLeftPitcher: '左打者を得意にしている様子',
  quickDelivery: '投球動作に工夫が見られる',
  toughPitcher: 'タフさに定評あり',
  pitcherIntimidation: 'マウンドでの存在感がある',
  lowBall: '低めに集められる制球',
  heavyBall: '球が重いという評判',
  clutchWeak: '勝負どころに不安がありそう',
  vsLeftWeak: '左投手に苦戦している様子',
  strikeoutProne: '空振りの多さが気になる',
  doublePlayProne: '走力面に不安がある',
  errorProne: '守備に不安がありそう',
  throwingTrouble: '送球に不安がありそう',
  wildWalk: '制球に不安がありそう',
  gopherBall: '長打を浴びる場面が目立つ',
  blowup: '崩れやすい面があるかもしれない',
  unlucky: '勝ち運に恵まれていない様子',
  pinchWeak: 'ピンチでの脆さが気になる',
};

/**
 * 特殊能力の発見。
 * 能力ごとに「見つかるのに必要な精度」を種から決め、精度が上がるほど
 * 見つかる → 名前が分かる → Lv まで分かる、と段階的に開示される。
 * マイナス特殊能力は見つけにくくしてあり、見抜けること自体に価値がある。
 */
function estimateSkills(
  report: ScoutReport,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
): void {
  const accuracy = scoutAccuracy(ability.skills, report.progress.skills);
  report.accuracy.skills = accuracy;
  const discovered: DiscoveredAbility[] = [];

  prospect.player.ext.specialAbilities.forEach((entry, index) => {
    const def = specialAbilityDef(entry.id);
    if (!def) return;
    const rng = new Rng(categorySeed(teamId, `${prospect.id}#${index}`, 'skills'));
    // 発見に必要な精度（マイナス能力は隠れやすい）
    const base = def.polarity === 'positive' ? 0.2 : 0.34;
    const threshold = base + rng.next() * 0.34;
    if (accuracy < threshold) return;

    let detail: DiscoveredAbility['detail'] = 'hint';
    if (accuracy >= threshold + 0.28) detail = 'full';
    else if (accuracy >= threshold + 0.14) detail = 'name';

    discovered.push({
      id: entry.id,
      polarity: def.polarity,
      detail,
      text:
        detail === 'hint'
          ? (ABILITY_HINTS[entry.id] ?? (def.polarity === 'positive' ? '光るものがある' : '弱点があるかもしれない'))
          : detail === 'name'
            ? def.name
            : `${def.name}${entry.level > 1 ? ` Lv${entry.level}` : ''}`,
      level: detail === 'full' ? entry.level : undefined,
    });
  });

  report.estimate.skills = discovered;
}

function refreshEstimate(
  report: ScoutReport,
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  teamId: string,
  category: ScoutCategory,
): void {
  switch (category) {
    case 'currentAbility':
      estimateCurrentAbility(report, prospect, ability, teamId);
      return;
    case 'potential':
      estimatePotential(report, prospect, ability, teamId);
      return;
    case 'personality':
      estimatePersonality(report, prospect, ability, teamId);
      return;
    case 'skills':
      estimateSkills(report, prospect, ability, teamId);
      return;
  }
}

/* ---------------- 調査アクション ---------------- */

export interface InvestigateResult {
  ok: boolean;
  reason?: string;
  report?: ScoutReport;
}

/**
 * 指定した候補の指定項目を調査する。
 * ポイントを消費して進行度を上げ、その項目の推定情報を作り直す。
 */
export function investigate(
  scouting: ScoutingState,
  teamId: string,
  prospect: DraftProspect,
  category: ScoutCategory,
): InvestigateResult {
  const team = scouting.teams[teamId];
  if (!team) return { ok: false, reason: 'スカウト情報がありません' };
  const cost = SCOUT_COST[category];
  if (team.points < cost) {
    return { ok: false, reason: '今季の調査ポイントを使い切りました' };
  }
  const report = reportFor(scouting, teamId, prospect, team.ability);
  if (report.progress[category] >= 100) {
    return { ok: false, reason: 'すでに調査を終えています' };
  }

  team.points -= cost;
  report.progress[category] = Math.min(100, report.progress[category] + SCOUT_PROGRESS_STEP);
  report.updatedAt = scouting.year;
  refreshEstimate(report, prospect, team.ability, teamId, category);
  return { ok: true, report };
}

/** 表示用：推定現在能力のテキスト */
export function abilityRangeText(report: ScoutReport): string {
  const { abilityLow, abilityHigh } = report.estimate;
  if (abilityLow === abilityHigh) return `${abilityLow}（${rankOf(abilityLow)}）`;
  const lowRank = rankOf(abilityLow);
  const highRank = rankOf(abilityHigh);
  const rankText = lowRank === highRank ? lowRank : `${lowRank}〜${highRank}`;
  return `${abilityLow}〜${abilityHigh}（${rankText}）`;
}

/** 調査状況の平均進行度 */
export function overallProgress(report: ScoutReport): number {
  const values = SCOUT_CATEGORIES.map((c) => report.progress[c]);
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* ---------------- CPU のスカウト ---------------- */

/**
 * CPU球団の調査。有望そうな候補から順に、限られたポイントを配分する。
 * CPU も自分のスカウト能力の範囲でしか候補を把握できない。
 */
export function runCpuScouting(state: GameState, rng: Rng): void {
  const scouting = state.scouting;
  const draft = state.draft;
  if (!scouting || !draft) return;

  for (const team of state.teams) {
    if (team.id === state.playerTeamId) continue;
    const entry = scouting.teams[team.id];
    if (!entry) continue;

    // 公開情報（事前評価順）を基準に、少し好みのばらつきを入れて調査対象を決める
    const candidates = [...draft.prospects]
      .map((prospect) => ({ prospect, key: prospect.draftRank + rng.normal(0, 6) }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.prospect);

    // 上位候補は深く、その次は浅く調べる
    const plan: Array<{ count: number; categories: ScoutCategory[] }> = [
      { count: 2, categories: ['potential', 'currentAbility', 'skills', 'potential'] },
      { count: 6, categories: ['potential', 'currentAbility'] },
      { count: 12, categories: ['currentAbility'] },
    ];

    let index = 0;
    for (const step of plan) {
      for (let i = 0; i < step.count && index < candidates.length; i++, index++) {
        const prospect = candidates[index];
        for (const category of step.categories) {
          if (entry.points < SCOUT_COST[category]) break;
          investigate(scouting, team.id, prospect, category);
        }
      }
    }
  }
}

/**
 * スカウト情報から見た候補の評価値。
 * 真の潜在能力ではなく、その球団が把握している推定値を使う。
 */
export function scoutedEvaluation(
  report: ScoutReport | undefined,
  prospect: DraftProspect,
): { ability: number; potential: number } {
  if (!report) {
    // 未調査なら公開情報のみ（大まかな現在能力）で判断する
    return { ability: prospect.projectedAbility, potential: 45 };
  }
  const ability = (report.estimate.abilityLow + report.estimate.abilityHigh) / 2;
  const potential = report.estimate.potential
    ? (POTENTIAL_LABEL_VALUE[report.estimate.potential as PotentialLabel] ?? 45)
    : 45;
  // 見つけたマイナス特殊能力は評価を下げ、プラスは少し上げる
  let adjust = 0;
  for (const skill of report.estimate.skills) {
    adjust += skill.polarity === 'positive' ? 1.5 : -3;
  }
  return { ability, potential: Math.max(1, Math.min(100, potential + adjust)) };
}

const POTENTIAL_LABEL_VALUE: Record<PotentialLabel, number> = {
  非常に高い: 86,
  高い: 70,
  普通: 55,
  低い: 40,
  非常に低い: 25,
};

/** 表示用：本当の潜在能力ラベル（デバッグ・検証専用。UIでは使わない） */
export function truePotentialLabel(player: Player): PotentialLabel {
  return potentialLabel(player.ext.potential);
}

export const SCOUT_ABILITY_LABELS: Record<keyof TeamScoutAbility, string> = {
  currentAbility: '能力の見極め',
  potential: '将来性の見極め',
  personality: '人物調査',
  skills: '素質の発見',
};

export function scoutAbilitySummary(ability: TeamScoutAbility): number {
  return Math.round(
    (ability.currentAbility + ability.potential + ability.personality + ability.skills) / 4,
  );
}

export { PERSONALITIES };
