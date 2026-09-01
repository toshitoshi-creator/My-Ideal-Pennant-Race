/**
 * 成長・衰退（PHASE 2）。
 *
 * 成長量 = 基礎成長値 × 年齢補正 × 成長タイプ補正 × 性格補正 × 潜在能力補正
 *          × 能力別成長傾向 × 出場経験補正 × モチベーション補正 × ランダム補正
 *
 * 育成施設などの将来の補正は GrowthModifiers に足していけるようにしてある。
 */
import type { Player } from './types';
import { Rng } from './rng';
import { personalityEffects } from './personality';

export type GrowthTypeId =
  | 'early'
  | 'normal'
  | 'late'
  | 'superLate'
  | 'genius'
  | 'stable'
  | 'volatile';

export interface GrowthTypeDef {
  id: GrowthTypeId;
  name: string;
  description: string;
  /**
   * 成長曲線の傾き。プラスほど「若いうちに伸びて早く衰える」、
   * マイナスほど「若いうちは伸びにくいが長く成長する」。
   */
  peakShift: number;
  /** 成長量全体の倍率 */
  scale: number;
  /** ばらつき */
  variance: number;
  /** 衰退の速さ */
  declineScale: number;
}

export const GROWTH_TYPES: GrowthTypeDef[] = [
  { id: 'early', name: '早熟', description: '若いうちに一気に伸びるが、ピークが早く訪れる。', peakShift: 0.5, scale: 1.1, variance: 1, declineScale: 1.2 },
  { id: 'normal', name: '普通', description: '標準的なペースで成長する。', peakShift: 0, scale: 1, variance: 1, declineScale: 1 },
  { id: 'late', name: '晩成', description: '20代後半まで伸び続ける。', peakShift: -0.25, scale: 1, variance: 1, declineScale: 0.85 },
  { id: 'superLate', name: '超晩成', description: '30歳近くまで伸びしろが残る大器。', peakShift: -0.5, scale: 0.95, variance: 1.1, declineScale: 0.7 },
  { id: 'genius', name: '天才型', description: '若くして完成する。伸びも落ちも急。', peakShift: 0.15, scale: 1.25, variance: 1.35, declineScale: 1.1 },
  { id: 'stable', name: '安定型', description: '大きく伸びないが崩れにくい。', peakShift: -0.1, scale: 0.85, variance: 0.55, declineScale: 0.75 },
  { id: 'volatile', name: '波瀾型', description: '伸びる年と落ちる年の差が激しい。', peakShift: 0, scale: 1, variance: 1.9, declineScale: 1.15 },
];

const GROWTH_TYPE_BY_ID = new Map(GROWTH_TYPES.map((g) => [g.id, g]));

export function growthTypeDef(id: GrowthTypeId | null | undefined): GrowthTypeDef {
  return (id && GROWTH_TYPE_BY_ID.get(id)) || GROWTH_TYPES[1];
}

export const GROWTH_TYPE_IDS: GrowthTypeId[] = GROWTH_TYPES.map((g) => g.id);

/**
 * 年齢による成長のしやすさ。正なら成長、負なら衰退。
 * 18〜20:非常に成長しやすい / 21〜23:成長しやすい / 24〜26:標準 /
 * 27〜28:成長しにくい / 29〜30:ほぼ横ばい / 31〜33:徐々に衰退 /
 * 34〜36:衰退しやすい / 37〜:大きく衰退
 */
export function ageGrowthFactor(age: number, growthType: GrowthTypeId): number {
  // §4 の年齢帯（普通型の基準カーブ）
  let base: number;
  if (age <= 20) base = 1.6;
  else if (age <= 23) base = 1.2;
  else if (age <= 26) base = 0.8;
  else if (age <= 28) base = 0.4;
  else if (age <= 30) base = 0.12;
  else if (age <= 33) base = -0.3;
  else if (age <= 36) base = -0.7;
  else base = -1.1;

  const def = growthTypeDef(growthType);
  // 早熟は若いうちに上振れして早く落ち、晩成はその逆になるよう傾ける
  const tilted = base + def.peakShift * ((24 - age) / 8);
  const clamped = Math.max(-2, Math.min(2.2, tilted));
  return clamped >= 0 ? clamped * def.scale : clamped * def.declineScale;
}

/** 能力ごとの成長傾向 */
export type GrowthTendencyId =
  | 'hitting'
  | 'power'
  | 'speed'
  | 'defense'
  | 'balanced'
  | 'pitchingPower'
  | 'pitchingControl';

export interface GrowthTendencyDef {
  id: GrowthTendencyId;
  name: string;
  /** 能力キーごとの成長倍率（1 が標準） */
  weights: Partial<Record<AbilityKey, number>>;
}

export type AbilityKey =
  | 'trajectory'
  | 'contact'
  | 'power'
  | 'speed'
  | 'arm'
  | 'fielding'
  | 'catching'
  | 'velocity'
  | 'control'
  | 'stamina'
  | 'pitcherPower'
  | 'movement';

export const BATTER_ABILITY_KEYS: AbilityKey[] = [
  'trajectory', 'contact', 'power', 'speed', 'arm', 'fielding', 'catching',
];
export const PITCHER_ABILITY_KEYS: AbilityKey[] = [
  'velocity', 'control', 'stamina', 'pitcherPower', 'movement',
];

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  trajectory: '弾道',
  contact: 'ミート',
  power: 'パワー',
  speed: '走力',
  arm: '肩力',
  fielding: '守備力',
  catching: '捕球',
  velocity: '球速',
  control: '制球',
  stamina: 'スタミナ',
  pitcherPower: '球威',
  movement: '変化量',
};

/** 技術系（天才肌・職人気質の補正対象） */
const TECHNICAL_KEYS = new Set<AbilityKey>([
  'contact', 'fielding', 'catching', 'control', 'movement',
]);

export const GROWTH_TENDENCIES: GrowthTendencyDef[] = [
  { id: 'hitting', name: '打撃型', weights: { contact: 1.5, power: 1.1, trajectory: 1.1, speed: 0.9, fielding: 0.7, catching: 0.7, arm: 0.7 } },
  { id: 'power', name: 'パワー型', weights: { power: 1.6, trajectory: 1.4, contact: 0.9, speed: 0.6, fielding: 0.7, catching: 0.8, arm: 0.9 } },
  { id: 'speed', name: '走力型', weights: { speed: 1.6, contact: 1.1, fielding: 1.1, power: 0.6, trajectory: 0.6, arm: 0.9, catching: 1 } },
  { id: 'defense', name: '守備型', weights: { fielding: 1.6, catching: 1.5, arm: 1.3, speed: 1.1, contact: 0.8, power: 0.6, trajectory: 0.6 } },
  { id: 'balanced', name: 'バランス型', weights: {} },
  { id: 'pitchingPower', name: '本格派', weights: { velocity: 1.4, pitcherPower: 1.4, stamina: 1.1, control: 0.8, movement: 0.9 } },
  { id: 'pitchingControl', name: '技巧派', weights: { control: 1.5, movement: 1.4, stamina: 1.1, velocity: 0.7, pitcherPower: 0.8 } },
];

const TENDENCY_BY_ID = new Map(GROWTH_TENDENCIES.map((t) => [t.id, t]));

export function growthTendencyDef(id: GrowthTendencyId | null | undefined): GrowthTendencyDef {
  return (id && TENDENCY_BY_ID.get(id)) || GROWTH_TENDENCIES[4];
}

export const GROWTH_TENDENCY_IDS: GrowthTendencyId[] = GROWTH_TENDENCIES.map((t) => t.id);

/** 能力ごとの衰退しやすさ（大きいほど早く落ちる） */
const DECLINE_RATE: Record<AbilityKey, number> = {
  speed: 1.5,
  velocity: 1.3,
  stamina: 1.15,
  power: 0.95,
  pitcherPower: 1,
  arm: 1,
  trajectory: 0.45,
  contact: 0.7,
  fielding: 0.55,
  catching: 0.45,
  movement: 0.7,
  control: 0.35,
};

/** 将来の育成施設・コーチなどを足すための補正 */
export interface GrowthModifiers {
  /** 施設などによる全体倍率 */
  facility?: number;
  /** 練習・育成方針などによる倍率 */
  training?: number;
}

export interface GrowthInput {
  player: Player;
  /** 1軍での出場度合い 0〜1 */
  firstTeamExperience: number;
  /** 2軍での出場度合い 0〜1 */
  secondTeamExperience: number;
  /** 成績評価 -1〜1（0が平均的） */
  performance: number;
  modifiers?: GrowthModifiers;
}

export interface AbilityChange {
  key: AbilityKey;
  before: number;
  after: number;
}

export interface PlayerGrowthResult {
  playerId: string;
  name: string;
  teamId: string;
  ageBefore: number;
  ageAfter: number;
  changes: AbilityChange[];
  /** 覚醒したか */
  awakened: boolean;
  /** 総変化量（正なら成長） */
  total: number;
  gainedAbilities: string[];
}

export function abilityValue(player: Player, key: AbilityKey): number {
  switch (key) {
    case 'velocity':
      return player.pitching?.velocity ?? 0;
    case 'control':
      return player.pitching?.control ?? 0;
    case 'stamina':
      return player.pitching?.stamina ?? 0;
    case 'pitcherPower':
      return player.pitching?.power ?? 0;
    case 'movement':
      return player.pitching?.movement ?? 0;
    default:
      return player.batting[key as keyof typeof player.batting];
  }
}

export function setAbilityValue(player: Player, key: AbilityKey, value: number): void {
  switch (key) {
    case 'velocity':
      if (player.pitching) player.pitching.velocity = clampVelocity(value);
      return;
    case 'control':
      if (player.pitching) player.pitching.control = clamp100(value);
      return;
    case 'stamina':
      if (player.pitching) player.pitching.stamina = clamp100(value);
      return;
    case 'pitcherPower':
      if (player.pitching) player.pitching.power = clamp100(value);
      return;
    case 'movement':
      if (player.pitching) player.pitching.movement = clamp100(value);
      return;
    default:
      player.batting[key as 'contact'] = clamp100(value);
  }
}

/** 1〜100 のスケールを km/h に戻す */
export function scaleToVelocity(scaled: number): number {
  return 122 + (scaled * 43) / 100;
}

/** 球速は 1〜100 ではなく km/h なので専用のスケールで扱う */
export const VELOCITY_MIN = 120;
export const VELOCITY_MAX = 165;

function clampVelocity(value: number): number {
  return Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(value)));
}

function clamp100(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

/** 球速を 1〜100 の潜在能力スケールに合わせるための換算 */
function velocityToScale100(kmh: number): number {
  return ((kmh - 122) / 43) * 100;
}

/** 現在能力が潜在能力にどれだけ近いか（0=到達済み, 1=まだ遠い） */
export function potentialHeadroom(current: number, potential: number): number {
  if (potential <= 0) return 0;
  return Math.max(0, (potential - current) / potential);
}

/** 1能力あたりの成長量を計算する */
function growthForAbility(
  rng: Rng,
  input: GrowthInput,
  key: AbilityKey,
  ageFactor: number,
): number {
  const { player } = input;
  const ext = player.ext;
  const personality = personalityEffects(ext.personality);
  const type = growthTypeDef(ext.growthType);
  const tendency = growthTendencyDef(ext.growthTendency);

  const current = abilityValue(player, key);
  const currentScaled = key === 'velocity' ? velocityToScale100(current) : current;
  const potential = ext.potential;

  const weight = tendency.weights[key] ?? 1;
  const technical = TECHNICAL_KEYS.has(key) ? personality.technicalGrowth : 1;

  if (ageFactor >= 0) {
    // ---- 成長 ----
    const headroom = potentialHeadroom(currentScaled, potential);
    if (headroom <= 0) return 0;
    const experience =
      0.45 + input.firstTeamExperience * 0.75 + input.secondTeamExperience * 0.3;
    const motivation = 0.85 + (ext.motivation / 100) * 0.3;
    const performanceBonus = 1 + Math.max(-0.15, Math.min(0.25, input.performance * 0.25));
    const modifiers = (input.modifiers?.facility ?? 1) * (input.modifiers?.training ?? 1);
    const variance = type.variance * personality.growthVariance;
    const random = 1 + rng.normal(0, 0.35) * variance;

    const amount =
      3.4 *
      ageFactor *
      (ext.growthRate ?? 1) *
      personality.growth *
      technical *
      weight *
      Math.min(1.15, headroom * 1.7) *
      experience *
      motivation *
      performanceBonus *
      modifiers *
      Math.max(0, random);
    return amount;
  }

  // ---- 衰退 ----
  // 能力が低いところまで落ちたら、それ以上は大きく下がらないようにする
  const floor = Math.max(0, Math.min(1, (currentScaled - 12) / 25));
  const decline =
    1.6 *
    -ageFactor *
    DECLINE_RATE[key] *
    (1 + rng.normal(0, 0.3) * type.variance) *
    // 出場していると衰えがやや緩やか
    (1 - input.firstTeamExperience * 0.2) *
    floor;
  return -Math.max(0, decline);
}

/** 覚醒条件を満たすか（低確率） */
function checkAwakening(rng: Rng, input: GrowthInput): boolean {
  const { player } = input;
  const ext = player.ext;
  if (player.age > 24) return false;
  if (ext.potential < 58) return false;
  if (input.firstTeamExperience < 0.3) return false;
  if (ext.motivation < 65) return false;
  return rng.chance(0.06);
}

/**
 * 1選手のシーズン終了時の成長・衰退を適用する（player を直接更新する）。
 * 年齢の加算もここで行う。
 */
export function applySeasonGrowth(rng: Rng, input: GrowthInput): PlayerGrowthResult {
  const { player } = input;
  const ext = player.ext;
  const ageBefore = player.age;
  const keys = player.isPitcher
    ? [...PITCHER_ABILITY_KEYS, 'speed' as AbilityKey, 'fielding' as AbilityKey]
    : BATTER_ABILITY_KEYS;

  const ageFactor = ageGrowthFactor(player.age, ext.growthType);
  const awakened = checkAwakening(rng, input);
  const changes: AbilityChange[] = [];

  for (const key of keys) {
    const before = abilityValue(player, key);
    let delta = growthForAbility(rng, input, key, ageFactor);
    if (awakened && delta >= 0) delta *= 2.6;

    if (key === 'velocity') {
      // 球速は km/h。1〜100 換算のおよそ 0.43 倍で動かす
      delta *= 0.43;
    }

    // 潜在能力を超えては成長しない（衰退方向には効かない）
    if (delta > 0) {
      const cap = key === 'velocity' ? scaleToVelocity(ext.potential) : ext.potential;
      delta = before >= cap ? 0 : Math.min(delta, cap - before);
    }

    const next = before + delta;
    setAbilityValue(player, key, next);
    const after = abilityValue(player, key);
    if (after !== before) changes.push({ key, before, after });
  }

  player.age = ageBefore + 1;

  const total = changes.reduce((sum, c) => sum + (c.after - c.before), 0);
  return {
    playerId: player.id,
    name: player.name,
    teamId: player.teamId,
    ageBefore,
    ageAfter: player.age,
    changes,
    awakened,
    total,
    gainedAbilities: [],
  };
}

/** 潜在能力の表示用ラベル（実数値は見せない） */
export type PotentialLabel = '非常に高い' | '高い' | '普通' | '低い' | '非常に低い';

export function potentialLabel(potential: number): PotentialLabel {
  if (potential >= 78) return '非常に高い';
  if (potential >= 64) return '高い';
  if (potential >= 48) return '普通';
  if (potential >= 34) return '低い';
  return '非常に低い';
}

/**
 * 将来 PHASE 3 でスカウトの調査力によって推定精度を変えられるようにするための関数。
 * accuracy 1 で正確、0 に近いほどぶれる。
 */
export function scoutedPotentialLabel(
  potential: number,
  accuracy: number,
  seed: number,
): PotentialLabel {
  const rng = new Rng(seed);
  const error = (1 - Math.max(0, Math.min(1, accuracy))) * 18;
  return potentialLabel(potential + rng.normal(0, error));
}
