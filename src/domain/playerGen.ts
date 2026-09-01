import type { Player, PlayerExtensions, PositionId } from './types';
import { Rng } from './rng';
import { clamp1to100 } from './rank';
import { SURNAMES, GIVEN_NAMES } from './names';

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

function emptyExtensions(): PlayerExtensions {
  return {
    personality: null,
    specialSkills: [],
    potential: null,
    popularity: null,
    growthRate: null,
    fatigue: 0,
    condition: 3,
    injury: null,
    contract: null,
    faStatus: null,
  };
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

export function generateTeamPlayers(rng: Rng, options: GeneratePlayersOptions): Player[] {
  const { teamId, strength } = options;
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
    const trajectory = isPitcher
      ? 1
      : Math.max(1, Math.min(4, 1 + Math.round((power - 20) / 26) + (rng.chance(0.15) ? 1 : 0)));

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
      ext: emptyExtensions(),
    };
    players.push(player);
  }
  return players;
}
