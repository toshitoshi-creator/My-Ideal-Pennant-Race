import type { ConditionId, Player, PlayerExtensions, PositionId } from './types';
import { Rng } from './rng';
import { clamp1to100, velocityToScale } from './rank';
import { SURNAMES, GIVEN_NAMES } from './names';
import { PERSONALITY_IDS, personalityEffects } from './personality';
import type { PersonalityId } from './personality';
import type { GrowthTendencyId, GrowthTypeId } from './growth';
import type { SpecialAbilityEntry, SpecialAbilityId } from './specialAbilities';
import { toDateString } from './dates';

/** プレイヤー球団の基本構成：投手10・捕手3・内野7・外野5 = 25人 */
export const DEFAULT_POSITION_PLAN: PositionId[] = [
  ...(Array(10).fill('P') as PositionId[]),
  'C', 'C', 'C',
  'SS', '2B', '3B', '1B', 'SS', '2B', '3B',
  'CF', 'LF', 'RF', 'CF', 'LF',
];

const SUB_POSITION_CANDIDATES: Record<PositionId, PositionId[]> = {
  P: [],
  C: ['1B'],
  '1B': ['3B'],
  '2B': ['SS', '3B'],
  '3B': ['1B', '2B'],
  SS: ['2B', '3B'],
  LF: ['RF', 'CF'],
  CF: ['LF', 'RF'],
  RF: ['LF', 'CF'],
};

/** PHASE 2 の個性を持たない既定値（セーブ移行時の補完にも使う） */
export function defaultExtensions(): PlayerExtensions {
  return {
    birthDate: null,
    potential: 50,
    growthType: 'normal',
    growthTendency: 'balanced',
    growthRate: 1,
    personality: 'hardWorker',
    specialAbilities: [],
    fatigue: 0,
    condition: 'normal',
    conditionTimer: 1,
    conditionHistory: [],
    motivation: 55,
    morale: 50,
    injury: null,
    injuryDemotion: false,
    slump: null,
    form: 50,
    consecutiveGames: 0,
    firstTeamGames: 0,
    secondTeamDays: 0,
    hiddenAttributes: {},
    popularity: null,
    contract: null,
    faStatus: null,
  };
}

/** 投手／野手それぞれの成長傾向 */
function pickGrowthTendency(
  rng: Rng,
  isPitcher: boolean,
  mainPosition: PositionId,
  power: number,
  speed: number,
): GrowthTendencyId {
  if (isPitcher) return rng.chance(0.5) ? 'pitchingPower' : 'pitchingControl';
  const roll = rng.next();
  if (power >= 55 && roll < 0.5) return 'power';
  if (speed >= 55 && roll < 0.5) return 'speed';
  if ((mainPosition === 'SS' || mainPosition === 'C' || mainPosition === 'CF') && roll < 0.55) {
    return 'defense';
  }
  if (roll < 0.35) return 'hitting';
  if (roll < 0.5) return 'balanced';
  if (roll < 0.65) return 'defense';
  if (roll < 0.8) return 'power';
  return 'speed';
}

function pickGrowthType(rng: Rng, age: number): GrowthTypeId {
  const roll = rng.next();
  if (roll < 0.16) return 'early';
  if (roll < 0.46) return 'normal';
  if (roll < 0.64) return 'late';
  if (roll < 0.72) return 'superLate';
  if (roll < 0.78) return 'genius';
  if (roll < 0.9) return 'stable';
  void age;
  return 'volatile';
}

/**
 * 現在能力・性格から潜在能力を決める。
 * 若い選手ほど「現在能力＜潜在能力」の幅が大きくなる。
 */
function makePotential(
  rng: Rng,
  currentOverall: number,
  age: number,
  personality: PersonalityId,
): number {
  const youth = Math.max(0, 30 - age);
  const headroom = rng.normal(youth * 1.15 + 4, 8) + personalityEffects(personality).potentialBonus;
  return clamp1to100(currentOverall + Math.max(-4, headroom));
}

const NUMBER_RANGES: Record<'P' | 'C' | 'IF' | 'OF', number[]> = {
  P: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 29, 34, 41, 42, 46, 47],
  C: [22, 27, 37, 62, 64],
  IF: [2, 3, 4, 5, 6, 7, 23, 25, 31, 33, 39],
  OF: [1, 8, 9, 24, 26, 32, 35, 51, 52, 55, 61, 63],
};

function numberGroup(pos: PositionId): 'P' | 'C' | 'IF' | 'OF' {
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  return pos === 'LF' || pos === 'CF' || pos === 'RF' ? 'OF' : 'IF';
}

function pickNumber(rng: Rng, pos: PositionId, used: Set<number>): number {
  const candidates = NUMBER_RANGES[numberGroup(pos)].filter((n) => !used.has(n));
  let num: number;
  if (candidates.length > 0) {
    num = rng.pick(candidates);
  } else {
    num = 1;
    while (used.has(num)) num += 1;
  }
  used.add(num);
  return num;
}

function ability(rng: Rng, mean: number, sd = 9): number {
  return clamp1to100(rng.normal(mean, sd));
}

function pickAge(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.18) return rng.int(18, 21);
  if (roll < 0.62) return rng.int(22, 27);
  if (roll < 0.9) return rng.int(28, 32);
  return rng.int(33, 38);
}

export interface GeneratePlayersOptions {
  teamId: string;
  /** 誕生年の計算に使う（省略時 2026） */
  startYear?: number;
  /** チームの平均能力の目安（1〜100） */
  strength: number;
  count?: number;
  /** 突出した選手の人数 */
  starCount?: number;
  /** 突出した選手の能力上乗せ幅 */
  starBonus?: [number, number];
  positionPlan?: PositionId[];
}

let idCounter = 0;

/** 同姓同名が出ても必ず別 ID になるようにする */
function newPlayerId(teamId: string): string {
  idCounter += 1;
  return `${teamId}-p${idCounter.toString(36)}-${Date.now().toString(36).slice(-4)}${Math.floor(
    Math.random() * 1296,
  )
    .toString(36)
    .padStart(2, '0')}`;
}

/** テスト用：ID カウンタをリセット（ID の一意性自体は乱数部分でも担保される） */
export function resetPlayerIdCounter(): void {
  idCounter = 0;
}


/** 現在能力のおおまかな総合値（潜在能力の基準に使う） */
function currentOverall(player: Player): number {
  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    return clamp1to100(
      velocityToScale(p.velocity) * 0.24 +
        p.control * 0.26 +
        p.stamina * 0.14 +
        p.power * 0.22 +
        p.movement * 0.14,
    );
  }
  const b = player.batting;
  return clamp1to100(
    b.contact * 0.3 + b.power * 0.26 + b.speed * 0.14 + b.fielding * 0.16 + b.catching * 0.08 + b.arm * 0.06,
  );
}

/**
 * 特殊能力を抽選する。
 *
 * 個数はまず「枠」を決めてから、どの能力になるかを能力値に応じた重みで選ぶ。
 * 能力の高い選手はプラスがつきやすく低い選手はマイナスがつきやすいが、
 * 誰にでも一定の確率があるので「強い選手だけがさらに強くなる」形にはしない。
 */
function rollSpecialAbilities(rng: Rng, player: Player): SpecialAbilityEntry[] {
  const gain = personalityEffects(player.ext.personality).specialAbilityGain;
  const overall = currentOverall(player);
  // 総合が高いほどプラスが多く、低いほどマイナスが多い（ただし差は小さめ）
  const positiveBias = (overall - 42) / 60;
  const negativeBias = (42 - overall) / 60;

  const pickCount = (bias: number, table: number[]): number => {
    const roll = rng.next() - Math.max(-0.2, Math.min(0.25, bias * 0.35));
    let acc = 0;
    for (let i = 0; i < table.length; i++) {
      acc += table[i];
      if (roll < acc) return i;
    }
    return table.length - 1;
  };

  const positiveCount = Math.min(
    3,
    Math.round(pickCount(positiveBias, [0.36, 0.35, 0.2, 0.09]) * gain),
  );
  const negativeCount = pickCount(negativeBias, [0.6, 0.3, 0.1]);

  const high = (value: number) => 0.5 + Math.max(0, (value - 40) / 22);
  const low = (value: number) => 0.5 + Math.max(0, (44 - value) / 22);

  let positives: Array<[SpecialAbilityId, number]>;
  let negatives: Array<[SpecialAbilityId, number]>;

  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    const velocity = velocityToScale(p.velocity);
    positives = [
      ['strikeoutPitcher', high((velocity + p.power) / 2)],
      ['risingBall', high(velocity)],
      ['sharpBreak', high(p.movement)],
      ['lowBall', high(p.control)],
      ['heavyBall', high(p.power)],
      ['pinchStrong', 0.9],
      ['vsLeftPitcher', 0.9],
      ['quickDelivery', 0.8],
      ['toughPitcher', 0.8],
      ['pitcherIntimidation', high(p.power) * 0.6],
    ];
    negatives = [
      ['wildWalk', low(p.control)],
      ['gopherBall', low(p.power)],
      ['blowup', low(p.control) * 0.8],
      ['unlucky', 0.6],
      ['pinchWeak', 0.7],
    ];
  } else {
    const b = player.batting;
    positives = [
      ['powerHitter', high(b.power)],
      ['contactHitter', high(b.contact)],
      ['sprayHitter', high(b.contact) * 0.8],
      ['goodEye', 0.9],
      ['basestealer', high(b.speed)],
      ['baserunning', high(b.speed) * 0.8],
      ['fieldingMaster', high(b.fielding)],
      ['laserBeam', high(b.arm) * 0.8],
      ['clutch', 0.9],
      ['vsLeftBatter', 0.9],
      ['adversity', 0.7],
      ['grandSlam', high(b.power) * 0.4],
      ['walkOff', 0.6],
      ['foulOff', high(b.contact) * 0.6],
      ['intimidation', high(b.power) * 0.5],
    ];
    negatives = [
      ['strikeoutProne', low(b.contact)],
      ['errorProne', low(b.fielding)],
      ['throwingTrouble', low(b.arm) * 0.8],
      ['doublePlayProne', low(b.speed) * 0.8],
      ['clutchWeak', 0.7],
      ['vsLeftWeak', 0.7],
    ];
  }

  const drawWeighted = (
    pool: Array<[SpecialAbilityId, number]>,
    count: number,
  ): SpecialAbilityId[] => {
    const chosen: SpecialAbilityId[] = [];
    const remaining = [...pool];
    for (let i = 0; i < count && remaining.length > 0; i++) {
      const total = remaining.reduce((sum, [, w]) => sum + w, 0);
      let r = rng.next() * total;
      let index = remaining.length - 1;
      for (let j = 0; j < remaining.length; j++) {
        r -= remaining[j][1];
        if (r <= 0) {
          index = j;
          break;
        }
      }
      chosen.push(remaining[index][0]);
      remaining.splice(index, 1);
    }
    return chosen;
  };

  return [
    ...drawWeighted(positives, positiveCount),
    ...drawWeighted(negatives, negativeCount),
  ].map((id) => ({
    id,
    // PHASE 2 では基本 Lv1。ごく一部だけ Lv2
    level: rng.chance(0.08) ? 2 : 1,
  }));
}

export function generateTeamPlayers(rng: Rng, options: GeneratePlayersOptions): Player[] {
  const { teamId, strength } = options;
  const startYear = options.startYear ?? 2026;
  const plan = options.positionPlan ?? DEFAULT_POSITION_PLAN;
  const count = options.count ?? plan.length;
  const starCount = options.starCount ?? 1;
  const [starMin, starMax] = options.starBonus ?? [12, 22];
  const used = new Set<number>();
  const starIndexes = new Set<number>();
  while (starIndexes.size < Math.min(starCount, count)) {
    starIndexes.add(rng.int(0, count - 1));
  }

  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const mainPosition = plan[i % plan.length];
    const bonus = starIndexes.has(i) ? rng.int(starMin, starMax) : 0;
    // ベンチ寄りの選手は少しだけ能力を落とす
    const depthPenalty = i >= 18 ? 4 : 0;
    const mean = strength + bonus - depthPenalty;
    const [surname, surnameKana] = rng.pick(SURNAMES);
    const [given, givenKana] = rng.pick(GIVEN_NAMES);
    const isPitcher = mainPosition === 'P';

    const subPositions: PositionId[] = [];
    for (const cand of SUB_POSITION_CANDIDATES[mainPosition]) {
      if (rng.chance(0.35)) subPositions.push(cand);
    }

    const power = isPitcher ? ability(rng, 12, 6) : ability(rng, mean);
    // 弾道は 1〜100。パワーとゆるく相関させつつ、独立したばらつきも持たせる
    const trajectory = isPitcher
      ? ability(rng, 16, 7)
      : clamp1to100(rng.normal(power * 0.55 + 24, 13));

    const player: Player = {
      id: newPlayerId(teamId),
      teamId,
      name: `${surname} ${given}`,
      kana: `${surnameKana} ${givenKana}`,
      age: pickAge(rng),
      uniformNumber: pickNumber(rng, mainPosition, used),
      throws: rng.chance(isPitcher ? 0.28 : 0.15) ? 'L' : 'R',
      bats: rng.chance(0.32) ? 'L' : 'R',
      mainPosition,
      subPositions,
      isPitcher,
      batting: {
        trajectory,
        contact: isPitcher ? ability(rng, 14, 6) : ability(rng, mean),
        power,
        speed: isPitcher ? ability(rng, 28, 8) : ability(rng, mean + (mainPosition === 'CF' ? 6 : 0)),
        arm: isPitcher ? ability(rng, 40, 8) : ability(rng, mean + (mainPosition === 'C' || mainPosition === 'RF' ? 5 : 0)),
        fielding: isPitcher ? ability(rng, 38, 8) : ability(rng, mean + (mainPosition === 'SS' || mainPosition === 'C' ? 5 : 0)),
        catching: isPitcher ? ability(rng, 36, 8) : ability(rng, mean),
      },
      pitching: isPitcher
        ? {
            velocity: Math.max(
              125,
              Math.min(162, Math.round(rng.normal(133 + (mean - 35) * 0.55, 4.5))),
            ),
            control: ability(rng, mean),
            stamina: ability(rng, i < 5 ? mean + 8 : mean - 6, 10),
            power: ability(rng, mean),
            movement: ability(rng, mean),
          }
        : null,
      roster: 'first',
      lastRosterChangeDate: null,
      ext: defaultExtensions(),
    };

    // ---- PHASE 2: 個性 ----
    const personality = rng.pick(PERSONALITY_IDS);
    const ext = player.ext;
    ext.personality = personality;
    ext.birthDate = toDateString(startYear - player.age, rng.int(1, 12), rng.int(1, 28));
    ext.growthType = pickGrowthType(rng, player.age);
    ext.growthTendency = pickGrowthTendency(
      rng,
      isPitcher,
      mainPosition,
      player.batting.power,
      player.batting.speed,
    );
    ext.growthRate = Math.round((0.5 + rng.next() * 1.0) * 100) / 100;
    ext.potential = makePotential(rng, currentOverall(player), player.age, personality);
    ext.motivation = clamp1to100(rng.normal(58, 12));
    ext.morale = clamp1to100(rng.normal(52, 8));
    ext.condition = rng.pick(['normal', 'normal', 'good', 'bad'] as ConditionId[]);
    ext.conditionTimer = rng.int(1, 5);
    ext.specialAbilities = rollSpecialAbilities(rng, player);

    players.push(player);
  }
  return players;
}
