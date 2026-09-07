/**
 * PHASE 4.5 選手の見た目（Appearance Profile）。
 *
 * ここは「どの部品で組み立てるか」を決めるだけの純粋な層。
 * SVG も React も知らないし、GameState を書き換えない。
 *
 * 守ること：
 *   - ゲームの乱数（rngState）を読まない・進めない
 *   - Math.random / Date.now / performance.now を使わない
 *   - 能力・成績・年俸・成長を一切変更しない
 *   - 同じ playerId なら、どの画面でも・何度開いても・別のセーブでも同じ人物になる
 *
 * 「選手画像を選ぶ」のではなく「選手を部品から組み立てる」。
 * Players are assembled, not selected.
 */
import type { GameState, Player } from './types';

/**
 * 見た目アルゴリズムの版。
 * 部品を足したときに既存選手の顔が変わらないよう、seed に混ぜる。
 * 既存セーブの選手は version 1 のまま扱う。
 */
export const APPEARANCE_VERSION = 1;

/* ================= ハッシュ ================= */

/**
 * 文字列から 32bit の値を作る（FNV-1a）。
 *
 * ゲームの乱数器とは完全に別物で、状態を持たない純粋関数。
 * 呼んでも rngState は動かない。
 */
export function appearanceHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * seed の「salt 番目の枝」から 0〜max-1 を取り出す。
 * 同じ seed・同じ salt からは必ず同じ値。
 */
export function pickIndex(seed: number, salt: number, max: number): number {
  if (max <= 0) return 0;
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h >>> 0) % max;
}

/** 一覧から1つ選ぶ */
function pickOne<T>(seed: number, salt: number, list: readonly T[]): T {
  return list[pickIndex(seed, salt, list.length)];
}

/** 0〜99 を取り出す（確率判定に使う） */
function roll(seed: number, salt: number): number {
  return pickIndex(seed, salt, 100);
}

/* ================= 部品の一覧 ================= */

export const HEAD_IDS = [
  'head_01_round',
  'head_02_oval',
  'head_03_square',
  'head_04_long',
  'head_05_wide',
  'head_06_narrow',
  'head_07_jaw',
  'head_08_soft',
  'head_09_angular',
  'head_10_heavy',
] as const;
export type HeadId = (typeof HEAD_IDS)[number];

export const HAIR_IDS = [
  'hair_01_crop',
  'hair_02_short',
  'hair_03_side_part',
  'hair_04_medium',
  'hair_05_swept',
  'hair_06_spiky',
  'hair_07_bowl',
  'hair_08_long',
  'hair_09_curly',
  'hair_10_wave',
  'hair_11_buzz',
  'hair_12_undercut',
  'hair_13_receding',
  'hair_14_thin',
  'hair_15_volume',
] as const;
export type HairId = (typeof HAIR_IDS)[number];

/** 年齢で髪が変わるとき、どの髪型へ寄せるか（別人にはしない） */
const HAIR_AGED: Partial<Record<HairId, HairId>> = {
  hair_04_medium: 'hair_02_short',
  hair_05_swept: 'hair_03_side_part',
  hair_06_spiky: 'hair_01_crop',
  hair_08_long: 'hair_04_medium',
  hair_09_curly: 'hair_10_wave',
  hair_15_volume: 'hair_02_short',
  hair_02_short: 'hair_13_receding',
  hair_03_side_part: 'hair_13_receding',
  hair_01_crop: 'hair_11_buzz',
  hair_13_receding: 'hair_14_thin',
};

export const EYEBROW_IDS = [
  'brow_01_thick',
  'brow_02_thin',
  'brow_03_straight',
  'brow_04_raised',
  'brow_05_drooping',
  'brow_06_arched',
  'brow_07_dense',
  'brow_08_light',
  'brow_09_short',
  'brow_10_long',
] as const;
export type EyebrowId = (typeof EYEBROW_IDS)[number];

export const EYE_IDS = [
  'eye_01_round',
  'eye_02_narrow',
  'eye_03_large',
  'eye_04_small',
  'eye_05_droop',
  'eye_06_sharp',
  'eye_07_wide',
  'eye_08_deep',
  'eye_09_athletic',
  'eye_10_gentle',
  'eye_11_keen',
  'eye_12_calm',
] as const;
export type EyeId = (typeof EYE_IDS)[number];

export const NOSE_IDS = [
  'nose_01_small',
  'nose_02_high',
  'nose_03_broad',
  'nose_04_long',
  'nose_05_short',
  'nose_06_round',
  'nose_07_straight',
  'nose_08_downward',
  'nose_09_strong',
  'nose_10_hooked',
] as const;
export type NoseId = (typeof NOSE_IDS)[number];

export const MOUTH_IDS = [
  'mouth_01_thin',
  'mouth_02_full',
  'mouth_03_small',
  'mouth_04_wide',
  'mouth_05_straight',
  'mouth_06_upturn',
  'mouth_07_downturn',
  'mouth_08_slight_smile',
  'mouth_09_flat',
  'mouth_10_pressed',
] as const;
export type MouthId = (typeof MOUTH_IDS)[number];

export const EAR_IDS = [
  'ear_01_standard',
  'ear_02_small',
  'ear_03_large',
  'ear_04_pointed',
  'ear_05_flat',
  'ear_06_lobed',
] as const;
export type EarId = (typeof EAR_IDS)[number];

export const JAW_IDS = [
  'jaw_01_soft',
  'jaw_02_standard',
  'jaw_03_square',
  'jaw_04_narrow',
  'jaw_05_heavy',
  'jaw_06_cleft',
] as const;
export type JawId = (typeof JAW_IDS)[number];

export const BODY_IDS = [
  'body_01_slim',
  'body_02_average',
  'body_03_athletic',
  'body_04_power',
  'body_05_broad',
  'body_06_tall',
  'body_07_short',
  'body_08_stocky',
  'body_09_pitcher',
  'body_10_heavy',
] as const;
export type BodyId = (typeof BODY_IDS)[number];

export const SKIN_IDS = [
  'skin_01',
  'skin_02',
  'skin_03',
  'skin_04',
  'skin_05',
  'skin_06',
  'skin_07',
  'skin_08',
] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export const HAIR_COLOR_IDS = [
  'hairc_01_black',
  'hairc_02_soft_black',
  'hairc_03_dark_brown',
  'hairc_04_brown',
  'hairc_05_light_brown',
  'hairc_06_ash',
  'hairc_07_grey',
  'hairc_08_white',
] as const;
export type HairColorId = (typeof HAIR_COLOR_IDS)[number];

/** 若い選手には出さない色（白髪・グレー） */
const AGED_HAIR_COLORS: HairColorId[] = ['hairc_06_ash', 'hairc_07_grey', 'hairc_08_white'];
/** 年齢に関係なく選ばれる、自然な範囲の髪色 */
const NATURAL_HAIR_COLORS: HairColorId[] = [
  'hairc_01_black',
  'hairc_01_black',
  'hairc_02_soft_black',
  'hairc_02_soft_black',
  'hairc_03_dark_brown',
  'hairc_03_dark_brown',
  'hairc_04_brown',
  'hairc_05_light_brown',
];

export const FACIAL_HAIR_IDS = [
  'face_01_none',
  'face_02_light_stubble',
  'face_03_stubble',
  'face_04_moustache',
  'face_05_beard_short',
  'face_06_beard_full',
  'face_07_moustache_beard',
  'face_08_chin',
] as const;
export type FacialHairId = (typeof FACIAL_HAIR_IDS)[number];

export const ACCESSORY_IDS = [
  'acc_glasses',
  'acc_eye_black',
  'acc_wristband',
  'acc_neck_chain',
] as const;
export type AccessoryId = (typeof ACCESSORY_IDS)[number];

export const UNIFORM_IDS = [
  'uni_home',
  'uni_home_stripe',
  'uni_visitor',
  'uni_third',
  'uni_practice',
] as const;
export type UniformId = (typeof UNIFORM_IDS)[number];

/* ================= 表情・ポーズ ================= */

export const EXPRESSIONS = [
  'neutral',
  'focused',
  'confident',
  'happy',
  'disappointed',
  'tired',
  'angry',
  'surprised',
  'injured',
  'celebrating',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const EXPRESSION_LABELS: Record<Expression, string> = {
  neutral: '平常',
  focused: '集中',
  confident: '自信',
  happy: '笑顔',
  disappointed: '落胆',
  tired: '疲労',
  angry: '闘志',
  surprised: '驚き',
  injured: '離脱中',
  celebrating: '歓喜',
};

export const POSES = [
  'pose_idle',
  'pose_standing',
  'pose_bat',
  'pose_pitch',
  'pose_crossed_arm',
  'pose_ready',
  'pose_celebrate',
  'pose_disappointed',
] as const;
export type Pose = (typeof POSES)[number];

export const POSE_LABELS: Record<Pose, string> = {
  pose_idle: '立ち姿',
  pose_standing: '正面',
  pose_bat: '打席',
  pose_pitch: '投球',
  pose_crossed_arm: '腕組み',
  pose_ready: '構え',
  pose_celebrate: '歓喜',
  pose_disappointed: '落胆',
};

/* ================= 年齢 ================= */

export type AgeStage = 'YOUTH' | 'PRIME' | 'MATURE' | 'VETERAN' | 'ELDER';

export const AGE_STAGE_LABELS: Record<AgeStage, string> = {
  YOUTH: '若手',
  PRIME: '全盛期',
  MATURE: '中堅',
  VETERAN: 'ベテラン',
  ELDER: '大ベテラン',
};

/** 年齢から段階を決める（18〜22 / 23〜27 / 28〜31 / 32〜35 / 36〜） */
export function ageStageOf(age: number): AgeStage {
  if (age <= 22) return 'YOUTH';
  if (age <= 27) return 'PRIME';
  if (age <= 31) return 'MATURE';
  if (age <= 35) return 'VETERAN';
  return 'ELDER';
}

/** ひげが出る確率（年齢段階ごと）。若手ほど低い */
const FACIAL_HAIR_CHANCE: Record<AgeStage, number> = {
  YOUTH: 8,
  PRIME: 26,
  MATURE: 40,
  VETERAN: 52,
  ELDER: 58,
};

/** 白髪・グレーになる確率 */
const GREY_CHANCE: Record<AgeStage, number> = {
  YOUTH: 0,
  PRIME: 0,
  MATURE: 4,
  VETERAN: 18,
  ELDER: 44,
};

/** 髪が変化する確率（生え際・ボリューム） */
const HAIR_CHANGE_CHANCE: Record<AgeStage, number> = {
  YOUTH: 0,
  PRIME: 0,
  MATURE: 12,
  VETERAN: 26,
  ELDER: 42,
};

/* ================= Appearance Profile ================= */

/**
 * 年齢に左右されない「その人そのもの」の部分。
 * playerId だけで決まり、移籍しても成長しても変わらない。
 */
export interface BaseAppearance {
  version: number;
  seed: number;
  playerId: string;
  head: HeadId;
  skin: SkinId;
  ears: EarId;
  hair: HairId;
  hairColor: HairColorId;
  eyebrows: EyebrowId;
  eyes: EyeId;
  nose: NoseId;
  mouth: MouthId;
  jaw: JawId;
  /** ひげの「素質」。実際に生えるかは年齢で決まる */
  facialHairStyle: FacialHairId;
  accessories: AccessoryId[];
}

/** 実際に描くときの見た目（年齢と体格を反映したもの） */
export interface PlayerAppearance extends BaseAppearance {
  age: number;
  ageStage: AgeStage;
  /** その年齢での髪型 */
  hair: HairId;
  /** その年齢での髪色 */
  hairColor: HairColorId;
  /** その年齢で実際に生えているひげ */
  facialHair: FacialHairId;
  /** 顔に入る年輪（0〜2）。線を1〜2本足すだけ */
  ageLines: number;
  body: BodyId;
  uniform: UniformId;
  /** 表示のみ。左右の向きに使う */
  handedness: 'R' | 'L';
  isPitcher: boolean;
}

/** 見た目を作るために必要な、ゲーム側の最小の情報 */
export interface AppearanceInput {
  playerId: string;
  age: number;
  isPitcher: boolean;
  /** 表示上の体格にだけ使う。能力値は一切変えない */
  power?: number;
  speed?: number;
  stamina?: number;
  handedness?: 'R' | 'L';
  uniform?: UniformId;
}

/**
 * その選手の「素の顔」を作る。
 * player.id と APPEARANCE_VERSION だけから決まるので、
 * 能力が変わっても、球団が変わっても、年を取っても同じ人物のまま。
 */
export function baseAppearanceOf(playerId: string, version = APPEARANCE_VERSION): BaseAppearance {
  const seed = appearanceHash(`player-appearance-v${version}:${playerId}`);
  const accessories: AccessoryId[] = [];
  // 眼鏡は少数。アイブラックは出場する選手の雰囲気づけ
  if (roll(seed, 40) < 9) accessories.push('acc_glasses');
  if (roll(seed, 41) < 12) accessories.push('acc_eye_black');

  return {
    version,
    seed,
    playerId,
    head: pickOne(seed, 1, HEAD_IDS),
    skin: pickOne(seed, 2, SKIN_IDS),
    ears: pickOne(seed, 3, EAR_IDS),
    hair: pickOne(seed, 4, HAIR_IDS),
    hairColor: pickOne(seed, 5, NATURAL_HAIR_COLORS),
    eyebrows: pickOne(seed, 6, EYEBROW_IDS),
    eyes: pickOne(seed, 7, EYE_IDS),
    nose: pickOne(seed, 8, NOSE_IDS),
    mouth: pickOne(seed, 9, MOUTH_IDS),
    jaw: pickOne(seed, 10, JAW_IDS),
    facialHairStyle: pickOne(seed, 11, FACIAL_HAIR_IDS.slice(1) as readonly FacialHairId[]),
    accessories,
  };
}

/**
 * 表示上の体格を決める。
 *
 * 能力値を書き換えることは絶対にしない。
 * 「パワーがある選手はがっしりして見える」程度の見た目の対応づけで、
 * 顔の造作（＝その人らしさ）には一切影響しない。
 */
export function bodyOf(input: AppearanceInput, seed: number): BodyId {
  const power = input.power ?? 50;
  const speed = input.speed ?? 50;
  const stamina = input.stamina ?? 50;
  if (input.isPitcher) {
    if (stamina >= 58) return power >= 62 ? 'body_06_tall' : 'body_09_pitcher';
    return power >= 62 ? 'body_05_broad' : pickOne(seed, 20, ['body_02_average', 'body_09_pitcher'] as const);
  }
  if (power >= 70) return speed >= 60 ? 'body_03_athletic' : 'body_04_power';
  if (power >= 58) return speed >= 62 ? 'body_03_athletic' : 'body_08_stocky';
  if (speed >= 68) return 'body_01_slim';
  if (power <= 32 && speed <= 40) return 'body_10_heavy';
  return pickOne(seed, 21, ['body_02_average', 'body_07_short', 'body_05_broad'] as const);
}

/**
 * 年齢を反映した見た目を作る。
 *
 * 「別人になる」ほど変えない。輪郭・目・鼻・口・耳は動かさず、
 * 髪・髪色・ひげ・年輪だけが少しずつ変わる。
 */
export function buildAppearance(input: AppearanceInput): PlayerAppearance {
  const base = baseAppearanceOf(input.playerId);
  const stage = ageStageOf(input.age);
  const seed = base.seed;

  // ---- 髪 ----
  let hair = base.hair;
  if (roll(seed, 30) < HAIR_CHANGE_CHANCE[stage]) {
    hair = HAIR_AGED[hair] ?? hair;
    // 大ベテランはもう一段だけ進む
    if (stage === 'ELDER' && roll(seed, 31) < 45) hair = HAIR_AGED[hair] ?? hair;
  }

  // ---- 髪色 ----
  let hairColor = base.hairColor;
  const greyRoll = roll(seed, 32);
  if (greyRoll < GREY_CHANCE[stage]) {
    hairColor = stage === 'ELDER' && greyRoll < 12
      ? 'hairc_08_white'
      : AGED_HAIR_COLORS[pickIndex(seed, 33, 2)];
  }

  // ---- ひげ ----
  const facialHair: FacialHairId =
    roll(seed, 34) < FACIAL_HAIR_CHANCE[stage] ? base.facialHairStyle : 'face_01_none';

  // ---- 年輪 ----
  const ageLines = stage === 'ELDER' ? 2 : stage === 'VETERAN' ? 1 : stage === 'MATURE' ? (roll(seed, 35) < 40 ? 1 : 0) : 0;

  return {
    ...base,
    age: input.age,
    ageStage: stage,
    hair,
    hairColor,
    facialHair,
    ageLines,
    body: bodyOf(input, seed),
    uniform: input.uniform ?? 'uni_home',
    handedness: input.handedness ?? 'R',
    isPitcher: input.isPitcher,
  };
}

/** Player から見た目を作る */
export function appearanceOf(player: Player): PlayerAppearance {
  return buildAppearance({
    playerId: player.id,
    age: player.age,
    isPitcher: player.isPitcher,
    power: player.isPitcher ? (player.pitching?.power ?? 50) : player.batting.power,
    speed: player.batting.speed,
    stamina: player.pitching?.stamina ?? 50,
    handedness: player.isPitcher ? player.throws : player.bats,
  });
}

/**
 * 選手IDと年齢だけから作る（Player が手元に無い引退記録・成長レポート用）。
 * 顔は playerId だけで決まるので、現役のときの顔と必ず一致する。
 */
export function appearanceFromId(
  playerId: string,
  age: number,
  isPitcher = false,
): PlayerAppearance {
  return buildAppearance({ playerId, age, isPitcher });
}

/* ================= 表情 ================= */

/**
 * いまの状況から表情を決める。
 *
 * 見ているのは、すでにゲームが決めた状態だけ（怪我・調子・スランプ・疲労・年齢）。
 * ここで能力・成績・評価を作り出すことは一切しない。
 */
export function expressionOf(state: GameState, player: Player): Expression {
  if (player.ext.injury) return 'injured';
  if (player.ext.slump) return 'disappointed';
  if (player.ext.fatigue >= 78) return 'tired';
  if (player.ext.condition === 'best') return 'confident';
  if (player.ext.condition === 'good') return 'focused';
  if (player.ext.condition === 'worst') return 'disappointed';
  if (player.ext.condition === 'bad') return 'tired';
  const debut = player.ext.debutYear;
  if (debut !== null && debut >= state.year) return 'focused';
  return 'neutral';
}

/** 選手の守備位置から、大きく見せるときのポーズを決める */
export function poseOf(player: Pick<Player, 'isPitcher'>): Pose {
  return player.isPitcher ? 'pose_pitch' : 'pose_bat';
}

/* ================= 参考情報 ================= */

/** 用意されている部品の数（テストと README で使う） */
export const PART_COUNTS = {
  head: HEAD_IDS.length,
  hair: HAIR_IDS.length,
  eyebrows: EYEBROW_IDS.length,
  eyes: EYE_IDS.length,
  nose: NOSE_IDS.length,
  mouth: MOUTH_IDS.length,
  ears: EAR_IDS.length,
  jaw: JAW_IDS.length,
  body: BODY_IDS.length,
  skin: SKIN_IDS.length,
  hairColor: HAIR_COLOR_IDS.length,
  facialHair: FACIAL_HAIR_IDS.length,
  expression: EXPRESSIONS.length,
  pose: POSES.length,
} as const;

/** 顔の組み合わせの総数（年齢・表情・ポーズを除く） */
export function faceCombinationCount(): number {
  return (
    PART_COUNTS.head *
    PART_COUNTS.hair *
    PART_COUNTS.eyebrows *
    PART_COUNTS.eyes *
    PART_COUNTS.nose *
    PART_COUNTS.mouth *
    PART_COUNTS.ears *
    PART_COUNTS.jaw *
    PART_COUNTS.skin *
    PART_COUNTS.hairColor
  );
}
