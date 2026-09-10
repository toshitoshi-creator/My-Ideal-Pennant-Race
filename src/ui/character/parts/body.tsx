/**
 * PHASE 4.8-A 体と首とユニフォーム（§13）。
 *
 * 体は顔とは別のレイヤー（§13）。
 * 頭を変えても体の位置が壊れないよう、体は首のアンカーから組み立てる。
 * 首から下の基準線（neckTop / shoulderLine / bodyBottom）は
 * 頭の形では動かさないので、どの頭を載せても接続が保たれる。
 */
import type { CharacterPart, CharacterRenderContext } from '../types';
import { STROKE } from '../coordinates';

interface BodyShape {
  /** 肩幅の半分 */
  shoulder: number;
  /** 胴の厚み（腰の幅の半分） */
  waist: number;
  /** 肩の傾き。大きいほどなで肩 */
  slope: number;
}

/** 首。頭と体をつなぐ。頭より必ず細い */
export const NECK_PARTS: CharacterPart[] = [
  {
    id: 'neck_01',
    category: 'neck',
    label: '標準',
    render: (context) => {
      const { guides, anchors, palette } = context;
      const cx = guides.centerX;
      // 頭のあごから首のつけねまで。頭が縦長でも隙間ができないよう少し重ねる
      const top = Math.min(anchors.headBottom.y - 6, guides.neckTop);
      return (
        <path
          d={`M ${cx - 17} ${top} L ${cx - 19} ${guides.shoulderLine} L ${cx + 19} ${guides.shoulderLine} L ${cx + 17} ${top} Z`}
          fill={palette.skinShadow}
          stroke={palette.outline}
          strokeWidth={STROKE.secondary}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    },
  },
];

function bodyRender(context: CharacterRenderContext, shape: BodyShape) {
  const { guides, palette } = context;
  const cx = guides.centerX;
  const shoulderY = guides.shoulderLine;
  const bottom = guides.bodyBottom;
  const { shoulder, waist, slope } = shape;

  return (
    <g>
      {/* 胴。肩から下へ、腰でわずかに絞る */}
      <path
        d={[
          `M ${cx - shoulder} ${shoulderY + slope}`,
          `Q ${cx - shoulder - 3} ${shoulderY - 6} ${cx - shoulder * 0.45} ${shoulderY - 9}`,
          `L ${cx + shoulder * 0.45} ${shoulderY - 9}`,
          `Q ${cx + shoulder + 3} ${shoulderY - 6} ${cx + shoulder} ${shoulderY + slope}`,
          `L ${cx + waist} ${bottom}`,
          `L ${cx - waist} ${bottom}`,
          'Z',
        ].join(' ')}
        fill={palette.uniform}
        stroke={palette.outline}
        strokeWidth={STROKE.outer}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 腕。肩の外側から下へ */}
      {([-1, 1] as const).map((dir) => (
        <path
          key={dir}
          d={[
            `M ${cx + dir * shoulder} ${shoulderY + slope}`,
            `Q ${cx + dir * (shoulder + 8)} ${shoulderY + 38} ${cx + dir * (shoulder + 2)} ${bottom - 18}`,
            `L ${cx + dir * (shoulder - 10)} ${bottom - 18}`,
            `Q ${cx + dir * (shoulder - 6)} ${shoulderY + 30} ${cx + dir * (shoulder - 9)} ${shoulderY + slope + 4}`,
            'Z',
          ].join(' ')}
          fill={palette.uniform}
          stroke={palette.outline}
          strokeWidth={STROKE.secondary}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function makeBody(id: string, label: string, shape: BodyShape): CharacterPart {
  return { id, category: 'body', label, render: (context) => bodyRender(context, shape) };
}

/** 体5種類（§13） */
export const BODY_PARTS: CharacterPart[] = [
  makeBody('body_01', '細身', { shoulder: 38, waist: 31, slope: 3 }),
  makeBody('body_02', '標準', { shoulder: 43, waist: 35, slope: 2 }),
  makeBody('body_03', '筋肉質', { shoulder: 50, waist: 38, slope: 0 }),
  makeBody('body_04', '大型', { shoulder: 55, waist: 48, slope: 1 }),
  makeBody('body_05', 'がっしり', { shoulder: 49, waist: 44, slope: 4 }),
];

/**
 * ユニフォームの飾り（前立てとベルト）。
 * 体とは別レイヤーなので、体型を変えても飾りの位置は基準線から決まる。
 */
export const UNIFORM_PARTS: CharacterPart[] = [
  {
    id: 'uniform_01',
    category: 'uniform',
    label: '標準',
    render: (context) => {
      const { guides, palette } = context;
      const cx = guides.centerX;
      const beltY = guides.shoulderLine + 74;
      return (
        <g>
          {/* 前立て */}
          <path
            d={`M ${cx} ${guides.shoulderLine - 6} L ${cx} ${beltY}`}
            fill="none"
            stroke={palette.uniformShadow}
            strokeWidth={STROKE.detail}
            vectorEffect="non-scaling-stroke"
          />
          {/* ベルト。球団色が入る唯一の場所 */}
          <rect
            x={cx - 40}
            y={beltY}
            width={80}
            height={9}
            fill={palette.uniformSecondary}
            stroke={palette.outline}
            strokeWidth={STROKE.detail}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    },
  },
];
