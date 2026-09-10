/**
 * PHASE 4.8-A キャラクター表示のまとめ。
 *
 * 外からはここだけを見ればよい。
 * UI が parts/ を直接呼ぶことは禁止（§1 の一方向構造）。
 */
export { CharacterRenderer, CharacterDebugOverlay } from './CharacterRenderer';
export type { CharacterRendererProps } from './CharacterRenderer';
export {
  CHARACTER_GUIDES,
  CHARACTER_HEIGHT,
  CHARACTER_LAYERS,
  CHARACTER_VIEW_BOX,
  CHARACTER_WIDTH,
  MIN_STROKE,
  STROKE,
  adjustGuides,
  anchorsFrom,
  headCenterY,
  layerOrder,
} from './coordinates';
export type {
  CharacterAnchor,
  CharacterAnchors,
  CharacterGuides,
  CharacterLayer,
} from './coordinates';
export { CHARACTER_PARTS, partAt, partById, partCount } from './registry';
export { HAIR_COLORS, SKIN_TONES, buildPalette } from './palette';
export type { CharacterPalette } from './palette';
export {
  CHARACTER_EXPRESSIONS,
  CHARACTER_PART_CATEGORIES,
} from './types';
export type {
  CharacterExpression,
  CharacterPart,
  CharacterPartCategory,
  CharacterRenderContext,
} from './types';
