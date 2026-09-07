/**
 * PHASE 4.5 球団と球場の絵（§11・§12）。
 *
 * 球団章・ユニフォーム・本拠地は、実在球団のものを一切使わず、
 * teamId から決定的に組み立てる架空のデザイン（§35）。
 * 色は Team.color をそのまま使い、新しい色を足さない（§28）。
 */
import type { TeamVisual, StadiumMood } from '../../../domain/visuals';
import { STADIUM_MOOD_LABELS } from '../../../domain/visuals';

/* ================= 球団章 ================= */

export function TeamMark({
  visual,
  name,
  size = 34,
}: {
  visual: TeamVisual;
  name: string;
  size?: number;
}) {
  return (
    <svg
      className="team-mark"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={`${name}の球団章`}
    >
      <circle cx="20" cy="20" r="18.5" fill="var(--paper)" className="portrait-line" />
      <MarkShape shape={visual.mark} color={visual.color} />
    </svg>
  );
}

function MarkShape({ shape, color }: { shape: TeamVisual['mark']; color: string }) {
  switch (shape) {
    case 'STAR':
      return (
        <path
          d="M20 7 l3.6 7.9 8.4 1 -6.2 5.9 1.6 8.6 -7.4-4.2 -7.4 4.2 1.6-8.6 -6.2-5.9 8.4-1 z"
          fill={color}
        />
      );
    case 'WING':
      return (
        <path
          d="M6 22 q8-9 14-2 q6-7 14 2 q-8 2-14 8 q-6-6-14-8 z"
          fill={color}
        />
      );
    case 'SHIELD':
      return <path d="M20 6 l12 4 v10 q0 9-12 14 q-12-5-12-14 v-10 z" fill={color} />;
    case 'DIAMOND':
      // ダイヤモンド＝内野の形
      return (
        <>
          <path d="M20 7 l13 13 -13 13 -13-13 z" fill={color} />
          <circle cx="20" cy="20" r="3.4" fill="var(--paper)" />
        </>
      );
    case 'CIRCLE':
      return (
        <>
          <circle cx="20" cy="20" r="12" fill={color} />
          {/* 縫い目 */}
          <path d="M13 11 q5 9 0 18 M27 11 q-5 9 0 18" stroke="var(--paper)" strokeWidth="1.6" fill="none" />
        </>
      );
    default:
      return <path d="M23 6 l-11 15 h7 l-3 13 12-16 h-7 z" fill={color} />;
  }
}

/* ================= ユニフォーム ================= */

/** 球団のユニフォーム。番号を入れると背番号入りの一枚になる */
export function TeamUniform({
  visual,
  name,
  number,
  size = 64,
}: {
  visual: TeamVisual;
  name: string;
  number?: number;
  size?: number;
}) {
  return (
    <svg
      className="team-uniform"
      viewBox="0 0 52 58"
      width={size}
      height={(size * 58) / 52}
      role="img"
      aria-label={number !== undefined ? `${name}のユニフォーム（背番号${number}）` : `${name}のユニフォーム`}
    >
      {/* 身頃 */}
      <path
        d="M14 10 l6-3 h12 l6 3 8 6 -5 7 -3-2 v31 h-24 v-31 l-3 2 -5-7 z"
        fill="var(--paper)"
        className="portrait-line"
      />
      {/* 縦縞 */}
      {visual.pinstripe && (
        <g opacity="0.35">
          {[19, 23, 27, 31, 35].map((x) => (
            <line key={x} x1={x} y1="14" x2={x} y2="52" stroke={visual.color} strokeWidth="0.9" />
          ))}
        </g>
      )}
      {/* 襟 */}
      <path d="M20 7 l6 6 6-6 -2-1 -4 4 -4-4 z" fill={visual.color} />
      {/* 背番号 */}
      {number !== undefined && (
        <text x="26" y="38" className="uniform-number" textAnchor="middle" fill={visual.color}>
          {number}
        </text>
      )}
    </svg>
  );
}

/* ================= 球場 ================= */

/**
 * 本拠地。空気（昼・夜・大観衆・試合のあと・ポストシーズン・優勝）で
 * 濃さと観客の描き方が変わる。天候をゲームに足しているわけではない（§12）。
 */
export function StadiumScene({
  visual,
  name,
  mood = 'DAY',
  height = 116,
}: {
  visual: TeamVisual;
  name: string;
  mood?: StadiumMood;
  height?: number;
}) {
  const label = STADIUM_MOOD_LABELS[mood];
  const night = mood === 'NIGHT' || mood === 'POSTSEASON';
  const packed = mood === 'PACKED' || mood === 'POSTSEASON' || mood === 'CHAMPION';
  const quiet = mood === 'QUIET';

  return (
    <svg
      className={`stadium stadium-${mood.toLowerCase()}`}
      viewBox="0 0 320 92"
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${name}（${label.ja}）`}
    >
      {/* 空 */}
      <rect x="0" y="0" width="320" height="92" className={night ? 'sky-night' : 'sky-day'} />

      {/* 照明塔（夜だけ灯る）。上端で切れないよう内側に収める */}
      {[44, 276].map((x) => (
        <g key={x}>
          <line x1={x} y1="20" x2={x} y2="42" className="stadium-line" />
          <rect x={x - 10} y="13" width="20" height="7" className={night ? 'light-on' : 'light-off'} />
        </g>
      ))}

      {/* スタンド */}
      <StandShape shape={visual.stadium} />

      {/* 観客。多いほど密に描く。色ではなく密度で伝える（§48） */}
      <g className="crowd">
        {Array.from({ length: packed ? 96 : quiet ? 14 : 52 }, (_unused, i) => {
          // 位置は index から決まる。乱数は使わない
          const x = 16 + ((i * 37) % 288);
          const y = 44 + ((i * 13) % 14);
          return <circle key={i} cx={x} cy={y} r="1.4" />;
        })}
      </g>

      {/* 内野の土と芝 */}
      <rect x="0" y="62" width="320" height="30" className="field-grass" />
      <path d="M160 66 l44 12 -44 12 -44-12 z" className="field-dirt" />
      <circle cx="160" cy="78" r="4" className="field-dirt" />
      {/* 塁。下端で切れないように収める */}
      {[
        [160, 66],
        [204, 78],
        [160, 90],
        [116, 78],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 2.2} y={y - 2.2} width="4.4" height="4.4" className="field-base" />
      ))}

      {/* 優勝したときだけ、旗を1本立てる。紙吹雪は出さない（§26） */}
      {mood === 'CHAMPION' && (
        <g>
          <line x1="160" y1="22" x2="160" y2="56" className="stadium-line" />
          <path d="M160 22 h28 l-7 7 7 7 h-28 z" fill={visual.color} />
        </g>
      )}
    </svg>
  );
}

function StandShape({ shape }: { shape: TeamVisual['stadium'] }) {
  if (shape === 'DOME') {
    return (
      <>
        <path d="M0 62 q160-52 320 0 z" className="stadium-roof" />
        <path d="M14 62 q146-40 292 0 z" className="stadium-stand" />
      </>
    );
  }
  if (shape === 'BOWL') {
    return <path d="M0 62 q30-24 160-24 q130 0 160 24 z" className="stadium-stand" />;
  }
  return <path d="M0 62 v-20 h320 v20 z" className="stadium-stand" />;
}

/**
 * 球場を用意できない場合（§8）。線だけのダイヤモンドを出す。
 */
export function StadiumFallback({ name, height = 116 }: { name: string; height?: number }) {
  return (
    <svg
      className="stadium stadium-fallback"
      viewBox="0 0 320 92"
      width="100%"
      height={height}
      role="img"
      aria-label={`${name}の球場図`}
    >
      <rect x="0" y="0" width="320" height="92" className="sky-day" />
      <path d="M160 26 l60 28 -60 26 -60-26 z" className="stadium-line" fill="none" />
    </svg>
  );
}
