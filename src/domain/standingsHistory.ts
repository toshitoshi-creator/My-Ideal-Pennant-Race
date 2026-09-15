/**
 * PHASE 4.9-B チーム順位推移。
 *
 * 既に保存されている TeamSeasonHistory を読むだけで、新しい保存項目は足さない。
 * 記録が無い年は null にして線を切る（存在しないシーズンを補間しない）。
 */
import type { GameState, TeamSeasonHistory } from './types';

/** 折れ線に出せる指標 */
export type StandingsMetric = 'rank' | 'wins' | 'winPct' | 'runsScored' | 'runsAllowed';

export const STANDINGS_METRIC_LABELS: Record<StandingsMetric, string> = {
  rank: '順位',
  wins: '勝利数',
  winPct: '勝率',
  runsScored: '得点',
  runsAllowed: '失点',
};

/** 小さいほど上に描く指標（順位は1位が一番上） */
export function isInverted(metric: StandingsMetric): boolean {
  return metric === 'rank';
}

export interface StandingsSeries {
  teamId: string;
  teamName: string;
  leagueId: string;
  /** years と同じ長さ。その年の記録が無ければ null */
  values: (number | null)[];
}

export interface StandingsTrend {
  years: number[];
  series: StandingsSeries[];
  /** その指標で取りうる最小値（グラフの下端。順位のときは1） */
  min: number;
  max: number;
}

function valueOf(row: TeamSeasonHistory, metric: StandingsMetric): number {
  switch (metric) {
    case 'rank':
      return row.rank;
    case 'wins':
      return row.wins;
    case 'winPct':
      return row.winPct;
    case 'runsScored':
      return row.runsScored;
    case 'runsAllowed':
      return row.runsAllowed;
  }
}

/**
 * リーグ内の全球団について、年ごとの指標を並べる。
 * 対象リーグの球団だけを返す（順位は同じリーグでしか比べられないため）。
 */
export function standingsTrend(
  state: GameState,
  leagueId: string,
  metric: StandingsMetric,
): StandingsTrend {
  const years = state.history.seasons.map((s) => s.year);
  const teams = state.teams.filter((t) => t.leagueId === leagueId);

  const series: StandingsSeries[] = teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    leagueId: team.leagueId,
    values: state.history.seasons.map((season) => {
      const row = season.teams.find((t) => t.teamId === team.id);
      return row ? valueOf(row, metric) : null;
    }),
  }));

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const min = metric === 'rank' ? 1 : all.length > 0 ? Math.min(...all) : 0;
  const max =
    metric === 'rank'
      ? Math.max(teams.length, ...(all.length > 0 ? all : [teams.length]))
      : all.length > 0
        ? Math.max(...all)
        : 1;

  return { years, series, min, max };
}

/** 指標の表示の仕方（グラフの目盛りと凡例で同じ書式を使う） */
export function formatStandingsValue(metric: StandingsMetric, value: number): string {
  if (metric === 'winPct') return value.toFixed(3).replace(/^0/, '');
  if (metric === 'rank') return `${Math.round(value)}位`;
  return String(Math.round(value));
}
