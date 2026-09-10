/**
 * PHASE 4.8-A 頭（§12）。5種類。
 *
 * **単なる拡大縮小は禁止**（§12）。輪郭そのものを変える。
 * 丸型・卵型・横広・縦長・下顎広めの5つを、別々の path で描く。
 *
 * 各頭は guideAdjustment を持つ。
 * 顔を縦長にすれば目も鼻も口もついてくるので、
 * 造作の側を頭ごとに直す必要がない（これが AI 画像でできなかったこと）。
 */
import type { CharacterPart, CharacterRenderContext } from '../types';
import { STROKE, headCenterY } from '../coordinates';

/**
 * 頭の輪郭を描く。
 *
 * 形は「半分の幅」「顎の張り」「頭頂の丸み」の3つで決める。
 * 数値は基準線から組み立てるので、頭が動けば輪郭も動く。
 */
function headPath(
  context: CharacterRenderContext,
  shape: { halfWidth: number; jawWidth: number; crown: number; jawRound: number },
): string {
  const { guides } = context;
  const cx = guides.centerX;
  const top = guides.headTop;
  const bottom = guides.headBottom;
  const cy = headCenterY(guides);
  const { halfWidth, jawWidth, crown, jawRound } = shape;

  // 上半分は頭頂の丸み、下半分は顎の張りで決まる
  return [
    `M ${cx - halfWidth} ${cy}`,
    `C ${cx - halfWidth} ${top + crown}, ${cx - halfWidth * 0.72} ${top}, ${cx} ${top}`,
    `C ${cx + halfWidth * 0.72} ${top}, ${cx + halfWidth} ${top + crown}, ${cx + halfWidth} ${cy}`,
    `C ${cx + halfWidth} ${cy + jawRound}, ${cx + jawWidth} ${bottom - 6}, ${cx} ${bottom}`,
    `C ${cx - jawWidth} ${bottom - 6}, ${cx - halfWidth} ${cy + jawRound}, ${cx - halfWidth} ${cy}`,
    'Z',
  ].join(' ');
}

/** 頬の陰。顔の下側に薄く入れて立体感を出す */
function cheekShadow(context: CharacterRenderContext, halfWidth: number): string {
  const { guides } = context;
  const cx = guides.centerX;
  const bottom = guides.headBottom;
  const cy = headCenterY(guides);
  return [
    `M ${cx - halfWidth * 0.86} ${cy + 6}`,
    `C ${cx - halfWidth * 0.8} ${cy + 30}, ${cx - halfWidth * 0.4} ${bottom - 4}, ${cx} ${bottom - 2}`,
    `C ${cx + halfWidth * 0.4} ${bottom - 4}, ${cx + halfWidth * 0.8} ${cy + 30}, ${cx + halfWidth * 0.86} ${cy + 6}`,
    `C ${cx + halfWidth * 0.6} ${cy + 20}, ${cx - halfWidth * 0.6} ${cy + 20}, ${cx - halfWidth * 0.86} ${cy + 6}`,
    'Z',
  ].join(' ');
}

function makeHead(
  id: string,
  label: string,
  shape: { halfWidth: number; jawWidth: number; crown: number; jawRound: number },
  guideAdjustment?: CharacterPart['guideAdjustment'],
): CharacterPart {
  return {
    id,
    category: 'head',
    label,
    ...(guideAdjustment ? { guideAdjustment } : {}),
    /*
     * 耳は「この頭の幅」に付く。
     *
     * 耳の位置を全体の固定値にしていたら、細い顔で耳が離れて浮いた。
     * 頭が自分の幅を申告して、耳はそれを見る。
     * これがアンカーを規格にした理由そのもの（§5）。
     */
    anchorsFor: (guides) => {
      const cy = headCenterY(guides);
      // 輪郭のいちばん外側。髪・耳・帽子はこれだけを見る
      const edge = shape.halfWidth;
      // 耳は目の少し下、輪郭のふくらみに合わせて内へ寄せる
      const earY = guides.eyeLine + 8;
      const earX = edge - 2;
      return {
        leftTemple: { x: guides.centerX - edge, y: cy },
        rightTemple: { x: guides.centerX + edge, y: cy },
        leftEar: { x: guides.centerX - earX, y: earY },
        rightEar: { x: guides.centerX + earX, y: earY },
      };
    },
    render: (context) => (
      <g>
        <path
          d={headPath(context, shape)}
          fill={context.palette.skin}
          stroke={context.palette.outline}
          strokeWidth={STROKE.outer}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d={cheekShadow(context, shape.halfWidth)} fill={context.palette.skinShadow} opacity={0.5} />
      </g>
    ),
  };
}

/**
 * 5種類（§12）。
 *
 * halfWidth  … 顔の横幅の半分
 * jawWidth   … あごの張り出し（小さいほど尖る）
 * crown      … 頭頂の丸み（小さいほど角ばる）
 * jawRound   … 頬から顎への曲がり方
 */
export const HEAD_PARTS: CharacterPart[] = [
  makeHead('head_01', '丸型', { halfWidth: 63, jawWidth: 44, crown: 12, jawRound: 34 }),
  makeHead('head_02', '卵型', { halfWidth: 58, jawWidth: 30, crown: 6, jawRound: 28 }, {
    faceScaleY: 1.04,
  }),
  makeHead('head_03', '横広', { halfWidth: 70, jawWidth: 52, crown: 18, jawRound: 38 }, {
    faceScaleY: 0.92,
  }),
  makeHead('head_04', '縦長', { halfWidth: 54, jawWidth: 32, crown: 8, jawRound: 24 }, {
    faceScaleY: 1.14,
    chinShift: 4,
  }),
  makeHead('head_05', '下顎広め', { halfWidth: 60, jawWidth: 56, crown: 14, jawRound: 42 }),
];
