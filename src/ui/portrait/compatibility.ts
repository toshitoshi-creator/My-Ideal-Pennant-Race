/**
 * PHASE 4.5 部品どうしの相性。
 *
 * 大量の組み合わせを許す代わりに、
 * 「顔が隠れてしまう」「同じ場所を2つの部品が奪い合う」組み合わせだけを直す。
 * 別の部品に置き換えるのではなく、成立する形へ最小限ずらす。
 */
import type {
  EarId,
  EyebrowId,
  FacialHairId,
  HairId,
  HeadId,
  PlayerAppearance,
} from '../../domain/playerAppearance';

/** 顔が狭い輪郭。大きすぎる部品は載せない */
const NARROW_HEADS: HeadId[] = ['head_06_narrow', 'head_04_long', 'head_09_angular'];

/** 前へ大きく張り出す髪型。耳が大きいと重なって潰れる */
const BULKY_HAIR: HairId[] = ['hair_09_curly', 'hair_15_volume', 'hair_08_long', 'hair_07_bowl'];

/** 生え際が後退している髪型。濃すぎる眉と並ぶと額が黒くなる */
const SPARSE_HAIR: HairId[] = ['hair_13_receding', 'hair_14_thin', 'hair_11_buzz'];

/** あごを広く覆うひげ */
const HEAVY_BEARD: FacialHairId[] = ['face_06_beard_full', 'face_07_moustache_beard'];

/**
 * 成立しない組み合わせを、いちばん近い形へ寄せる。
 * 顔の「その人らしさ」を決める目・鼻・輪郭は動かさない。
 */
export function resolveCompatibility(appearance: PlayerAppearance): PlayerAppearance {
  let ears: EarId = appearance.ears;
  let eyebrows: EyebrowId = appearance.eyebrows;
  let facialHair: FacialHairId = appearance.facialHair;

  // 大きな耳 × ボリュームのある髪 → 耳を標準に寄せる
  if (ears === 'ear_03_large' && BULKY_HAIR.includes(appearance.hair)) {
    ears = 'ear_01_standard';
  }
  // 細い輪郭 × 大きな耳 → 顔の幅より耳が目立つので小さくする
  if (ears === 'ear_03_large' && NARROW_HEADS.includes(appearance.head)) {
    ears = 'ear_06_lobed';
  }
  // 薄い髪 × いちばん濃い眉 → 額が黒くなるので一段落とす
  if (SPARSE_HAIR.includes(appearance.hair) && eyebrows === 'brow_07_dense') {
    eyebrows = 'brow_01_thick';
  }
  // 細い輪郭 × 広いひげ → あごが埋まるので短いひげにする
  if (NARROW_HEADS.includes(appearance.head) && HEAVY_BEARD.includes(facialHair)) {
    facialHair = 'face_05_beard_short';
  }

  if (ears === appearance.ears && eyebrows === appearance.eyebrows && facialHair === appearance.facialHair) {
    return appearance;
  }
  return { ...appearance, ears, eyebrows, facialHair };
}

/** テスト用：この組み合わせが調整対象かどうか */
export function needsAdjustment(appearance: PlayerAppearance): boolean {
  return resolveCompatibility(appearance) !== appearance;
}
