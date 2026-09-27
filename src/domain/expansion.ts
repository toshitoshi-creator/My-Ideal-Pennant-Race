/**
 * ゼロから始める球団づくり。
 *
 *   1. 球団を選び、球団名を決める
 *   2. 選手0人の状態から、契約できる選手（能力が低く、契約金も安い）を選んで契約する
 *      契約金は球団資金から払うので、資金が尽きるまでしか契約できない
 *      （野手15人・投手6人ほど契約できる額を用意する）
 *   3. 野手9人・投手5人以上そろえばシーズンを始められる
 *
 * 他の11球団は通常どおりの戦力で始まるので、1年目はほとんど最下位になる。
 * 若い選手の成長・ドラフト・FA で強くしていく。
 *
 * 候補は専用の乱数列で作る。ゲームの乱数（rngState）は進めない。
 */
import type { ExpansionCandidate, ExpansionState, GameState, Player, PositionId, SeasonLength } from './types';
import { Rng, seedFrom } from './rng';
import { createPlayer } from './playerGen';
import { createNewGame } from './newGame';
import { createContract, marketValue, refreshPayrolls } from './contract';
import { rebuildFirstTeam, MIN_FIRST_TEAM_FIELDERS, MIN_FIRST_TEAM_PITCHERS } from './roster';
import { buildAutoSetup } from './setup';
import { emptySeasonStats } from './stats';
import { refreshTeamPlans } from './teamAi';
import { EXPANSION_START_FANS, totalRevenue } from './fans';

/** 最初の球団資金（契約金に使う）。野手15人・投手6人ほどが目安 */
export const EXPANSION_START_CASH = 800;
export const TARGET_FIELDERS = 15;
export const TARGET_PITCHERS = 6;
/** 最初に契約できる上限（1軍の枠に収まる人数） */
export const EXPANSION_MAX_SIGNINGS = 28;

/** 候補の守備位置の内訳（野手） */
const FIELDER_POSITIONS: Array<[PositionId, number]> = [
  ['C', 6],
  ['1B', 4],
  ['2B', 4],
  ['3B', 4],
  ['SS', 4],
  ['LF', 4],
  ['CF', 5],
  ['RF', 4],
];
const STARTER_PITCHERS = 12;
const RELIEF_PITCHERS = 8;

export interface ExpansionOptions {
  teamName: string;
  shortName: string;
}

/** 名前の入力を整える（空なら元の名前、長すぎれば切る） */
export function cleanTeamName(value: string, fallback: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length === 0 ? fallback : trimmed.slice(0, max);
}

/** 球団名を付け替える（全球団の配列は共有の定数なので、複製してから書き換える） */
export function renameTeam(state: GameState, teamId: string, name: string, shortName: string): void {
  state.teams = state.teams.map((team) =>
    team.id === teamId
      ? {
          ...team,
          name: cleanTeamName(name, team.name, 16),
          shortName: cleanTeamName(shortName, team.shortName, 5),
        }
      : { ...team },
  );
}

function ageFor(rng: Rng): number {
  // 若手が多め。安い選手には「今は弱いが伸びる若手」と「峠を越えたベテラン」が混ざる
  const roll = rng.next();
  if (roll < 0.45) return rng.int(18, 22);
  if (roll < 0.75) return rng.int(23, 28);
  return rng.int(29, 36);
}

function makeCandidate(rng: Rng, index: number, mainPosition: PositionId, year: number, used: Set<number>, names: Set<string>, starter: boolean): ExpansionCandidate {
  const age = ageFor(rng);
  const mean = Math.max(20, rng.normal(age <= 22 ? 35 : 38, 5));
  const player = createPlayer(rng, {
    teamId: '',
    mainPosition,
    mean,
    age,
    startYear: year,
    usedNumbers: used,
    usedNames: names,
    starterStamina: starter,
    // 若い選手ほど伸びしろを持たせる（2年目以降に強くなる手がかり）
    potentialBonus: age <= 22 ? rng.int(4, 14) : 0,
  });
  player.ext.debutYear = year;
  player.ext.fatigue = 0;
  player.ext.injury = null;
  player.ext.slump = null;
  player.ext.contract = null;
  const salary = marketValue(player, undefined, year);
  return {
    id: `ex${year}-${index}`,
    player,
    // 契約金は年俸の1.4倍ほど。能力が高いほど高い
    bonus: Math.max(12, Math.round(salary * 1.4)),
    salary,
    years: age <= 24 ? 3 : age <= 30 ? 2 : 1,
  };
}

export function generateExpansionPool(seed: number, year: number): ExpansionCandidate[] {
  const rng = new Rng(seedFrom(`expansion-pool:${seed}`));
  const used = new Set<number>();
  const names = new Set<string>();
  const pool: ExpansionCandidate[] = [];
  let index = 0;
  for (const [pos, count] of FIELDER_POSITIONS) {
    for (let i = 0; i < count; i++) pool.push(makeCandidate(rng, index++, pos, year, used, names, false));
  }
  for (let i = 0; i < STARTER_PITCHERS; i++) pool.push(makeCandidate(rng, index++, 'P', year, used, names, true));
  for (let i = 0; i < RELIEF_PITCHERS; i++) pool.push(makeCandidate(rng, index++, 'P', year, used, names, false));
  return pool;
}

/**
 * ゼロから始めるゲームを作る。
 * 他球団は通常どおり。自球団だけ選手を外し、契約の候補と資金を用意する。
 */
export function createExpansionGame(
  playerTeamId: string,
  seasonLength: SeasonLength,
  options: ExpansionOptions,
  seed?: number,
): GameState {
  const state = createNewGame(playerTeamId, seasonLength, seed);
  renameTeam(state, playerTeamId, options.teamName, options.shortName);

  // 自球団の選手はいない状態から始める
  const removed = new Set(state.players.filter((p) => p.teamId === playerTeamId).map((p) => p.id));
  state.players = state.players.filter((p) => !removed.has(p.id));
  for (const id of removed) {
    delete state.stats[id];
    delete state.teamStats[id];
  }
  state.setups[playerTeamId] = { ...state.setups[playerTeamId], lineup: [], rotation: [], rotationIndex: 0 };

  const finance = state.finances[playerTeamId];
  finance.cash = EXPANSION_START_CASH;
  finance.annualRevenue = totalRevenue(EXPANSION_START_FANS);
  finance.budget = finance.annualRevenue;
  finance.payroll = 0;
  finance.lastResult = 0;

  state.fans = EXPANSION_START_FANS;
  state.fansBefore = EXPANSION_START_FANS;
  state.fanLog = [];
  state.lastSettlement = null;

  const expansion: ExpansionState = {
    pool: generateExpansionPool(state.seed, state.year),
    signed: [],
    startCash: EXPANSION_START_CASH,
  };
  state.expansion = expansion;
  return state;
}

export function signedPlayers(state: GameState): Player[] {
  const exp = state.expansion;
  if (!exp) return [];
  return exp.pool.filter((c) => exp.signed.includes(c.id)).map((c) => c.player);
}

export function signedCounts(state: GameState): { fielders: number; pitchers: number } {
  const players = signedPlayers(state);
  return {
    fielders: players.filter((p) => !p.isPitcher).length,
    pitchers: players.filter((p) => p.isPitcher).length,
  };
}

export interface ExpansionResult {
  ok: boolean;
  reason: string | null;
}

/** 候補と契約する（契約金を球団資金から払う） */
export function signExpansionPlayer(state: GameState, candidateId: string): ExpansionResult {
  const exp = state.expansion;
  if (!exp) return { ok: false, reason: '契約の期間ではありません' };
  const candidate = exp.pool.find((c) => c.id === candidateId);
  if (!candidate) return { ok: false, reason: '候補が見つかりません' };
  if (exp.signed.includes(candidateId)) return { ok: false, reason: 'すでに契約しています' };
  if (exp.signed.length >= EXPANSION_MAX_SIGNINGS) {
    return { ok: false, reason: `最初に契約できるのは${EXPANSION_MAX_SIGNINGS}人までです` };
  }
  const finance = state.finances[state.playerTeamId];
  if (finance.cash < candidate.bonus) return { ok: false, reason: '球団資金が足りません' };
  finance.cash -= candidate.bonus;
  exp.signed.push(candidateId);
  return { ok: true, reason: null };
}

/** 契約を取り消す（シーズンが始まる前なら契約金は全額戻る） */
export function releaseExpansionPlayer(state: GameState, candidateId: string): ExpansionResult {
  const exp = state.expansion;
  if (!exp) return { ok: false, reason: '契約の期間ではありません' };
  const index = exp.signed.indexOf(candidateId);
  if (index < 0) return { ok: false, reason: '契約していません' };
  const candidate = exp.pool.find((c) => c.id === candidateId)!;
  exp.signed.splice(index, 1);
  state.finances[state.playerTeamId].cash += candidate.bonus;
  return { ok: true, reason: null };
}

/** シーズンを始められるか（野手9人・投手5人以上） */
export function canFinishExpansion(state: GameState): ExpansionResult {
  const { fielders, pitchers } = signedCounts(state);
  if (fielders < MIN_FIRST_TEAM_FIELDERS) {
    return { ok: false, reason: `野手があと${MIN_FIRST_TEAM_FIELDERS - fielders}人必要です` };
  }
  if (pitchers < MIN_FIRST_TEAM_PITCHERS) {
    return { ok: false, reason: `投手があと${MIN_FIRST_TEAM_PITCHERS - pitchers}人必要です` };
  }
  return { ok: true, reason: null };
}

/**
 * おまかせで契約する（目安の人数まで、安い順に守備位置をそろえて）。
 * 資金が足りなくなったらそこで止める。
 */
export function autoSignExpansion(state: GameState): void {
  const exp = state.expansion;
  if (!exp) return;
  const finance = state.finances[state.playerTeamId];
  const unsigned = () => exp.pool.filter((c) => !exp.signed.includes(c.id));
  // 1. 各守備位置に1人ずつ（捕手・内野・外野）、先発投手5人
  for (const [pos] of FIELDER_POSITIONS) {
    if (signedPlayers(state).some((p) => p.mainPosition === pos)) continue;
    const pick = unsigned()
      .filter((c) => c.player.mainPosition === pos)
      .sort((a, b) => a.bonus - b.bonus)[0];
    if (pick && finance.cash >= pick.bonus) signExpansionPlayer(state, pick.id);
  }
  const fill = (isPitcher: boolean, target: number) => {
    const cheap = unsigned()
      .filter((c) => c.player.isPitcher === isPitcher)
      .sort((a, b) => a.bonus - b.bonus);
    for (const c of cheap) {
      const counts = signedCounts(state);
      const have = isPitcher ? counts.pitchers : counts.fielders;
      if (have >= target) break;
      // 残りの目安人数ぶんの資金を残しながら契約する
      if (finance.cash >= c.bonus) signExpansionPlayer(state, c.id);
    }
  };
  fill(true, MIN_FIRST_TEAM_PITCHERS);
  fill(false, TARGET_FIELDERS);
  fill(true, TARGET_PITCHERS);
}

/** 契約を締めてシーズンを始める */
export function finishExpansion(state: GameState): ExpansionResult {
  const check = canFinishExpansion(state);
  if (!check.ok) return check;
  const exp = state.expansion!;
  const teamId = state.playerTeamId;
  const year = state.year;
  for (const candidate of exp.pool) {
    if (!exp.signed.includes(candidate.id)) continue;
    const player = candidate.player;
    player.teamId = teamId;
    player.roster = 'first';
    player.lastRosterChangeDate = null;
    player.ext.contract = createContract(candidate.salary, candidate.years, year);
    player.ext.careerTeams = [{ year, teamId }];
    state.players.push(player);
    state.stats[player.id] = emptySeasonStats(player.id);
  }
  rebuildFirstTeam(state, teamId);
  const team = state.teams.find((t) => t.id === teamId)!;
  const league = state.leagues.find((l) => l.id === team.leagueId)!;
  state.setups[teamId] = buildAutoSetup(
    teamId,
    state.players.filter((p) => p.teamId === teamId && p.roster === 'first'),
    league.useDH,
  );
  refreshPayrolls(state);
  refreshTeamPlans(state);
  state.expansion = null;
  state.notices.push({
    date: state.date,
    kind: 'contract',
    message: `${team.name}が${exp.signed.length}人の選手と契約して始動しました`,
  });
  return { ok: true, reason: null };
}
