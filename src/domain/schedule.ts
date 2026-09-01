import type { League, ScheduledGame, SeasonLength, Team } from './types';
import { addDays, dayOfWeek, toDateString } from './dates';

export const SEASON_LENGTH_OPTIONS: Array<{ value: SeasonLength; label: string; note: string }> = [
  { value: 10, label: '10試合', note: '動作確認用の超短縮シーズン' },
  { value: 30, label: '30試合', note: '短縮シーズン' },
  { value: 143, label: '143試合', note: '正式シーズン' },
];

export function openingDate(year: number): string {
  return toDateString(year, 3, 27);
}

/** 6 球団の総当たり（サークル法）。round は 0〜4 で 1 巡。 */
function roundPairs(teamIds: string[], round: number): Array<[string, string]> {
  const n = teamIds.length;
  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);
  const size = rotating.length; // 5
  const shift = round % size;
  const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];
  const pairs: Array<[string, string]> = [[fixed, rotated[0]]];
  for (let i = 1; i < n / 2; i++) {
    pairs.push([rotated[i], rotated[size - i]]);
  }
  return pairs;
}

/** 月曜日は試合なし（休養日） */
function isGameDay(date: string): boolean {
  return dayOfWeek(date) !== 1;
}

/**
 * 12 球団分のシーズン日程を作る。
 * 各球団が seasonLength 試合ちょうど行う（同一リーグ内の総当たり）。
 */
export function generateSchedule(
  year: number,
  seasonLength: SeasonLength,
  leagues: League[],
  teams: Team[],
): ScheduledGame[] {
  const games: ScheduledGame[] = [];
  let date = openingDate(year);

  for (let round = 0; round < seasonLength; round++) {
    while (!isGameDay(date)) date = addDays(date, 1);
    const cycle = Math.floor(round / 5);
    for (const league of leagues) {
      const teamIds = teams.filter((t) => t.leagueId === league.id).map((t) => t.id);
      for (const [a, b] of roundPairs(teamIds, round)) {
        // 巡ごとにホーム／ビジターを入れ替える
        const [homeTeamId, awayTeamId] = cycle % 2 === 0 ? [a, b] : [b, a];
        games.push({
          id: `g${round}-${homeTeamId}`,
          date,
          leagueId: league.id,
          homeTeamId,
          awayTeamId,
          played: false,
        });
      }
    }
    date = addDays(date, 1);
  }
  return games;
}

export function gamesOn(schedule: ScheduledGame[], date: string): ScheduledGame[] {
  return schedule.filter((g) => g.date === date);
}

export function nextGameForTeam(
  schedule: ScheduledGame[],
  teamId: string,
  fromDate: string,
): ScheduledGame | null {
  for (const g of schedule) {
    if (g.played) continue;
    if (g.date < fromDate) continue;
    if (g.homeTeamId === teamId || g.awayTeamId === teamId) return g;
  }
  return null;
}
