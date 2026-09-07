/**
 * PHASE 4.5 選手の資料写真（§6・§7）。
 *
 * 外部の画像ファイルは読み込まない。輪郭・髪・ひげ・体格の部品を組み合わせて
 * その場で描く SVG の肖像で、部品の選び方は playerId のハッシュだけで決まる。
 * つまり同じ選手なら、どの画面でも・何度開いても・別のセーブでも同じ顔になる（§7）。
 *
 * こうした理由：
 *   - オフラインで確実に出る（CDN が落ちても選手は消えない。§34）
 *   - 実在の球団・選手の写真を一切使わない（§35）
 *   - 単一HTMLのまま配布できる（§33）
 *   - 300〜800人ぶんの顔を、重複なく持てる
 *
 * 描き方は「インクで刷った選手名鑑の写真」。色数を絞り、線で描く（§36）。
 */
import type { PlayerVisual } from '../../../domain/visuals';
import { MOOD_CAPTIONS } from '../../../domain/visuals';

/** 肌・髪の色は紙とインクの世界に合わせた限られた段階（§28） */
const SKIN = ['var(--skin-1)', 'var(--skin-2)', 'var(--skin-3)', 'var(--skin-4)'];
const HAIR = ['var(--hair-1)', 'var(--hair-2)', 'var(--hair-3)'];

export type PortraitSize = 'sm' | 'md' | 'lg';

const BOX: Record<PortraitSize, number> = { sm: 44, md: 96, lg: 168 };

/**
 * 顔だけの肖像。名鑑・一覧・ニュースなど、どこでも同じ顔が出る。
 */
export function PlayerPortrait({
  visual,
  name,
  size = 'md',
  teamColor,
  className,
}: {
  visual: PlayerVisual;
  /** 読み上げ用。画像だけで情報を伝えないため必ず受け取る（§44） */
  name: string;
  size?: PortraitSize;
  /** 帽子の色。未所属なら渡さない */
  teamColor?: string;
  className?: string;
}) {
  const box = BOX[size];
  const skin = SKIN[visual.skin % SKIN.length];
  const hair = HAIR[visual.hairTone % HAIR.length];
  const cap = teamColor ?? 'var(--ink-2)';
  const caption = MOOD_CAPTIONS[visual.mood];

  // 輪郭：頭の幅とあごの丸みを4種類。楕円を基本にして崩れないようにする
  const rx = [9.2, 10.3, 11.4, 12.4][visual.face];
  const chin = [41.4, 40.4, 39.6, 38.8][visual.face];
  const eyeY = 26;

  return (
    <svg
      className={`portrait portrait-${size} portrait-${visual.mood.toLowerCase()}${
        className ? ` ${className}` : ''
      }`}
      viewBox="0 0 48 52"
      width={box}
      height={(box * 52) / 48}
      role="img"
      aria-label={`${name}の資料写真（${caption.ja}）`}
    >
      {/* 台紙。資料に貼られた写真 */}
      <rect x="0" y="0" width="48" height="52" className="portrait-paper" />

      {/* 肩（ユニフォーム）。体格で幅を変える */}
      <path d="M21.4 37 h5.2 v6 h-5.2 z" fill={skin} />
      <path
        d={
          visual.build === 2
            ? 'M5 52 q0-10 19-10 q19 0 19 10 z'
            : visual.build === 0
              ? 'M11 52 q0-8 13-8 q13 0 13 8 z'
              : 'M8 52 q0-9 16-9 q16 0 16 9 z'
        }
        className="portrait-jersey"
      />

      {/* 顔。頭頂は楕円、あごは少しすぼめる */}
      <path
        d={`M${24 - rx} ${eyeY - 2}
            a${rx} ${rx + 2} 0 0 1 ${rx * 2} 0
            v4
            q0 ${chin - eyeY - 2} ${-rx} ${chin - eyeY - 2}
            q${-rx} 0 ${-rx} ${-(chin - eyeY - 2)}
            z`}
        fill={skin}
        className="portrait-line"
      />

      {/*
        髪。帽子をかぶっているときは「帽子から出ている部分」だけを描く。
        ここを帽子より先に描いてしまうと全員が同じ顔に見えてしまう。
      */}
      <HairStyle style={visual.hair} color={hair} rx={rx} capped={visual.cap} />

      {/* 帽子。髪の上にかぶせる */}
      {visual.cap && <Cap color={cap} dark={visual.build === 2} rx={rx} />}

      {/* 耳。輪郭の少し内側に、小さく添える */}
      <ellipse cx={24 - rx + 0.5} cy={eyeY + 1.5} rx="1.15" ry="1.9" fill={skin} className="portrait-line" />
      <ellipse cx={24 + rx - 0.5} cy={eyeY + 1.5} rx="1.15" ry="1.9" fill={skin} className="portrait-line" />

      {/* もみあげ。耳の前に細く落ちる */}
      {visual.cap && <SideHair style={visual.hair} color={hair} rx={rx} />}

      {/* 眉と目 */}
      <Brows kind={visual.brow} color={hair} />
      <ellipse cx={24 - rx * 0.34} cy={eyeY} rx="1.25" ry="1.45" className="portrait-eye" />
      <ellipse cx={24 + rx * 0.34} cy={eyeY} rx="1.25" ry="1.45" className="portrait-eye" />

      {/* 鼻。中心に短く */}
      <path d="M24 27.4 v3 q0 .7 1.1 .7" className="portrait-stroke" />
      <Mouth mood={visual.mood} />

      {/* ひげ */}
      <Beard kind={visual.beard} color={hair} />

    </svg>
  );
}

/** 髪型8種。7 は薄毛（年齢が上の選手に出る） */
function HairStyle({
  style,
  color,
  rx,
  capped,
}: {
  style: number;
  color: string;
  rx: number;
  capped: boolean;
}) {
  const l = 24 - rx;
  const r = 24 + rx;
  const w = rx * 2;
  // 帽子をかぶるときは、つばの下から覗く前髪だけを描く（髪型で量が変わる）
  if (capped) {
    if (style === 7) return null; // 薄毛は覗かない
    const drop = [1.6, 2.4, 0.9, 3.0, 3.4, 0.6, 2.8, 0][style];
    if (drop <= 0) return null;
    return (
      <path
        d={`M${l + 0.6} 20.3 q${rx - 0.6} ${drop * 1.5} ${w - 1.2} 0 v-3 h-${w - 1.2} z`}
        fill={color}
      />
    );
  }
  switch (style) {
    case 0: // 短髪
      return <path d={`M${l} 24 q0-13 ${rx} -13 q${rx} 0 ${rx} 13 q-2-7-${rx}-7 q-${rx} 0 -${rx} 7 z`} fill={color} />;
    case 1: // 分け目
      return <path d={`M${l} 24 q0-13 ${rx} -13 q${rx} 0 ${rx} 13 q-2-8-9-8 q-8 0-11 8 z`} fill={color} />;
    case 2: // 角刈り
      return <path d={`M${l} 21 h${w} v-3 q0-9-${rx}-9 q-${rx} 0 -${rx} 9 z`} fill={color} />;
    case 3: // ボリューム
      return <path d={`M${l - 1.2} 25 q0-15 ${rx + 1.2} -15 q${rx + 1.2} 0 ${rx + 1.2} 15 q-3-9-${rx + 1.2}-9 q-${rx + 1.2} 0 -${rx + 1.2} 9 z`} fill={color} />;
    case 4: // 直毛前髪
      return <path d={`M${l} 23 q0-12 ${rx} -12 q${rx} 0 ${rx} 12 l-1.6-4 h-${w - 3.2} z`} fill={color} />;
    case 5: // 刈り上げ
      return <path d={`M${l + 1} 20 q0-11 ${rx - 1} -11 q${rx - 1} 0 ${rx - 1} 11 z`} fill={color} />;
    case 6: // くせ毛
      return (
        <path
          d={`M${l} 24 q0-14 ${rx} -13 q${rx} -1 ${rx} 13 q-2-4-4-6 q-2 4-5 1 q-3 4-5-1 q-2 2-4 6 z`}
          fill={color}
        />
      );
    default: // 薄毛
      return (
        <path
          d={`M${l} 24 q.5-6 3-8 q-.6 4-.6 8 z M${r} 24 q-.5-6-3-8 q.6 4 .6 8 z`}
          fill={color}
        />
      );
  }
}

/**
 * 帽子の下から見えるもみあげと襟足。
 * 髪型ごとに長さが違うので、帽子をかぶっていても選手の見分けがつく。
 */
function SideHair({ style, color, rx }: { style: number; color: string; rx: number }) {
  if (style === 7) return null; // 薄毛
  const len = [2.2, 3.0, 1.2, 4.0, 2.6, 0.8, 4.6, 0][style];
  if (len <= 0) return null;
  const l = 24 - rx + 1.6;
  const r = 24 + rx - 1.6;
  return (
    <g fill={color}>
      <path d={`M${l - 1.1} 21.8 h1.5 v${len} q-.75 .9-1.5 0 z`} />
      <path d={`M${r - 0.4} 21.8 h1.5 v${len} q-.75 .9-1.5 0 z`} />
    </g>
  );
}

function Brows({ kind, color }: { kind: number; color: string }) {
  const d = [
    'M18.3 22.8 h4.6 M25.1 22.8 h4.6',
    'M18.3 23.4 l4.6-1.1 M25.1 22.3 l4.6 1.1',
    'M18.3 22.3 l4.6 1 M25.1 23.3 l4.6-1',
    'M18.4 22.9 q2.3-1.3 4.4 0 M25.2 22.9 q2.3-1.3 4.4 0',
  ][kind];
  return <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />;
}

/** 口は「空気」だけを変える。能力や評価とは無関係（§10） */
function Mouth({ mood }: { mood: PlayerVisual['mood'] }) {
  const d =
    mood === 'HOT'
      ? 'M21.2 33.6 q2.8 2.4 5.6 0'
      : mood === 'SLUMP' || mood === 'INJURED'
        ? 'M21.2 34.4 q2.8-1.8 5.6 0'
        : 'M21.4 34 h5.2';
  return <path d={d} className="portrait-stroke" />;
}

function Beard({ kind, color }: { kind: number; color: string }) {
  if (kind === 0) return null;
  if (kind === 1) {
    // 無精ひげ
    return <path d="M16.6 30 q7.4 10.5 14.8 0 q-7.4 6-14.8 0 z" fill={color} opacity="0.22" />;
  }
  if (kind === 2) {
    // 口ひげ
    return <path d="M21 32.3 q3-1.4 6 0 q-3 1.2-6 0 z" fill={color} />;
  }
  // あごひげ
  return <path d="M17.8 30.6 q6.2 11.5 12.4 0 q-6.2 8-12.4 0 z" fill={color} opacity="0.7" />;
}

function Cap({ color, dark, rx }: { color: string; dark: boolean; rx: number }) {
  const l = 24 - rx - 0.8;
  const w = (rx + 0.8) * 2;
  return (
    <>
      <path d={`M${l} 18 q0-11 ${rx + 0.8} -11 q${rx + 0.8} 0 ${rx + 0.8} 11 z`} fill={color} className="portrait-line" />
      <path
        d={`M${l} 18 h${w} q3.2 0 3.2 2.2 h-${w + 6.4} q0-2.2 3.2-2.2 z`}
        fill={color}
        className="portrait-line"
        opacity={dark ? 1 : 0.85}
      />
      {/* 中央の縫い目。帽子だと分かるように、ごく細く */}
      <path d="M24 7.6 v4" stroke="var(--paper)" strokeWidth="0.8" opacity="0.5" />
    </>
  );
}

/**
 * 画像を用意できない場合のかたち（§8）。
 * 「画像がありません」とは出さず、統一されたシルエットを出す。
 */
export function PortraitFallback({
  name,
  size = 'md',
}: {
  name: string;
  size?: PortraitSize;
}) {
  const box = BOX[size];
  return (
    <svg
      className={`portrait portrait-${size} portrait-fallback`}
      viewBox="0 0 48 52"
      width={box}
      height={(box * 52) / 48}
      role="img"
      aria-label={`${name}の資料写真は用意されていません`}
    >
      <rect x="0" y="0" width="48" height="52" className="portrait-paper" />
      <circle cx="24" cy="22" r="10" className="portrait-silhouette" />
      <path d="M8 52 q0-13 16-13 q16 0 16 13 z" className="portrait-silhouette" />
    </svg>
  );
}
