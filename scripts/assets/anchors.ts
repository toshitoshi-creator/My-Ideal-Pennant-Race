/**
 * PHASE 4.7 共通キャンバスと基準点（§6・§7）。
 *
 * config/visual-assets.json と同じ値を、計算から使える形で持つ。
 * どちらかを直したらもう一方も直す。食い違いはテストが見つける。
 */
import type { CatalogId } from './catalog';

export const CANVAS_WIDTH = 1024;
export const CANVAS_HEIGHT = 1280;

/** 書き出す解像度（§6）。original は必ず残す */
export const OUTPUT_SIZES = {
  hero: 1024,
  large: 512,
  medium: 256,
  small: 128,
} as const;
export type OutputSize = keyof typeof OUTPUT_SIZES;

/** 基準となる点。1024x1280 の上の座標 */
export interface AnchorPoint {
  x: number;
  y: number;
}

/**
 * 種類ごとの基準点。
 * 後処理は「中身の重心」ではなく、この点に合わせて置き直す。
 */
export const ANCHORS: Record<CatalogId, AnchorPoint> = {
  head_shape: { x: 512, y: 470 },
  body_type: { x: 512, y: 1000 },
  hair_style: { x: 512, y: 330 },
  hair_color: { x: 512, y: 330 },
  skin_tone: { x: 512, y: 470 },
  eyebrow: { x: 512, y: 428 },
  eyes: { x: 512, y: 496 },
  nose: { x: 512, y: 600 },
  mouth: { x: 512, y: 712 },
  ears: { x: 512, y: 512 },
  jaw_cheeks: { x: 512, y: 740 },
  facial_hair: { x: 512, y: 740 },
  expression: { x: 512, y: 560 },
  pose: { x: 512, y: 1060 },
  uniform: { x: 512, y: 1010 },
  cap: { x: 512, y: 280 },
  accessory: { x: 512, y: 496 },
  special_state: { x: 512, y: 1100 },
  neck: { x: 512, y: 835 },
  hair_back: { x: 512, y: 420 },
};

/** 顔の基準線。上から下へ並ぶ */
export const FACE_LINES = {
  hairLine: 210,
  browLine: 428,
  eyeLine: 496,
  earLine: 512,
  noseLine: 600,
  mouthLine: 712,
  chinLine: 800,
  neckLine: 856,
} as const;
export type FaceLine = keyof typeof FACE_LINES;

/** 左右の基準点 */
export const SIDE_POINTS = {
  leftEyeX: 408,
  rightEyeX: 616,
  leftBrowX: 404,
  rightBrowX: 620,
  leftEarX: 250,
  rightEarX: 774,
  faceLeftX: 244,
  faceRightX: 780,
  shoulderLeftX: 236,
  shoulderRightX: 788,
} as const;

/**
 * その種類が「キャンバスのどのあたりに収まるべきか」。
 * 検査で、素材がとんでもない場所に描かれていないかを見るのに使う。
 * 値は 0〜1 の割合（左上が 0,0）。
 */
export const EXPECTED_REGION: Record<CatalogId, { top: number; bottom: number }> = {
  head_shape: { top: 0.1, bottom: 0.7 },
  body_type: { top: 0.6, bottom: 1.0 },
  hair_style: { top: 0.08, bottom: 0.55 },
  hair_color: { top: 0.08, bottom: 0.55 },
  skin_tone: { top: 0.1, bottom: 0.7 },
  eyebrow: { top: 0.25, bottom: 0.42 },
  eyes: { top: 0.3, bottom: 0.48 },
  nose: { top: 0.38, bottom: 0.55 },
  mouth: { top: 0.48, bottom: 0.65 },
  ears: { top: 0.3, bottom: 0.52 },
  jaw_cheeks: { top: 0.45, bottom: 0.7 },
  facial_hair: { top: 0.48, bottom: 0.7 },
  expression: { top: 0.25, bottom: 0.65 },
  pose: { top: 0.6, bottom: 1.0 },
  uniform: { top: 0.6, bottom: 1.0 },
  cap: { top: 0.1, bottom: 0.35 },
  accessory: { top: 0.32, bottom: 0.46 },
  special_state: { top: 0.5, bottom: 1.0 },
  neck: { top: 0.58, bottom: 0.72 },
  hair_back: { top: 0.12, bottom: 0.6 },
};
