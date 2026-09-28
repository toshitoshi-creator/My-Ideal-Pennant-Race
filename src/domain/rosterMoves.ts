/**
 * 自球団の選手の整理（自由契約・引退）と、自由契約の選手との直接契約。
 *
 *  - 自由契約：球団から外し、未所属の選手（FA）にする。他球団もプレイヤーも獲得できる
 *  - 引退：現役を退かせる。記録は歴史に残る
 *  - 自由契約の選手へのオファー：FA市場が開いていないとき（シーズン中・契約更改中）でも、
 *    未所属の選手に直接条件を提示して契約できる。FA市場が開いている間は市場で提示する
 *
 * どれも選手の能力・成長は書き換えない。乱数はゲーム内シードから作る（試合の乱数は進めない）。
 */
import type { GameState, Player, RetiredPlayerRecord } from './types';
import { ROSTER_LIMIT } from './types';
import { overallRating } from './rating';
import { canAddPlayer } from './roster';
import { createContract, maxContractYears, refreshPayrolls, rememberSalary } from './contract';
import { buildListing, freeAgentById, listingFor, withinBudget } from './freeAgency';
import { recordRetirements } from './history';
import { applyRetirementFans } from './fans';
import { emptySeasonStats } from './stats';

export interface MoveResult {
  ok: boolean;
  reason: string | null;
}

function myPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((p) => p.id === playerId && p.teamId === state.playerTeamId);
}

/** 契約更改の対象から外す（自由契約・引退した選手は交渉しない） */
function dropFromContractPhase(state: GameState, player: Player, label: string): void {
  const phase = state.contractPhase;
  if (!phase) return;
  if (phase.pending.includes(player.id)) {
    phase.pending = phase.pending.filter((id) => id !== player.id);
  }
  phase.resolved.push({ playerId: player.id, name: `${player.name}（${label}）`, accepted: false, salary: 0, years: 0 });
}

/** 自由契約にする。未所属の選手になり、FA市場が開いていればそこにも並ぶ */
export function releasePlayer(state: GameState, playerId: string): MoveResult {
  const player = myPlayer(state, playerId);
  if (!player) return { ok: false, reason: '自球団の選手ではありません' };
  dropFromContractPhase(state, player, '自由契約');
  rememberSalary(player);
  player.teamId = '';
  player.ext.contract = null;
  player.ext.releasedYear = state.year;
  player.roster = 'second';
  state.players = state.players.filter((p) => p.id !== player.id);
  if (state.protectList) state.protectList = state.protectList.filter((id) => id !== player.id);
  if (!Array.isArray(state.freeAgents)) state.freeAgents = [];
  if (!state.freeAgents.some((p) => p.id === player.id)) state.freeAgents.push(player);
  // FA市場が開いている間なら、市場にも並べる
  const fa = state.fa;
  if (fa && fa.phase === 'open' && fa.year === state.year && !listingFor(fa, player.id)) {
    fa.listings.push(buildListing(state, player));
  }
  refreshPayrolls(state);
  state.notices.push({ date: state.date, kind: 'contract', message: `${player.name}を自由契約にしました` });
  return { ok: true, reason: null };
}

/** 引退させる。記録は歴史に残る（殿堂入りの判定もする） */
export function retirePlayer(state: GameState, playerId: string): MoveResult {
  const player = myPlayer(state, playerId);
  if (!player) return { ok: false, reason: '自球団の選手ではありません' };
  dropFromContractPhase(state, player, '引退');
  const debutYear = player.ext.debutYear ?? state.year;
  const record: RetiredPlayerRecord = {
    playerId: player.id,
    name: player.name,
    teamId: player.teamId,
    age: player.age,
    years: Math.max(1, state.year - debutYear + 1),
    finalOverall: overallRating(player),
    mainPosition: player.mainPosition,
    retiredAt: state.year,
  };
  player.ext.contract = null;
  state.players = state.players.filter((p) => p.id !== player.id);
  if (state.protectList) state.protectList = state.protectList.filter((id) => id !== player.id);
  state.retiredPlayers.push(record);
  const inducted = recordRetirements(state, [{ playerId: player.id, finalOverall: record.finalOverall }]);
  applyRetirementFans(state, [record]);
  refreshPayrolls(state);
  state.notices.push({
    date: state.date,
    kind: 'retire',
    message: `${player.name}（${player.age}歳）が現役を引退しました`,
  });
  for (const entry of inducted) {
    state.notices.push({ date: state.date, kind: 'retire', message: `${entry.name}が殿堂入りしました` });
  }
  return { ok: true, reason: null };
}

/** FA市場の外で、未所属の選手と直接契約できるか（FA市場が開いている間は市場で提示する） */
export function canSignDirectly(state: GameState): boolean {
  return !(state.fa && state.fa.phase === 'open' && state.fa.year === state.year);
}

/** 直接契約で選手が求める年俸（FA市場と同じ基準） */
export function directAsking(state: GameState, player: Player): { asking: number; minimum: number; years: number } {
  const listing = buildListing(state, player);
  return { asking: listing.askingSalary, minimum: listing.minimumSalary, years: listing.preferredYears };
}

/** 直接契約で受け入れてもらえるか（希望年俸の9割以上なら受ける） */
export function directAcceptable(state: GameState, player: Player, salary: number): boolean {
  const { asking, minimum } = directAsking(state, player);
  return salary >= Math.max(minimum, Math.round(asking * 0.9));
}

/** 未所属の選手に条件を提示して、その場で契約する */
export function signFreeAgentDirect(
  state: GameState,
  playerId: string,
  salary: number,
  years: number,
): MoveResult {
  if (!canSignDirectly(state)) return { ok: false, reason: 'FA市場が開いている間は、FA市場で提示してください' };
  const player = freeAgentById(state, playerId);
  if (!player) return { ok: false, reason: 'その選手は未所属ではありません' };
  if (!canAddPlayer(state, state.playerTeamId)) return { ok: false, reason: `支配下は${ROSTER_LIMIT}人までです` };
  const safeYears = Math.round(years);
  if (safeYears < 1 || safeYears > maxContractYears(player.age)) {
    return { ok: false, reason: 'その選手の年齢では結べない契約年数です' };
  }
  if (!withinBudget(state, state.playerTeamId, salary)) return { ok: false, reason: '球団の予算では契約できません' };
  if (!directAcceptable(state, player, salary)) {
    return { ok: false, reason: `${player.name}は条件に納得しませんでした` };
  }
  state.freeAgents = state.freeAgents.filter((p) => p.id !== player.id);
  player.teamId = state.playerTeamId;
  player.roster = 'second';
  player.lastRosterChangeDate = null;
  player.ext.contract = createContract(salary, safeYears, state.year);
  if (!Array.isArray(player.ext.careerTeams)) player.ext.careerTeams = [];
  player.ext.careerTeams.push({ year: state.year, teamId: state.playerTeamId });
  state.players.push(player);
  if (!state.stats[player.id]) state.stats[player.id] = emptySeasonStats(player.id);
  refreshPayrolls(state);
  state.notices.push({ date: state.date, kind: 'contract', message: `自由契約の${player.name}と契約しました` });
  return { ok: true, reason: null };
}
