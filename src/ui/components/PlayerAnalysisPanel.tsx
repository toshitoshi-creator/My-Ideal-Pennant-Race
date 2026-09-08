/**
 * PHASE 4.1 選手詳細の「球団分析」。
 * 分析は domain/playerAnalysis.ts が決めた結果を並べるだけで、ここでは判断しない。
 */
import { useMemo, useState } from 'react';
import type { Player } from '../../domain/types';
import {
  GRADE_LABELS,
  RECOMMENDATION_LABELS,
  USAGE_ADVICE_LABELS,
} from '../../domain/playerAnalysis';
import { buildPlayerReport } from '../../domain/playerReport';
import { PlayerVisual } from './PlayerVisual';
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
  const report = useMemo(() => buildPlayerReport(state, player), [state, player]);
  const analysis = report.analysis;
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
        {/*
          PHASE 4.5 §17: 助言の横に人物像を置く。
          絵は分析結果を説明するものではなく、
          「誰の話をしているのか」を思い出しやすくするために置く。
        */}
        <div className="verdict-head">
          <PlayerVisual player={player} size="medium" />
          <div className="verdict-head-text">
            <div className="verdict-name">{verdict}</div>
            <p className="verdict-reason">{analysis.recommendationReason}</p>
          </div>
        </div>
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

      {/* ── なぜこの扱いなのか（§7） ── */}
      <div className="card">
        <Sec en="PLAYER STATUS" ja="いまの立ち位置" />
        <dl className="report-rows">
          {report.rows.map((row) => (
            <div key={row.key} className="report-row">
              <dt>
                <span className="label">{row.en}</span>
                <span className="report-ja">{row.ja}</span>
              </dt>
              <dd>
                <span className="report-value">{row.value}</span>
                {row.note && <span className="report-note">{row.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── 「活躍している」と「成長している」を分ける（§9） ── */}
      <div className="card">
        <Sec en="PERFORMANCE & GROWTH" ja="成績と成長" />
        <div className="split-note">
          <span className="label">CURRENT PERFORMANCE</span>
          <span className="split-ja">現在の成績</span>
          <p className="split-text">{report.performanceNote}</p>
        </div>
        <div className="split-note">
          <span className="label">DEVELOPMENT</span>
          <span className="split-ja">成長傾向</span>
          <p className="split-text">{report.developmentNote}</p>
        </div>
        <div className="split-note">
          <span className="label">POTENTIAL OUTLOOK</span>
          <span className="split-ja">将来性の推定</span>
          <p className="split-text">{report.outlookNote}</p>
        </div>
        <p className="split-combined">{report.combinedNote}</p>
      </div>

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
        {/*
          §10: レーダーだけを見て判断させない。
          いちばん高い軸と低い軸を言葉にして隣に置く。
        */}
        {(report.strength || report.weakness) && (
          <div className="axis-notes">
            {report.strength && (
              <div className="axis-note">
                <span className="label">STRENGTH</span>
                <span className="axis-note-ja">強み</span>
                <div className="axis-note-name">{report.strength.label}</div>
                <p className="axis-note-text">{report.strength.text}</p>
              </div>
            )}
            {report.weakness && (
              <div className="axis-note">
                <span className="label">WEAK POINT</span>
                <span className="axis-note-ja">弱点</span>
                <div className="axis-note-name">{report.weakness.label}</div>
                <p className="axis-note-text">{report.weakness.text}</p>
              </div>
            )}
          </div>
        )}
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
            {/* §11: グラフの読み方。データから直接読めることだけを書く */}
            <div className={`trend-read trend-${report.trendReading.trend.toLowerCase()}`}>
              <span className="label">TREND</span>
              <span className="trend-read-mark">
                {report.trendReading.mark} {report.trendReading.label}
              </span>
              <p className="trend-read-text">{report.trendReading.text}</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
