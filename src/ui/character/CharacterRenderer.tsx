/**
 * PHASE 4.8-A キャラクターを描く（§23）。
 *
 * 責務は5つだけ。
 *   1. 設計図（CharacterProfile）を受け取る
 *   2. パーツを引く
 *   3. 基準線とアンカーを計算する
 *   4. **決まった順番で** 重ねる
 *   5. 色を配る
 *
 * ここが順番を一元管理します（§6）。パーツは自分の順番を知りません。
 * 頭の形による基準線の調整もここでやります。
 * だから、どの頭にどの目を載せても位置が合います。
 */
import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { CharacterProfile } from '../../domain/characterProfile';
import {
  CHARACTER_GUIDES,
  CHARACTER_LAYERS,
  CHARACTER_VIEW_BOX,
  adjustGuides,
  anchorsFrom,
  type CharacterLayer,
} from './coordinates';
import { buildPalette } from './palette';
import { partAt } from './registry';
import type { CharacterExpression, CharacterPartCategory, CharacterRenderContext } from './types';

/** どの層をどの種類のパーツが埋めるか。ここだけが対応を知っている */
const LAYER_SOURCE: Record<CharacterLayer, CharacterPartCategory | null> = {
  backHair: 'hairBack',
  backEar: null,
  neck: 'neck',
  body: 'body',
  uniform: 'uniform',
  frontEar: 'ear',
  head: 'head',
  beard: 'beard',
  eyes: 'eye',
  eyebrows: 'eyebrow',
  nose: 'nose',
  mouth: 'mouth',
  frontHair: 'hairFront',
  cap: 'cap',
  accessory: 'accessory',
  expression: 'expression',
};

/**
 * 層につける印。
 *
 * PHASE 4.5 の肖像と **同じ名前** を使います。
 * 画面の CSS も E2E も、この名前で顔の部品を見つけています。
 * 描き方を入れ替えても、外から見た名前は変えない、という約束です。
 */
const LAYER_CLASS: Partial<Record<CharacterLayer, string>> = {
  eyes: 'pt-eyes',
  eyebrows: 'pt-brows',
  nose: 'pt-nose',
  mouth: 'pt-mouth',
  frontEar: 'pt-ears',
  frontHair: 'pt-hair',
  backHair: 'pt-hair-back',
  head: 'pt-head',
  body: 'pt-body',
  cap: 'pt-cap',
};

/** 設計図のどの番号がその種類を選ぶか */
const PROFILE_KEY: Partial<Record<CharacterPartCategory, keyof CharacterProfile>> = {
  head: 'head',
  body: 'body',
  hairBack: 'hair',
  hairFront: 'hair',
  ear: 'ears',
  neck: 'head',
  eyebrow: 'eyebrow',
  eye: 'eyes',
  nose: 'nose',
  mouth: 'mouth',
  beard: 'beard',
  cap: 'cap',
  uniform: 'body',
};

export interface CharacterRendererProps {
  profile: CharacterProfile;
  /** 表示幅（px）。高さは 320/256 の比で決まる */
  width: number;
  expression?: CharacterExpression;
  showCap?: boolean;
  /** 球団色。ユニフォームのベルトと帽子に入る */
  teamColor?: string | undefined;
  className?: string;
  /** 開発時だけ。基準線を重ねて見せる（§24） */
  debug?: boolean;
  title?: string;
}

/**
 * 1人を描く。
 *
 * 同じ設計図からは必ず同じ絵が出ます（乱数も時刻も使いません）。
 */
export const CharacterRenderer = memo(function CharacterRenderer({
  profile,
  width,
  expression = 'neutral',
  showCap = true,
  teamColor,
  className,
  debug = false,
  title,
}: CharacterRendererProps) {
  const height = Math.round((width * 320) / 256);

  const { layers, context } = useMemo(() => {
    // 1. 頭を先に引く。頭が基準線を動かすので、他より先に決める必要がある
    const head = partAt('head', profile.head);

    // 2. 基準線を頭に合わせて調整し、アンカーを導く
    const guides = head?.guideAdjustment
      ? adjustGuides(CHARACTER_GUIDES, head.guideAdjustment)
      : CHARACTER_GUIDES;
    // 頭が申告する基準点（耳の位置など）を重ねる。頭の幅に耳がついてくる
    const anchors = { ...anchorsFrom(guides), ...(head?.anchorsFor?.(guides) ?? {}) };

    // 3. 色を組み立てる
    const palette = buildPalette({
      skin: profile.skin,
      hairColor: profile.hairColor,
      teamColor,
    });

    const renderContext: CharacterRenderContext = {
      guides,
      anchors,
      palette,
      hasCap: showCap,
      expression,
    };

    // 4. 決まった順番で重ねる
    const drawn: ReactNode[] = [];
    for (const layer of CHARACTER_LAYERS) {
      const category = LAYER_SOURCE[layer];
      if (!category) continue;
      if (category === 'cap' && !showCap) continue;

      const key = PROFILE_KEY[category];
      const index = key ? (profile[key] as number) : 0;
      const part = partAt(category, index);
      if (!part) continue;

      const node = part.render(renderContext);
      if (node === null || node === undefined) continue;
      const mark = LAYER_CLASS[layer];
      drawn.push(
        <g key={layer} data-layer={layer} data-part={part.id} {...(mark ? { className: mark } : {})}>
          {node}
        </g>,
      );
    }

    return { layers: drawn, context: renderContext };
  }, [profile, expression, showCap, teamColor]);

  return (
    <svg
      viewBox={CHARACTER_VIEW_BOX}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={title ?? '選手'}
      /*
       * はみ出しは切る。行の高さが崩れるのを防ぐため（styles.css の .portrait と同じ）。
       * パーツはすべて 256x320 の中に収まるよう作ってあるので、切れるものは無い。
       */
      style={{ display: 'block', overflow: 'hidden' }}
    >
      {title ? <title>{title}</title> : null}
      {layers}
      {debug ? <CharacterDebugOverlay context={context} profile={profile} /> : null}
    </svg>
  );
});

/* ================================================================
 * デバッグ表示（§24）
 * ============================================================== */

interface DebugProps {
  context: CharacterRenderContext;
  profile: CharacterProfile;
}

/**
 * 基準線とアンカーを重ねて見せる。
 *
 * **開発時だけ。** 本番のUIからは debug を渡さないので出ません（§24）。
 * パーツのずれは、目で見るより線を引いたほうが早く見つかります。
 */
export function CharacterDebugOverlay({ context, profile }: DebugProps): ReactNode {
  const { guides, anchors } = context;
  const lines: Array<{ y: number; label: string }> = [
    { y: guides.headTop, label: 'headTop' },
    { y: guides.eyebrowLine, label: 'eyebrow' },
    { y: guides.eyeLine, label: 'eye' },
    { y: guides.noseLine, label: 'nose' },
    { y: guides.mouthLine, label: 'mouth' },
    { y: guides.chinLine, label: 'chin' },
    { y: guides.neckTop, label: 'neck' },
    { y: guides.shoulderLine, label: 'shoulder' },
  ];
  const points = [
    anchors.leftEye,
    anchors.rightEye,
    anchors.nose,
    anchors.mouth,
    anchors.capBase,
    anchors.brim,
    anchors.leftEar,
    anchors.rightEar,
  ];

  return (
    <g data-debug="character" pointerEvents="none">
      {lines.map((line) => (
        <g key={line.label}>
          <line
            x1={0}
            y1={line.y}
            x2={256}
            y2={line.y}
            stroke="#e0245e"
            strokeWidth={0.6}
            opacity={0.65}
          />
          <text x={2} y={line.y - 1.5} fill="#e0245e" fontSize={6}>
            {line.label} {line.y}
          </text>
        </g>
      ))}
      <line
        x1={guides.centerX}
        y1={0}
        x2={guides.centerX}
        y2={320}
        stroke="#1d9bf0"
        strokeWidth={0.6}
        opacity={0.65}
      />
      {points.map((point, i) => (
        <circle key={i} cx={point.x} cy={point.y} r={1.6} fill="#1d9bf0" />
      ))}
      <text x={2} y={316} fill="#1d9bf0" fontSize={6}>
        head{profile.head} body{profile.body} hair{profile.hair} eye{profile.eyes} brow
        {profile.eyebrow} nose{profile.nose} mouth{profile.mouth} cap{profile.cap}
      </text>
    </g>
  );
}
