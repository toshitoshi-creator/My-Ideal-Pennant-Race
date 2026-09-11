/**
 * PHASE 4.8-A パーツ表（§7・§8）。
 *
 * 種類ごとにパーツを並べておくだけの場所。
 * 描画側はここからしかパーツを取らないので、
 * パーツを足すときに触るのはこのファイルと parts/ だけで済む。
 */
import type { CharacterPart, CharacterPartCategory, CharacterPartTable } from './types';
import { HEAD_PARTS } from './parts/heads';
import { EAR_PARTS, EYEBROW_PARTS, EYE_PARTS, MOUTH_PARTS, NOSE_PARTS } from './parts/face';
import { HAIR_BACK_PARTS, HAIR_FRONT_PARTS } from './parts/hair';
import { CAP_PARTS } from './parts/cap';
import { BODY_PARTS, NECK_PARTS, UNIFORM_PARTS } from './parts/body';
import { CUSTOM_PARTS } from './customParts';

/**
 * すべてのパーツ。
 *
 * PHASE 4.8-A で作るのは「規格と最小サンプル」だけ（§8）。
 * ここが空の種類は、まだ作っていないという意味であって、
 * 描画側はその種類を黙って飛ばす。
 */
const BUILT_IN_PARTS: CharacterPartTable = {
  head: HEAD_PARTS,
  body: BODY_PARTS,
  hairBack: HAIR_BACK_PARTS,
  ear: EAR_PARTS,
  neck: NECK_PARTS,
  hairFront: HAIR_FRONT_PARTS,
  eyebrow: EYEBROW_PARTS,
  eye: EYE_PARTS,
  nose: NOSE_PARTS,
  mouth: MOUTH_PARTS,
  beard: [],
  cap: CAP_PARTS,
  uniform: UNIFORM_PARTS,
  pose: [],
  expression: [],
  accessory: [],
};

/**
 * 実際に使うパーツ表。
 *
 * **はじめから入っているもの → あなたが描いたもの** の順に並べます。
 * 順番を固定するのは、同じセーブから必ず同じ顔を出すためです。
 * 後ろに足す形なので、パーツを追加しても既存の番号はずれません。
 */
export const CHARACTER_PARTS: CharacterPartTable = Object.fromEntries(
  (Object.keys(BUILT_IN_PARTS) as CharacterPartCategory[]).map((category) => [
    category,
    [...BUILT_IN_PARTS[category], ...CUSTOM_PARTS[category]],
  ]),
) as CharacterPartTable;

/** その種類のパーツ数（あなたが描いたものを含む） */
export function partCount(category: CharacterPartCategory): number {
  return CHARACTER_PARTS[category].length;
}

/** はじめから入っているパーツだけの数（検査で使う） */
export function builtInCount(category: CharacterPartCategory): number {
  return BUILT_IN_PARTS[category].length;
}

/**
 * 番号でパーツを選ぶ。
 *
 * 番号は必ず範囲内に丸める。パーツを増やしても減らしても、
 * 「番号が範囲外で落ちる」ということが起きない。
 */
export function partAt(category: CharacterPartCategory, index: number): CharacterPart | null {
  const list = CHARACTER_PARTS[category];
  if (list.length === 0) return null;
  const i = ((index % list.length) + list.length) % list.length;
  return list[i];
}

/** IDでパーツを探す（Gallery と Debug で使う） */
export function partById(category: CharacterPartCategory, id: string): CharacterPart | null {
  return CHARACTER_PARTS[category].find((part) => part.id === id) ?? null;
}
