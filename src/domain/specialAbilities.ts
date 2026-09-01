/**
 * 特殊能力（PHASE 2）。
 *
 * 特殊能力は能力値そのものではなく、試合中の「イベント発生率」への係数として働く。
 * Lv1〜Lv3 を持てる設計で、PHASE 2 では主に Lv1 を使う。
 * 複数持っている場合は掛け算されるが、効果キーごとに上限・下限を設けて
 * 補正が積み重なりすぎないようにしている。
 */

export type SpecialAbilityId =
  // 野手（プラス）
  | 'powerHitter'
  | 'contactHitter'
  | 'sprayHitter'
  | 'goodEye'
  | 'basestealer'
  | 'baserunning'
  | 'fieldingMaster'
  | 'laserBeam'
  | 'clutch'
  | 'vsLeftBatter'
  | 'adversity'
  | 'grandSlam'
  | 'walkOff'
  | 'foulOff'
  | 'intimidation'
  // 投手（プラス）
  | 'strikeoutPitcher'
  | 'risingBall'
  | 'sharpBreak'
  | 'pinchStrong'
  | 'vsLeftPitcher'
  | 'quickDelivery'
  | 'toughPitcher'
  | 'pitcherIntimidation'
  | 'lowBall'
  | 'heavyBall'
  // 野手（マイナス）
  | 'clutchWeak'
  | 'vsLeftWeak'
  | 'strikeoutProne'
  | 'doublePlayProne'
  | 'errorProne'
  | 'throwingTrouble'
  // 投手（マイナス）
  | 'wildWalk'
  | 'gopherBall'
  | 'blowup'
  | 'unlucky'
  | 'pinchWeak';

/** 試合エンジンが参照する効果キー */
export type EffectKey =
  // 打者
  | 'batHomeRun'
  | 'batHit'
  | 'batWalk'
  | 'batStrikeout'
  | 'batDouble'
  | 'stealAttempt'
  | 'stealSuccess'
  | 'extraBase'
  | 'doublePlay'
  // 守備
  | 'defense'
  | 'error'
  | 'catcherArm'
  // 投手
  | 'pitStrikeout'
  | 'pitWalk'
  | 'pitHit'
  | 'pitHomeRun'
  | 'pitGroundBall'
  | 'pitStealSuppress'
  | 'pitFatigue'
  | 'runSupport'
  // 相手への影響
  | 'opponentPitcherWalk'
  | 'opponentBatterHit';

export type Polarity = 'positive' | 'negative';
export type AbilityKind = 'batter' | 'pitcher';

/** 効果が働く場面 */
export type SituationKey =
  | 'always'
  | 'scoringPosition'
  | 'basesLoaded'
  | 'lateClose'
  | 'behind'
  | 'vsLeftHand'
  | 'pinch';

export interface SpecialAbilityDef {
  id: SpecialAbilityId;
  name: string;
  kind: AbilityKind;
  polarity: Polarity;
  description: string;
  situation: SituationKey;
  /** Lv1 あたりの倍率。Lv n では 1 + (v - 1) * n として効く */
  effects: Partial<Record<EffectKey, number>>;
}

export const SPECIAL_ABILITIES: SpecialAbilityDef[] = [
  // ---- 野手 プラス ----
  { id: 'powerHitter', name: 'パワーヒッター', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '長打力に優れ、本塁打が出やすい。', effects: { batHomeRun: 1.25, batDouble: 1.05 } },
  { id: 'contactHitter', name: 'アベレージヒッター', kind: 'batter', polarity: 'positive', situation: 'always',
    description: 'バットに当てるのがうまく、安打が出やすい。', effects: { batHit: 1.1, batStrikeout: 0.95 } },
  { id: 'sprayHitter', name: '広角打法', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '広角に打ち分け、安打と二塁打が増える。', effects: { batHit: 1.06, batDouble: 1.12 } },
  { id: 'goodEye', name: '選球眼', kind: 'batter', polarity: 'positive', situation: 'always',
    description: 'ボール球に手を出さず、四球が多い。', effects: { batWalk: 1.28, batStrikeout: 0.92 } },
  { id: 'basestealer', name: '盗塁', kind: 'batter', polarity: 'positive', situation: 'always',
    description: 'スタートがうまく、盗塁を決めやすい。', effects: { stealAttempt: 1.5, stealSuccess: 1.1 } },
  { id: 'baserunning', name: '走塁', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '次の塁を狙う判断がよく、進塁が多い。', effects: { extraBase: 1.25, doublePlay: 0.9 } },
  { id: 'fieldingMaster', name: '守備職人', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '守備範囲が広く、堅実。', effects: { defense: 1.08, error: 0.65 } },
  { id: 'laserBeam', name: 'レーザービーム', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '強肩で走者を刺す。', effects: { catcherArm: 1.15, defense: 1.02 } },
  { id: 'clutch', name: 'チャンス', kind: 'batter', polarity: 'positive', situation: 'scoringPosition',
    description: '得点圏に走者がいると力を発揮する。', effects: { batHit: 1.12, batHomeRun: 1.12 } },
  { id: 'vsLeftBatter', name: '対左', kind: 'batter', polarity: 'positive', situation: 'vsLeftHand',
    description: '左投手を得意にしている。', effects: { batHit: 1.12, batHomeRun: 1.08 } },
  { id: 'adversity', name: '逆境', kind: 'batter', polarity: 'positive', situation: 'behind',
    description: '負けている展開で粘り強い。', effects: { batHit: 1.1, batWalk: 1.08 } },
  { id: 'grandSlam', name: '満塁男', kind: 'batter', polarity: 'positive', situation: 'basesLoaded',
    description: '満塁の場面で一発が出る。', effects: { batHomeRun: 1.35, batHit: 1.08 } },
  { id: 'walkOff', name: 'サヨナラ男', kind: 'batter', polarity: 'positive', situation: 'lateClose',
    description: '終盤の競った場面に強い。', effects: { batHit: 1.12, batHomeRun: 1.12 } },
  { id: 'foulOff', name: '粘り打ち', kind: 'batter', polarity: 'positive', situation: 'always',
    description: 'ファウルで粘り、三振が少なく四球が多い。', effects: { batStrikeout: 0.88, batWalk: 1.1 } },
  { id: 'intimidation', name: '威圧感', kind: 'batter', polarity: 'positive', situation: 'always',
    description: '打席に立つだけで投手が嫌がる。', effects: { opponentPitcherWalk: 1.15, batHomeRun: 1.05 } },

  // ---- 投手 プラス ----
  { id: 'strikeoutPitcher', name: '奪三振', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '三振を奪う力がある。', effects: { pitStrikeout: 1.18 } },
  { id: 'risingBall', name: 'ノビ', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '直球に伸びがあり、打者が振り遅れる。', effects: { pitStrikeout: 1.08, pitHit: 0.95 } },
  { id: 'sharpBreak', name: 'キレ', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '変化球のキレがよく、芯を外せる。', effects: { pitHit: 0.92, pitStrikeout: 1.05 } },
  { id: 'pinchStrong', name: '対ピンチ', kind: 'pitcher', polarity: 'positive', situation: 'pinch',
    description: 'ピンチで踏ん張れる。', effects: { pitHit: 0.86, pitHomeRun: 0.85 } },
  { id: 'vsLeftPitcher', name: '対左', kind: 'pitcher', polarity: 'positive', situation: 'vsLeftHand',
    description: '左打者を苦にしない。', effects: { pitHit: 0.88, pitStrikeout: 1.08 } },
  { id: 'quickDelivery', name: 'クイック', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '投球動作が速く、走者を走らせない。', effects: { pitStealSuppress: 0.8 } },
  { id: 'toughPitcher', name: '打たれ強さ', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '打たれても崩れず、スタミナ切れの影響が小さい。', effects: { pitFatigue: 0.7 } },
  { id: 'pitcherIntimidation', name: '威圧感', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: 'マウンドでの存在感で打者を圧倒する。', effects: { opponentBatterHit: 0.94 } },
  { id: 'lowBall', name: '低め○', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '低めに集められ、ゴロが多く長打が少ない。', effects: { pitGroundBall: 1.15, pitHomeRun: 0.82 } },
  { id: 'heavyBall', name: '重い球', kind: 'pitcher', polarity: 'positive', situation: 'always',
    description: '球が重く、外野まで飛ばされにくい。', effects: { pitHomeRun: 0.85, pitHit: 0.96 } },

  // ---- 野手 マイナス ----
  { id: 'clutchWeak', name: 'チャンス×', kind: 'batter', polarity: 'negative', situation: 'scoringPosition',
    description: '得点圏で力んでしまう。', effects: { batHit: 0.86, batHomeRun: 0.9 } },
  { id: 'vsLeftWeak', name: '対左×', kind: 'batter', polarity: 'negative', situation: 'vsLeftHand',
    description: '左投手が苦手。', effects: { batHit: 0.86, batStrikeout: 1.1 } },
  { id: 'strikeoutProne', name: '三振', kind: 'batter', polarity: 'negative', situation: 'always',
    description: '空振りが多く三振しやすい。', effects: { batStrikeout: 1.18 } },
  { id: 'doublePlayProne', name: '併殺', kind: 'batter', polarity: 'negative', situation: 'always',
    description: 'ゲッツーになりやすい。', effects: { doublePlay: 1.35 } },
  { id: 'errorProne', name: 'エラー', kind: 'batter', polarity: 'negative', situation: 'always',
    description: '守備でミスが出やすい。', effects: { error: 1.5, defense: 0.97 } },
  { id: 'throwingTrouble', name: '送球難', kind: 'batter', polarity: 'negative', situation: 'always',
    description: '送球が不安定。', effects: { error: 1.3, catcherArm: 0.88 } },

  // ---- 投手 マイナス ----
  { id: 'wildWalk', name: '四球', kind: 'pitcher', polarity: 'negative', situation: 'always',
    description: '制球が定まらず四球が多い。', effects: { pitWalk: 1.3 } },
  { id: 'gopherBall', name: '一発', kind: 'pitcher', polarity: 'negative', situation: 'always',
    description: '甘く入った球を長打にされやすい。', effects: { pitHomeRun: 1.4 } },
  { id: 'blowup', name: '乱調', kind: 'pitcher', polarity: 'negative', situation: 'always',
    description: '崩れ出すと止まらない。試合によって出来の波が大きい。', effects: { pitWalk: 1.12, pitHit: 1.05 } },
  { id: 'unlucky', name: '負け運', kind: 'pitcher', polarity: 'negative', situation: 'always',
    description: 'なぜか味方の援護に恵まれない。', effects: { runSupport: 0.9 } },
  { id: 'pinchWeak', name: '対ピンチ×', kind: 'pitcher', polarity: 'negative', situation: 'pinch',
    description: 'ピンチで動揺してしまう。', effects: { pitHit: 1.14, pitHomeRun: 1.12 } },
];

const BY_ID = new Map(SPECIAL_ABILITIES.map((a) => [a.id, a]));

export function specialAbilityDef(id: SpecialAbilityId): SpecialAbilityDef | undefined {
  return BY_ID.get(id);
}

export interface SpecialAbilityEntry {
  id: SpecialAbilityId;
  /** 1〜3 */
  level: number;
}

/** 効果キーごとの補正上限（積み重なりすぎ防止） */
const EFFECT_LIMITS: Record<string, [number, number]> = {
  default: [0.6, 1.7],
  batHomeRun: [0.6, 1.9],
  batHit: [0.75, 1.35],
  batWalk: [0.7, 1.6],
  batStrikeout: [0.7, 1.5],
  pitHit: [0.75, 1.35],
  pitHomeRun: [0.55, 1.8],
  pitWalk: [0.7, 1.6],
  pitStrikeout: [0.75, 1.45],
  error: [0.5, 2],
  defense: [0.9, 1.2],
  runSupport: [0.85, 1.15],
};

/** 場面 */
export interface SituationFlags {
  scoringPosition?: boolean;
  basesLoaded?: boolean;
  lateClose?: boolean;
  behind?: boolean;
  vsLeftHand?: boolean;
  pinch?: boolean;
}

function situationActive(situation: SituationKey, flags: SituationFlags): boolean {
  if (situation === 'always') return true;
  return flags[situation] === true;
}

/**
 * 選手の持つ特殊能力から、指定した効果キーの合成倍率を返す。
 * 効果がなければ 1。
 *
 * conditionScale（PHASE 2.5）は調子による発動しやすさ。
 * 能力値には触れず、係数の «1 からのズレ» だけを拡大・縮小する。
 * 好調なら長所が出やすく短所が出にくい／不調ならその逆。
 * 効果キーごとの上限は最後に必ず適用される。
 */
export function abilityEffect(
  entries: SpecialAbilityEntry[] | undefined,
  key: EffectKey,
  flags: SituationFlags = {},
  conditionScale = 1,
): number {
  if (!entries || entries.length === 0) return 1;
  let value = 1;
  for (const entry of entries) {
    const def = BY_ID.get(entry.id);
    if (!def) continue;
    const factor = def.effects[key];
    if (factor === undefined) continue;
    if (!situationActive(def.situation, flags)) continue;
    const level = Math.max(1, Math.min(3, entry.level));
    // 長所は好調で伸び、短所は好調なら出にくくなる
    const scale = def.polarity === 'positive' ? conditionScale : 2 - conditionScale;
    value *= 1 + (factor - 1) * level * scale;
  }
  const [min, max] = EFFECT_LIMITS[key] ?? EFFECT_LIMITS.default;
  return Math.max(min, Math.min(max, value));
}

export function hasAbility(
  entries: SpecialAbilityEntry[] | undefined,
  id: SpecialAbilityId,
): boolean {
  return !!entries?.some((e) => e.id === id);
}

export function positiveAbilities(entries: SpecialAbilityEntry[]): SpecialAbilityEntry[] {
  return entries.filter((e) => BY_ID.get(e.id)?.polarity === 'positive');
}

export function negativeAbilities(entries: SpecialAbilityEntry[]): SpecialAbilityEntry[] {
  return entries.filter((e) => BY_ID.get(e.id)?.polarity === 'negative');
}
