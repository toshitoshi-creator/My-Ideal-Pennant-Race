/**
 * 性格（PHASE 2）。
 *
 * 性格は「全能力を常時 1.20 倍」のような極端な効果は持たせず、
 * 項目ごとに 1.01〜1.20 倍の範囲で影響する。
 */

export type PersonalityId =
  | 'hardWorker'
  | 'genius'
  | 'competitive'
  | 'calm'
  | 'leader'
  | 'moodMaker'
  | 'sensitive'
  | 'myPace'
  | 'ambitious'
  | 'craftsman';

export interface PersonalityEffects {
  /** シーズン終了時の成長量への倍率 */
  growth: number;
  /** 技術系能力（ミート・制球・変化量・守備・捕球）の成長倍率 */
  technicalGrowth: number;
  /** 疲労回復量の倍率 */
  fatigueRecovery: number;
  /** 疲労による能力低下の受けやすさ（小さいほど強い） */
  fatigueSensitivity: number;
  /** コンディションの振れ幅（小さいほど安定） */
  conditionSwing: number;
  /** 接戦（1点差以内・終盤）での実効能力倍率 */
  closeGame: number;
  /** 重要場面のプレッシャーによる低下の受けやすさ（小さいほど動じない） */
  pressureSensitivity: number;
  /** 連敗時のモチベーション低下の受けやすさ */
  losingStreakSensitivity: number;
  /** 出場機会が少ないときのモチベーション低下の受けやすさ */
  benchSensitivity: number;
  /** 活躍したときのモチベーション上昇の倍率 */
  successMotivation: number;
  /** チーム士気への影響力（1.0 が標準） */
  teamMoraleInfluence: number;
  /** 勝利時のチーム士気上昇の倍率 */
  winMoraleBonus: number;
  /** 潜在能力生成時の上振れ */
  potentialBonus: number;
  /** 成長のばらつき（小さいほど安定） */
  growthVariance: number;
  /** 特殊能力の習得しやすさ */
  specialAbilityGain: number;
}

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  description: string;
  /** 選手詳細に出す効果の要約 */
  summary: string[];
  effects: PersonalityEffects;
}

const BASE: PersonalityEffects = {
  growth: 1,
  technicalGrowth: 1,
  fatigueRecovery: 1,
  fatigueSensitivity: 1,
  conditionSwing: 1,
  closeGame: 1,
  pressureSensitivity: 1,
  losingStreakSensitivity: 1,
  benchSensitivity: 1,
  successMotivation: 1,
  teamMoraleInfluence: 1,
  winMoraleBonus: 1,
  potentialBonus: 0,
  growthVariance: 1,
  specialAbilityGain: 1,
};

function def(
  id: PersonalityId,
  name: string,
  description: string,
  summary: string[],
  effects: Partial<PersonalityEffects>,
): PersonalityDef {
  return { id, name, description, summary, effects: { ...BASE, ...effects } };
}

export const PERSONALITIES: PersonalityDef[] = [
  def(
    'hardWorker',
    '努力家',
    '地道な練習を重ねることで成長しやすい。疲れもすぐに抜ける。',
    ['成長率 +15%', '疲労回復 +5%'],
    { growth: 1.15, fatigueRecovery: 1.05 },
  ),
  def(
    'genius',
    '天才肌',
    '感覚で技術を掴む。技術系の能力が伸びやすく、素質に恵まれやすい。',
    ['技術系能力の成長 +10%', '潜在能力が高くなりやすい'],
    { technicalGrowth: 1.1, potentialBonus: 8, growthVariance: 1.15 },
  ),
  def(
    'competitive',
    '負けず嫌い',
    '競った展開ほど力を発揮する。負けが込んでも気持ちが切れない。',
    ['接戦での実効能力 +10%', '連敗時のモチベーション低下を軽減'],
    { closeGame: 1.1, losingStreakSensitivity: 0.6 },
  ),
  def(
    'calm',
    '冷静',
    'どんな場面でも平常心を保つ。大事な試合でも力を落としにくい。',
    ['プレッシャーによる低下を軽減', 'コンディションが安定'],
    { pressureSensitivity: 0.45, conditionSwing: 0.85 },
  ),
  def(
    'leader',
    'リーダー',
    'チームを引っ張る存在。本人だけでなくチーム全体に良い影響を与える。',
    ['チーム士気への影響が大きい', '接戦にやや強い'],
    { teamMoraleInfluence: 1.6, closeGame: 1.03 },
  ),
  def(
    'moodMaker',
    'ムードメーカー',
    'チームの雰囲気を明るくする。勝ったときの盛り上がりが違う。',
    ['勝利時のチーム士気上昇 +40%', '連敗時の士気低下を軽減'],
    { winMoraleBonus: 1.4, losingStreakSensitivity: 0.7, teamMoraleInfluence: 1.2 },
  ),
  def(
    'sensitive',
    '繊細',
    '調子の波が結果に出やすい。乗ったときの上振れも大きい。',
    ['不調時の低下が大きい', '絶好調時の上昇も大きい'],
    { conditionSwing: 1.45, pressureSensitivity: 1.3, fatigueSensitivity: 1.15 },
  ),
  def(
    'myPace',
    'マイペース',
    '周囲に左右されない。疲れや調子の波の影響を受けにくい。',
    ['疲労の影響 -40%', 'コンディション変動が小さい'],
    { fatigueSensitivity: 0.6, conditionSwing: 0.6, benchSensitivity: 0.7 },
  ),
  def(
    'ambitious',
    '野心家',
    '常に上を目指す。出番が減ると腐りやすいが、活躍すれば勢いに乗る。',
    ['出場機会が少ないとモチベーション低下', '活躍時のモチベーション上昇 +50%'],
    { benchSensitivity: 1.6, successMotivation: 1.5 },
  ),
  def(
    'craftsman',
    '職人気質',
    '一つの技を磨き続ける。成長は安定していて、特殊能力を身につけやすい。',
    ['成長が安定', '特殊能力を習得しやすい'],
    { growthVariance: 0.6, technicalGrowth: 1.05, specialAbilityGain: 1.35 },
  ),
];

const BY_ID = new Map(PERSONALITIES.map((p) => [p.id, p]));

export function personalityDef(id: PersonalityId | null | undefined): PersonalityDef {
  return (id && BY_ID.get(id)) || PERSONALITIES[0];
}

export function personalityEffects(id: PersonalityId | null | undefined): PersonalityEffects {
  return personalityDef(id).effects;
}

export const PERSONALITY_IDS: PersonalityId[] = PERSONALITIES.map((p) => p.id);
