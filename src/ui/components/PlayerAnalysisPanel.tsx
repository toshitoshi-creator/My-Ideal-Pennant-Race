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
} from '../../domain/playerAnalysis';
import { formatAverage } from '../../domain/stats';
import { useGame } from '../store';
import { RadarChart, Stars, TrendChart } from './charts';
import { Sec } from './Sec';


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

  /*
   * PHASE 4.2: いちばん上に「この選手をどう扱うか」を置く（§11）。
   * 星や数値より先に、結論とその理由が読めること。
   */
  const verdict = RECOMMENDATION_LABELS[analysis.recommendation];
  const tone: Record<string, string> = {
    CORE: 'core',
    KEEP: 'keep',
    DEVELOP: 'develop',
    ADJUST: 'adjust',
    RELEASE_CANDIDATE: 'release',
    INJURY_RETURN: 'injury',
  };

  return (
    <>
      {/* ── 結論 ── */}
      <section className={`verdict verdict-${tone[analysis.recommendation]}`}>
        <Sec en="GM RECOMMENDATION" ja="扱いの助言" size="lead" />
        <div className="verdict-name">{verdict}</div>
        <p className="verdict-reason">{analysis.recommendationReason}</p>
        {analysis.reasons.length > 0 && (
          <div className="tally">
            <div className="label tally-head">
              判断材料 {analysis.reasons.length} / 6
            </div>
            <ul className="tally-list">
              {analysis.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="verdict-note">
          判断材料です。起用と契約を決めるのは監督（あなた）です。
        </div>
      </section>

      {/* ── 評価 ── */}
      <div className="card">
        <Sec
          en="SCOUT REPORT"
          ja="スカウト評価"
          note={`確度 ${Math.round(analysis.scoutingConfidence * 100)}%`}
        />
        <div className="grade-line">
          <span className="grade-mark">{analysis.grade}</span>
          <span className="grade-label">{GRADE_LABELS[analysis.grade]}</span>
          {player.teamId !== state.playerTeamId && (
            <span className="grade-conf">他球団のため確度は低め</span>
          )}
        </div>
        <Stars label="現在戦力" value={analysis.stars.current} />
        <Stars label="将来性" value={analysis.stars.future} />
        <Stars label="成長期待" value={analysis.stars.development} />
        <Stars label="起用優先度" value={analysis.stars.usage} />
      </div>

      {/* ── 起用 ── */}
      <div className="card">
        <Sec en="ROSTER STATUS" ja="起用の目安" />
        <div className="usage-line">
          <span className="usage-mark">{USAGE_ADVICE_LABELS[analysis.usage]}</span>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            自動では変更しません
          </span>
        </div>
        <p className="analysis-reason">{analysis.usageReason}</p>
      </div>

      {/* ── 能力 ── */}
      <div className="card">
        <Sec en="ABILITY" ja="能力資料" />
        <p className="scout-note">{analysis.summary}</p>
        <RadarChart axes={analysis.radar} animationKey={player.id} />
        {!analysis.abilityHistoryAvailable && (
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
            能力の履歴は保存していないため、過去の能力推移は表示できません。
          </div>
        )}
      </div>

      <div className="card">
        <Sec en="SEASON RECORD" ja="年度別成績" />
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
