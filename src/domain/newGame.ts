import type { GameState, Player, SeasonLength, TeamRecord } from './types';
import { LEAGUES, TEAM_SEEDS, TEAMS, PLAYER_TEAM_STRENGTH } from './teams';
import { Rng } from './rng';
import { generateTeamPlayers } from './playerGen';
import { buildAutoSetup } from './setup';
import { generateSchedule, openingDate } from './schedule';
import { emptySeasonStats } from './stats';
import { overallRating } from './rating';

export const SAVE_VERSION = 1;
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
      starCount: isPlayerTeam ? 2 : strength >= 40 ? 3 : 2,
      starBonus: isPlayerTeam ? [7, 14] : [12, 22],
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
  };

  for (const team of TEAMS) {
    const league = LEAGUES.find((l) => l.id === team.leagueId)!;
    const firstTeam = players.filter((p) => p.teamId === team.id && p.roster === 'first');
    state.setups[team.id] = buildAutoSetup(team.id, firstTeam, league.useDH);
    state.records[team.id] = emptyRecord(team.id);
  }
  for (const player of players) {
    state.stats[player.id] = emptySeasonStats(player.id);
  }

  return state;
}
