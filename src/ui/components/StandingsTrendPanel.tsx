/**
 * PHASE 4.9-B チーム順位推移のグラフ。
 * 順位は1位を一番上に描く。自球団だけ濃く、他球団は薄い線にする。
 */
import { useState } from 'react';
import { useGame } from '../store';
import {
  standingsTrend,
  isInverted,
  formatStandingsValue,
  STANDINGS_METRIC_LABELS,
  type StandingsMetric,
} from '../../domain/standingsHistory';
import { MultiLineChart, type LineSeriesInput } from './charts';
import { Sec } from './Sec';

const METRICS: StandingsMetric[] = ['rank', 'wins', 'winPct', 'runsScored', 'runsAllowed'];

export function StandingsTrendPanel() {
  const { state } = useGame();
  const [metric, setMetric] = useState<StandingsMetric>('rank');
  const myTeam = state.teams.find((t) => t.id === state.playerTeamId);
  const [leagueId, setLeagueId] = useState(myTeam?.leagueId ?? state.leagues[0].id);

  if (state.history.seasons.length === 0) {
    return (
      <div className="card">
        <Sec en="TEAM TREND" ja="順位の推移" />
        <p className="muted">
          まだ終えたシーズンがありません。シーズンを締めると1年ぶんずつ記録されます。
        </p>
      </div>
    );
  }

  const trend = standingsTrend(state, leagueId, metric);
  const series: LineSeriesInput[] = trend.series.map((s) => ({
    key: s.teamId,
    label: s.teamName,
    values: s.values,
    emphasis: s.teamId === state.playerTeamId,
  }));

  const inverted = isInverted(metric);
  const ticks = inverted
    ? [trend.min, trend.max]
    : [trend.min, Math.round((trend.min + trend.max) / 2), trend.max];

  return (
    <div className="card">
      <Sec en="TEAM TREND" ja="順位の推移" />

      {state.leagues.length > 1 && (
        <div className="scroll-x" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {state.leagues.map((league) => (
              <button
                key={league.id}
                className={league.id === leagueId ? 'chip on' : 'chip'}
                onClick={() => setLeagueId(league.id)}
              >
                {league.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scroll-x" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {METRICS.map((m) => (
            <button
              key={m}
              className={m === metric ? 'chip on' : 'chip'}
              onClick={() => setMetric(m)}
            >
              {STANDINGS_METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <MultiLineChart
        labels={trend.years.map((y) => String(y).slice(2))}
        series={series}
        invertY={inverted}
        yMin={trend.min}
        yMax={trend.max}
        yTicks={ticks}
        format={(v) => formatStandingsValue(metric, v)}
        animationKey={`standings:${leagueId}:${metric}`}
        ariaLabel={`${STANDINGS_METRIC_LABELS[metric]}の推移`}
      />

      <div className="chart-legend">
        {trend.series.map((s) => (
          <span key={s.teamId} className={s.teamId === state.playerTeamId ? 'on' : undefined}>
            {s.teamName}
          </span>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
        {inverted ? '上にあるほど上位です。' : '記録のある年だけを結んでいます。'}
      </p>
    </div>
  );
}
