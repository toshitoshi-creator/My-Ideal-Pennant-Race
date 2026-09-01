import type { GameState, TeamRecord } from './types';

export interface StandingRow {
  rank: number;
  teamId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winPct: number;
  gamesBehind: number;
  runsScored: number;
  runsAllowed: number;
}

export function winPct(record: TeamRecord): number {
  const denom = record.wins + record.losses;
  return denom === 0 ? 0 : record.wins / denom;
}

export function formatWinPct(value: number): string {
  return value.toFixed(3).replace(/^0/, '');
}

export function formatGamesBehind(gb: number): string {
  if (gb <= 0) return '-';
  return Number.isInteger(gb) ? gb.toFixed(1) : gb.toFixed(1);
}

/** リーグの順位表（勝率順） */
export function standingsForLeague(state: GameState, leagueId: string): StandingRow[] {
  const teams = state.teams.filter((t) => t.leagueId === leagueId);
  const rows = teams
    .map((team) => {
      const record = state.records[team.id];
      return {
        rank: 0,
        teamId: team.id,
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        draws: record.draws,
        winPct: winPct(record),
        gamesBehind: 0,
        runsScored: record.runsScored,
        runsAllowed: record.runsAllowed,
      };
    })
    .sort((a, b) => {
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    });

  const top = rows[0];
  rows.forEach((row, i) => {
    row.rank = i + 1;
    row.gamesBehind =
      top === row ? 0 : ((top.wins - row.wins) + (row.losses - top.losses)) / 2;
  });
  return rows;
}

export function rankOfTeam(state: GameState, teamId: string): number {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return 0;
  const rows = standingsForLeague(state, team.leagueId);
  return rows.find((r) => r.teamId === teamId)?.rank ?? 0;
}
