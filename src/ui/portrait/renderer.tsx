/**
 * PHASE 4.5 肖像の組み立て（§5 レイヤー順）。
 *
 * 外部の画像ファイルもCDNも使わない。すべてその場で描く SVG。
 * 部品の選び方は playerId のハッシュだけで決まるので、
 * 同じ選手なら、どの画面でも・何度開いても・別のセーブでも同じ人物になる。
 *
 * 描く順番（下から上）：
 *   背景 → 体 → ユニフォーム → 首 → 耳 → 頭 → 髪(後)
 *   → 顔の陰 → 眉 → 目 → 鼻 → 口 → ひげ → 髪(前) → 帽子 → 小物
 */
import { useMemo } from 'react';
import type { PlayerAppearance, PortraitOptions, PortraitSize } from './types';
import { CAP_BRIM_Y, CENTER_X, EYE_Y, SIZE_CROP, SIZE_PX, VIEW_H, VIEW_W } from './types';
import { HAIR_FILL, HAIR_SHADE, SKIN_FILL, SKIN_SHADE } from './palette';
import { headGeometry } from './parts/heads';
import { Eyes } from './parts/eyes';
import { Eyebrows } from './parts/eyebrows';
import { Nose } from './parts/noses';
import { Mouth } from './parts/mouths';
import { Ears } from './parts/ears';
import { Jaw } from './parts/jaws';
import { HairBack, HairFringe, HairFull, HairSides } from './parts/hair';
import { FacialHair } from './parts/facialHair';
import { Arms, Body, Neck } from './parts/bodies';
import { Accessories, Cap, Helmet } from './parts/accessories';
import { resolveCompatibility } from './compatibility';
import type { PartContext } from './types';

/*
 * 表示範囲。頭のまわりの余白を詰めて、小さく置いても顔が読めるようにする。
 *   bust … 頭と肩（一覧・ニュース・ホーム）
 *   full … 腕とポーズまで（選手詳細・ドラフト・見せ場）
 */
const BUST_BOX = { x: 32, y: 20, w: 192, h: 206 };
const FULL_BOX = { x: 18, y: 4, w: 220, h: 316 };
const BUST_VIEWBOX = `${BUST_BOX.x} ${BUST_BOX.y} ${BUST_BOX.w} ${BUST_BOX.h}`;
const FULL_VIEWBOX = `${FULL_BOX.x} ${FULL_BOX.y} ${FULL_BOX.w} ${FULL_BOX.h}`;

/** そのサイズでの表示高さ（幅から縦横比で決める） */
function boxHeight(px: number, crop: 'bust' | 'full'): number {
  const box = crop === 'bust' ? BUST_BOX : FULL_BOX;
  return Math.round((px * box.h) / box.w);
}

/**
 * 完成した肖像を1枚描く。
 *
 * 同じ appearance・同じ表情・同じポーズなら、必ず同じ絵になる。
 */
export function PortraitSvg({
  appearance,
  name,
  options = {},
}: {
  appearance: PlayerAppearance;
  /** 読み上げ用。画像だけで情報を伝えないため必ず受け取る（§36） */
  name: string;
  options?: PortraitOptions;
}) {
  const size: PortraitSize = options.size ?? 'medium';
  const expression = options.expression ?? 'neutral';
  const pose = options.pose ?? 'pose_idle';
  const showCap = options.showCap ?? true;
  const showUniform = options.showUniform ?? true;
  const crop = SIZE_CROP[size];
  const px = SIZE_PX[size];

  // 相性の悪い組み合わせだけを直してから描く
  const look = useMemo(() => resolveCompatibility(appearance), [appearance]);

  const ctx: PartContext = useMemo(
    () => ({
      geo: headGeometry(look.head),
      skin: SKIN_FILL[look.skin] ?? SKIN_FILL.skin_03,
      skinShade: SKIN_SHADE[look.skin] ?? SKIN_SHADE.skin_03,
      hair: HAIR_FILL[look.hairColor] ?? HAIR_FILL.hairc_01_black,
      hairShade: HAIR_SHADE[look.hairColor] ?? HAIR_SHADE.hairc_01_black,
      ink: 'var(--ink)',
      expression,
      capped: showCap,
    }),
    [look, expression, showCap],
  );

  const headwear = pose === 'pose_bat' && size !== 'small' ? 'helmet' : 'cap';
  const capColor = options.teamColor ?? 'var(--ink-2)';
  const label = `${name}の肖像`;

  return (
    <svg
      className={[
        'portrait',
        `portrait-${size}`,
        `portrait-x-${expression}`,
        options.animate ? 'portrait-reveal' : '',
        options.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      viewBox={crop === 'bust' ? BUST_VIEWBOX : FULL_VIEWBOX}
      width={px}
      height={boxHeight(px, crop)}
      role="img"
      aria-label={label}
    >
      {/* 01 背景。紙の色のまま置く（球団色で塗りつぶさない） */}
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="pt-paper" />

      {/* 05 首 */}
      <Neck id={look.body} ctx={ctx} />

      {/* 04 ユニフォーム */}
      {showUniform && <Body appearance={look} teamColor={options.teamColor} pose={pose} />}

      {/* 03 腕。大きい表示だけ、ユニフォームの上に重ねてポーズを見せる */}
      {crop === 'full' && (
        <g className="pt-layer-arms">
          <Arms appearance={look} pose={pose} />
        </g>
      )}

      {/* 08 髪（後ろ） */}
      <HairBack id={look.hair} ctx={ctx} />

      {/* 06 耳 */}
      <Ears id={look.ears} ctx={ctx} />

      {/* 07 頭 */}
      <path d={ctx.geo.path} fill={ctx.skin} className="pt-line" />

      {/* 09 顔の陰・骨格 */}
      <Jaw id={look.jaw} ctx={ctx} />
      <AgeLines count={look.ageLines} ctx={ctx} />

      {/* 10-13 顔の部品 */}
      <Eyebrows id={look.eyebrows} ctx={ctx} />
      <Eyes id={look.eyes} ctx={ctx} />
      <Nose id={look.nose} ctx={ctx} />
      <Mouth id={look.mouth} ctx={ctx} />

      {/* 14 ひげ */}
      <FacialHair id={look.facialHair} ctx={ctx} />

      {/* 15 髪（前）。帽子の有無で描き分ける */}
      {showCap ? (
        <>
          <HairSides id={look.hair} ctx={ctx} />
          <HairFringe id={look.hair} ctx={ctx} />
        </>
      ) : (
        <HairFull id={look.hair} ctx={ctx} />
      )}

      {/* 16 帽子 */}
      {showCap &&
        (headwear === 'helmet' ? <Helmet ctx={ctx} color={capColor} /> : <Cap ctx={ctx} color={capColor} />)}

      {/* 17 小物 */}
      <Accessories ids={look.accessories} ctx={ctx} />
    </svg>
  );
}

/** 年輪。線を1〜2本足すだけで、別人にはしない */
function AgeLines({ count, ctx }: { count: number; ctx: PartContext }) {
  if (count <= 0) return null;
  const cx = CENTER_X;
  const gap = ctx.geo.eyeGap;
  return (
    <g className="pt-age-lines">
      {/* 目尻の線 */}
      <path d={`M ${cx - gap - 13} ${EYE_Y + 7} l -6 5`} />
      <path d={`M ${cx + gap + 13} ${EYE_Y + 7} l 6 5`} />
      {count >= 2 && (
        <>
          {/* 口元の線 */}
          <path d={`M ${cx - 20} ${EYE_Y + 36} q -4 12 -1 20`} />
          <path d={`M ${cx + 20} ${EYE_Y + 36} q 4 12 1 20`} />
          {/* 額の線 */}
          <path d={`M ${cx - 22} ${CAP_BRIM_Y + 20} q 22 -5 44 0`} />
        </>
      )}
    </g>
  );
}

/**
 * 部品を用意できない場合のかたち（§35）。
 * 「画像がありません」とは出さず、同じ世界の統一されたシルエットを出す。
 */
export function PortraitFallbackSvg({
  name,
  size = 'medium',
  className,
}: {
  name: string;
  size?: PortraitSize;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const crop = SIZE_CROP[size];
  return (
    <svg
      className={['portrait', `portrait-${size}`, 'portrait-fallback', className ?? ''].filter(Boolean).join(' ')}
      viewBox={crop === 'bust' ? BUST_VIEWBOX : FULL_VIEWBOX}
      width={px}
      height={boxHeight(px, crop)}
      role="img"
      aria-label={`${name}の肖像は用意されていません`}
    >
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="pt-paper" />
      <circle cx={CENTER_X} cy="132" r="62" className="pt-silhouette" />
      <path d={`M 30 ${VIEW_H} q 0 -80 98 -80 q 98 0 98 80 z`} className="pt-silhouette" />
    </svg>
  );
}
