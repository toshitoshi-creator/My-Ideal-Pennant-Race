/**
 * PHASE 4.9-B 選手の成長曲線。
 *
 * 表示するのは「保存されている能力の記録」だけ。
 * 記録が無い年は線を切り、現在値から過去を推測して埋めることはしない。
 * 潜在能力の実数値も、将来の成長率も、ここには出さない。
 */
import { useState } from 'react';
import type { Player } from '../../domain/types';
import {
  abilityPoints,
  readGrowth,
  GROWTH_PHASE_LABELS,
  GROWTH_PHASE_MARKS,
} from '../../domain/abilityHistory';
import { useGame } from '../store';
import { MultiLineChart, type LineSeriesInput } from './charts';
import { Sec } from './Sec';

interface AbilityMetric {
  key: string;
  label: string;
  pick: (point: ReturnType<typeof abilityPoints>[number]) => number | null;
}

const BATTER_METRICS: AbilityMetric[] = [
  { key: 'overall', label: '総合', pick: (p) => p.overall },
  { key: 'trajectory', label: '弾道', pick: (p) => p.batting?.trajectory ?? null },
  { key: 'power', label: 'パワー', pick: (p) => p.batting?.power ?? null },
  { key: 'contact', label: 'ミート', pick: (p) => p.batting?.contact ?? null },
  { key: 'speed', label: '走力', pick: (p) => p.batting?.speed ?? null },
  { key: 'arm', label: '肩', pick: (p) => p.batting?.arm ?? null },
  { key: 'fielding', label: '守備', pick: (p) => p.batting?.fielding ?? null },
  { key: 'catching', label: '捕球', pick: (p) => p.batting?.catching ?? null },
];

const PITCHER_METRICS: AbilityMetric[] = [
  { key: 'overall', label: '総合', pick: (p) => p.overall },
  { key: 'velocity', label: '球速', pick: (p) => p.pitching?.velocity ?? null },
  { key: 'control', label: '制球', pick: (p) => p.pitching?.control ?? null },
  { key: 'stamina', label: 'スタミナ', pick: (p) => p.pitching?.stamina ?? null },
  { key: 'power', label: '球威', pick: (p) => p.pitching?.power ?? null },
  { key: 'movement', label: '変化', pick: (p) => p.pitching?.movement ?? null },
];

export function GrowthPanel({ player }: { player: Player }) {
  const { state } = useGame();
  const points = abilityPoints(state.history.players[player.id]);
  const metrics = player.isPitcher ? PITCHER_METRICS : BATTER_METRICS;
  const [metric, setMetric] = useState('overall');
  const current = metrics.find((m) => m.key === metric) ?? metrics[0];
  const growth = readGrowth(points);

  if (points.length === 0) {
    return (
      <div className="card">
        <Sec en="GROWTH" ja="能力の推移" />
        <p className="muted">{growth.text}</p>
      </div>
    );
  }

  const values = points.map((p) => current.pick(p));
  const known = values.filter((v): v is number => v !== null);
  // 球速だけ単位が違うので、そのまま km/h で描く
  const isVelocity = current.key === 'velocity';
  const lo = isVelocity ? Math.min(...known) - 3 : 0;
  const hi = isVelocity ? Math.max(...known) + 3 : 100;

  const series: LineSeriesInput[] = [{ key: current.key, label: current.label, values, emphasis: true }];

  return (
    <div className="card">
      <Sec en="GROWTH" ja="能力の推移" />

      <div className="usage-line">
        <span className="usage-mark">{GROWTH_PHASE_MARKS[growth.phase]}</span>
        <span>{GROWTH_PHASE_LABELS[growth.phase]}</span>
      </div>
      <p className="analysis-reason">{growth.text}</p>

      <div className="scroll-x" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {metrics.map((m) => (
            <button
              key={m.key}
              className={m.key === metric ? 'chip on' : 'chip'}
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
        yMin={lo}
        yMax={hi}
        yTicks={isVelocity ? [lo, hi] : [0, 50, 100]}
        animationKey={`growth:${player.id}:${metric}`}
        ariaLabel={`${current.label}の推移`}
      />

      <div className="stat-line">
        <span className="muted">最高</span>
        <span>
          {growth.peakOverall ?? '―'}
          {growth.peakYear !== null && <span className="muted">（{growth.peakYear}年）</span>}
        </span>
      </div>
      <div className="stat-line">
        <span className="muted">直近</span>
        <span>{growth.latestOverall ?? '―'}</span>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
        記録があるシーズンだけを結んでいます。潜在能力そのものは表示しません。
      </p>
    </div>
  );
}
