/**
 * PHASE 4.8-A キャラクターの色（§11）。
 *
 * **色をパーツの中に書かない。**
 *
 * パーツが色を持つと、肌の色を1つ足すだけで全パーツを直すことになる。
 * ここで色を組み立てて、描画時に配る。
 * どの色を使うかは Appearance Profile が決める（§11 最後の行）。
 */

export interface CharacterPalette {
  skin: string;
  skinShadow: string;
  skinLight: string;

  hair: string;
  hairShadow: string;

  eye: string;
  eyeWhite: string;
  eyeHighlight: string;

  brow: string;
  mouth: string;
  mouthInner: string;

  outline: string;

  uniform: string;
  uniformSecondary: string;
  uniformShadow: string;

  cap: string;
  capSecondary: string;
  /** つばと影。クラウンと同じ色だと帽子が一枚の板に見える */
  capShadow: string;
}

/** 輪郭の色。全キャラクター共通。真っ黒にはしない（きつく見えるため） */
export const OUTLINE = '#20191a';

/**
 * 肌の色（§11 で「4〜8種類程度」）。
 * 明るい順に8段階。陰は同じ色相で少し暗くしたもの。
 */
export const SKIN_TONES: Array<{ base: string; shadow: string; light: string }> = [
  { base: '#f6ddc9', shadow: '#e3bfa4', light: '#fdefe3' },
  { base: '#f2d2b6', shadow: '#dcb18e', light: '#fbe7d6' },
  { base: '#eac39f', shadow: '#cf9f76', light: '#f6dcc2' },
  { base: '#dfae86', shadow: '#c08b60', light: '#eecaab' },
  { base: '#cf9a6e', shadow: '#ac774b', light: '#e3b892' },
  { base: '#b98254', shadow: '#946039', light: '#d0a077' },
  { base: '#9a663f', shadow: '#77492a', light: '#b4835c' },
  { base: '#7a4e30', shadow: '#5b3720', light: '#96694a' },
];

/**
 * 髪の色（§11 で「8〜12種類程度」）。
 * 黒・茶系を中心に、白髪と灰も持つ（年齢表現で使う）。
 */
export const HAIR_COLORS: Array<{ base: string; shadow: string }> = [
  { base: '#241d1b', shadow: '#120e0d' },
  { base: '#31241d', shadow: '#1b1210' },
  { base: '#4a3324', shadow: '#2e1f15' },
  { base: '#5f4128', shadow: '#3d2917' },
  { base: '#77522f', shadow: '#4f351c' },
  { base: '#8d6438', shadow: '#5f4123' },
  { base: '#5a4a3f', shadow: '#3a2f28' },
  { base: '#6f6a66', shadow: '#4b4744' },
  { base: '#9a9591', shadow: '#6e6a67' },
  { base: '#c9c5c1', shadow: '#9a9793' },
];

/** ユニフォームの既定色。球団色はゲーム側から差し替える */
const UNIFORM_BASE = '#f4f1e9';
const UNIFORM_SHADOW = '#d8d3c6';

export interface PaletteInput {
  /** SKIN_TONES の番号 */
  skin: number;
  /** HAIR_COLORS の番号 */
  hairColor: number;
  /** 球団色。渡さなければ既定のオフホワイト */
  teamColor?: string | undefined;
}

/**
 * 色を暗くする。
 *
 * 球団色を渡されたとき、クラウンとつばが同じ色だと帽子が板に見える。
 * 球団ごとに影の色を持たせるのは管理が増えるので、ここで作る。
 */
function darken(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const to = (shift: number) => {
    const channel = (n >> shift) & 0xff;
    return Math.max(0, Math.round(channel * (1 - amount)));
  };
  const out = (to(16) << 16) | (to(8) << 8) | to(0);
  return `#${out.toString(16).padStart(6, '0')}`;
}

/** 番号を範囲内に収める。素材が増減しても壊れないように */
function pick<T>(list: T[], index: number): T {
  const n = list.length;
  return list[((index % n) + n) % n];
}

export function buildPalette(input: PaletteInput): CharacterPalette {
  const skin = pick(SKIN_TONES, input.skin);
  const hair = pick(HAIR_COLORS, input.hairColor);
  const team = input.teamColor;

  return {
    skin: skin.base,
    skinShadow: skin.shadow,
    skinLight: skin.light,

    hair: hair.base,
    hairShadow: hair.shadow,

    eye: '#3b2c26',
    eyeWhite: '#fbf8f4',
    eyeHighlight: '#ffffff',

    brow: hair.shadow,
    mouth: '#8c4f45',
    mouthInner: '#5d2f2b',

    outline: OUTLINE,

    uniform: UNIFORM_BASE,
    uniformSecondary: team ?? '#b8b2a4',
    uniformShadow: UNIFORM_SHADOW,

    cap: team ?? '#3d4756',
    capSecondary: team ? darken(team, 0.22) : '#2b3340',
    capShadow: team ? darken(team, 0.38) : '#1f2731',
  };
}
