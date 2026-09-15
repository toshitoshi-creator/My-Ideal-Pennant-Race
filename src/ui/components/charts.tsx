/**
 * PHASE 4.1 のグラフ部品。
 * すべて SVG + CSS で描く（Canvas / WebGL は使わない）。
 * アニメーションは transform と opacity、あるいは描画値の補間だけで行う。
 */
import { useId } from 'react';
import type { RadarAxis, TrendPoint } from '../../domain/playerAnalysis';
import { rankOf, RANK_COLORS } from '../../domain/rank';
import { useProgress, useReducedMotion, useFirstVisit, easeOutCubic } from '../anim';

/* ================= レーダーチャート ================= */

const RADAR_SIZE = 210;
const RADAR_R = 78;

function point(cx: number, cy: number, r: number, index: number, total: number) {
  // 真上から時計回り
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

/**
 * 能力のレーダーチャート（§7・§8）。
 * 外周 → 軸 → 各能力が伸びる、の順に約 700ms で描く。
 * 2回目以降と reduced-motion では即座に最終形にする。
 */
export function RadarChart({
  axes,
  animationKey,
  showProjection = true,
}: {
  axes: RadarAxis[];
  /** 選手が変わったら描き直すためのキー */
  animationKey: string;
  showProjection?: boolean;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`radar:${animationKey}`);
  const duration = reduced ? 0 : first ? 720 : 260;
  const t = useProgress(duration, animationKey);
  const clipId = useId();

  const cx = RADAR_SIZE / 2;
  const cy = RADAR_SIZE / 2;
  const total = axes.length;
  if (total === 0) return null;

  // 0〜0.25 外周 / 0.25〜0.45 軸 / 0.45〜1 能力
  const ringT = Math.min(1, t / 0.25);
  const axisT = Math.min(1, Math.max(0, (t - 0.22) / 0.23));
  const valueT = easeOutCubic(Math.min(1, Math.max(0, (t - 0.42) / 0.58)));

  const rings = [0.25, 0.5, 0.75, 1];
  const polygon = (getR: (axis: RadarAxis) => number) =>
    axes
      .map((axis, i) => {
        const p = point(cx, cy, getR(axis), i, total);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');

  const valueR = (axis: RadarAxis) => (Math.max(4, axis.value) / 100) * RADAR_R * valueT;
  const projectedR = (axis: RadarAxis) =>
    ((axis.projected ?? axis.value) / 100) * RADAR_R * valueT;

  const hasProjection = showProjection && axes.some((a) => a.projected !== null);
  const average = axes.reduce((sum, a) => sum + a.value, 0) / total;
  const color = RANK_COLORS[rankOf(average)];

  return (
    <div className="radar-wrap">
      <svg
        viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
        className="radar"
        role="img"
        aria-label="能力のレーダーチャート"
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={RADAR_R * ringT} />
          </clipPath>
        </defs>

        {/* 外周と目盛り */}
        {rings.map((ratio) => (
          <polygon
            key={ratio}
            className="radar-ring"
            points={polygon(() => RADAR_R * ratio * ringT)}
          />
        ))}

        {/* 軸 */}
        {axes.map((axis, i) => {
          const p = point(cx, cy, RADAR_R * axisT, i, total);
          return (
            <line key={axis.key} className="radar-axis" x1={cx} y1={cy} x2={p.x} y2={p.y} />
          );
        })}

        {/* 将来予測レンジ（確定値ではないので薄く塗るだけ） */}
        {hasProjection && (
          <polygon
            className="radar-projection"
            points={polygon(projectedR)}
            clipPath={`url(#${clipId})`}
            style={{ fill: color }}
          />
        )}

        {/* 現在の推定能力 */}
        <polygon
          className="radar-value"
          points={polygon(valueR)}
          style={{ fill: color, stroke: color }}
        />

        {/* 頂点 */}
        {axes.map((axis, i) => {
          const p = point(cx, cy, valueR(axis), i, total);
          return <circle key={axis.key} className="radar-dot" cx={p.x} cy={p.y} r={2.4} style={{ fill: color }} />;
        })}

        {/* ラベル */}
        {axes.map((axis, i) => {
          const p = point(cx, cy, RADAR_R + 20, i, total);
          return (
            <text
              key={axis.key}
              className="radar-label"
              x={p.x}
              y={p.y}
              textAnchor={labelAnchor(p.x, cx)}
              dominantBaseline="middle"
            >
              {axis.label}
            </text>
          );
        })}
      </svg>
      {hasProjection && (
        <div className="muted radar-note">
          薄い領域は将来予測のレンジです（確定した数値ではありません）
        </div>
      )}
    </div>
  );
}

function labelAnchor(x: number, cx: number): 'start' | 'middle' | 'end' {
  if (x > cx + 6) return 'start';
  if (x < cx - 6) return 'end';
  return 'middle';
}

/* ================= 成績推移グラフ ================= */

export type TrendDirection = 'UP' | 'FLAT' | 'DOWN';

export const TREND_MARKS: Record<TrendDirection, string> = {
  UP: '↑ 成長傾向',
  FLAT: '→ 安定',
  DOWN: '↓ 下降傾向',
};

/** 値の並びから上昇・横ばい・下降を判定する（小さい方が良い指標は invert） */
export function directionOf(values: number[], invert = false): TrendDirection {
  if (values.length < 2) return 'FLAT';
  const recent = values.slice(-3);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = Math.max(...values) - Math.min(...values);
  if (span <= 0) return 'FLAT';
  const diff = ((last - first) / span) * (invert ? -1 : 1);
  if (diff >= 0.28) return 'UP';
  if (diff <= -0.28) return 'DOWN';
  return 'FLAT';
}

const CHART_W = 320;
const CHART_H = 132;

/**
 * 年度別成績の折れ線（§9）。
 * 値は年度順。1点しかない場合も点だけ描いて「1年ぶん」と分かるようにする。
 */
export function TrendChart({
  points,
  metric,
  invert = false,
  format,
  animationKey,
}: {
  points: TrendPoint[];
  metric: string;
  /** 小さいほど良い指標（防御率など） */
  invert?: boolean;
  format: (value: number) => string;
  animationKey: string;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`trend:${animationKey}:${metric}`);
  const t = useProgress(reduced ? 0 : first ? 520 : 200, `${animationKey}:${metric}`);
  const eased = easeOutCubic(t);

  const values = points.map((p) => p.values[metric] ?? 0);
  if (values.length === 0) {
    return <div className="muted">記録された年度別成績がありません。</div>;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.2);
  const padTop = 14;
  const padBottom = 24;
  const padX = 26;
  const usableW = CHART_W - padX * 2;
  const usableH = CHART_H - padTop - padBottom;

  const xy = (i: number, value: number) => {
    const x = values.length === 1 ? CHART_W / 2 : padX + (usableW * i) / (values.length - 1);
    const ratio = (value - min) / span;
    const y = padTop + usableH * (1 - ratio);
    return { x, y };
  };

  const direction = directionOf(values, invert);
  const color =
    direction === 'UP' ? 'var(--good)' : direction === 'DOWN' ? 'var(--bad)' : 'var(--accent-2)';

  const shown = Math.max(1, Math.ceil(values.length * eased));
  const path = values
    .slice(0, shown)
    .map((v, i) => {
      const p = xy(i, v);
      return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div>
      <div className="spread" style={{ marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {points[0].year}年 〜 {points[points.length - 1].year}年
        </span>
        <span className={`trend-mark ${direction.toLowerCase()}`}>{TREND_MARKS[direction]}</span>
      </div>
      <div className="scroll-x">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="trend-chart" role="img" aria-label="年度別成績">
          <line className="trend-grid" x1={padX} y1={padTop} x2={CHART_W - padX} y2={padTop} />
          <line
            className="trend-grid"
            x1={padX}
            y1={padTop + usableH}
            x2={CHART_W - padX}
            y2={padTop + usableH}
          />
          <path className="trend-line" d={path} style={{ stroke: color }} />
          {values.slice(0, shown).map((v, i) => {
            const p = xy(i, v);
            return (
              <g key={points[i].year}>
                <circle className="trend-dot" cx={p.x} cy={p.y} r={3} style={{ fill: color }} />
                <text className="trend-value" x={p.x} y={p.y - 7} textAnchor="middle">
                  {format(v)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const pos = xy(i, values[i]);
            return (
              <text
                key={p.year}
                className="trend-year"
                x={pos.x}
                y={CHART_H - 7}
                textAnchor="middle"
              >
                {String(p.year).slice(2)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ================= 星 ================= */

export function Stars({ value, label }: { value: number; label?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <div className="spread stars-row">
      {label && <span className="muted">{label}</span>}
      <span className="stars" aria-label={`${filled} / 5`}>
        {'★'.repeat(filled)}
        <span className="stars-off">{'★'.repeat(5 - filled)}</span>
      </span>
    </div>
  );
}

/* ================= 横棒（チーム軸） ================= */

export function AxisBar({
  label,
  value,
  vsLeague,
  animationKey,
}: {
  label: string;
  value: number;
  vsLeague: number;
  animationKey: string;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`axis:${animationKey}:${label}`);
  const t = useProgress(reduced ? 0 : first ? 460 : 180, animationKey);
  const width = Math.max(2, Math.min(100, value)) * easeOutCubic(t);
  const sign = vsLeague > 0 ? '+' : '';
  // PHASE 4.2: 棒は「量」なので墨で引く。等級の色は使わない（§6）。
  // リーグ平均との差だけを、記号と色の両方で示す。
  const above = vsLeague >= 0;
  return (
    <div className="ability">
      <span className="label">{label}</span>
      <span className="bar">
        <span style={{ width: `${width}%`, background: 'var(--ink-2)' }} />
      </span>
      <span className="val">{Math.round(value)}</span>
      <span
        className="axis-delta"
        style={{ color: above ? 'var(--grass)' : 'var(--accent)' }}
      >
        {above ? '▲' : '▼'}
        {sign}
        {vsLeague.toFixed(1)}
      </span>
    </div>
  );
}

/* ================= 複数系列の折れ線（PHASE 4.9-B） ================= */

export interface LineSeriesInput {
  key: string;
  label: string;
  /** labels と同じ長さ。記録が無い年は null（線をつなげず、点も描かない） */
  values: (number | null)[];
  /** 主役の系列（自球団・総合力など）を太く描く */
  emphasis?: boolean;
  /** 線の色。省略すると既定のインク色 */
  color?: string;
}

const LINE_W = 320;

/**
 * 年ごとの折れ線グラフ。
 * 順位のように「小さいほど上」の指標は invertY で上下を反転する。
 * 値が null の年は線を切る（存在しない記録を補間して捏造しない）。
 */
export function MultiLineChart({
  labels,
  series,
  invertY = false,
  yMin,
  yMax,
  format,
  animationKey,
  height = 150,
  yTicks,
  ariaLabel,
}: {
  /** X軸の見出し（年など） */
  labels: string[];
  series: LineSeriesInput[];
  invertY?: boolean;
  yMin?: number;
  yMax?: number;
  format?: (value: number) => string;
  animationKey: string;
  height?: number;
  /** Y軸に置く目盛りの値 */
  yTicks?: number[];
  ariaLabel?: string;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`line:${animationKey}`);
  const t = useProgress(reduced ? 0 : first ? 520 : 200, animationKey);
  const eased = easeOutCubic(t);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (labels.length === 0 || all.length === 0) {
    return <div className="muted">記録がありません。</div>;
  }

  const lo = yMin ?? Math.min(...all);
  const hi = yMax ?? Math.max(...all);
  const span = hi - lo || 1;

  const padTop = 12;
  const padBottom = 22;
  const padLeft = 26;
  const padRight = 12;
  const usableW = LINE_W - padLeft - padRight;
  const usableH = height - padTop - padBottom;

  const xAt = (i: number) =>
    labels.length === 1 ? padLeft + usableW / 2 : padLeft + (usableW * i) / (labels.length - 1);
  const yAt = (value: number) => {
    const ratio = (value - lo) / span;
    // invertY のときは値が小さいほど上（順位1位が一番上）
    return padTop + usableH * (invertY ? ratio : 1 - ratio);
  };

  const shown = Math.max(1, Math.ceil(labels.length * eased));
  // 年が多いときは見出しを間引く（390px 幅で重ならないように）
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div>
      <svg
        viewBox={`0 0 ${LINE_W} ${height}`}
        className="trend-chart line-chart"
        role="img"
        aria-label={ariaLabel ?? '推移グラフ'}
      >
        {(yTicks ?? [lo, hi]).map((tick) => (
          <g key={tick}>
            <line
              className="trend-grid"
              x1={padLeft}
              y1={yAt(tick)}
              x2={LINE_W - padRight}
              y2={yAt(tick)}
            />
            <text className="trend-year" x={padLeft - 4} y={yAt(tick) + 3} textAnchor="end">
              {format ? format(tick) : String(tick)}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const segments: string[] = [];
          let current: string[] = [];
          s.values.slice(0, shown).forEach((v, i) => {
            if (v === null) {
              if (current.length > 0) segments.push(current.join(' '));
              current = [];
              return;
            }
            current.push(`${current.length === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
          });
          if (current.length > 0) segments.push(current.join(' '));
          const stroke = s.color ?? (s.emphasis ? 'var(--text)' : 'var(--text-dim)');
          return (
            <g key={s.key}>
              {segments.map((d, i) => (
                <path
                  key={i}
                  className={s.emphasis ? 'trend-line line-main' : 'trend-line line-sub'}
                  d={d}
                  style={{ stroke }}
                />
              ))}
              {s.emphasis &&
                s.values.slice(0, shown).map((v, i) =>
                  v === null ? null : (
                    <circle
                      key={`${s.key}:${i}`}
                      className="trend-dot"
                      cx={xAt(i)}
                      cy={yAt(v)}
                      r={2.6}
                      style={{ fill: stroke }}
                    />
                  ),
                )}
            </g>
          );
        })}

        {labels.map((label, i) =>
          i % labelStep === 0 || i === labels.length - 1 ? (
            <text
              key={label}
              className="trend-year"
              x={xAt(i)}
              y={height - 6}
              textAnchor="middle"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
