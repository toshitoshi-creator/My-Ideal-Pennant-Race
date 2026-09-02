import type { GameState, Player, SeasonLength, TeamRecord } from './types';
import { LEAGUES, TEAM_SEEDS, TEAMS, PLAYER_TEAM_STRENGTH } from './teams';
import { Rng } from './rng';
import { generateTeamPlayers } from './playerGen';
import { buildAutoSetup } from './setup';
import { generateSchedule, openingDate } from './schedule';
import { emptySeasonStats } from './stats';
import { overallRating } from './rating';
import { createScoutingState } from './scouting';
import { createContract, createTeamFinance, marketValue, refreshPayrolls } from './contract';

/**
 * 2: 弾道を 1〜4 から 1〜100 に変更
 * 3: PHASE 2（性格・潜在能力・成長・特殊能力・疲労・怪我）
 * 4: PHASE 2.5（調子のカテゴリ別補正・調子の履歴）
 * 5: PHASE 3.1（引退・ドラフト・新人加入）
 * 6: PHASE 3.2（スカウト・調査ポイント・ScoutReport）
 * 7: PHASE 3.3（契約・年俸・球団資金）
 * 8: PHASE 3.4（FA市場・オファー・未所属選手）
 */
export const SAVE_VERSION = 8;
export const START_YEAR = 2026;

/** 1軍スタート人数（残りは 2軍スタート） */
const INITIAL_FIRST_TEAM = 22;

function emptyRecord(teamId: string): TeamRecord {
  return {
    teamId,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    runsScored: 0,
    runsAllowed: 0,
  };
}

export function createNewGame(
  playerTeamId: string,
  seasonLength: SeasonLength,
  seed = Math.floor(Math.random() * 0xffffffff),
): GameState {
  const rng = new Rng(seed);
  const players: Player[] = [];

  for (const teamSeed of TEAM_SEEDS) {
    const isPlayerTeam = teamSeed.id === playerTeamId;
    const strength = isPlayerTeam ? PLAYER_TEAM_STRENGTH : teamSeed.strength;
    const teamPlayers = generateTeamPlayers(rng, {
      teamId: teamSeed.id,
      strength,
      startYear: START_YEAR,
      starCount: 2,
      starBonus: isPlayerTeam ? [7, 14] : [10, 19],
    });
    // 総合評価の低い選手から 2軍スタート
    const sorted = [...teamPlayers].sort((a, b) => overallRating(b) - overallRating(a));
    sorted.forEach((p, i) => {
      p.roster = i < INITIAL_FIRST_TEAM ? 'first' : 'second';
    });
    players.push(...teamPlayers);
  }

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rngState: rng.getState(),
    year: START_YEAR,
    date: openingDate(START_YEAR),
    seasonLength,
    playerTeamId,
    leagues: LEAGUES,
    teams: TEAMS,
    players,
    setups: {},
    schedule: generateSchedule(START_YEAR, seasonLength, LEAGUES, TEAMS),
    results: [],
    records: {},
    stats: {},
    seasonFinished: false,
    teamMorale: {},
    lastGrowthReport: null,
    notices: [],
    retiredPlayers: [],
    draft: null,
    lastDraftYear: null,
    scouting: createScoutingState(TEAMS, rng, START_YEAR),
    finances: {},
    contractPhase: null,
    lastPayrollYear: null,
    lastContractYear: null,
    lastOffseason: null,
    freeAgents: [],
    fa: null,
    lastFaYear: null,
  };

  for (const team of TEAMS) {
    const league = LEAGUES.find((l) => l.id === team.leagueId)!;
    const firstTeam = players.filter((p) => p.teamId === team.id && p.roster === 'first');
    state.setups[team.id] = buildAutoSetup(team.id, firstTeam, league.useDH);
    state.records[team.id] = emptyRecord(team.id);
    state.teamMorale[team.id] = 50;
    state.finances[team.id] = createTeamFinance(rng);
  }
  for (const player of players) {
    state.stats[player.id] = emptySeasonStats(player.id);
  }

  // ---- PHASE 3.3: 初期契約 ----
  // 開幕時点で全選手が契約済みの状態にする（残り年数はばらけさせる）
  for (const player of players) {
    const value = marketValue(player, undefined, START_YEAR);
    const years = rng.int(1, 4);
    player.ext.contract = createContract(value, years, START_YEAR - (4 - years));
  }
  refreshPayrolls(state);

  return state;
}
