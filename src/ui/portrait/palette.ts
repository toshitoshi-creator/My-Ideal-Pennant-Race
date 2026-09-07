/**
 * PHASE 4.5 肌と髪の色。
 *
 * 色は styles.css のトークンだけを使う。紙とインクの世界（§38）から外れないよう、
 * 彩度を抑えた自然な範囲にとどめる。色だけを変えて「別人」にはしない。
 */
import type { HairColorId, SkinId } from '../../domain/playerAppearance';

export const SKIN_FILL: Record<SkinId, string> = {
  skin_01: 'var(--skin-1)',
  skin_02: 'var(--skin-2)',
  skin_03: 'var(--skin-3)',
  skin_04: 'var(--skin-4)',
  skin_05: 'var(--skin-5)',
  skin_06: 'var(--skin-6)',
  skin_07: 'var(--skin-7)',
  skin_08: 'var(--skin-8)',
};

/** 頬・首の影。肌より一段だけ暗い */
export const SKIN_SHADE: Record<SkinId, string> = {
  skin_01: 'var(--skin-1-d)',
  skin_02: 'var(--skin-2-d)',
  skin_03: 'var(--skin-3-d)',
  skin_04: 'var(--skin-4-d)',
  skin_05: 'var(--skin-5-d)',
  skin_06: 'var(--skin-6-d)',
  skin_07: 'var(--skin-7-d)',
  skin_08: 'var(--skin-8-d)',
};

export const HAIR_FILL: Record<HairColorId, string> = {
  hairc_01_black: 'var(--hair-1)',
  hairc_02_soft_black: 'var(--hair-2)',
  hairc_03_dark_brown: 'var(--hair-3)',
  hairc_04_brown: 'var(--hair-4)',
  hairc_05_light_brown: 'var(--hair-5)',
  hairc_06_ash: 'var(--hair-6)',
  hairc_07_grey: 'var(--hair-7)',
  hairc_08_white: 'var(--hair-8)',
};

/** 髪の陰。毛の流れを1〜2本入れるときに使う */
export const HAIR_SHADE: Record<HairColorId, string> = {
  hairc_01_black: 'var(--hair-1-d)',
  hairc_02_soft_black: 'var(--hair-2-d)',
  hairc_03_dark_brown: 'var(--hair-3-d)',
  hairc_04_brown: 'var(--hair-4-d)',
  hairc_05_light_brown: 'var(--hair-5-d)',
  hairc_06_ash: 'var(--hair-6-d)',
  hairc_07_grey: 'var(--hair-7-d)',
  hairc_08_white: 'var(--hair-8-d)',
};
