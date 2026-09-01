import type { GameResult, GameState, Player, ScheduledGame } from './types';
import { Rng } from './rng';
import { addDays } from './dates';
import { simulateGame } from './simulation';
import { repairSetup } from './setup';
import { addBatting, addPitching, emptySeasonStats } from './stats';
import { applyDailyUpdates } from './daily';
import { isAvailable } from './injury';

/** 実況を保持しておくプレイヤー球団の試合数 */
const COMMENTARY_KEEP = 20;

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function playersOf(state: GameState, teamId: string): Player[] {
  return state.players.filter((p) => p.teamId === teamId);
}

export function firstTeamOf(state: GameState, teamId: string): Player[] {
  return state.players.filter((p) => p.teamId === teamId && p.roster === 'first');
}

/** 1軍かつ怪我をしていない、実際に試合に出られる選手（PHASE 2） */
export function availableFirstTeam(state: GameState, teamId: string): Player[] {
  return state.players.filter(
    (p) => p.teamId === teamId && p.roster === 'first' && isAvailable(p),
  );
}

/** 1軍から外れた選手がオーダーに残らないように全球団のオーダーを整える */
export function repairAllSetups(state: GameState): void {
  for (const team of state.teams) {
    const league = state.leagues.find((l) => l.id === team.leagueId)!;
    state.setups[team.id] = repairSetup(
      state.setups[team.id],
      team.id,
      // 怪我人はオーダー・ローテーションから自動的に外れる
      availableFirstTeam(state, team.id),
      league.useDH,
    );
  }
}

function ensureStats(state: GameState, playerId: string) {
  let s = state.stats[playerId];
  if (!s) {
    s = emptySeasonStats(playerId);
    state.stats[playerId] = s;
  }
  return s;
}

/** 試合結果を state に反映する（state は複製済みのものを渡すこと） */
export function applyGameResult(state: GameState, result: GameResult): void {
  const scheduled = state.schedule.find((g) => g.id === result.id);
  if (scheduled) scheduled.played = true;

  const homeRecord = state.records[result.homeTeamId];
  const awayRecord = state.records[result.awayTeamId];
  homeRecord.games += 1;
  awayRecord.games += 1;
  homeRecord.runsScored += result.home.runs;
  homeRecord.runsAllowed += result.away.runs;
  awayRecord.runsScored += result.away.runs;
  awayRecord.runsAllowed += result.home.runs;
  if (result.winnerTeamId === null) {
    homeRecord.draws += 1;
    awayRecord.draws += 1;
  } else if (result.winnerTeamId === result.homeTeamId) {
    homeRecord.wins += 1;
    awayRecord.losses += 1;
  } else {
    awayRecord.wins += 1;
    homeRecord.losses += 1;
  }

  for (const line of result.playerLines) {
    const stats = ensureStats(state, line.playerId);
    if (line.batting) addBatting(stats.batting, line.batting);
    if (line.pitching) addPitching(stats.pitching, line.pitching);
  }

  const involvesPlayerTeam =
    result.homeTeamId === state.playerTeamId || result.awayTeamId === state.playerTeamId;

  // 保存サイズを抑えるため、個人成績はシーズン成績に合算済みなので落とし、
  // 実況はプレイヤー球団の直近の試合だけ残す
  const stored: GameResult = {
    ...result,
    playerLines: [],
    commentary: involvesPlayerTeam ? result.commentary : [],
  };
  state.results.push(stored);

  if (involvesPlayerTeam) {
    let kept = 0;
    for (let i = state.results.length - 1; i >= 0; i--) {
      const r = state.results[i];
      if (r.commentary.length === 0) continue;
      kept += 1;
      if (kept > COMMENTARY_KEEP) r.commentary = [];
    }
  }
}

export function simulateScheduledGame(
  state: GameState,
  game: ScheduledGame,
  rng: Rng,
): GameResult {
  const homeTeam = state.teams.find((t) => t.id === game.homeTeamId)!;
  const awayTeam = state.teams.find((t) => t.id === game.awayTeamId)!;
  const league = state.leagues.find((l) => l.id === game.leagueId)!;
  const homeSetup = state.setups[homeTeam.id];
  const awaySetup = state.setups[awayTeam.id];

  const result = simulateGame({
    rng,
    gameId: game.id,
    date: game.date,
    leagueId: game.leagueId,
    useDH: league.useDH,
    homeTeam,
    awayTeam,
    homePlayers: availableFirstTeam(state, homeTeam.id),
    awayPlayers: availableFirstTeam(state, awayTeam.id),
    homeSetup,
    awaySetup,
    homeMorale: state.teamMorale[homeTeam.id] ?? 50,
    awayMorale: state.teamMorale[awayTeam.id] ?? 50,
  });

  // 先発ローテーションを 1 つ進める
  if (homeSetup.rotation.length > 0) {
    homeSetup.rotationIndex = (homeSetup.rotationIndex + 1) % homeSetup.rotation.length;
  }
  if (awaySetup.rotation.length > 0) {
    awaySetup.rotationIndex = (awaySetup.rotationIndex + 1) % awaySetup.rotation.length;
  }
  return result;
}

export interface AdvanceResult {
  state: GameState;
  /** その日に行われた全試合 */
  results: GameResult[];
  /** プレイヤー球団の試合（なければ null） */
  playerResult: GameResult | null;
}

/**
 * 1日進める。その日に予定されている 12 球団すべての試合を処理し、日付を翌日にする。
 * 日付が戻ることはない。
 */
export function advanceDay(state: GameState): AdvanceResult {
  const next = cloneState(state);
  repairAllSetups(next);
  const rng = new Rng(next.rngState);
  const today = next.date;
  const todaysGames = next.schedule.filter((g) => g.date === today && !g.played);
  const results: GameResult[] = [];

  for (const game of todaysGames) {
    const result = simulateScheduledGame(next, game, rng);
    applyGameResult(next, result);
    results.push(result);
  }

  // PHASE 2: 疲労・コンディション・モチベーション・怪我を1日分進める
  applyDailyUpdates(next, rng, results);
  repairAllSetups(next);

  next.rngState = rng.getState();
  next.date = addDays(next.date, 1);
  next.seasonFinished = next.schedule.every((g) => g.played);

  const playerResult =
    results.find(
      (r) => r.homeTeamId === next.playerTeamId || r.awayTeamId === next.playerTeamId,
    ) ?? null;

  return { state: next, results, playerResult };
}

/**
 * プレイヤー球団の次の試合まで日を進めて、その試合を消化する。
 * 試合のない日はまとめてスキップする。
 */
export function advanceToNextPlayerGame(state: GameState): AdvanceResult {
  let current = state;
  const allResults: GameResult[] = [];
  for (let guard = 0; guard < 400; guard++) {
    if (current.schedule.every((g) => g.played)) break;
    const step = advanceDay(current);
    current = step.state;
    allResults.push(...step.results);
    if (step.playerResult) {
      return { state: current, results: allResults, playerResult: step.playerResult };
    }
  }
  return { state: current, results: allResults, playerResult: null };
}

/** データ整合性チェック（テストと起動時の自己診断で使用） */
export function validateState(state: GameState): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const p of state.players) {
    if (ids.has(p.id)) errors.push(`選手 ID が重複しています: ${p.id}`);
    ids.add(p.id);
    if (!state.teams.some((t) => t.id === p.teamId)) {
      errors.push(`存在しない球団に所属しています: ${p.name}`);
    }
  }
  for (const team of state.teams) {
    const roster = state.players.filter((p) => p.teamId === team.id);
    if (roster.length > 70) errors.push(`${team.name}の保有選手が 70 人を超えています`);
    const first = roster.filter((p) => p.roster === 'first');
    if (first.length > 31) errors.push(`${team.name}の1軍が 31 人を超えています`);
    const setup = state.setups[team.id];
    if (!setup) {
      errors.push(`${team.name}のオーダーがありません`);
      continue;
    }
    const seen = new Set<string>();
    for (const slot of setup.lineup) {
      if (slot.position === 'P') continue;
      const player = state.players.find((p) => p.id === slot.playerId);
      if (!player) {
        errors.push(`${team.name}のオーダーに存在しない選手が入っています`);
      } else if (player.teamId !== team.id || player.roster !== 'first') {
        errors.push(`${team.name}のオーダーに1軍以外の選手が入っています`);
      } else if (player.ext.injury) {
        errors.push(`${team.name}のオーダーに怪我人が入っています`);
      }
      if (seen.has(slot.playerId)) {
        errors.push(`${team.name}のオーダーに同じ選手が重複しています`);
      }
      seen.add(slot.playerId);
    }
    for (const id of setup.rotation) {
      const player = state.players.find((p) => p.id === id);
      if (
        !player ||
        player.teamId !== team.id ||
        player.roster !== 'first' ||
        !player.isPitcher ||
        player.ext.injury
      ) {
        errors.push(`${team.name}の先発ローテーションが不正です`);
      }
    }
  }
  return errors;
}
