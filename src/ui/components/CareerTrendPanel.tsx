/**
 * PHASE 4.9-B 通算成績の推移。
 * 年度別の記録を積み上げた線を描く。記録が無い年は積み上げを増やさない。
 */
import { useState } from 'react';
import type { Player, PlayerSeasonHistoryEntry } from '../../domain/types';
import { careerCumulative } from '../../domain/abilityHistory';
import { BATTING_FIELDS, PITCHING_FIELDS } from '../../domain/stats';
import { useGame } from '../store';
import { MultiLineChart, type LineSeriesInput } from './charts';
import { Sec } from './Sec';

interface CareerMetric {
  key: string;
  label: string;
  pick: (season: PlayerSeasonHistoryEntry) => number | null;
}

function batterField(key: (typeof BATTING_FIELDS)[number]) {
  const index = BATTING_FIELDS.indexOf(key);
  return (season: PlayerSeasonHistoryEntry): number | null => season.b?.[index] ?? null;
}

function pitcherField(key: (typeof PITCHING_FIELDS)[number]) {
  const index = PITCHING_FIELDS.indexOf(key);
  return (season: PlayerSeasonHistoryEntry): number | null => season.p?.[index] ?? null;
}

const BATTER_METRICS: CareerMetric[] = [
  { key: 'hits', label: '安打', pick: batterField('hits') },
  { key: 'homeRuns', label: '本塁打', pick: batterField('homeRuns') },
  { key: 'rbi', label: '打点', pick: batterField('rbi') },
  { key: 'steals', label: '盗塁', pick: batterField('steals') },
];

const PITCHER_METRICS: CareerMetric[] = [
  { key: 'wins', label: '勝利', pick: pitcherField('wins') },
  { key: 'strikeouts', label: '奪三振', pick: pitcherField('strikeouts') },
  { key: 'saves', label: 'セーブ', pick: pitcherField('saves') },
];

export function CareerTrendPanel({ player }: { player: Player }) {
  const { state } = useGame();
  const metrics = player.isPitcher ? PITCHER_METRICS : BATTER_METRICS;
  const [metric, setMetric] = useState(metrics[0].key);
  const current = metrics.find((m) => m.key === metric) ?? metrics[0];
  const points = careerCumulative(state.history.players[player.id], current.pick);

  if (points.length === 0) {
    return (
      <div className="card">
        <Sec en="CAREER TOTAL" ja="通算成績の推移" />
        <p className="muted">まだ年度別成績が記録されていません。</p>
      </div>
    );
  }

  const totals = points.map((p) => p.total);
  const series: LineSeriesInput[] = [
    { key: 'total', label: `通算${current.label}`, values: totals, emphasis: true },
  ];
  const max = Math.max(...totals, 1);

  return (
    <div className="card">
      <Sec en="CAREER TOTAL" ja="通算成績の推移" />

      <div className="scroll-x" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {metrics.map((m) => (
            <button
              key={m.key}
              className={m.key === metric ? 'chip on' : 'chip'}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <MultiLineChart
        labels={points.map((p) => String(p.year).slice(2))}
        series={series}
        yMin={0}
        yMax={max}
        yTicks={[0, max]}
        animationKey={`career:${player.id}:${metric}`}
        ariaLabel={`通算${current.label}の推移`}
      />

      <div className="stat-line">
        <span className="muted">通算{current.label}</span>
        <span>{points[points.length - 1].total}</span>
      </div>
    </div>
  );
}
