/**
 * PHASE 4.8-A 帽子（§19）。5種類。
 *
 * **AI画像でいちばん困った「帽子のズレ」をここで完全に潰します。**
 *
 * 潰し方は単純で、帽子が自分の座標を一切持たないことです。
 * 使ってよいのは headTop / capBase / capCenter / brim / temple のアンカーだけ（§19）。
 * アンカーは頭の基準線から計算されるので、
 * 頭の形を変えても帽子は勝手についてきます。
 *
 * 帽子側に「y=40 に描く」「幅は60」と書いた瞬間にズレが始まるので、書きません。
 */
import type { CharacterPart, CharacterRenderContext } from '../types';
import { STROKE } from '../coordinates';

interface CapShape {
  /** クラウンの頂点が頭の天辺からどれだけ上に出るか */
  crownRise: number;
  /** ヘッドバンドを基準よりどれだけ下げるか。大きいほど深くかぶる */
  depth: number;
  /**
   * クラウンの横幅を、**頭の輪郭からどれだけ外へ出すか**。
   *
   * 帽子側に横幅の実数を書いてはいけない。
   * 実数で持っていたとき、横広の頭では帽子が食い込み、
   * 細い頭では帽子だけが左右に浮いた。頭の幅に追従させる。
   */
  widthOver: number;
  /** つばが前へ張り出す長さ */
  brimLength: number;
  /** つばの角度。正で下向き、負で反り上がる */
  brimAngle: number;
}

function capRender(context: CharacterRenderContext, shape: CapShape) {
  const { anchors, palette, guides } = context;
  const cx = anchors.capCenter.x;

  /*
   * ヘッドバンドの線。眉の少し上（帽子ごとに深さだけ変える）。
   * 深くかぶる帽子でも目まで下りないよう、ここで上限を決める。
   * 帽子側の数値まかせにすると「めり込み」が必ず出る（§26）。
   */
  const bandLimit = guides.eyebrowLine - 2;
  const bandY = Math.min(anchors.capBase.y + shape.depth, bandLimit);
  // クラウンの頂点。頭の天辺から少しだけ上に出る
  const top = anchors.headTop.y - shape.crownRise;
  // 横幅は頭の輪郭から。帽子は頭より少しだけ外
  const half = anchors.rightTemple.x - cx + shape.widthOver;
  const bandHeight = 8;
  const brimY = bandY + bandHeight - 1;
  // つばの先端。目の手前で必ず止める
  const brimTip = Math.min(brimY + shape.brimLength + shape.brimAngle, guides.eyeLine - 5);

  return (
    <g>
      {/* クラウン。天辺からヘッドバンドまで */}
      <path
        d={[
          `M ${cx - half} ${bandY + 2}`,
          `C ${cx - half} ${top + 10}, ${cx - half * 0.58} ${top}, ${cx} ${top}`,
          `C ${cx + half * 0.58} ${top}, ${cx + half} ${top + 10}, ${cx + half} ${bandY + 2}`,
          'Z',
        ].join(' ')}
        fill={palette.cap}
        stroke={palette.outline}
        strokeWidth={STROKE.outer}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* ヘッドバンド。球団色の差し色が入る */}
      <path
        d={[
          `M ${cx - half} ${bandY}`,
          `L ${cx + half} ${bandY}`,
          `L ${cx + half} ${bandY + bandHeight}`,
          `Q ${cx} ${bandY + bandHeight + 4} ${cx - half} ${bandY + bandHeight}`,
          'Z',
        ].join(' ')}
        fill={palette.capSecondary}
        stroke={palette.outline}
        strokeWidth={STROKE.secondary}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* つば。ヘッドバンドから前へ張り出す。目にかからない長さに抑える */}
      <path
        d={[
          `M ${cx - half * 1.02} ${brimY}`,
          `Q ${cx} ${brimTip} ${cx + half * 1.02} ${brimY}`,
          `Q ${cx} ${brimY + (brimTip - brimY) * 0.28} ${cx - half * 1.02} ${brimY}`,
          'Z',
        ].join(' ')}
        fill={palette.capShadow}
        stroke={palette.outline}
        strokeWidth={STROKE.outer}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* クラウンの縫い目。細くしすぎない */}
      <path
        d={`M ${cx} ${top + 2} L ${cx} ${bandY}`}
        fill="none"
        stroke={palette.outline}
        strokeWidth={STROKE.detail}
        opacity={0.4}
        vectorEffect="non-scaling-stroke"
      />
      {/* てっぺんのボタン */}
      <circle
        cx={cx}
        cy={top + 2}
        r={2.6}
        fill={palette.capSecondary}
        stroke={palette.outline}
        strokeWidth={STROKE.detail}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function makeCap(id: string, label: string, shape: CapShape): CharacterPart {
  return { id, category: 'cap', label, render: (context) => capRender(context, shape) };
}

/**
 * 帽子5種類（§19）。
 * 差はクラウンの高さ・かぶりの深さ・つばの長さ・つばの角度で付ける。
 */
export const CAP_PARTS: CharacterPart[] = [
  makeCap('cap_01', '標準', { crownRise: 4, depth: 0, widthOver: 3, brimLength: 15, brimAngle: 0 }),
  makeCap('cap_02', '深め', { crownRise: 6, depth: 5, widthOver: 4, brimLength: 14, brimAngle: 2 }),
  makeCap('cap_03', '浅め', { crownRise: 2, depth: -6, widthOver: 2, brimLength: 15, brimAngle: 0 }),
  makeCap('cap_04', 'つば長め', { crownRise: 4, depth: 1, widthOver: 3, brimLength: 21, brimAngle: 3 }),
  makeCap('cap_05', 'つば反り', { crownRise: 5, depth: 0, widthOver: 4, brimLength: 14, brimAngle: -5 }),
];
