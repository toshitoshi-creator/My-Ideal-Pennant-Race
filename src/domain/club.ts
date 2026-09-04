/**
 * 球団経営（PHASE 4.0）。
 *
 * 「今年は勝負するのか、若手を育てるのか、施設に投資するのか」という
 * 意思決定を作るための層。
 *
 * 設計上の約束：
 *  - 基本能力（batting / pitching / fielding）は絶対に書き換えない。
 *    効くのは成長判定の補正・出場機会・疲労回復・調査ポイントなど。
 *  - 施設は Lv1 がちょうど「補正なし」。上げると有利になるだけで、
 *    怪我を無効化したりスカウトを確定させたりはしない。
 *  - 乱数は PHASE 4.0 専用の系列を使い、既存の乱数列をずらさない。
 *  - 同じ状態・同じシードなら必ず同じ結果になる。
 */
import type {
  ClubDirection,
  ClubRating,
  ClubState,
  FacilityKind,
  FacilityLevel,
  FacilityState,
  GameState,
  ManagementEvent,
  ObjectiveKind,
  Player,
  TeamIdentity,
  TeamObjective,
  UsageRole,
} from './types';
import { Rng, seedFrom } from './rng';
import { overallRating } from './rating';
import { teamPayroll } from './contract';
import { standingsForLeague } from './standings';
import { era } from './stats';
import { refreshUserTeamPlan } from './teamAi';

/* ---------------- 乱数（PHASE 4.0 専用の系列） ---------------- */

export type ClubRngKind =
  | 'phase40Strategy'
  | 'phase40Facility'
  | 'phase40Development'
  | 'phase40Event'
  | 'phase40Objective'
  | 'phase40Identity';

/** PHASE 4.0 専用の乱数。共有の rngState は触らない */
export function clubRng(
  state: GameState,
  kind: ClubRngKind,
  ...parts: Array<string | number>
): Rng {
  return new Rng(seedFrom(`${kind}:${state.seed}:${state.year}:${parts.join(':')}`));
}

/* ---------------- 呼び名 ---------------- */

export const DIRECTIONS: ClubDirection[] = [
  'WIN_NOW',
  'DEVELOP',
  'REBUILD',
  'BALANCED',
  'THRIFTY',
];

export const DIRECTION_LABELS: Record<ClubDirection, string> = {
  WIN_NOW: '優勝狙い',
  DEVELOP: '若手育成',
  REBUILD: '再建',
  BALANCED: 'バランス',
  THRIFTY: '堅実経営',
};

export const DIRECTION_DESCRIPTIONS: Record<ClubDirection, string> = {
  WIN_NOW: 'ベテランを優先して起用し、補強にも積極的に動きます',
  DEVELOP: '若手に出場機会を多く与え、成長を促します',
  REBUILD: '若手中心に切り替え、将来性を重視して補強します',
  BALANCED: '戦力と将来性のつり合いを取ります',
  THRIFTY: '高額な契約を避け、資金の余力を残します',
};

export const USAGE_ROLES: UsageRole[] = ['CORE', 'SEMI', 'DEVELOP', 'BENCH', 'VETERAN'];

export const USAGE_LABELS: Record<UsageRole, string> = {
  CORE: '主力',
  SEMI: '準主力',
  DEVELOP: '育成',
  BENCH: '控え',
  VETERAN: 'ベテラン枠',
};

export const FACILITY_KINDS: FacilityKind[] = [
  'development',
  'medical',
  'scouting',
  'training',
];

export const FACILITY_LABELS: Record<FacilityKind, string> = {
  development: '育成施設',
  medical: '医療施設',
  scouting: 'スカウト施設',
  training: 'トレーニング施設',
};

export const FACILITY_DESCRIPTIONS: Record<FacilityKind, string> = {
  development: '若手が伸びやすくなります',
  medical: '怪我からの復帰が早く、長期離脱が減ります',
  scouting: 'ドラフト候補を多く調査できます',
  training: '疲労が抜けやすくなります',
};

export const IDENTITIES: TeamIdentity[] = [
  'DEVELOPER',
  'BIG_SPENDER',
  'DEFENSIVE',
  'SLUGGER',
  'PITCHING',
  'STEADY',
];

export const IDENTITY_LABELS: Record<TeamIdentity, string> = {
  DEVELOPER: '育成型',
  BIG_SPENDER: '大型補強型',
  DEFENSIVE: '守備型',
  SLUGGER: '打撃型',
  PITCHING: '投手王国',
  STEADY: '堅実型',
};

export const OBJECTIVE_LABELS: Record<ObjectiveKind, string> = {
  A_CLASS: 'Aクラス入り',
  LEAGUE_TITLE: 'リーグ優勝',
  YOUTH_GAMES: '若手の起用',
  TEAM_ERA: 'チーム防御率',
  AVERAGE_AGE: '平均年齢',
  PAYROLL: '総年俸',
  ROOKIE_GAMES: '新人の起用',
};

/* ---------------- 施設 ---------------- */

export const MAX_FACILITY_LEVEL: FacilityLevel = 5;

/** Lv を1つ上げるのに必要な資金 */
export function facilityCost(level: FacilityLevel): number {
  // Lv1→2 は 400、以降は段階的に高くなる
  return [0, 400, 700, 1100, 1600][level] ?? 0;
}

export function createFacilities(): FacilityState {
  return { development: 1, medical: 1, scouting: 1, training: 1 };
}

/**
 * 施設の効き目（0 が補正なし）。Lv1 で必ず 0 になる。
 * 上限を設けて、施設だけで能力が青天井にならないようにする。
 */
export function facilityBonus(level: FacilityLevel): number {
  return (Math.max(1, Math.min(MAX_FACILITY_LEVEL, level)) - 1) / 4;
}

export function facilitiesOf(state: GameState, teamId: string): FacilityState {
  return state.clubs?.[teamId]?.facilities ?? createFacilities();
}

export function facilityLevel(state: GameState, teamId: string, kind: FacilityKind): FacilityLevel {
  return facilitiesOf(state, teamId)[kind];
}

/** 育成施設による成長倍率（Lv1=1.00 〜 Lv5=1.24） */
export function developmentMultiplier(level: FacilityLevel): number {
  return 1 + facilityBonus(level) * 0.24;
}

/** 医療施設による離脱日数の短縮率（Lv1=1.00 〜 Lv5=0.80） */
export function recoveryMultiplier(level: FacilityLevel): number {
  return 1 - facilityBonus(level) * 0.2;
}

/** 医療施設による「重い怪我になりにくさ」（0〜0.08 だけ軽い側に寄せる） */
export function injurySeverityRelief(level: FacilityLevel): number {
  return facilityBonus(level) * 0.08;
}

/** スカウト施設による調査ポイントの上乗せ（Lv1=0 〜 Lv5=+24） */
export function scoutPointBonus(level: FacilityLevel): number {
  return Math.round(facilityBonus(level) * 24);
}

/** トレーニング施設による疲労回復倍率（Lv1=1.00 〜 Lv5=1.30） */
export function fatigueRecoveryMultiplier(level: FacilityLevel): number {
  return 1 + facilityBonus(level) * 0.3;
}

/** その球団が施設を1段階上げられるか */
export function canUpgradeFacility(
  state: GameState,
  teamId: string,
  kind: FacilityKind,
): { ok: boolean; reason?: string; cost: number } {
  const club = state.clubs?.[teamId];
  const level = club?.facilities?.[kind] ?? 1;
  if (level >= MAX_FACILITY_LEVEL) return { ok: false, reason: '最高段階です', cost: 0 };
  const cost = facilityCost(level);
  const cash = state.finances[teamId]?.cash ?? 0;
  if (cash < cost) return { ok: false, reason: '資金が足りません', cost };
  return { ok: true, cost };
}

/** 施設を1段階上げる。資金が足りなければ何もしない */
export function upgradeFacility(
  state: GameState,
  teamId: string,
  kind: FacilityKind,
): boolean {
  const check = canUpgradeFacility(state, teamId, kind);
  if (!check.ok) return false;
  const club = ensureClub(state, teamId);
  const finance = state.finances[teamId];
  finance.cash -= check.cost;
  club.facilities[kind] = (club.facilities[kind] + 1) as FacilityLevel;
  club.facilitySpent += check.cost;
  return true;
}

/* ---------------- 球団の状態 ---------------- */

/** 球団の色をシードから決める（同じシードなら毎回同じ） */
export function identityOf(state: GameState, teamId: string): TeamIdentity {
  const rng = new Rng(seedFrom(`phase40Identity:${state.seed}:${teamId}`));
  return IDENTITIES[rng.int(0, IDENTITIES.length - 1)];
}

export function createClubState(state: GameState, teamId: string): ClubState {
  return {
    direction: 'BALANCED',
    identity: identityOf(state, teamId),
    facilities: createFacilities(),
    objectives: [],
    objectiveYear: null,
    evaluatedYear: null,
    achieved: 0,
    facilitySpent: 0,
  };
}

/** 保存データに経営状態が無い（PHASE 3.9 以前のセーブ）場合に備える */
export function ensureClub(state: GameState, teamId: string): ClubState {
  if (!state.clubs) state.clubs = {};
  let club = state.clubs[teamId];
  if (!club) {
    club = createClubState(state, teamId);
    state.clubs[teamId] = club;
  }
  if (!club.facilities) club.facilities = createFacilities();
  for (const kind of FACILITY_KINDS) {
    const level = club.facilities[kind];
    if (typeof level !== 'number' || level < 1 || level > MAX_FACILITY_LEVEL) {
      club.facilities[kind] = 1;
    }
  }
  if (!Array.isArray(club.objectives)) club.objectives = [];
  if (typeof club.achieved !== 'number') club.achieved = 0;
  if (typeof club.evaluatedYear !== 'number') club.evaluatedYear = null;
  if (typeof club.facilitySpent !== 'number') club.facilitySpent = 0;
  if (!DIRECTIONS.includes(club.direction)) club.direction = 'BALANCED';
  if (!IDENTITIES.includes(club.identity)) club.identity = identityOf(state, teamId);
  return club;
}

export function ensureClubs(state: GameState): void {
  if (!state.clubs) state.clubs = {};
  if (!state.usage) state.usage = {};
  if (!Array.isArray(state.events)) state.events = [];
  for (const team of state.teams) ensureClub(state, team.id);
}

/** 球団方針を決める（ユーザー球団の操作） */
export function setDirection(
  state: GameState,
  teamId: string,
  direction: ClubDirection,
): void {
  ensureClub(state, teamId).direction = direction;
  // 方針は「表示だけ」ではないので、自球団の経営プランにすぐ反映する
  if (teamId === state.playerTeamId) refreshUserTeamPlan(state);
}

/* ---------------- 起用方針 ---------------- */

/** 指定がなければ、年齢と能力から自動で役割を決める */
export function autoUsageRole(state: GameState, player: Player): UsageRole {
  const overall = overallRating(player);
  const roster = state.players.filter((p) => p.teamId === player.teamId);
  const sorted = [...roster].sort((a, b) => overallRating(b) - overallRating(a));
  const rank = sorted.findIndex((p) => p.id === player.id);
  if (player.age >= 34) return 'VETERAN';
  if (player.age <= 23 && overall < 55) return 'DEVELOP';
  if (rank >= 0 && rank < 9) return 'CORE';
  if (rank >= 0 && rank < 18) return 'SEMI';
  return 'BENCH';
}

export function usageRoleOf(state: GameState, player: Player): UsageRole {
  return state.usage?.[player.id] ?? autoUsageRole(state, player);
}

export function setUsageRole(state: GameState, playerId: string, role: UsageRole): void {
  if (!state.usage) state.usage = {};
  state.usage[playerId] = role;
}

export function clearUsageRole(state: GameState, playerId: string): void {
  if (state.usage) delete state.usage[playerId];
}

/**
 * 起用方針と球団方針から決まる「出場機会の優先度」。
 * 0 が指定なしと同じ。能力そのものは変えない。
 */
export function usagePriority(
  role: UsageRole,
  direction: ClubDirection,
  age: number,
): number {
  let bonus = 0;
  if (role === 'CORE') bonus += 6;
  else if (role === 'SEMI') bonus += 2;
  else if (role === 'DEVELOP') bonus += 1;
  else if (role === 'BENCH') bonus -= 6;

  const young = age <= 24;
  const veteran = age >= 33;
  if (direction === 'WIN_NOW') {
    if (veteran || role === 'VETERAN') bonus += 3;
    if (role === 'DEVELOP') bonus -= 3;
  } else if (direction === 'DEVELOP') {
    if (young || role === 'DEVELOP') bonus += 4;
    if (veteran) bonus -= 2;
  } else if (direction === 'REBUILD') {
    if (young || role === 'DEVELOP') bonus += 6;
    if (veteran) bonus -= 4;
  } else if (direction === 'THRIFTY') {
    if (young) bonus += 1;
  }
  return bonus;
}

/** 起用方針から決まる、オーダー編成での上乗せ点 */
export function lineupBonus(state: GameState, player: Player): number {
  // 起用方針は自球団を動かすための機能。CPU球団の並べ方は PHASE 3.9 のまま変えない
  if (player.teamId !== state.playerTeamId) return 0;
  const club = state.clubs?.[player.teamId];
  if (!club) return 0;
  return usagePriority(usageRoleOf(state, player), club.direction, player.age);
}

/* ---------------- 球団評価 ---------------- */

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * 球団の状態を数値にする（表示とCPUの判断に使う）。
 * この値が高いから必ず勝つ、という作りにはしない。
 */
export function clubRating(state: GameState, teamId: string): ClubRating {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const finance = state.finances[teamId];
  const club = state.clubs?.[teamId];
  if (roster.length === 0) {
    return { strength: 0, future: 0, finance: 0, development: 0, management: 0, total: 0 };
  }

  const top = [...roster].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 18);
  const average = top.reduce((sum, p) => sum + overallRating(p), 0) / top.length;
  const strength = clamp100((average - 28) * 4.2);

  // 将来性：若い選手が「まだ伸びる余地」をどれだけ持っているか
  const young = roster.filter((p) => p.age <= 25);
  const headroom = young.reduce(
    (sum, p) => sum + Math.max(0, p.ext.potential - overallRating(p)),
    0,
  );
  const future = clamp100(young.length * 3 + headroom * 0.5);

  const budget = Math.max(1, finance?.budget ?? 900);
  const payroll = teamPayroll(state, teamId);
  const cashRoom = Math.max(0, Math.min(1.5, (finance?.cash ?? 0) / (budget * 2)));
  const financeScore = clamp100(60 + (1 - payroll / budget) * 60 + cashRoom * 20);

  const facilities = facilitiesOf(state, teamId);
  const facilityAverage =
    FACILITY_KINDS.reduce((sum, kind) => sum + facilities[kind], 0) / FACILITY_KINDS.length;
  const development = clamp100((facilityAverage - 1) * 22 + future * 0.25);

  const management = clamp100(
    45 + (club?.achieved ?? 0) * 4 + (facilityAverage - 1) * 8 + (financeScore - 50) * 0.2,
  );

  const total = clamp100(
    strength * 0.38 + future * 0.2 + financeScore * 0.16 + development * 0.14 + management * 0.12,
  );
  return { strength, future, finance: financeScore, development, management, total };
}

/* ---------------- 経営目標 ---------------- */

/** 目標の説明文 */
export function objectiveText(objective: TeamObjective): string {
  switch (objective.kind) {
    case 'A_CLASS':
      return `${objective.target}位以内に入る`;
    case 'LEAGUE_TITLE':
      return 'リーグ優勝する';
    case 'YOUTH_GAMES':
      return `25歳以下を${objective.target}人、一定以上起用する`;
    case 'TEAM_ERA':
      return `チーム防御率を${objective.target.toFixed(2)}以下にする`;
    case 'AVERAGE_AGE':
      return `平均年齢を${objective.target.toFixed(1)}歳以下に保つ`;
    case 'PAYROLL':
      return '総年俸を予算内に収める';
    case 'ROOKIE_GAMES':
      return `新人を${objective.target}人、一定以上起用する`;
  }
}

/**
 * 今季の目標を立てる。方針と前年の成績から決める。
 * 同じ年に二度呼んでも作り直さない。
 */
export function buildObjectives(state: GameState, teamId: string): TeamObjective[] {
  const club = ensureClub(state, teamId);
  if (club.objectiveYear === state.year && club.objectives.length > 0) return club.objectives;

  const team = state.teams.find((t) => t.id === teamId);
  const rank = team
    ? (standingsForLeague(state, team.leagueId).find((r) => r.teamId === teamId)?.rank ?? 6)
    : 6;
  const objectives: TeamObjective[] = [];
  const add = (kind: ObjectiveKind, target: number) =>
    objectives.push({ kind, target, actual: null, achieved: null });

  switch (club.direction) {
    case 'WIN_NOW':
      add(rank <= 2 ? 'LEAGUE_TITLE' : 'A_CLASS', 3);
      add('TEAM_ERA', 3.9);
      break;
    case 'DEVELOP':
      add('YOUTH_GAMES', 5);
      add('A_CLASS', 4);
      break;
    case 'REBUILD':
      add('YOUTH_GAMES', 6);
      add('AVERAGE_AGE', 27.5);
      break;
    case 'THRIFTY':
      add('PAYROLL', 1);
      add('ROOKIE_GAMES', 2);
      break;
    default:
      add('A_CLASS', 3);
      add('PAYROLL', 1);
      break;
  }

  club.objectives = objectives;
  club.objectiveYear = state.year;
  return objectives;
}

/** 1軍で十分に出場したと言える出場数 */
function playedEnough(state: GameState, playerId: string): boolean {
  const stats = state.stats[playerId];
  if (!stats) return false;
  const games = Math.max(stats.batting.games, stats.pitching.games);
  return games >= Math.max(3, Math.round(state.seasonLength * 0.25));
}

/**
 * シーズン終了時に目標の達成を判定する。
 * 二度呼んでも達成数が二重に増えない。
 */
export function evaluateObjectives(state: GameState, teamId: string): TeamObjective[] {
  const club = ensureClub(state, teamId);
  // 同じ年に二度判定しない（達成数の二重加算を防ぐ）
  if (club.evaluatedYear === state.year) return club.objectives;
  club.evaluatedYear = state.year;
  const roster = state.players.filter((p) => p.teamId === teamId);
  const team = state.teams.find((t) => t.id === teamId);
  const rank = team
    ? (standingsForLeague(state, team.leagueId).find((r) => r.teamId === teamId)?.rank ?? 6)
    : 6;

  for (const objective of club.objectives) {
    if (objective.achieved !== null) continue;
    let actual = 0;
    let achieved = false;
    switch (objective.kind) {
      case 'A_CLASS':
        actual = rank;
        achieved = rank <= objective.target;
        break;
      case 'LEAGUE_TITLE':
        actual = rank;
        achieved = rank === 1;
        break;
      case 'YOUTH_GAMES':
        actual = roster.filter((p) => p.age <= 25 && playedEnough(state, p.id)).length;
        achieved = actual >= objective.target;
        break;
      case 'ROOKIE_GAMES':
        actual = roster.filter(
          (p) => p.ext.debutYear === state.year && playedEnough(state, p.id),
        ).length;
        achieved = actual >= objective.target;
        break;
      case 'TEAM_ERA': {
        const pitching = roster.reduce(
          (sum, p) => {
            const stats = state.stats[p.id];
            if (!stats) return sum;
            sum.outs += stats.pitching.outs;
            sum.earnedRuns += stats.pitching.earnedRuns;
            return sum;
          },
          { outs: 0, earnedRuns: 0 },
        );
        actual = pitching.outs === 0 ? 99 : era({ ...emptyPitchingLike(), ...pitching });
        achieved = actual <= objective.target;
        break;
      }
      case 'AVERAGE_AGE':
        actual = roster.reduce((sum, p) => sum + p.age, 0) / Math.max(1, roster.length);
        achieved = actual <= objective.target;
        break;
      case 'PAYROLL':
        actual = teamPayroll(state, teamId);
        achieved = actual <= (state.finances[teamId]?.budget ?? 900);
        break;
    }
    objective.actual = Math.round(actual * 100) / 100;
    objective.achieved = achieved;
    if (achieved) club.achieved += 1;
  }
  return club.objectives;
}

/** era() に渡すための最小限の形 */
function emptyPitchingLike() {
  return {
    games: 0,
    starts: 0,
    outs: 0,
    wins: 0,
    losses: 0,
    holds: 0,
    saves: 0,
    strikeouts: 0,
    walks: 0,
    hitsAllowed: 0,
    homeRunsAllowed: 0,
    runsAllowed: 0,
    earnedRuns: 0,
  };
}

/* ---------------- CPU の施設投資 ---------------- */

/** 方針ごとの投資の優先順位 */
export const FACILITY_PRIORITY: Record<ClubDirection, FacilityKind[]> = {
  WIN_NOW: ['medical', 'training', 'development', 'scouting'],
  DEVELOP: ['development', 'training', 'scouting', 'medical'],
  REBUILD: ['development', 'scouting', 'training', 'medical'],
  BALANCED: ['development', 'medical', 'training', 'scouting'],
  THRIFTY: ['training', 'development', 'medical', 'scouting'],
};

/** 方針ごとに、資金のどれだけを施設に回してよいか */
export const FACILITY_BUDGET_RATIO: Record<ClubDirection, number> = {
  WIN_NOW: 0.16,
  DEVELOP: 0.3,
  REBUILD: 0.34,
  BALANCED: 0.22,
  THRIFTY: 0.1,
};

/**
 * CPU球団の施設投資（オフシーズンに1回）。
 * 全球団が同じ動きにならないよう、球団ごとに決まった揺らぎを入れる。
 */
export function runCpuFacilityInvestment(state: GameState): void {
  ensureClubs(state);
  for (const team of state.teams) {
    if (team.id === state.playerTeamId) continue;
    const club = ensureClub(state, team.id);
    const finance = state.finances[team.id];
    if (!finance) continue;

    const rng = clubRng(state, 'phase40Facility', team.id);
    // ±10% の決定的な揺らぎ
    const jitter = 0.9 + rng.next() * 0.2;
    let allowance = finance.cash * FACILITY_BUDGET_RATIO[club.direction] * jitter;
    // 球団の色でも少し変わる
    if (club.identity === 'DEVELOPER') allowance *= 1.2;
    if (club.identity === 'BIG_SPENDER') allowance *= 0.8;

    const order = [...FACILITY_PRIORITY[club.direction]];
    // 同じ順番ばかりにならないよう、先頭2つを入れ替えることがある
    if (rng.chance(0.25) && order.length >= 2) {
      [order[0], order[1]] = [order[1], order[0]];
    }

    for (const kind of order) {
      const check = canUpgradeFacility(state, team.id, kind);
      if (!check.ok) continue;
      if (check.cost > allowance) continue;
      if (!upgradeFacility(state, team.id, kind)) continue;
      allowance -= check.cost;
    }
  }
}

/** 球団方針を CPU の戦略から決め直す（ユーザー球団は自分で決めたものを保つ） */
export function syncCpuDirections(state: GameState): void {
  ensureClubs(state);
  // 「戦力が薄い」はリーグの中での相対で見る（絶対値だとどの年も当てはまらない）
  const strengths = state.teams.map((t) => clubRating(state, t.id).strength);
  const mean = strengths.reduce((a, b) => a + b, 0) / Math.max(1, strengths.length);
  for (const team of state.teams) {
    if (team.id === state.playerTeamId) continue;
    const plan = state.teamPlans?.[team.id];
    if (!plan) continue;
    const club = ensureClub(state, team.id);
    club.direction =
      plan.strategy === 'WIN_NOW'
        ? 'WIN_NOW'
        : plan.strategy === 'YOUTH'
          ? // リーグ平均より目に見えて戦力が薄い球団は「再建」、そうでなければ「若手育成」
            (clubRating(state, team.id).strength < mean - 8 ? 'REBUILD' : 'DEVELOP')
          : plan.strategy === 'BUDGET'
            ? 'THRIFTY'
            : 'BALANCED';
  }
}

/* ---------------- 士気 ---------------- */

/** 士気に効く出来事 */
export type MoraleEvent =
  | 'STAR_INJURY'
  | 'BIG_SIGNING'
  | 'TRADE_IN'
  | 'TRADE_OUT'
  | 'FA_LEAVE'
  | 'POSTSEASON'
  | 'LEAGUE_TITLE'
  | 'JAPAN_TITLE'
  | 'YOUTH_USED'
  | 'OBJECTIVE_MET';

/** 出来事ごとの士気の動き（大きくなりすぎないよう小さめに保つ） */
export const MORALE_DELTA: Record<MoraleEvent, number> = {
  STAR_INJURY: -5,
  BIG_SIGNING: 5,
  TRADE_IN: 2,
  TRADE_OUT: -2,
  FA_LEAVE: -4,
  POSTSEASON: 6,
  LEAGUE_TITLE: 9,
  JAPAN_TITLE: 12,
  YOUTH_USED: 1,
  OBJECTIVE_MET: 4,
};

/** 出来事による士気の変化を反映する */
export function applyMoraleEvent(state: GameState, teamId: string, event: MoraleEvent): void {
  const current = state.teamMorale[teamId];
  if (typeof current !== 'number') return;
  const next = current + MORALE_DELTA[event];
  state.teamMorale[teamId] = Math.max(0, Math.min(100, next));
}

/** 順位による士気の押し上げ・押し下げ（シーズン終了時に1回） */
export function applyRankMorale(state: GameState, teamId: string, rank: number): void {
  const current = state.teamMorale[teamId];
  if (typeof current !== 'number') return;
  // 1位で +4、6位で -4 くらい
  const delta = (3.5 - rank) * 1.6;
  state.teamMorale[teamId] = Math.max(0, Math.min(100, current + delta));
}

/* ---------------- 育成環境 ---------------- */

/**
 * 成長判定に使う補正（PHASE 2 の成長処理は置き換えない）。
 *
 * 施設 Lv1・方針バランス・指定なしのときは、ちょうど 1.0（＝補正なし）になる。
 * 施設だけで能力が青天井にならないよう、上限を設けている。
 */
export function developmentModifiers(
  state: GameState,
  player: Player,
): { facility: number; training: number } {
  const club = state.clubs?.[player.teamId];
  if (!club) return { facility: 1, training: 1 };

  const facility = developmentMultiplier(club.facilities.development);

  let training = 1;
  const role = usageRoleOf(state, player);
  const young = player.age <= 24;
  // 球団方針：若手を育てる方針なら、若い選手が伸びやすい
  if (club.direction === 'DEVELOP' && young) training *= 1.08;
  else if (club.direction === 'REBUILD' && young) training *= 1.1;
  else if (club.direction === 'WIN_NOW' && young) training *= 0.96;
  // 起用方針：育成指定はわずかに伸びやすい（必ず伸びるわけではない）
  if (role === 'DEVELOP') training *= 1.06;
  else if (role === 'BENCH') training *= 0.97;

  // 合計でも 1.4 倍を超えないようにする
  const total = Math.min(1.4, facility * training);
  return { facility: total, training: 1 };
}

/* ---------------- シーズン中の経営イベント ---------------- */

/** 保持しておくイベント件数 */
export const EVENT_LIMIT = 20;

/**
 * イベントを1件追加する。
 * 同じIDのイベントは二度作らない。
 */
export function pushEvent(state: GameState, event: ManagementEvent): boolean {
  if (!Array.isArray(state.events)) state.events = [];
  if (state.events.some((e) => e.id === event.id)) return false;
  state.events.push(event);
  if (state.events.length > EVENT_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_LIMIT);
  }
  return true;
}

export function pendingEvents(state: GameState): ManagementEvent[] {
  return (state.events ?? []).filter((e) => !e.resolved);
}

/**
 * イベントの選択肢を選ぶ。
 * 結果は起用方針・士気に効くだけで、能力は変えない。
 */
export function resolveEvent(state: GameState, eventId: string, choiceId: string): boolean {
  const event = (state.events ?? []).find((e) => e.id === eventId);
  if (!event || event.resolved) return false;
  if (event.choices.length > 0 && !event.choices.some((c) => c.id === choiceId)) return false;
  event.chosen = choiceId;
  event.resolved = true;

  // 選んだ内容を起用方針と士気へ反映する
  if (event.playerId) {
    if (choiceId === 'promote') {
      setUsageRole(state, event.playerId, 'CORE');
      applyMoraleEvent(state, event.teamId, 'YOUTH_USED');
    } else if (choiceId === 'develop') {
      setUsageRole(state, event.playerId, 'DEVELOP');
      applyMoraleEvent(state, event.teamId, 'YOUTH_USED');
    } else if (choiceId === 'bench') {
      setUsageRole(state, event.playerId, 'BENCH');
    } else if (choiceId === 'keep') {
      setUsageRole(state, event.playerId, 'VETERAN');
    }
  }
  return true;
}

/** イベントIDは決定的に決める（同じ出来事から二度作らない） */
export function eventId(year: number, kind: string, key: string): string {
  return `${year}:${kind}:${key}`;
}

/* ---------------- イベントの発生 ---------------- */

/** 1軍で十分な出場があったか（イベント判定用） */
function seasonGames(state: GameState, playerId: string): number {
  const stats = state.stats[playerId];
  if (!stats) return 0;
  return Math.max(stats.batting.games, stats.pitching.games);
}

/**
 * シーズン中の経営判断イベントを作る（PHASE 4.0）。
 *
 * プレイヤー球団だけを対象にし、節目の日にだけ調べる。
 * 毎日すべての選手を総当たりするようなことはしない。
 */
export function generateManagementEvents(state: GameState): void {
  const teamId = state.playerTeamId;
  const games = state.records[teamId]?.games ?? 0;
  // シーズンの1/4・1/2・3/4 の節目だけ調べる
  const marks = [0.25, 0.5, 0.75].map((r) => Math.round(state.seasonLength * r));
  if (!marks.includes(games) || games === 0) return;

  const roster = state.players.filter((p) => p.teamId === teamId);
  const club = ensureClub(state, teamId);
  const played = Math.max(1, games);

  // ---- 若手の台頭 ----
  const breakout = roster
    .filter((p) => p.age <= 24 && seasonGames(state, p.id) >= played * 0.3)
    .sort((a, b) => overallRating(b) - overallRating(a))[0];
  if (breakout && usageRoleOf(state, breakout) !== 'CORE') {
    pushEvent(state, {
      id: eventId(state.year, 'YOUNG_BREAKOUT', `${teamId}:${breakout.id}:${games}`),
      year: state.year,
      date: state.date,
      teamId,
      kind: 'YOUNG_BREAKOUT',
      title: `${breakout.name}が台頭`,
      body: `${breakout.age}歳の${breakout.name}が出場機会をつかんでいます。今後の起用をどうしますか。`,
      playerId: breakout.id,
      choices: [
        { id: 'promote', label: '主力として起用', description: '出場機会が大きく増えます' },
        { id: 'develop', label: '育成枠で伸ばす', description: '成長を優先します' },
        { id: 'keep', label: 'いまのまま', description: '起用方針は変えません' },
      ],
      chosen: null,
      resolved: false,
    });
  }

  // ---- ベテランの不調 ----
  const veteran = roster
    .filter((p) => p.age >= 33 && seasonGames(state, p.id) >= played * 0.3)
    .sort((a, b) => overallRating(a) - overallRating(b))[0];
  if (veteran && usageRoleOf(state, veteran) !== 'BENCH') {
    pushEvent(state, {
      id: eventId(state.year, 'VETERAN_SLUMP', `${teamId}:${veteran.id}:${games}`),
      year: state.year,
      date: state.date,
      teamId,
      kind: 'VETERAN_SLUMP',
      title: `${veteran.name}が振るわず`,
      body: `${veteran.age}歳の${veteran.name}が本来の力を出せていません。`,
      playerId: veteran.id,
      choices: [
        { id: 'keep', label: '我慢して使う', description: '経験を買って起用を続けます' },
        { id: 'bench', label: '控えに回す', description: '若手に機会を譲ります' },
      ],
      chosen: null,
      resolved: false,
    });
  }

  // ---- 連勝・連敗 ----
  const record = state.records[teamId];
  if (record) {
    const pace = record.wins / Math.max(1, record.wins + record.losses);
    if (pace <= 0.38) {
      pushEvent(state, {
        id: eventId(state.year, 'LOSING_STREAK', `${teamId}:${games}`),
        year: state.year,
        date: state.date,
        teamId,
        kind: 'LOSING_STREAK',
        title: '苦しい戦いが続いています',
        body: `ここまで${record.wins}勝${record.losses}敗。立て直しが必要です。`,
        playerId: null,
        choices: [
          { id: 'rebuild', label: '若手に切り替える', description: '来季を見据えます' },
          { id: 'fight', label: '主力で戦い抜く', description: '今季を諦めません' },
        ],
        chosen: null,
        resolved: false,
      });
    } else if (pace >= 0.62) {
      pushEvent(state, {
        id: eventId(state.year, 'WINNING_STREAK', `${teamId}:${games}`),
        year: state.year,
        date: state.date,
        teamId,
        kind: 'WINNING_STREAK',
        title: '好調を維持しています',
        body: `ここまで${record.wins}勝${record.losses}敗。上位を狙える位置です。`,
        playerId: null,
        choices: [],
        chosen: null,
        resolved: false,
      });
    }
  }
  void club;
}
