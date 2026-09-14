// src/domain/character/appearance.ts
//
// 選手の見た目を「シードから決定的に」生成する純粋ロジック。
// React・DOM・Canvas に一切依存しないので domain 配下に置ける。
// 実際に絵として描く処理（Canvas描画）は src/ui/character/draw.ts 側。

/**
 * 既存の Rng クラスとつなぐための最小インターフェース。
 * 0以上1未満の浮動小数点数を返すメソッドが1つあればよい。
 *
 * 既存の Rng クラスのメソッド名が違う場合は、呼び出し側で
 *   const source: RandomSource = { next: () => rng.yourMethodName() };
 * のように包んでから generatePlayerAppearance に渡してください。
 */
export interface RandomSource {
  next(): number;
}

export interface GeneratePlayerAppearanceOptions {
  /** true: 帽子・グローブ等の装備あり / false: 帽子なし（既定 true） */
  gear?: boolean;
  /** 帽子や胸に入れる文字（省略可） */
  hatText?: string;
  /** 背番号。省略時は空欄 */
  number?: number | string;
}

/**
 * 見た目を構成する全パーツ番号・全色。
 * UI側の描画コード（draw.ts）は、この値だけを見て絵を組み立てる。
 */
export interface PlayerAppearance {
  head: number;
  hair: number;
  eye: number;
  brow: number;
  nose: number;
  mouth: number;
  beard: number;
  body: number;
  hat: number;
  glasses: number;
  extra: number;
  item: number;
  bg: number;

  skinColor: string;
  lineColor: string;
  blushColor: string;
  hairColor: string;
  hairLineColor: string;
  eyeColor: string;
  browColor: string;
  mouthColor: string;
  beardColor: string;
  cloth1Color: string;
  cloth2Color: string;
  hat1Color: string;
  hat2Color: string;
  glassColor: string;
  lensColor: string;
  /** 0〜100（レンズの濃さ） */
  lensOpacity: number;
  extraColor: string;
  itemColor: string;
  textColor: string;
  textLineColor: string;
  bg1Color: string;
  bg2Color: string;

  /** 縁取り枠の太さ。0なら枠なし */
  frameThickness: number;
  frameColor: string;

  /** 目の左右の間隔・上下位置の微調整（0が標準） */
  eyeGapOffset: number;
  eyeYOffset: number;
  /** 眉の上下位置の微調整（0が標準） */
  browYOffset: number;

  hatText: string;
  numberText: string;
}

/**
 * 各パーツの選択肢数。
 * UI側の配列（HEADS/HAIRS/EYES/...）の length と必ず一致させること。
 * ズレると存在しないインデックスを選んでしまうため、
 * UI側にも同じ値を置いて起動時 or テストで突き合わせるのを推奨。
 *   例）Vitest: expect(HEADS.length).toBe(PART_COUNTS.head)
 */
export const PART_COUNTS = {
  head: 6,
  hair: 15,
  eye: 11,
  brow: 9,
  nose: 6,
  mouth: 10,
  beard: 6,
  body: 14,
  hat: 12,
  glasses: 5,
  extra: 8,
  item: 6,
  bg: 8,
} as const;

const SKIN_COLORS: readonly string[] = [
  "#fbe0c4", "#f8d3ab", "#efbb8c", "#d99a66", "#b97a4c", "#8d5a38", "#ffe8d6",
];

const HAIR_COLORS: readonly string[] = [
  "#2c2522", "#3a2f2b", "#6b4426", "#a5702f", "#d9b45a",
  "#8c2f2f", "#2f4f8c", "#5a2f7a", "#c9c9c9", "#1b1b1b",
];

/** [メイン色, 差し色] のチームカラー候補 */
const TEAM_COLORS: readonly (readonly [string, string])[] = [
  ["#1c4f96", "#16386c"], ["#c62828", "#7f1b1b"], ["#f9a825", "#1b1b1b"],
  ["#1b5e20", "#0e3d14"], ["#4a148c", "#2e0d57"], ["#37474f", "#1b262c"],
  ["#00838f", "#00565e"], ["#ef6c00", "#1b1b1b"],
];

/** 帽子ありのとき似合う髪型（帽子から見えるショート寄りに絞った候補） */
const GEAR_HAIR_CHOICES: readonly number[] = [1, 2, 3, 1, 11, 10, 12, 14];
/** 帽子なしのとき用の髪型（ロング・ツインテール等も含む全候補） */
const NO_GEAR_HAIR_CHOICES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14];
/** 眉：「ふとまゆ」に極端に偏らないよう均等になるよう絞った候補 */
const BROW_CHOICES: readonly number[] = [1, 2, 4, 6, 7];
/** 体型：ユニフォーム系に寄せた候補 */
const BODY_CHOICES: readonly number[] = [1, 10, 10, 11, 13];

/** 現状プリセットでは動かしていない色。既定値のまま持たせておく項目 */
const FIXED_DEFAULTS = {
  lineColor: "#33261f",
  blushColor: "#f0a08f",
  eyeColor: "#2f2622",
  glassColor: "#2b2b2b",
  lensColor: "#8fd6ff",
  lensOpacity: 20,
  extraColor: "#f27a86",
  frameThickness: 0,
  frameColor: "#ffffff",
} as const;

function pick<T>(rng: RandomSource, arr: readonly T[]): T {
  const idx = Math.min(Math.floor(rng.next() * arr.length), arr.length - 1);
  return arr[idx];
}

function randomIndex(rng: RandomSource, count: number): number {
  return Math.min(Math.floor(rng.next() * count), count - 1);
}

/**
 * 選手の見た目をシードから決定的に生成する。
 * 同じ内容の rng（同じシードから作った Rng）を渡せば、常に同じ結果になる。
 */
export function generatePlayerAppearance(
  rng: RandomSource,
  options: GeneratePlayerAppearanceOptions = {}
): PlayerAppearance {
  const gear = options.gear !== false;
  const team = pick(rng, TEAM_COLORS);
  const role = rng.next();

  let body = pick(rng, BODY_CHOICES);
  let hat: number;
  let item: number;
  let hair: number;

  if (gear) {
    hat = role < 0.35 ? 8 : role < 0.5 ? 9 : pick(rng, [1, 1, 10, 11]);
    item = hat === 9 ? 2 : role < 0.35 ? pick(rng, [1, 1, 4]) : pick(rng, [0, 1, 2, 3, 5]);
    if (hat === 9) body = 12;
    hair = pick(rng, GEAR_HAIR_CHOICES);
  } else {
    hat = 0;
    item = 0;
    hair = pick(rng, NO_GEAR_HAIR_CHOICES);
  }

  const cloth1Color = rng.next() < 0.6 ? "#f4f3ef" : "#c9ccd1";
  const hairColor = pick(rng, HAIR_COLORS);

  const bg = pick(rng, [6, 6, 7, 1]);
  let bg1Color = bg === 7 ? "#123055" : "#8fd4f0";
  let bg2Color = bg === 7 ? "#0a1a30" : bg === 1 ? "#ffffff" : "#4f9d55";
  if (bg === 1) {
    bg1Color = team[0];
    bg2Color = "#ffffff";
  }

  return {
    head: randomIndex(rng, PART_COUNTS.head),
    hair,
    eye: randomIndex(rng, PART_COUNTS.eye),
    brow: pick(rng, BROW_CHOICES),
    nose: randomIndex(rng, PART_COUNTS.nose),
    mouth: randomIndex(rng, PART_COUNTS.mouth),
    beard: rng.next() < 0.25 ? pick(rng, [1, 2, 3]) : 0,
    body,
    hat,
    glasses: 0,
    extra: rng.next() < 0.45 ? 6 : 0,
    item,
    bg,

    skinColor: pick(rng, SKIN_COLORS),
    lineColor: FIXED_DEFAULTS.lineColor,
    blushColor: FIXED_DEFAULTS.blushColor,
    hairColor,
    hairLineColor: "#241c18",
    eyeColor: FIXED_DEFAULTS.eyeColor,
    browColor: hairColor,
    mouthColor: "#8c3a3a",
    beardColor: hairColor,
    cloth1Color,
    cloth2Color: team[0],
    hat1Color: team[0],
    hat2Color: team[1],
    glassColor: FIXED_DEFAULTS.glassColor,
    lensColor: FIXED_DEFAULTS.lensColor,
    lensOpacity: FIXED_DEFAULTS.lensOpacity,
    extraColor: FIXED_DEFAULTS.extraColor,
    itemColor: "#b5763a",
    textColor: "#ffffff",
    textLineColor: team[1],
    bg1Color,
    bg2Color,

    frameThickness: FIXED_DEFAULTS.frameThickness,
    frameColor: FIXED_DEFAULTS.frameColor,

    eyeGapOffset: 0,
    eyeYOffset: 0,
    browYOffset: 0,

    hatText: options.hatText ?? "",
    numberText: options.number != null ? String(options.number) : "",
  };
}
