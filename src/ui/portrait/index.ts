/**
 * PHASE 4.5 選手ビジュアルの入口。
 *
 * Players are assembled, not selected.
 * 「選手画像を選ぶ」のではなく「選手を部品から組み立てる」。
 */
export * from './types';
export { PortraitSvg, PortraitFallbackSvg } from './renderer';
export { headGeometry, HEAD_GEOMETRIES } from './parts/heads';
export { resolveCompatibility, needsAdjustment } from './compatibility';
export { SKIN_FILL, SKIN_SHADE, HAIR_FILL, HAIR_SHADE } from './palette';
