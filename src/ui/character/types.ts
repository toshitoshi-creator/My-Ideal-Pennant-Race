/**
 * PHASE 4.8-A パーツの共通規格（§7・§8）。
 *
 * すべてのパーツが同じ形をしていることが大事です。
 * 形がそろっていれば、パーツを足すときに描画側を直さなくて済みます。
 *
 * パーツが持ってよいもの:  id / category / anchors / render
 * パーツが持ってはいけないもの:  z-index / 色 / 自前の viewBox / 乱数
 */
import type { ReactNode } from 'react';
import type { CharacterAnchors, CharacterGuides, GuideAdjustment } from './coordinates';
import type { CharacterPalette } from './palette';

/** パーツの種類（§8） */
export const CHARACTER_PART_CATEGORIES = [
  'head',
  'body',
  'hairBack',
  'ear',
  'neck',
  'hairFront',
  'eyebrow',
  'eye',
  'nose',
  'mouth',
  'beard',
  'cap',
  'uniform',
  'pose',
  'expression',
  'accessory',
] as const;

export type CharacterPartCategory = (typeof CHARACTER_PART_CATEGORIES)[number];

/**
 * 描くときにパーツへ配られるもの。
 *
 * パーツはここに入っているものだけを見て描く。
 * 外の値（定数の直接参照・現在時刻・乱数）を見てはいけない。
 */
export interface CharacterRenderContext {
  guides: CharacterGuides;
  anchors: CharacterAnchors;
  palette: CharacterPalette;
  /** 帽子をかぶっているか。前髪はこれを見て形を変える */
  hasCap: boolean;
  /** 表情。眉と口はこれを見て角度を変えてよい */
  expression: CharacterExpression;
}

/** 表情（§17・§15）。顔そのものは変えず、眉・目・口の描き方だけを変える */
export type CharacterExpression =
  | 'neutral'
  | 'smile'
  | 'grin'
  | 'open'
  | 'serious'
  | 'surprised';

export const CHARACTER_EXPRESSIONS: CharacterExpression[] = [
  'neutral',
  'smile',
  'grin',
  'open',
  'serious',
  'surprised',
];

/**
 * パーツ1つ。
 *
 * render は React の要素を返すだけ。副作用を持たない。
 * 同じ context からは必ず同じ絵が出る（決定論的）。
 */
export interface CharacterPart {
  id: string;
  category: CharacterPartCategory;
  /** 人が読むための短い名前（Gallery と Debug に出す） */
  label: string;
  /**
   * その頭の形が基準線をどう動かすか（head だけが持つ）。
   * 顔を縦長にすれば目も鼻も口もついてくる。
   */
  guideAdjustment?: GuideAdjustment;
  /**
   * そのパーツが決める基準点の上書き。
   *
   * 固定値ではなく **基準線から計算させる**。
   * 頭が「自分の幅はこれ」と申告し、耳や帽子がそれを見る、という流れ。
   * 固定値にすると、細い顔で耳が浮くといったズレが必ず出る。
   */
  anchorsFor?: (guides: CharacterGuides) => Partial<CharacterAnchors>;
  render: (context: CharacterRenderContext) => ReactNode;
}

/** 種類ごとのパーツ表 */
export type CharacterPartTable = Record<CharacterPartCategory, CharacterPart[]>;
