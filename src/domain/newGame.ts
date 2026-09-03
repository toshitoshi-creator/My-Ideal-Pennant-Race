import type { GameState, Player, SeasonLength, TeamRecord } from './types';
import { LEAGUES, TEAM_SEEDS, TEAMS, PLAYER_TEAM_STRENGTH } from './teams';
import { Rng } from './rng';
import { generateTeamPlayers, resetPlayerIdCounter } from './playerGen';
import { buildAutoSetup } from './setup';
import { generateSchedule, openingDate } from './schedule';
import { emptySeasonStats } from './stats';
import { overallRating } from './rating';
import { createScoutingState } from './scouting';
import { createContract, createTeamFinance, marketValue, refreshPayrolls } from './contract';
import { tradeDeadline } from './trade';
import { refreshTeamPlans } from './teamAi';
import { createHistoryState } from './history';

/**
 * 2: 弾道を 1〜4 から 1〜100 に変更
 * 3: PHASE 2（性格・潜在能力・成長・特殊能力・疲労・怪我）
 * 4: PHASE 2.5（調子のカテゴリ別補正・調子の履歴）
 * 5: PHASE 3.1（引退・ドラフト・新人加入）
 * 6: PHASE 3.2（スカウト・調査ポイント・ScoutReport）
 * 7: PHASE 3.3（契約・年俸・球団資金）
 * 8: PHASE 3.4（FA市場・オファー・未所属選手）
 * 9: PHASE 3.5（トレード・提案・履歴・在籍履歴）
 * 10: PHASE 3.6（球団経営AIのプラン）
 * 11: PHASE 3.7（歴史・記録・殿堂）
 * 12: PHASE 3.8（ポストシーズン・日本シリーズ）
 */
export const SAVE_VERSION = 12;
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
  // 同じシードなら常に同じ選手ID になるよう、ゲームごとに採番をリセットする
  resetPlayerIdCounter();
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
    teamStats: {},
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
    trade: {
      year: START_YEAR,
      deadline: openingDate(START_YEAR),
      offers: [],
      history: [],
      tradedThisSeason: [],
      countByTeam: {},
    },
    history: createHistoryState(),
    postseason: null,
    teamPlans: {},
    teamPlansYear: null,
  };
  state.trade.deadline = tradeDeadline(state);

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

  // ---- PHASE 3.5: 在籍履歴の起点 ----
  for (const player of players) {
    player.ext.careerTeams = [{ year: START_YEAR, teamId: player.teamId }];
  }

  // ---- PHASE 3.3: 初期契約 ----
  // 開幕時点で全選手が契約済みの状態にする（残り年数はばらけさせる）
  for (const player of players) {
    const value = marketValue(player, undefined, START_YEAR);
    const years = rng.int(1, 4);
    player.ext.contract = createContract(value, years, START_YEAR - (4 - years));
  }
  refreshPayrolls(state);

  // 開幕時点で総年俸が予算を圧迫している球団には、そのぶん大きな予算を与える。
  // （戦力が厚い球団＝規模の大きい球団、という扱い）
  // ここで揃えておかないと、抱えている契約だけで予算超過が続いてしまう。
  for (const team of TEAMS) {
    const finance = state.finances[team.id];
    finance.budget = Math.max(finance.budget, Math.round(finance.payroll * 1.15));
    finance.annualRevenue = finance.budget;
  }

  // ---- PHASE 3.6: 開幕時点の経営プラン（戦略・補強ポイント・FA予算） ----
  refreshTeamPlans(state);

  return state;
}
