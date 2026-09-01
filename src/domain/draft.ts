/**
 * ドラフト（PHASE 3.1）。
 *
 * 責務を分けてある：
 *   generateProspects  … ドラフト候補の生成
 *   createDraft        … 指名順と巡数の決定
 *   evaluateProspect   … CPU球団の評価（PHASE 3.2 のスカウトはここに乗せる）
 *   makePick / autoPick … 指名
 *   finishDraft        … 指名選手を球団へ加入させる
 *
 * 「内部の真の潜在能力」と「プレイヤーに見せる情報」を分けており、
 * projectedPotential にはラベルだけを入れて実数値は渡さない。
 */
import type {
  DraftProspect,
  DraftState,
  GameState,
  Player,
  PositionId,
  Team,
} from './types';
import { ROSTER_LIMIT } from './types';
import { Rng } from './rng';
import { createPlayer } from './playerGen';
import { overallRating } from './rating';
import { potentialLabel } from './growth';
import { standingsForLeague } from './standings';

/** 1球団あたりの候補数（12球団なら 108人） */
export const PROSPECTS_PER_TEAM = 9;
/** 各球団が目標とする保有人数 */
export const TARGET_ROSTER_SIZE = 25;
/** ドラフトの最大巡数 */
export const MAX_DRAFT_ROUNDS = 6;

/** 候補のポジション分布（実際のチーム構成に近づける） */
const PROSPECT_POSITIONS: Array<[PositionId, number]> = [
  ['P', 0.4],
  ['C', 0.1],
  ['1B', 0.06],
  ['2B', 0.08],
  ['3B', 0.08],
  ['SS', 0.09],
  ['LF', 0.06],
  ['CF', 0.07],
  ['RF', 0.06],
];

/** 各ポジション群の標準的な保有人数（CPU の必要度判定に使う） */
const POSITION_QUOTA: Record<'P' | 'C' | 'IF' | 'OF', number> = {
  P: 10,
  C: 3,
  IF: 7,
  OF: 5,
};

function positionGroupOf(position: PositionId): 'P' | 'C' | 'IF' | 'OF' {
  if (position === 'P') return 'P';
  if (position === 'C') return 'C';
  return position === 'LF' || position === 'CF' || position === 'RF' ? 'OF' : 'IF';
}

function pickPosition(rng: Rng): PositionId {
  const roll = rng.next();
  let acc = 0;
  for (const [position, weight] of PROSPECT_POSITIONS) {
    acc += weight;
    if (roll < acc) return position;
  }
  return 'P';
}

/** 新人の年齢（高卒18歳中心、大学・社会人卒も混ぜる） */
function pickProspectAge(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.42) return 18;
  if (roll < 0.5) return 19;
  if (roll < 0.68) return 20;
  if (roll < 0.82) return 21;
  return 22;
}

/**
 * ドラフト候補を生成する。
 * 年ごとに「当たり年・不作年」の差を少しだけ付ける。
 */
export function generateProspects(
  rng: Rng,
  year: number,
  teamCount: number,
  countPerTeam = PROSPECTS_PER_TEAM,
): DraftProspect[] {
  const count = teamCount * countPerTeam;
  // -1（不作）〜 +1（当たり年）。極端にはしない
  const classQuality = Math.max(-1, Math.min(1, rng.normal(0, 0.5)));
  const baseMean = 24 + classQuality * 2.5;

  const prospects: DraftProspect[] = [];
  for (let i = 0; i < count; i++) {
    const mainPosition = pickPosition(rng);
    const age = pickProspectAge(rng);
    // ごく一部だけ「即戦力級・大器」の候補を混ぜる
    const isTop = rng.chance(0.06 + classQuality * 0.02);
    const bonus = isTop ? rng.int(6, 14) : 0;
    // 大学・社会人卒は現在能力がやや高い
    const maturity = (age - 18) * 1.4;
    const player = createPlayer(rng, {
      teamId: '',
      mainPosition,
      mean: Math.max(8, rng.normal(baseMean + bonus + maturity, 6)),
      age,
      startYear: year,
      starterStamina: mainPosition === 'P' && rng.chance(0.5),
    });
    // 潜在能力は候補用に決め直す。
    // 「若い＝伸びしろが大きい」だけで決めるとリーグ全体の能力が年々上がってしまうため、
    // 指名される上位候補の潜在能力がリーグ平均と釣り合う水準になるよう調整している。
    const potentialMean = baseMean + 8 + (isTop ? rng.int(10, 20) : 0);
    player.ext.potential = Math.max(
      overallRating(player) + 2,
      Math.max(1, Math.min(100, Math.round(rng.normal(potentialMean, 7)))),
    );
    player.ext.debutYear = year + 1;
    // 新人は疲労・怪我・スランプなしで、モチベーションは通常〜やや高め
    player.ext.fatigue = 0;
    player.ext.injury = null;
    player.ext.slump = null;
    player.ext.motivation = Math.max(50, Math.min(85, Math.round(rng.normal(64, 8))));

    prospects.push({
      id: `dp${year}-${i}`,
      player,
      draftRank: 0,
      projectedAbility: overallRating(player),
      projectedPotential: potentialLabel(player.ext.potential),
    });
  }

  // 事前評価順（表向きの現在能力＋将来性ラベルから決まる目安）
  prospects.sort((a, b) => scoutingScore(b) - scoutingScore(a));
  prospects.forEach((prospect, index) => {
    prospect.draftRank = index + 1;
  });
  return prospects;
}

/** 公開情報だけを使った並べ替え用スコア（PHASE 3.2 でスカウト精度を掛ける） */
function scoutingScore(prospect: DraftProspect): number {
  const labelScore =
    { 非常に高い: 100, 高い: 78, 普通: 55, 低い: 35, 非常に低い: 18 }[
      prospect.projectedPotential
    ] ?? 50;
  return prospect.projectedAbility * 0.55 + labelScore * 0.45;
}

/** 前年成績が悪い球団から順に指名する */
export function draftOrder(state: GameState, rng: Rng): string[] {
  const rows = state.leagues.flatMap((league) => standingsForLeague(state, league.id));
  return rows
    .map((row) => ({ teamId: row.teamId, winPct: row.winPct, tie: rng.next() }))
    .sort((a, b) => a.winPct - b.winPct || a.tie - b.tie)
    .map((row) => row.teamId);
}

export function rosterCount(state: GameState, teamId: string): number {
  return state.players.filter((p) => p.teamId === teamId).length;
}

/** 球団ごとの必要補充人数 */
export function rosterNeeds(state: GameState): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const team of state.teams) {
    const count = rosterCount(state, team.id);
    needs[team.id] = Math.max(0, Math.min(ROSTER_LIMIT - count, TARGET_ROSTER_SIZE - count));
  }
  return needs;
}

/**
 * ドラフトを準備する。すでにその年のドラフトを実施済みなら null を返す（二重実行の防止）。
 */
export function createDraft(state: GameState, rng: Rng): DraftState | null {
  if (state.lastDraftYear === state.year) return null;
  if (state.draft && state.draft.year === state.year) return state.draft;

  const needs = rosterNeeds(state);
  const maxNeed = Math.max(0, ...Object.values(needs));
  const rounds = Math.max(1, Math.min(MAX_DRAFT_ROUNDS, maxNeed));
  const prospects = generateProspects(rng, state.year, state.teams.length);

  return {
    year: state.year,
    prospects,
    order: draftOrder(state, rng),
    rounds,
    cursor: 0,
    picks: [],
    needs,
    completed: false,
  };
}

/** 次に指名する球団（ドラフトが終わっていれば null） */
export function currentPick(
  draft: DraftState,
): { round: number; pick: number; teamId: string } | null {
  if (draft.completed) return null;
  const teamCount = draft.order.length;
  const total = draft.rounds * teamCount;
  for (let index = draft.cursor; index < total; index++) {
    const round = Math.floor(index / teamCount) + 1;
    const pickInRound = (index % teamCount) + 1;
    const teamId = draft.order[index % teamCount];
    // 必要人数を満たした球団は指名しない
    if ((draft.needs[teamId] ?? 0) <= 0) continue;
    return { round, pick: pickInRound, teamId };
  }
  return null;
}

/** まだ指名されていない候補 */
export function availableProspects(draft: DraftState): DraftProspect[] {
  return draft.prospects.filter((p) => !p.selectedBy);
}

/**
 * CPU球団の評価。
 * 現在能力・将来性・ロスター不足・ポジション適性から決める。
 * 内部の潜在能力を参照してよい（画面には出さない）。
 */
export function evaluateProspect(
  prospect: DraftProspect,
  teamRoster: Player[],
  rng?: Rng,
): number {
  const player = prospect.player;
  const currentAbility = overallRating(player);
  const potential = player.ext.potential;

  const group = positionGroupOf(player.mainPosition);
  const have = teamRoster.filter((p) => positionGroupOf(p.mainPosition) === group).length;
  const quota = POSITION_QUOTA[group];
  const shortage = Math.max(0, Math.min(1, (quota - have) / quota));
  // そのポジションが全く足りていなければ適性ボーナス
  const positionFit = have < quota ? 1 : 0;

  const jitter = rng ? rng.normal(0, 3) : 0;
  return (
    currentAbility * 0.5 +
    potential * 0.3 +
    shortage * 100 * 0.15 +
    positionFit * 100 * 0.05 +
    jitter
  );
}

function applyPick(
  draft: DraftState,
  prospect: DraftProspect,
  slot: { round: number; pick: number; teamId: string },
): void {
  prospect.selectedBy = slot.teamId;
  prospect.selectedRound = slot.round;
  prospect.selectedPick = slot.pick;
  draft.picks.push({
    round: slot.round,
    pick: slot.pick,
    teamId: slot.teamId,
    prospectId: prospect.id,
  });
  draft.needs[slot.teamId] = Math.max(0, (draft.needs[slot.teamId] ?? 0) - 1);
  draft.cursor += 1;
  if (!currentPick(draft)) draft.completed = true;
}

/** 指定した候補を、いま指名権のある球団が指名する */
export function makePick(draft: DraftState, prospectId: string): boolean {
  const slot = currentPick(draft);
  if (!slot) return false;
  const prospect = draft.prospects.find((p) => p.id === prospectId);
  // すでに指名された候補は選べない
  if (!prospect || prospect.selectedBy) return false;
  applyPick(draft, prospect, slot);
  return true;
}

/** いま指名権のある球団に自動で指名させる */
export function autoPick(state: GameState, draft: DraftState, rng: Rng): DraftProspect | null {
  const slot = currentPick(draft);
  if (!slot) return null;
  const roster = state.players.filter((p) => p.teamId === slot.teamId);
  const available = availableProspects(draft);
  if (available.length === 0) {
    draft.completed = true;
    return null;
  }
  let best = available[0];
  let bestScore = -Infinity;
  for (const prospect of available) {
    const score = evaluateProspect(prospect, roster, rng);
    if (score > bestScore) {
      bestScore = score;
      best = prospect;
    }
  }
  applyPick(draft, best, slot);
  return best;
}

/**
 * プレイヤー球団の番が来るまで CPU に指名させる。
 * 指名内容はイベントログに記録する。
 */
export function runCpuPicks(state: GameState, rng: Rng): void {
  const draft = state.draft;
  if (!draft) return;
  let guard = 0;
  while (guard++ < 500) {
    const slot = currentPick(draft);
    if (!slot) {
      draft.completed = true;
      return;
    }
    if (slot.teamId === state.playerTeamId) return;
    const prospect = autoPick(state, draft, rng);
    if (!prospect) return;
    const team = state.teams.find((t) => t.id === slot.teamId);
    pushDraftNotice(
      state,
      `${team?.name ?? slot.teamId}が${prospect.player.name}（${prospect.player.age}歳）を${slot.round}巡目で指名`,
    );
  }
}

function pushDraftNotice(state: GameState, message: string): void {
  state.notices.push({ date: state.date, kind: 'draft', message });
  if (state.notices.length > 60) state.notices.splice(0, state.notices.length - 60);
}

export function recordPlayerPick(state: GameState, prospect: DraftProspect, round: number): void {
  const team = state.teams.find((t) => t.id === state.playerTeamId);
  pushDraftNotice(
    state,
    `${team?.name ?? ''}が${prospect.player.name}（${prospect.player.age}歳）を${round}巡目で指名`,
  );
}

/**
 * ドラフトを締めて、指名された選手を各球団へ加入させる。
 * 新人は2軍スタートで、以降は通常の選手とまったく同じ扱いになる。
 */
export function finishDraft(state: GameState, teams: Team[]): Player[] {
  const draft = state.draft;
  if (!draft) return [];
  const rookies: Player[] = [];
  for (const pick of draft.picks) {
    if (!pick.prospectId) continue;
    const prospect = draft.prospects.find((p) => p.id === pick.prospectId);
    if (!prospect) continue;
    const player = prospect.player;
    player.teamId = pick.teamId;
    player.roster = 'second';
    player.lastRosterChangeDate = null;
    rookies.push(player);
  }
  void teams;
  state.lastDraftYear = draft.year;
  return rookies;
}
