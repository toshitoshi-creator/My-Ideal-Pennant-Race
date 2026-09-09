/**
 * PHASE 4.7 選手ビジュアルの設計図（Appearance Profile v3）。
 *
 * PHASE 4.5 は「SVGをその場で描く」ための設計図だった。
 * PHASE 4.6 では、外部の画像生成AIで作った素材を組み合わせるための設計図を足す。
 *
 * ここは純粋な計算だけの層。
 *   - 画像も React も知らない
 *   - ゲームの乱数（rngState）を読まない・進めない
 *   - Math.random / Date.now / performance.now を使わない
 *   - 能力・成績・年俸・成長・ロスターを一切変更しない
 *   - 画像があってもなくても、返す値は同じ
 *
 * 素材が1枚も無い状態でも動く。そのときは PHASE 4.5 の SVG が描かれる。
 */
import type { Player, PositionId } from './types';
import {
  ageStageOf,
  appearanceFromId,
  appearanceOf,
  expressionOf,
  type AgeStage,
  type Expression,
  type PlayerAppearance,
} from './playerAppearance';
import type { GameState } from './types';

/**
 * 設計図の版。
 * 素材を足したときに既存選手の顔が変わらないよう、ハッシュの種に混ぜる。
 * v1（PHASE 4.5 の SVG）とは別系列なので、片方を足してももう片方は動かない。
 */
export const VISUAL_PROFILE_VERSION = 3;

/* ================= ハッシュ ================= */

/**
 * 文字列から 32bit の値を作る（FNV-1a）。
 * ゲームの乱数器とは完全に別物で、状態を持たない純粋関数。
 */
export function visualHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** seed の salt 番目の枝から 0〜max-1 を取り出す */
export function visualPick(seed: number, salt: number, max: number): number {
  if (max <= 0) return 0;
  let h = (seed ^ Math.imul(salt + 1, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h >>> 0) % max;
}

/* ================= 素材の枠 ================= */

/** 画像素材の種類。config/visual-assets.json と対応する */
export const VISUAL_CATEGORIES = [
  'head',
  'hairBack',
  'hair',
  'eyebrows',
  'eyes',
  'nose',
  'mouth',
  'ears',
  'jaw',
  'beard',
  'body',
  'neck',
  'uniform',
  'cap',
  'glasses',
  'equipment',
  'expression',
  'pose',
  // PHASE 4.7 §4-18 状態を表す小さな重ね（怪我・疲労・新人など）
  'special',
] as const;
export type VisualCategory = (typeof VISUAL_CATEGORIES)[number];

/**
 * 顔として最低限そろっていないと「画像で描けた」とは言えない種類。
 *
 * ears / jaw / neck はここに入っていない。
 * PHASE 4.7 の C-2 で、耳・あご・首は **頭の素材の中に描き込まれる** ことにしたので、
 * 単独の素材としては存在しない（assets/prompts/style-bible.md §15）。
 * 単独で要求すると、いつまでも画像モードにならず SVG のままになってしまう。
 *
 * 足りないものが1つでもあれば SVG に落とす仕組み自体は、これまでどおり残す。
 */
export const REQUIRED_CATEGORIES: VisualCategory[] = [
  'head',
  'hair',
  'eyebrows',
  'eyes',
  'nose',
  'mouth',
  'body',
  'uniform',
];

/** 素材IDの並び（001 から始まる3桁） */
export function assetId(prefix: string, index: number): string {
  return `${prefix}_${String(index + 1).padStart(3, '0')}`;
}

/* ================= ポジションと構え ================= */

/** 画面に出すときの立ち姿。守備位置から決まる（§18） */
export type VisualStance = 'PITCHER' | 'CATCHER' | 'INFIELDER' | 'OUTFIELDER' | 'BATTER';

export const STANCE_LABELS: Record<VisualStance, string> = {
  PITCHER: '投球',
  CATCHER: '捕手の構え',
  INFIELDER: '内野の守備',
  OUTFIELDER: '外野の守備',
  BATTER: '打席',
};

/** 守備位置から立ち姿を決める */
export function stanceOf(position: PositionId, isPitcher: boolean): VisualStance {
  if (isPitcher || position === 'P') return 'PITCHER';
  if (position === 'C') return 'CATCHER';
  if (position === 'LF' || position === 'CF' || position === 'RF') return 'OUTFIELDER';
  return 'INFIELDER';
}

/** 立ち姿ごとの装備（§19）。顔を隠しすぎないものだけ */
export const STANCE_EQUIPMENT: Record<VisualStance, string[]> = {
  PITCHER: ['gear_glove'],
  CATCHER: ['gear_mask', 'gear_chest', 'gear_mitt'],
  INFIELDER: ['gear_glove'],
  OUTFIELDER: ['gear_glove'],
  BATTER: ['gear_helmet', 'gear_bat', 'gear_batting_glove'],
};

/** 立ち姿ごとのかぶり物。打席だけヘルメット、捕手はマスク */
export function headwearOf(stance: VisualStance): 'cap' | 'helmet' | 'mask' {
  if (stance === 'BATTER') return 'helmet';
  if (stance === 'CATCHER') return 'mask';
  return 'cap';
}

/** かぶり物ごとの素材ID。cap 種類の中で番号を固定して割り当てる */
export const HEADWEAR_ASSET: Record<'cap' | 'helmet' | 'mask', string> = {
  cap: 'cap_001',
  helmet: 'cap_002',
  mask: 'cap_003',
};

/** 立ち姿ごとの姿勢素材のID（§18） */
export const STANCE_POSE_ASSET: Record<VisualStance, string> = {
  PITCHER: 'pose_pitch_001',
  CATCHER: 'pose_catch_001',
  INFIELDER: 'pose_field_001',
  OUTFIELDER: 'pose_field_001',
  BATTER: 'pose_bat_001',
};

/** 立ち姿ごとに、いちばん手前に出す用具の素材ID */
export const STANCE_GEAR_ASSET: Record<VisualStance, string> = {
  PITCHER: 'gear_glove_001',
  CATCHER: 'gear_mitt_001',
  INFIELDER: 'gear_glove_001',
  OUTFIELDER: 'gear_glove_001',
  BATTER: 'gear_bat_001',
};

/** 表情の上書き素材のID。平常は下の目と口をそのまま見せるので素材を使わない */
export function expressionAsset(expression: Expression): string | null {
  return expression === 'neutral' ? null : `expression_${expression}_001`;
}

/**
 * PHASE 4.7 §4-18 状態を表す小さな重ね。
 *
 * 大事なのは向きで、**ゲームの状態から見た目が決まる**（§23）。
 * 見た目がゲームの状態を決めることは絶対にない。
 */
export type VisualState =
  | 'none'
  | 'injury'
  | 'fatigue'
  | 'slump'
  | 'hot'
  | 'rookie'
  | 'veteran';

export const VISUAL_STATE_LABELS: Record<VisualState, string> = {
  none: '通常',
  injury: '離脱中',
  fatigue: '疲労',
  slump: '不振',
  hot: '好調',
  rookie: '新人',
  veteran: 'ベテラン',
};

/** 状態の素材ID。none のときは素材を使わない */
export function specialAsset(state: VisualState): string | null {
  return state === 'none' ? null : `special_${state}_001`;
}

/**
 * いまの状態から、重ねる印を決める。
 * 見ているのはすでにゲームが決めた事実だけ（怪我・疲労・スランプ・調子・年数）。
 */
export function visualStateOf(state: GameState, player: Player): VisualState {
  if (player.ext.injury) return 'injury';
  if (player.ext.slump) return 'slump';
  if (player.ext.fatigue >= 78) return 'fatigue';
  if (player.ext.condition === 'best') return 'hot';
  const debut = player.ext.debutYear;
  if (debut !== null && debut >= state.year) return 'rookie';
  if (player.age >= 36) return 'veteran';
  return 'none';
}

/* ================= 設計図 ================= */

/** 画像素材の割り当て（種類 → 素材ID） */
export type PartAssignment = Partial<Record<VisualCategory, string>>;

export interface VisualProfile {
  version: number;
  playerId: string;
  seed: number;
  /** 画像素材の割り当て */
  parts: PartAssignment;
  /** 肌の段階（0〜7）。画像・SVGの両方で使う */
  skinTone: number;
  /** 髪色の段階（0〜9） */
  hairColor: number;
  age: number;
  ageStage: AgeStage;
  expression: Expression;
  stance: VisualStance;
  headwear: 'cap' | 'helmet' | 'mask';
  /** 身につけている装備のID */
  equipment: string[];
  /** 状態を表す印（§4-18・§23）。ゲームの状態から一方向に決まる */
  state: VisualState;
  /** 所属球団（ユニフォームの色に使う）。未所属なら null */
  teamId: string | null;
  /**
   * PHASE 4.5 の SVG 設計図。
   * 画像素材がそろっていないときはこちらで描く（§1・§37）。
   */
  svg: PlayerAppearance;
}

/** 設計図を作るのに必要な、ゲーム側の最小の情報 */
export interface VisualProfileInput {
  player: Player;
  /** 渡さなければ状態から決める */
  visualState?: VisualState;
  /** 渡さなければ状態から決める */
  expression?: Expression;
  /** 渡さなければ守備位置から決める */
  stance?: VisualStance;
  /** 表情を状態から決めるときに使う */
  state?: GameState;
}

/** 各種類に用意されている素材の数（manifest から渡す） */
export type CategoryCounts = Partial<Record<VisualCategory, number>>;

/**
 * 各種類の素材が「何種類あるか」の既定値。
 * manifest が空でも設計図は作れるようにするため、仕様上の想定数を持っておく。
 * 実際に何が存在するかは、描画側が manifest を見て判断する。
 */
export const DEFAULT_CATEGORY_COUNTS: Required<Pick<
  CategoryCounts,
  'head' | 'hair' | 'eyebrows' | 'eyes' | 'nose' | 'mouth' | 'ears' | 'jaw' | 'beard' | 'body' | 'neck'
>> = {
  head: 12,
  hair: 18,
  eyebrows: 12,
  eyes: 14,
  nose: 12,
  mouth: 12,
  ears: 8,
  jaw: 8,
  beard: 10,
  body: 10,
  neck: 6,
};

/** ハッシュの枝番号。種類ごとに固定して、素材を足しても他が動かないようにする */
const SALT: Record<string, number> = {
  head: 1,
  hair: 2,
  eyebrows: 3,
  eyes: 4,
  nose: 5,
  mouth: 6,
  ears: 7,
  jaw: 8,
  beard: 9,
  body: 10,
  neck: 11,
  skin: 12,
  hairColor: 13,
  glasses: 14,
  beardChance: 15,
  glassesChance: 16,
  greyChance: 17,
  hairBack: 18,
};

/** 年齢段階ごとのひげの出やすさ（§16） */
const BEARD_CHANCE: Record<AgeStage, number> = {
  YOUTH: 8,
  PRIME: 26,
  MATURE: 40,
  VETERAN: 52,
  ELDER: 58,
};

/** 年齢段階ごとの白髪の出やすさ */
const GREY_CHANCE: Record<AgeStage, number> = {
  YOUTH: 0,
  PRIME: 0,
  MATURE: 4,
  VETERAN: 18,
  ELDER: 44,
};

/**
 * 選手の設計図を作る。
 *
 * player.id と版番号だけから決まるので、
 * 移籍しても・成長しても・年を取っても・セーブを読み直しても同じ人物になる（§13・§35）。
 * 能力・成績・球団は顔の造作に一切影響しない。
 */
export function buildVisualProfile(
  input: VisualProfileInput,
  counts: CategoryCounts = {},
): VisualProfile {
  const { player } = input;
  return buildProfileCore(
    {
      playerId: player.id,
      age: player.age,
      stance: input.stance ?? stanceOf(player.mainPosition, player.isPitcher),
      expression:
        input.expression ?? (input.state ? expressionOf(input.state, player) : 'neutral'),
      state:
        input.visualState ?? (input.state ? visualStateOf(input.state, player) : 'none'),
      teamId: player.teamId || null,
      // PHASE 4.5 の設計図をそのまま持つ。素材が無いときはこれで描く
      svg: appearanceOf(player),
    },
    counts,
  );
}

/** Player が手元に無いとき（引退記録・成長レポート・歴史）に渡すもの */
export interface VisualProfileByIdInput {
  playerId: string;
  age: number;
  isPitcher?: boolean;
  expression?: Expression;
  stance?: VisualStance;
  visualState?: VisualState;
  teamId?: string | null;
}

/**
 * 選手IDと年齢だけから設計図を作る。
 * 顔は playerId だけで決まるので、現役のときの顔と必ず一致する（§13）。
 */
export function buildVisualProfileFromId(
  input: VisualProfileByIdInput,
  counts: CategoryCounts = {},
): VisualProfile {
  const isPitcher = input.isPitcher ?? false;
  return buildProfileCore(
    {
      playerId: input.playerId,
      age: input.age,
      stance: input.stance ?? (isPitcher ? 'PITCHER' : 'BATTER'),
      expression: input.expression ?? 'neutral',
      state: input.visualState ?? 'none',
      teamId: input.teamId ?? null,
      svg: appearanceFromId(input.playerId, input.age, isPitcher),
    },
    counts,
  );
}

/** 設計図を作るために本当に必要なものだけ */
interface ProfileCoreInput {
  playerId: string;
  age: number;
  stance: VisualStance;
  expression: Expression;
  state: VisualState;
  teamId: string | null;
  svg: PlayerAppearance;
}

function buildProfileCore(input: ProfileCoreInput, counts: CategoryCounts): VisualProfile {
  const seed = visualHash(`player-appearance-v${VISUAL_PROFILE_VERSION}:${input.playerId}`);
  const stage = ageStageOf(input.age);
  const n = (category: VisualCategory, fallback: number) => counts[category] ?? fallback;

  const parts: PartAssignment = {
    head: assetId('head', visualPick(seed, SALT.head, n('head', DEFAULT_CATEGORY_COUNTS.head))),
    hair: assetId('hair', visualPick(seed, SALT.hair, n('hair', DEFAULT_CATEGORY_COUNTS.hair))),
    eyebrows: assetId('brow', visualPick(seed, SALT.eyebrows, n('eyebrows', DEFAULT_CATEGORY_COUNTS.eyebrows))),
    eyes: assetId('eye', visualPick(seed, SALT.eyes, n('eyes', DEFAULT_CATEGORY_COUNTS.eyes))),
    nose: assetId('nose', visualPick(seed, SALT.nose, n('nose', DEFAULT_CATEGORY_COUNTS.nose))),
    mouth: assetId('mouth', visualPick(seed, SALT.mouth, n('mouth', DEFAULT_CATEGORY_COUNTS.mouth))),
    ears: assetId('ear', visualPick(seed, SALT.ears, n('ears', DEFAULT_CATEGORY_COUNTS.ears))),
    jaw: assetId('jaw', visualPick(seed, SALT.jaw, n('jaw', DEFAULT_CATEGORY_COUNTS.jaw))),
    body: assetId('body', visualPick(seed, SALT.body, n('body', DEFAULT_CATEGORY_COUNTS.body))),
    neck: assetId('neck', visualPick(seed, SALT.neck, n('neck', DEFAULT_CATEGORY_COUNTS.neck))),
    uniform: 'uniform_001',
  };

  // ひげは「素質」を先に決め、年齢で実際に生えるかを決める（別人にはしない。§16）
  if (visualPick(seed, SALT.beardChance, 100) < BEARD_CHANCE[stage]) {
    parts.beard = assetId('beard', visualPick(seed, SALT.beard, n('beard', DEFAULT_CATEGORY_COUNTS.beard)));
  }
  // 眼鏡はごく一部の選手だけ
  if (visualPick(seed, SALT.glassesChance, 100) < 9) {
    parts.glasses = assetId('glasses', visualPick(seed, SALT.glasses, Math.max(1, n('glasses', 6))));
  }

  const { stance, expression } = input;
  const headwear = headwearOf(stance);

  // ここから下は任意の種類。素材が無ければ描画側が黙って飛ばす（§21）
  parts.cap = HEADWEAR_ASSET[headwear];
  parts.pose = STANCE_POSE_ASSET[stance];
  parts.equipment = STANCE_GEAR_ASSET[stance];
  const expressionOverlay = expressionAsset(expression);
  if (expressionOverlay) parts.expression = expressionOverlay;
  const stateOverlay = specialAsset(input.state);
  if (stateOverlay) parts.special = stateOverlay;
  // 後ろ髪は、前髪と番号をそろえる（同じ髪型の裏側になるように）
  const hairBackCount = counts.hairBack ?? 0;
  if (hairBackCount > 0) {
    parts.hairBack = assetId('hairback', visualPick(seed, SALT.hairBack, hairBackCount));
  }

  // 白髪は年齢が上がってから。若い選手には出さない
  const baseHairColor = visualPick(seed, SALT.hairColor, 6);
  const greyRoll = visualPick(seed, SALT.greyChance, 100);
  const hairColor =
    greyRoll < GREY_CHANCE[stage] ? (stage === 'ELDER' && greyRoll < 12 ? 9 : 6 + (greyRoll % 3)) : baseHairColor;

  return {
    version: VISUAL_PROFILE_VERSION,
    playerId: input.playerId,
    seed,
    parts,
    skinTone: visualPick(seed, SALT.skin, 8),
    hairColor,
    age: input.age,
    ageStage: stage,
    expression,
    stance,
    headwear,
    equipment: STANCE_EQUIPMENT[stance],
    state: input.state,
    teamId: input.teamId,
    svg: input.svg,
  };
}

/**
 * 年齢だけを差し替えた設計図（引退記録・歴史など、当時の姿を出すとき）。
 * 顔の造作は動かない。
 */
export function visualProfileAtAge(profile: VisualProfile, age: number): VisualProfile {
  return { ...profile, age, ageStage: ageStageOf(age) };
}

/**
 * その設計図が、素材だけで描けるかどうか。
 * 足りないものが1つでもあれば SVG に落とす（§1・§50）。
 */
export function missingCategories(
  profile: VisualProfile,
  has: (category: VisualCategory, id: string) => boolean,
): VisualCategory[] {
  const missing: VisualCategory[] = [];
  for (const category of REQUIRED_CATEGORIES) {
    const id = profile.parts[category];
    if (!id || !has(category, id)) missing.push(category);
  }
  return missing;
}
