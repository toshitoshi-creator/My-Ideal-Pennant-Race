/**
 * PHASE 4.1 選手詳細の「球団分析」。
 * 分析は domain/playerAnalysis.ts が決めた結果を並べるだけで、ここでは判断しない。
 */
import { useMemo, useState } from 'react';
import type { Player } from '../../domain/types';
import {
  analyzePlayer,
  GRADE_LABELS,
  RECOMMENDATION_LABELS,
  USAGE_ADVICE_LABELS,
  type PlayerGrade,
} from '../../domain/playerAnalysis';
import { formatAverage } from '../../domain/stats';
import { useGame } from '../store';
import { RadarChart, Stars, TrendChart } from './charts';

const GRADE_COLORS: Record<PlayerGrade, string> = {
  S: '#ff4d6d',
  A: '#ff9f43',
  B: '#ffd93d',
  C: '#4db4ff',
  D: '#9aa4b2',
};

interface MetricDef {
  key: string;
  label: string;
  invert?: boolean;
  format: (value: number) => string;
}

const BATTER_METRICS: MetricDef[] = [
  { key: 'average', label: '打率', format: (v) => formatAverage(v) },
  { key: 'homeRuns', label: '本塁打', format: (v) => String(v) },
  { key: 'rbi', label: '打点', format: (v) => String(v) },
  { key: 'hits', label: '安打', format: (v) => String(v) },
  { key: 'games', label: '試合', format: (v) => String(v) },
];

const PITCHER_METRICS: MetricDef[] = [
  { key: 'era', label: '防御率', invert: true, format: (v) => v.toFixed(2) },
  { key: 'wins', label: '勝利', format: (v) => String(v) },
  { key: 'strikeouts', label: '奪三振', format: (v) => String(v) },
  { key: 'innings', label: '投球回', format: (v) => v.toFixed(1) },
  { key: 'saves', label: 'セーブ', format: (v) => String(v) },
];

export function PlayerAnalysisPanel({ player }: { player: Player }) {
  const { state } = useGame();
  const analysis = useMemo(() => analyzePlayer(state, player), [state, player]);
  const metrics = player.isPitcher ? PITCHER_METRICS : BATTER_METRICS;
  const [metric, setMetric] = useState(metrics[0].key);
  const current = metrics.find((m) => m.key === metric) ?? metrics[0];

  return (
    <>
      <div className="card">
        <h2>球団分析</h2>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span
            className="grade-badge"
            style={{ background: GRADE_COLORS[analysis.grade] }}
            aria-label={`評価 ${analysis.grade}`}
          >
            {analysis.grade}
          </span>
          <div style={{ flex: 1, marginLeft: 10 }}>
            <div style={{ fontWeight: 800 }}>{GRADE_LABELS[analysis.grade]}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              情報の確度 {Math.round(analysis.scoutingConfidence * 100)}%
              {player.teamId !== state.playerTeamId && '（他球団の選手のため低めです）'}
            </div>
          </div>
        </div>
        <p className="analysis-summary">{analysis.summary}</p>
      </div>

      <div className="card">
        <h2>能力</h2>
        <RadarChart axes={analysis.radar} animationKey={player.id} />
        <Stars label="現在戦力" value={analysis.stars.current} />
        <Stars label="将来性" value={analysis.stars.future} />
        <Stars label="成長期待" value={analysis.stars.development} />
        <Stars label="起用優先度" value={analysis.stars.usage} />
        {!analysis.abilityHistoryAvailable && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            能力の履歴は保存していないため、過去の能力推移は表示できません。
          </div>
        )}
      </div>

      <div className="card">
        <h2>起用分析</h2>
        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="chip on">{USAGE_ADVICE_LABELS[analysis.usage]}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            自動では変更しません
          </span>
        </div>
        <p className="analysis-reason">{analysis.usageReason}</p>
      </div>

      <div className="card">
        <h2>扱いの目安</h2>
        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="chip on">{RECOMMENDATION_LABELS[analysis.recommendation]}</span>
        </div>
        <p className="analysis-reason">{analysis.recommendationReason}</p>
        {analysis.reasons.length > 0 && (
          <ul className="reason-list">
            {analysis.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          これは判断材料です。最終的な起用・契約の判断は監督（あなた）が決めます。
        </div>
      </div>

      <div className="card">
        <h2>年度別成績</h2>
        {analysis.trend.length === 0 ? (
          <p className="muted">
            まだ年度別成績が記録されていません。シーズンを終えると記録されます。
          </p>
        ) : (
          <>
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
            <TrendChart
              points={analysis.trend}
              metric={current.key}
              invert={current.invert}
              format={current.format}
              animationKey={player.id}
            />
          </>
        )}
      </div>
    </>
  );
}
