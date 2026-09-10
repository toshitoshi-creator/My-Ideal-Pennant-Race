/**
 * PHASE 4.8-A 髪（§18）。8種類。
 *
 * 髪は **前と後ろに分ける**（§18）。
 *   hairBack  … 頭より下に描く。帽子をかぶっても残る
 *   hairFront … 頭より上に描く。帽子をかぶると隠れる部分がある
 *
 * こうしておくと、帽子をかぶったときに
 * 「前髪だけ消えて後ろ髪は残る」という当たり前の見え方になる。
 *
 * 前髪は context.hasCap を見て形を変えてよい。
 * 帽子の下に潜り込む髪は、帽子のつばより上へはみ出さない。
 */
import type { ReactNode } from 'react';
import type { CharacterPart, CharacterRenderContext } from '../types';
import { STROKE, headCenterY } from '../coordinates';

interface HairShape {
  /** 髪が頭からどれだけ外へ張り出すか */
  spread: number;
  /** 頭頂からどれだけ上へ盛り上がるか */
  lift: number;
  /** 前髪の下端（生え際からの距離） */
  fringe: number;
  /** 後ろ髪の長さ。0 なら後ろ髪なし */
  backLength: number;
  /** 毛先の刻み。0 なら滑らか */
  spikes: number;
  /** 生え際の流れ。大きいほど片側へ流れる */
  sweep: number;
}

/**
 * 前髪。
 *
 * 作り方は「頭の上半分をなぞる外側」＋「生え際をなぞる内側」で1つの帯にする。
 * こうすると、どの頭の形でも髪が頭からはみ出したり浮いたりしない。
 *
 * 帽子をかぶったら、生え際のすぐ下だけを見せる（帽子の下に潜り込む）。
 */
function frontHair(context: CharacterRenderContext, shape: HairShape): ReactNode {
  const { guides, palette, hasCap } = context;
  const cx = guides.centerX;
  const top = guides.headTop;
  const cy = headCenterY(guides);

  /*
   * 髪の幅は **頭が申告した輪郭** から決める（§5）。
   * 固定値にしていたとき、細い頭では髪が横に黒い板のようにはみ出した。
   * 頭の縁のすぐ外を通せば、どの頭でも輪郭に沿って乗る。
   */
  const half = context.anchors.rightTemple.x - cx + 2 + shape.spread;
  const lift = hasCap ? 1 : shape.lift;
  const hairTop = top - lift;
  /*
   * 生え際。
   *
   * 帽子をかぶったら、生え際は **ヘッドバンドの少し下** に置く。
   * 天辺からの固定距離のままだと髪が帽子に完全に隠れて坊主に見えた。
   * 帽子の下から前髪と揉み上げがのぞくのが自然。
   */
  const browY = hasCap
    ? context.anchors.capBase.y + Math.min(shape.fringe, 10)
    : top + shape.fringe;

  // 外側：頭頂をぐるりと回る
  const outer = [
    `M ${cx - half} ${cy - 2}`,
    `C ${cx - half} ${hairTop + 8}, ${cx - half * 0.62} ${hairTop} ${cx} ${hairTop}`,
    `C ${cx + half * 0.62} ${hairTop}, ${cx + half} ${hairTop + 8} ${cx + half} ${cy - 2}`,
  ].join(' ');

  // 内側：生え際を左へ戻る。刻みがあれば毛先をぎざぎざにする
  let inner: string;
  if (shape.spikes > 0) {
    const steps: string[] = [`L ${cx + half * 0.9} ${browY - 2}`];
    for (let i = 0; i < shape.spikes; i++) {
      const t = i / (shape.spikes - 1 || 1);
      const x = cx + half * 0.9 - t * half * 1.8;
      steps.push(`L ${x} ${browY + (i % 2 === 0 ? 4 : -5)}`);
    }
    steps.push(`L ${cx - half * 0.9} ${browY - 2}`);
    inner = steps.join(' ');
  } else {
    inner = [
      `L ${cx + half * 0.9} ${browY - 4}`,
      `Q ${cx + half * 0.3} ${browY} ${cx} ${browY - shape.sweep}`,
      `Q ${cx - half * 0.3} ${browY - shape.sweep * 2} ${cx - half * 0.9} ${browY - 4}`,
    ].join(' ');
  }

  return (
    <path
      d={`${outer} ${inner} Z`}
      fill={palette.hair}
      stroke={palette.outline}
      strokeWidth={STROKE.outer}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** 後ろ髪。頭より下に描くので、帽子をかぶっても残る */
function backHair(context: CharacterRenderContext, shape: HairShape): ReactNode {
  if (shape.backLength <= 0) return null;
  const { guides, palette } = context;
  const cx = guides.centerX;
  const top = guides.headTop;
  const cy = headCenterY(guides);
  // 後ろ髪も頭の輪郭から。前髪よりわずかに外
  const half = context.anchors.rightTemple.x - cx + 3 + shape.spread;
  /*
   * 毛先は肩の手前で止め、下へ行くほど内へ絞る。
   *
   * 幅をそのまま下ろしていたとき、髪が肩の後ろで四角い幕になり、
   * 髪ではなくフードをかぶっているように見えた。
   */
  const bottom = Math.min(guides.headBottom + shape.backLength, guides.shoulderLine - 2);
  const tip = half * 0.66;

  return (
    <path
      d={[
        `M ${cx - half} ${cy - 10}`,
        `C ${cx - half} ${top + 4}, ${cx + half} ${top + 4}, ${cx + half} ${cy - 10}`,
        `C ${cx + half} ${bottom - 24}, ${cx + tip} ${bottom - 16}, ${cx + tip} ${bottom - 6}`,
        `Q ${cx + tip * 0.5} ${bottom} ${cx} ${bottom}`,
        `Q ${cx - tip * 0.5} ${bottom} ${cx - tip} ${bottom - 6}`,
        `C ${cx - tip} ${bottom - 16}, ${cx - half} ${bottom - 24}, ${cx - half} ${cy - 10}`,
        'Z',
      ].join(' ')}
      fill={palette.hairShadow}
      stroke={palette.outline}
      strokeWidth={STROKE.outer}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function makeHair(id: string, label: string, shape: HairShape): {
  front: CharacterPart;
  back: CharacterPart;
} {
  return {
    front: {
      id: `${id}_front`,
      category: 'hairFront',
      label,
      render: (context) => frontHair(context, shape),
    },
    back: {
      id: `${id}_back`,
      category: 'hairBack',
      label,
      render: (context) => backHair(context, shape),
    },
  };
}

/** 髪8種類（§18）。前と後ろが同じ番号で対になる */
const HAIR_SHAPES: Array<{ id: string; label: string; shape: HairShape }> = [
  { id: 'hair_01', label: 'ショート', shape: { spread: 1, lift: 5, fringe: 16, backLength: 0, spikes: 0, sweep: 3 } },
  { id: 'hair_02', label: 'サイド刈り', shape: { spread: -2, lift: 3, fringe: 12, backLength: 0, spikes: 0, sweep: 1 } },
  { id: 'hair_03', label: 'ツンツン', shape: { spread: 2, lift: 9, fringe: 15, backLength: 0, spikes: 7, sweep: 0 } },
  { id: 'hair_04', label: '流し', shape: { spread: 2, lift: 7, fringe: 20, backLength: 0, spikes: 0, sweep: 8 } },
  { id: 'hair_05', label: 'ミディアム', shape: { spread: 3, lift: 6, fringe: 18, backLength: 14, spikes: 0, sweep: 4 } },
  { id: 'hair_06', label: 'ロング', shape: { spread: 4, lift: 6, fringe: 19, backLength: 34, spikes: 0, sweep: 5 } },
  { id: 'hair_07', label: '刈り上げ', shape: { spread: -3, lift: 1, fringe: 8, backLength: 0, spikes: 0, sweep: 1 } },
  { id: 'hair_08', label: 'くしゃっと', shape: { spread: 3, lift: 8, fringe: 17, backLength: 0, spikes: 9, sweep: 2 } },
];

const HAIR_PAIRS = HAIR_SHAPES.map((item) => makeHair(item.id, item.label, item.shape));

export const HAIR_FRONT_PARTS: CharacterPart[] = HAIR_PAIRS.map((pair) => pair.front);
export const HAIR_BACK_PARTS: CharacterPart[] = HAIR_PAIRS.map((pair) => pair.back);
