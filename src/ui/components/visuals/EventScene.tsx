/**
 * PHASE 4.5 出来事の絵（§15・§17・§18）。
 *
 * 描くのは、GameResult に実際に記録された出来事だけ。
 * 派手なゲーム演出ではなく「新聞の一面写真」として扱う（§17）。
 * パーティクルも画面揺れも使わない（§16）。
 */
import type { VisualEventKind } from '../../../domain/visuals';
import { EVENT_LABELS, EVENT_RANK } from '../../../domain/visuals';

/**
 * 出来事ひとつぶんの絵。
 * どれも「線で描いた新聞写真」で、色は球団色とインクだけ。
 */
export function EventScene({
  kind,
  teamColor,
  height = 96,
}: {
  kind: VisualEventKind;
  teamColor?: string;
  height?: number;
}) {
  const label = EVENT_LABELS[kind];
  const accent = teamColor ?? 'var(--accent)';
  return (
    <svg
      className={`event-scene event-${kind.toLowerCase().replace(/_/g, '-')} rank-${EVENT_RANK[kind].toLowerCase()}`}
      viewBox="0 0 240 96"
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${label.ja}の場面`}
    >
      <rect x="0" y="0" width="240" height="96" className="event-paper" />
      <Scene kind={kind} accent={accent} />
      {/* 網点。刷り物らしさを線だけで出す（§36） */}
      <g className="halftone">
        {Array.from({ length: 60 }, (_unused, i) => (
          <circle key={i} cx={6 + ((i * 29) % 232)} cy={6 + ((i * 17) % 84)} r="0.9" />
        ))}
      </g>
    </svg>
  );
}

function Scene({ kind, accent }: { kind: VisualEventKind; accent: string }) {
  switch (kind) {
    case 'HOME_RUN':
      return (
        <>
          <Ground />
          <Batter accent={accent} follow />
          {/* 打球の軌跡。フェンスを越える線 */}
          <path d="M96 54 q52-46 128-26" className="ball-path" />
          <circle cx="224" cy="28" r="3.4" className="ball" />
          <path d="M150 70 h86" className="fence" />
        </>
      );
    case 'STRIKEOUT':
      return (
        <>
          <Ground />
          <Pitcher accent={accent} />
          {/* 空振りした打者と、キャッチャーミット */}
          <path d="M186 50 l10 26" className="bat-swing" />
          <circle cx="176" cy="58" r="3.2" className="ball" />
          <path d="M60 44 l108 12" className="ball-path" />
        </>
      );
    case 'DOUBLE_PLAY':
      // 二塁で捕って一塁へ。二人の野手と送球で見せる
      return (
        <>
          <Ground />
          <path d="M60 78 l60-26 60 26" className="ball-path" />
          <Figure x={120} y={40} accent={accent} arms="throw" />
          <Figure x={186} y={52} accent={accent} arms="catch" />
          <path d="M126 48 q30 2 54 8" className="ball-path" />
          <circle cx="182" cy="57" r="3.2" className="ball" />
          <path d="M112 74 l8-8 8 8 -8 8 z" className="field-base" />
          <path d="M178 82 l7-7 7 7 -7 7 z" className="field-base" />
        </>
      );
    case 'GREAT_CATCH':
      // 横っ跳びで捕る。体を倒し、伸ばした手の先に球を置く
      return (
        <>
          <Ground />
          <g className="fielder">
            <circle cx="96" cy="56" r="6" fill={accent} />
            <path d="M102 58 l30-8" className="figure-line" />
            <path d="M92 60 l-26 14 M96 62 l-20 18" className="figure-line" />
            <path d="M90 58 l-16 4" className="figure-line" />
          </g>
          <circle cx="138" cy="48" r="3.4" className="ball" />
          <path d="M216 22 q-40 12-74 24" className="ball-path" />
        </>
      );
    case 'RALLY':
      // 走者が続けて還ってくる。塁を回る線と、走る three 人
      return (
        <>
          <Ground />
          <path d="M64 82 l52-26 52 26 -52 12 z" className="field-dirt" />
          {[78, 116, 154].map((x, i) => (
            <Figure key={x} x={x} y={40 + i * 4} accent={accent} arms="run" />
          ))}
          <path d="M64 82 l52-26" className="ball-path" />
        </>
      );
    case 'COMEBACK':
      // スコアの動きそのものを線にする。ここは球場ではなく記録の図
      return (
        <>
          <line x1="18" y1="82" x2="222" y2="82" className="stadium-line" />
          <line x1="18" y1="14" x2="18" y2="82" className="stadium-line" />
          <path d="M26 72 L74 68 L122 58 L170 38 L214 24" className="flow-line" stroke={accent} />
          <circle cx="214" cy="24" r="4" fill={accent} />
          <path d="M26 34 L74 38 L122 46 L170 58 L214 70" className="flow-line dim" />
        </>
      );
    case 'WALK_OFF':
      return (
        <>
          <Ground />
          <path d="M30 26 h180" className="fence" />
          {/* 本塁に駆け寄る選手たち。頭と体を描いて人だと分かるようにする */}
          <path d="M120 84 l-7 7 7 7 7-7 z" className="field-base" />
          {[92, 106, 120, 134, 148].map((x, i) => {
            const y = 52 + (i % 2) * 4;
            return (
              <g key={x}>
                <circle cx={x} cy={y} r="4.6" fill={accent} />
                <path d={`M${x} ${y + 5} v10`} className="figure-line" />
                <path d={`M${x} ${y + 15} l-4 7 M${x} ${y + 15} l4 7`} className="figure-line" />
                <path d={`M${x - 5} ${y + 8} l5-4 5 4`} className="figure-line" />
              </g>
            );
          })}
        </>
      );
    case 'EXTRA_INNING':
      return (
        <>
          <Ground />
          {/* 電光掲示板の回数が伸びていく */}
          <rect x="30" y="24" width="180" height="34" className="board" />
          {Array.from({ length: 12 }, (_unused, i) => (
            <line key={i} x1={38 + i * 14} y1="28" x2={38 + i * 14} y2="54" className="board-line" />
          ))}
          <rect x="190" y="28" width="12" height="26" fill={accent} />
        </>
      );
    case 'SHUTOUT':
      return (
        <>
          <Ground />
          <Pitcher accent={accent} />
          {/* 相手の得点欄がゼロで並ぶ */}
          <g className="zero-row">
            {Array.from({ length: 9 }, (_unused, i) => (
              <circle key={i} cx={150 + i * 10} cy="30" r="3.4" />
            ))}
          </g>
        </>
      );
    case 'NO_HIT_NO_RUN':
      return (
        <>
          <Ground />
          <Pitcher accent={accent} />
          <g className="zero-row">
            {Array.from({ length: 9 }, (_unused, i) => (
              <circle key={i} cx={150 + i * 10} cy="26" r="3.4" />
            ))}
            {Array.from({ length: 9 }, (_unused, i) => (
              <circle key={`h${i}`} cx={150 + i * 10} cy="40" r="3.4" />
            ))}
          </g>
        </>
      );
    default:
      return <Ground />;
  }
}

/** 線で描いた選手。腕の形だけを変えて、投げる・捕る・走るを表す */
function Figure({
  x,
  y,
  accent,
  arms,
}: {
  x: number;
  y: number;
  accent: string;
  arms: 'throw' | 'catch' | 'run';
}) {
  const armPath =
    arms === 'throw'
      ? `M${x - 6} ${y + 12} l6-4 10 2`
      : arms === 'catch'
        ? `M${x - 5} ${y + 10} l5-3 6-6`
        : `M${x - 6} ${y + 13} l6-4 6 5`;
  return (
    <g>
      <circle cx={x} cy={y} r="5" fill={accent} />
      <path d={`M${x} ${y + 5} v13`} className="figure-line" />
      <path
        d={arms === 'run' ? `M${x} ${y + 18} l-7 8 M${x} ${y + 18} l6 9` : `M${x} ${y + 18} l-5 9 M${x} ${y + 18} l5 9`}
        className="figure-line"
      />
      <path d={armPath} className="figure-line" />
    </g>
  );
}

function Ground() {
  return (
    <>
      <rect x="0" y="64" width="240" height="32" className="field-grass" />
      <path d="M0 64 h240" className="stadium-line" />
    </>
  );
}

function Batter({ accent, follow }: { accent: string; follow?: boolean }) {
  return (
    <g className="batter">
      <circle cx="76" cy="44" r="7" fill={accent} />
      <path d="M76 51 v18 l-8 12 M76 69 l9 12" className="figure-line" />
      <path d={follow ? 'M78 54 l22-16' : 'M78 54 l20 4'} className="bat" />
    </g>
  );
}

function Pitcher({ accent }: { accent: string }) {
  return (
    <g className="pitcher">
      <circle cx="56" cy="40" r="7" fill={accent} />
      <path d="M56 47 v16 l-8 14 M56 63 l9 14" className="figure-line" />
      <path d="M58 50 l14-8" className="figure-line" />
      <path d="M44 76 h26" className="mound" />
    </g>
  );
}

/**
 * 出来事の絵が用意できない場合（§8）。
 * スコアブックの枠だけを出す。壊れた見た目にはしない。
 */
export function EventFallback({ height = 96 }: { height?: number }) {
  return (
    <svg
      className="event-scene event-fallback"
      viewBox="0 0 240 96"
      width="100%"
      height={height}
      role="img"
      aria-label="場面の絵はありません"
    >
      <rect x="0" y="0" width="240" height="96" className="event-paper" />
      <path d="M120 26 l40 22 -40 22 -40-22 z" className="stadium-line" fill="none" />
    </svg>
  );
}
