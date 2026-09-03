/**
 * FA（フリーエージェント）市場（PHASE 3.4）。
 *
 * ライフサイクル：
 *   契約更改 → 契約が成立しなかった選手が FA 市場へ
 *   → ユーザーと CPU がオファー → 締切 → 選手が提示内容を比較して契約先を決める
 *   → 新球団のロスターへ加入 → 翌シーズン
 *
 * 設計上の約束：
 *  - FA 選手は state.players には含めず state.freeAgents で保持する。
 *    こうすることで「所属していないのに試合に出る／成績が付く」事故が起きない。
 *  - 選手の能力・潜在能力・成長は一切書き換えない。
 *  - CPU は真の潜在能力（ext.potential）を参照しない。見えている能力と成績で判断する。
 *  - 乱数はすべてゲーム内シードから作る（Math.random は使わない）。
 */
import type {
  FAMarketPlayer,
  TeamAiPlan,
  FAOffer,
  FARole,
  FASignRecord,
  FAState,
  GameState,
  Player,
  PlayerSeasonStats,
  Team,
} from './types';
import { Rng, seedFrom } from './rng';
import { overallRating } from './rating';
import { emptySeasonStats } from './stats';
import {
  MAX_SALARY,
  MIN_SALARY,
  MINIMUM_ROSTER,
  createContract,
  lastKnownSalary,
  leagueSalaryLevel,
  marketValue,
  maxContractYears,
  refreshPayrolls,
} from './contract';
import { generateFaNews } from './news';

/** ユーザーが同時に出せるオファーの上限 */
export const MAX_USER_OFFERS = 8;

/** ロスターの最低人数（PHASE 3.3 と同じ値を使う） */
export { MINIMUM_ROSTER } from './contract';

/** 契約成立に必要な評価点。これを下回るとどのオファーも受けない */
export const ACCEPT_THRESHOLD = 0.34;

/** CPU が1球団あたりに出せるオファー数の上限 */
export const MAX_CPU_OFFERS_PER_TEAM = 3;

/** 控えの確保を含めた、CPU 1球団あたりのオファー数の上限 */
export const MAX_DEPTH_OFFERS_PER_TEAM = 6;

/* ---------------- 乱数（すべてシードから作る） ---------------- */

function faRng(state: GameState, ...parts: Array<string | number>): Rng {
  return new Rng(seedFrom(`fa:${state.seed}:${state.year}:${parts.join(':')}`));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/* ---------------- 市場に出るときの条件 ---------------- */

/** 何年続けて契約先が決まっていないか */
export function unsignedYears(player: Player): number {
  const value = player.ext.hiddenAttributes?.faUnsignedYears;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function setUnsignedYears(player: Player, value: number): void {
  if (!player.ext.hiddenAttributes || typeof player.ext.hiddenAttributes !== 'object') {
    player.ext.hiddenAttributes = {};
  }
  player.ext.hiddenAttributes.faUnsignedYears = Math.max(0, value);
}

/**
 * 決まらないまま年を越した選手は要求を下げる（最大 60% まで）。
 * これがないと市場に売れ残りが溜まり続けてしまう。
 */
export function staleDiscount(player: Player): number {
  return Math.max(0.4, 1 - 0.18 * unsignedYears(player));
}

/** FA選手の希望契約年数（年齢制限を超えない） */
export function preferredContractYears(player: Player, rng: Rng): number {
  const max = maxContractYears(player.age);
  let wish: number;
  if (player.age <= 25) wish = 4;
  else if (player.age <= 30) wish = 3;
  else if (player.age <= 33) wish = 2;
  else wish = 1;
  // ±1年の揺らぎ
  wish += rng.int(-1, 1);
  return Math.max(1, Math.min(max, wish));
}

/** 市場での役割ラベル。真の潜在能力は使わず、年齢と見えている能力だけで決める */
export function faRole(player: Player): FARole {
  const overall = overallRating(player);
  if (player.age <= 23) return 'PROSPECT';
  if (player.isPitcher) return overall >= 48 ? 'ROTATION' : 'BENCH';
  return overall >= 48 ? 'STARTER' : 'BENCH';
}

/**
 * FA選手の希望年俸。
 * PHASE 3.3 の市場価値をそのまま土台にし、FA 用の上乗せだけを行う。
 */
export function askingSalaryFor(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  year: number,
  rng: Rng,
): { marketValue: number; askingSalary: number; minimumSalary: number } {
  const value = marketValue(player, stats, year);
  const previous = lastKnownSalary(player);
  const discount = staleDiscount(player);
  const base = Math.max(value, previous * 0.7) * discount;
  // ±5〜12% の揺らぎ（極端なインフレにならない範囲）
  const spread = 0.05 + rng.next() * 0.07;
  const jitter = rng.next() < 0.5 ? 1 - spread : 1 + spread;
  const asking = Math.max(MIN_SALARY, Math.min(MAX_SALARY, Math.round(base * jitter)));
  // 市場価値の70%未満は原則成立しない（売れ残りは同じ割合で下がる）
  const minimum = Math.max(MIN_SALARY, Math.min(asking, Math.round(value * 0.7 * discount)));
  return { marketValue: value, askingSalary: asking, minimumSalary: minimum };
}

function buildListing(state: GameState, player: Player): FAMarketPlayer {
  const rng = faRng(state, 'list', player.id);
  const stats = state.stats[player.id];
  const { marketValue: value, askingSalary, minimumSalary } = askingSalaryFor(
    player,
    stats,
    state.year,
    rng,
  );
  return {
    playerId: player.id,
    listedYear: state.year,
    marketValue: value,
    askingSalary,
    minimumSalary,
    preferredYears: preferredContractYears(player, rng),
    role: faRole(player),
    status: 'AVAILABLE',
  };
}

/* ---------------- 市場の開始 ---------------- */

/**
 * 未所属の選手をFA市場に並べる。
 * すでに開催済みの年なら何もしない（二重開催の防止）。
 */
export function startFreeAgency(state: GameState): FAState {
  if (state.fa && state.fa.year === state.year) return state.fa;

  // 引退した選手・重複はプールに入れない
  const seen = new Set<string>();
  const pool: Player[] = [];
  for (const player of state.freeAgents) {
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    player.teamId = '';
    player.ext.contract = null;
    pool.push(player);
  }
  state.freeAgents = pool;

  const listings = pool
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((player) => buildListing(state, player));

  const fa: FAState = {
    year: state.year,
    phase: 'open',
    listings,
    offers: [],
    results: [],
    unsigned: 0,
    completed: false,
  };
  state.fa = fa;
  state.lastFaYear = state.year;
  return fa;
}

export function listingFor(fa: FAState, playerId: string): FAMarketPlayer | undefined {
  return fa.listings.find((l) => l.playerId === playerId);
}

export function freeAgentById(state: GameState, playerId: string): Player | undefined {
  return state.freeAgents.find((p) => p.id === playerId);
}

/* ---------------- オファー ---------------- */

export type OfferError =
  | 'no-market'
  | 'market-closed'
  | 'unknown-player'
  | 'unknown-team'
  | 'already-signed'
  | 'duplicate'
  | 'limit'
  | 'salary-range'
  | 'years-range'
  | 'budget';

export interface OfferResult {
  ok: boolean;
  error?: OfferError;
  message?: string;
  offer?: FAOffer;
}

const OFFER_MESSAGES: Record<OfferError, string> = {
  'no-market': 'FA市場は開催されていません',
  'market-closed': 'FA市場はすでに締め切られました',
  'unknown-player': 'その選手はFA市場にいません',
  'unknown-team': '存在しない球団です',
  'already-signed': 'その選手はすでに契約が決まりました',
  duplicate: 'その選手にはすでに提示しています',
  limit: `同時に提示できるFA契約は${MAX_USER_OFFERS}人までです`,
  'salary-range': '提示できる年俸の範囲を外れています',
  'years-range': 'その選手の年齢では結べない契約年数です',
  budget: '球団の資金では提示できません',
};

/** その球団が現在出しているオファー */
export function offersByTeam(fa: FAState, teamId: string): FAOffer[] {
  return fa.offers.filter((o) => o.teamId === teamId && o.status === 'PENDING');
}

/** その選手に届いているオファー */
export function offersForPlayer(fa: FAState, playerId: string): FAOffer[] {
  return fa.offers.filter((o) => o.playerId === playerId && o.status === 'PENDING');
}

/**
 * FA選手に契約を提示する。
 * この時点では契約は成立せず、市場の締切でまとめて解決される。
 */
export function makeFAOffer(
  state: GameState,
  teamId: string,
  playerId: string,
  salary: number,
  years: number,
  options: { maxOffers?: number } = {},
): OfferResult {
  const fail = (error: OfferError): OfferResult => ({
    ok: false,
    error,
    message: OFFER_MESSAGES[error],
  });

  const fa = state.fa;
  if (!fa) return fail('no-market');
  if (fa.phase !== 'open' || fa.completed) return fail('market-closed');
  if (!state.teams.some((t) => t.id === teamId)) return fail('unknown-team');

  const listing = listingFor(fa, playerId);
  const player = freeAgentById(state, playerId);
  if (!listing || !player) return fail('unknown-player');
  if (listing.status === 'SIGNED') return fail('already-signed');

  if (offersByTeam(fa, teamId).some((o) => o.playerId === playerId)) return fail('duplicate');

  const maxOffers = options.maxOffers ?? MAX_USER_OFFERS;
  if (offersByTeam(fa, teamId).length >= maxOffers) return fail('limit');

  const safeSalary = Math.round(salary);
  if (!Number.isFinite(safeSalary) || safeSalary < MIN_SALARY || safeSalary > MAX_SALARY) {
    return fail('salary-range');
  }
  const safeYears = Math.round(years);
  if (!Number.isFinite(safeYears) || safeYears < 1 || safeYears > maxContractYears(player.age)) {
    return fail('years-range');
  }

  // 予算：確定している総年俸＋提示中の年俸が予算の1.12倍を超えるなら出せない
  if (!withinBudget(state, teamId, safeSalary)) return fail('budget');

  const offer: FAOffer = {
    id: `fa-${state.year}-${teamId}-${playerId}`,
    playerId,
    teamId,
    salary: safeSalary,
    years: safeYears,
    offeredYear: state.year,
    status: 'PENDING',
  };
  fa.offers.push(offer);
  listing.status = 'OFFERED';
  return { ok: true, offer };
}

/** 提示を取り下げる */
export function cancelFAOffer(state: GameState, teamId: string, playerId: string): boolean {
  const fa = state.fa;
  if (!fa || fa.phase !== 'open') return false;
  const index = fa.offers.findIndex(
    (o) => o.teamId === teamId && o.playerId === playerId && o.status === 'PENDING',
  );
  if (index < 0) return false;
  fa.offers.splice(index, 1);
  const listing = listingFor(fa, playerId);
  if (listing && listing.status === 'OFFERED' && offersForPlayer(fa, playerId).length === 0) {
    listing.status = 'AVAILABLE';
  }
  return true;
}

/** 予算の上限（PHASE 3.3 と同じ 1.12 倍）に収まるか */
export function budgetCeiling(state: GameState, teamId: string): number {
  const finance = state.finances[teamId];
  return (finance?.budget ?? 900) * 1.12;
}

/** 提示中の年俸を含めた総年俸 */
export function committedSalary(state: GameState, teamId: string): number {
  const payroll = state.players
    .filter((p) => p.teamId === teamId && p.ext.contract)
    .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
  const pending = state.fa ? offersByTeam(state.fa, teamId).reduce((s, o) => s + o.salary, 0) : 0;
  return payroll + pending;
}

export function withinBudget(state: GameState, teamId: string, additional: number): boolean {
  return committedSalary(state, teamId) + additional <= budgetCeiling(state, teamId);
}

/* ---------------- 選手の意思決定 ---------------- */

export interface OfferScoreBreakdown {
  salary: number;
  years: number;
  teamStrength: number;
  role: number;
  opportunity: number;
  random: number;
  total: number;
}

/** 前年の勝率からチームの魅力を 0〜1 で表す */
export function teamStrengthScore(state: GameState, teamId: string): number {
  const record = state.records[teamId];
  if (!record || record.games <= 0) return 0.5;
  const decided = record.wins + record.losses;
  if (decided <= 0) return 0.5;
  const winPct = record.wins / decided;
  return clamp01(0.5 + (winPct - 0.5) * 1.6);
}

/** 同じ枠を争う選手の人数 */
function playersAhead(state: GameState, teamId: string, player: Player): number {
  const overall = overallRating(player);
  return state.players.filter((p) => {
    if (p.teamId !== teamId) return false;
    if (p.isPitcher !== player.isPitcher) return false;
    if (!player.isPitcher && p.mainPosition !== player.mainPosition) return false;
    return overallRating(p) >= overall;
  }).length;
}

/** 出場機会の見込み（同ポジションに強い選手がいるほど下がる） */
export function roleScore(state: GameState, teamId: string, player: Player): number {
  const ahead = playersAhead(state, teamId, player);
  if (player.isPitcher) {
    // 投手はローテーション＋救援でおよそ6枠
    if (ahead <= 1) return 1;
    if (ahead <= 3) return 0.8;
    if (ahead <= 5) return 0.6;
    if (ahead <= 7) return 0.4;
    return 0.22;
  }
  if (ahead === 0) return 1;
  if (ahead === 1) return 0.68;
  if (ahead === 2) return 0.44;
  return 0.24;
}

/** ロスターに余裕があるか（人数が少ない球団ほど出番がある） */
export function opportunityScore(state: GameState, teamId: string): number {
  const size = state.players.filter((p) => p.teamId === teamId).length;
  if (size <= MINIMUM_ROSTER) return 1;
  if (size >= 40) return 0.2;
  return clamp01(1 - (size - MINIMUM_ROSTER) / 20);
}

/** 提示年俸の評価。希望額の60%で0、120%で1になる */
export function salaryScore(offerSalary: number, askingSalary: number): number {
  if (askingSalary <= 0) return 1;
  const ratio = offerSalary / askingSalary;
  return clamp01((ratio - 0.6) / 0.6);
}

/** 契約年数の評価。希望年数に近いほど高い */
export function yearsScore(offerYears: number, preferredYears: number): number {
  return clamp01(1 - Math.abs(offerYears - preferredYears) / 4);
}

/**
 * オファーの総合評価（0〜1）。
 * 年俸だけでは決まらず、球団の強さ・出場機会・契約年数も見る。
 */
export function evaluateOffer(
  state: GameState,
  listing: FAMarketPlayer,
  player: Player,
  offer: FAOffer,
): OfferScoreBreakdown {
  const rng = faRng(state, 'score', offer.playerId, offer.teamId);
  const salary = salaryScore(offer.salary, listing.askingSalary);
  const years = yearsScore(offer.years, listing.preferredYears);
  const strength = teamStrengthScore(state, offer.teamId);
  const role = roleScore(state, offer.teamId, player);
  const opportunity = opportunityScore(state, offer.teamId);
  const random = rng.next();
  const total =
    salary * 0.55 +
    years * 0.1 +
    strength * 0.1 +
    role * 0.1 +
    opportunity * 0.1 +
    random * 0.05;
  return { salary, years, teamStrength: strength, role, opportunity, random, total: clamp01(total) };
}

/* ---------------- CPU の補強 ---------------- */

/** CPUが見る「推定能力」。真の潜在能力は使わない */
export function estimatedAbility(state: GameState, teamId: string, player: Player): number {
  const rng = faRng(state, 'estimate', teamId, player.id);
  const scout = state.scouting?.teams?.[teamId]?.ability;
  // スカウト能力が高いほど誤差が小さい（現在能力は概ね見えるが、完全ではない）
  const accuracy = Math.max(20, Math.min(100, scout?.currentAbility ?? 55));
  const noise = rng.normal(0, (100 - accuracy) / 12 + 1.5);
  return Math.max(1, Math.min(100, overallRating(player) + noise));
}

interface TeamNeed {
  teamId: string;
  /** PHASE 3.6: 球団の経営プラン（戦略・補強ポイント・FA予算） */
  plan?: TeamAiPlan;
  rosterShortage: number;
  /** 控えを増やす余地（人数が少ないほど大きい） */
  depthRoom: number;
  fielderShortage: number;
  pitcherShortage: number;
  headroom: number;
  budget: number;
  eagerness: number;
}

/** 経営プランで使う枠のキー（rosterAnalysis と同じ分け方） */
function planKeyOf(player: Player): string {
  if (player.isPitcher) return (player.pitching?.stamina ?? 0) >= 45 ? 'SP' : 'RP';
  const pos = player.mainPosition;
  if (pos === 'C') return 'C';
  if (pos === 'LF' || pos === 'CF' || pos === 'RF') return 'OF';
  return pos;
}

function analyzeNeed(state: GameState, team: Team): TeamNeed {
  const roster = state.players.filter((p) => p.teamId === team.id);
  const fielders = roster.filter((p) => !p.isPitcher).length;
  const pitchers = roster.filter((p) => p.isPitcher).length;
  const finance = state.finances[team.id];
  const headroom = budgetCeiling(state, team.id) - committedSalary(state, team.id);
  // 弱い球団ほど少しだけ積極的になる（順位で獲得数が固定されない程度）
  const strength = teamStrengthScore(state, team.id);
  const cashFactor = clamp01(((finance?.cash ?? 0) + 500) / 3000);
  return {
    teamId: team.id,
    plan: state.teamPlans?.[team.id],
    // 人数不足は「最低人数を割っている」ときだけ。
    // 1人ぶんの余裕まで不足に数えると、契約更改後に24人ちょうどになる
    // 全球団が毎年「不足」となり、市場のFAが必ず全員決まってしまう。
    rosterShortage: Math.max(0, MINIMUM_ROSTER - roster.length),
    depthRoom: Math.max(0, 28 - roster.length),
    fielderShortage: Math.max(0, 13 - fielders),
    pitcherShortage: Math.max(0, 9 - pitchers),
    headroom,
    budget: finance?.budget ?? 900,
    eagerness: clamp01(0.4 + (0.5 - strength) * 0.5 + cashFactor * 0.3),
  };
}

/**
 * 1球団が1人のFA選手をどれくらい欲しいか（0〜1）。
 * ロスター不足 > ポジション不足 > 主力補強 > 若手 の順に効く。
 */
export function cpuInterest(
  state: GameState,
  need: TeamNeed,
  player: Player,
  listing: FAMarketPlayer,
): number {
  const ability = estimatedAbility(state, need.teamId, player);
  const ahead = playersAhead(state, need.teamId, player);

  let score = 0;
  // 1. ロスター不足（最優先）
  if (need.rosterShortage > 0) score += 0.5;
  // 2. ポジション不足
  const shortage = player.isPitcher ? need.pitcherShortage : need.fielderShortage;
  if (shortage > 0) score += 0.28;
  // 3. 戦力アップ（同じ枠に自分より上がいないほど価値が高い）
  score += clamp01((ability - 30) / 45) * 0.3;
  if (ahead <= 1) score += 0.12;
  else if (ahead <= 3) score += 0.05;
  // 4. 若手
  if (player.age <= 25) score += 0.06;
  // 5. 割高な選手は敬遠する
  const priceRatio = listing.askingSalary / Math.max(1, listing.marketValue);
  if (priceRatio > 1.05) score -= 0.08;
  if (listing.askingSalary > need.headroom) score -= 0.5;
  // 6. 予算に対して十分に安い選手は、控えとして確保する価値がある
  if (need.depthRoom > 0 && listing.askingSalary <= need.budget * 0.05) score += 0.24;

  // 7. PHASE 3.6: 経営プランの補強ポイント・戦略・FA予算を反映する
  const plan = need.plan;
  if (plan) {
    const positionNeed = plan.needs?.[planKeyOf(player)] ?? 50;
    score += (positionNeed - 50) * 0.004;
    if (plan.strategy === 'WIN_NOW') score += player.age >= 27 && player.age <= 33 ? 0.08 : -0.04;
    else if (plan.strategy === 'YOUTH') score += player.age <= 25 ? 0.1 : -0.08;
    else if (plan.strategy === 'BUDGET' && listing.askingSalary > need.budget * 0.06) score -= 0.14;
    // 配分した FA 予算を超える買い物はしない（人数が足りていない場合を除く）
    if (need.rosterShortage <= 0 && listing.askingSalary > plan.faBudget - plan.faSpent) {
      score -= 0.45;
    }
  }

  return clamp01(score);
}

/** CPU が提示する年俸。希望額の周辺に収める */
export function cpuOfferSalary(listing: FAMarketPlayer, interest: number, rng: Rng): number {
  // 欲しい選手ほど強気に、そうでなければ希望額を少し下回る
  const ratio = 0.88 + interest * 0.28 + rng.next() * 0.06;
  return Math.max(
    listing.minimumSalary,
    Math.min(MAX_SALARY, Math.round(listing.askingSalary * ratio)),
  );
}

/** CPU が提示する契約年数 */
export function cpuOfferYears(
  player: Player,
  listing: FAMarketPlayer,
  rng: Rng,
  tightBudget = false,
): number {
  const max = maxContractYears(player.age);
  // 予算が逼迫している球団は将来の負担を増やさない
  if (tightBudget) return 1;
  const years = listing.preferredYears + rng.int(-1, 0);
  return Math.max(1, Math.min(max, years));
}

/**
 * CPU球団がFA市場に参加する。
 * includePlayerTeam を指定すると、プレイヤー球団も同じ基準で自動参加する
 * （「おまかせ」とバランス検証で使う）。
 */
export function runCpuFAOffers(
  state: GameState,
  options: { includePlayerTeam?: boolean; onlyTeamId?: string } = {},
): void {
  const fa = state.fa;
  if (!fa || fa.phase !== 'open') return;

  for (const team of state.teams) {
    if (options.onlyTeamId && team.id !== options.onlyTeamId) continue;
    if (
      team.id === state.playerTeamId &&
      !options.includePlayerTeam &&
      options.onlyTeamId !== team.id
    ) {
      continue;
    }
    const rng = faRng(state, 'cpu', team.id);
    const need = analyzeNeed(state, team);

    const candidates = fa.listings
      .filter((l) => l.status !== 'SIGNED')
      .map((listing) => {
        const player = freeAgentById(state, listing.playerId);
        if (!player) return null;
        return { listing, player, interest: cpuInterest(state, need, player, listing) };
      })
      .filter((c): c is { listing: FAMarketPlayer; player: Player; interest: number } => !!c)
      .sort((a, b) => b.interest - a.interest || (a.listing.playerId < b.listing.playerId ? -1 : 1));

    // 参加人数は 0〜3 人。ロスターが足りない球団は必ず動く
    // PHASE 3.6: 戦略と球団の癖で積極さが変わる
    const eagerness = clamp01(
      need.eagerness +
        (need.plan
          ? (need.plan.profile.faActivity - 50) / 250 +
            (need.plan.strategy === 'WIN_NOW' ? 0.12 : need.plan.strategy === 'BUDGET' ? -0.18 : 0)
          : 0),
    );
    let quota = 0;
    if (need.rosterShortage > 0) quota = MAX_CPU_OFFERS_PER_TEAM;
    else if (rng.next() < eagerness) quota = 1 + rng.int(0, MAX_CPU_OFFERS_PER_TEAM - 1);
    else if (need.depthRoom > 0 && rng.next() < 0.5) quota = 1;

    for (const candidate of candidates) {
      if (quota <= 0) break;
      // ロスター不足でないなら、興味が薄い選手には手を出さない
      if (need.rosterShortage <= 0 && candidate.interest < 0.38) continue;
      const salary = cpuOfferSalary(candidate.listing, candidate.interest, rng);
      const years = cpuOfferYears(
        candidate.player,
        candidate.listing,
        rng,
        committedSalary(state, team.id) > need.budget * 0.95,
      );
      const result = makeFAOffer(state, team.id, candidate.listing.playerId, salary, years, {
        maxOffers:
          team.id === state.playerTeamId ? MAX_USER_OFFERS : MAX_CPU_OFFERS_PER_TEAM,
      });
      if (result.ok) quota -= 1;
    }

    // ---- 控え（安価な人材）の確保 ----
    // 主力候補とは別枠で、人数に余裕がない球団は残っているFAから安い選手を拾う。
    // これがないと、評価の低い選手が市場に溜まり続けてしまう。
    let depthQuota = need.depthRoom > 0 ? Math.min(2, need.depthRoom) : 0;
    if (depthQuota <= 0) continue;
    // 全球団が同じ最安値の選手に殺到しないよう、球団ごとに順番を散らす。
    // 値段だけでなく、不足しているポジション・出場機会も見る。
    // 控えを拾うのは「いま持っている最下位クラスより良い」ときだけにする。
    // 誰でも拾っていると、市場に出た選手がほぼ全員決まってしまう。
    const worstOwn = (isPitcher: boolean) => {
      const own = state.players.filter(
        (p) => p.teamId === team.id && p.isPitcher === isPitcher,
      );
      if (own.length === 0) return 0;
      return Math.min(...own.map((p) => overallRating(p)));
    };
    const worstFielder = worstOwn(false);
    const worstPitcher = worstOwn(true);

    const cheap = candidates
      .filter((c) => c.listing.askingSalary <= need.budget * 0.08)
      .filter((c) => {
        // 人数が足りない球団は、良し悪しにかかわらず補充する
        if (need.rosterShortage > 0) return true;
        const shortage = c.player.isPitcher ? need.pitcherShortage : need.fielderShortage;
        if (shortage > 0) return true;
        const floor = c.player.isPitcher ? worstPitcher : worstFielder;
        return estimatedAbility(state, team.id, c.player) >= floor;
      })
      .map((c) => {
        const shortage = c.player.isPitcher ? need.pitcherShortage : need.fielderShortage;
        const jitter = faRng(state, 'depth', team.id, c.listing.playerId).next();
        const key =
          c.listing.askingSalary / Math.max(1, need.budget) -
          (shortage > 0 ? 0.03 : 0) -
          roleScore(state, team.id, c.player) * 0.02 +
          jitter * 0.06;
        return { ...c, key };
      })
      .sort((a, b) => a.key - b.key || (a.listing.playerId < b.listing.playerId ? -1 : 1));
    for (const candidate of cheap) {
      if (depthQuota <= 0) break;
      const salary = Math.max(
        candidate.listing.minimumSalary,
        Math.round(candidate.listing.askingSalary * (0.95 + rng.next() * 0.1)),
      );
      const result = makeFAOffer(state, team.id, candidate.listing.playerId, salary, 1, {
        maxOffers: team.id === state.playerTeamId ? MAX_USER_OFFERS : MAX_DEPTH_OFFERS_PER_TEAM,
      });
      if (result.ok) depthQuota -= 1;
    }
  }
}

/* ---------------- 解決 ---------------- */

export interface FAResolution {
  signings: FASignRecord[];
  unsigned: number;
}

function joinTeam(state: GameState, player: Player, teamId: string, salary: number, years: number): void {
  // PHASE 3.9: 移籍・残留をニュースにする（前の球団は在籍履歴から分かる）
  const previousTeamId =
    player.ext.careerTeams?.[player.ext.careerTeams.length - 1]?.teamId ?? null;
  // リーグの年俸水準から見て高額かどうか（球団の内部評価は使わない）
  const level = leagueSalaryLevel(state) / Math.max(1, MINIMUM_ROSTER);
  generateFaNews(state, player, previousTeamId, teamId, salary, years, salary >= level * 4);

  // PHASE 3.6: 使った予算と埋まった枠を経営プランに反映する
  const plan = state.teamPlans?.[teamId];
  if (plan) {
    plan.faSpent += salary;
    plan.log.faSigned += 1;
    const key = planKeyOf(player);
    const drop = 14 + Math.max(0, overallRating(player) - 30) * 0.6;
    plan.needs[key] = Math.max(0, Math.round((plan.needs[key] ?? 50) - drop));
  }
  setUnsignedYears(player, 0);
  player.teamId = teamId;
  player.ext.contract = createContract(salary, years, state.year);
  player.roster = 'second';
  player.lastRosterChangeDate = null;
  player.ext.injuryDemotion = false;
  if (!Array.isArray(player.ext.careerTeams)) player.ext.careerTeams = [];
  player.ext.careerTeams.push({ year: state.year, teamId });
  state.players.push(player);
  if (!state.stats[player.id]) state.stats[player.id] = emptySeasonStats(player.id);
  state.freeAgents = state.freeAgents.filter((p) => p.id !== player.id);
}

/**
 * FA市場を締め切り、各選手の契約先を決める。
 * 1人の選手が複数球団と契約することはない。
 */
export function resolveFreeAgency(state: GameState): FAResolution {
  const fa = state.fa;
  if (!fa) return { signings: [], unsigned: 0 };
  if (fa.phase === 'resolved') return { signings: fa.results, unsigned: fa.unsigned };

  const signings: FASignRecord[] = [];

  // まず最低人数を割っている球団を埋める。
  // 競争が終わってからでは市場が空になっている場合があるため、先に確保する。
  fillMinimumRosters(state, signings);

  // 良い選手（希望年俸が高い順）から決まっていく
  const order = fa.listings
    .filter((l) => l.status !== 'SIGNED')
    .slice()
    .sort(
      (a, b) =>
        b.askingSalary - a.askingSalary || (a.playerId < b.playerId ? -1 : 1),
    );

  // 契約が決まるたびに総年俸が増えるので、その場で予算を追跡する
  const spent = new Map<string, number>();
  const committedOf = (teamId: string) =>
    state.players
      .filter((p) => p.teamId === teamId && p.ext.contract)
      .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0) + (spent.get(teamId) ?? 0);

  for (const listing of order) {
    const player = freeAgentById(state, listing.playerId);
    if (!player) continue;
    const offers = fa.offers.filter((o) => o.playerId === listing.playerId && o.status === 'PENDING');
    if (offers.length === 0) continue;

    const scored = offers
      .map((offer) => ({ offer, score: evaluateOffer(state, listing, player, offer) }))
      .sort((a, b) => b.score.total - a.score.total || (a.offer.teamId < b.offer.teamId ? -1 : 1));

    for (const entry of scored) entry.offer.offerScore = Math.round(entry.score.total * 1000) / 1000;

    // 決まらない期間が長い選手ほど条件にこだわらなくなる
    const threshold = ACCEPT_THRESHOLD * Math.max(0.5, 1 - 0.2 * unsignedYears(player));

    let winner: (typeof scored)[number] | null = null;
    for (const entry of scored) {
      // 極端に安いオファーは通らない
      if (entry.offer.salary < listing.minimumSalary) continue;
      if (entry.score.total < threshold) continue;
      // 予算を超える契約はその球団が結べない
      if (committedOf(entry.offer.teamId) + entry.offer.salary > budgetCeiling(state, entry.offer.teamId)) {
        continue;
      }
      winner = entry;
      break;
    }

    for (const entry of scored) {
      entry.offer.status = winner && entry.offer === winner.offer ? 'ACCEPTED' : 'REJECTED';
    }

    if (!winner) continue;

    joinTeam(state, player, winner.offer.teamId, winner.offer.salary, winner.offer.years);
    spent.set(winner.offer.teamId, (spent.get(winner.offer.teamId) ?? 0) + winner.offer.salary);
    listing.status = 'SIGNED';
    signings.push({
      playerId: player.id,
      name: player.name,
      teamId: winner.offer.teamId,
      salary: winner.offer.salary,
      years: winner.offer.years,
      offers: offers.length,
    });
  }

  // 最低人数を割っている球団は、残ったFAから最低限の補強をする
  fillMinimumRosters(state, signings);

  for (const offer of fa.offers) {
    if (offer.status === 'PENDING') offer.status = 'EXPIRED';
  }

  // 決まらなかった選手は、翌年は要求を下げて再挑戦する
  for (const player of state.freeAgents) setUnsignedYears(player, unsignedYears(player) + 1);

  fa.results = signings;
  fa.unsigned = state.freeAgents.length;
  fa.phase = 'resolved';
  fa.completed = true;
  refreshPayrolls(state);
  return { signings, unsigned: fa.unsigned };
}

/**
 * ロスターが24人を割っている球団を、残っているFA選手で埋める。
 * FA市場が空なら何もしない（新しい選手は作らない）。
 */
export function fillMinimumRosters(state: GameState, signings: FASignRecord[]): void {
  const fa = state.fa;
  for (const team of state.teams) {
    let size = state.players.filter((p) => p.teamId === team.id).length;
    let guard = 0;
    while (size < MINIMUM_ROSTER && state.freeAgents.length > 0 && guard++ < 60) {
      // 安い選手から順に確保する
      const contested = (id: string) =>
        fa ? offersForPlayer(fa, id).length : 0;
      const candidates = state.freeAgents
        .slice()
        .sort((a, b) => {
          // 争奪戦になっていない選手を優先し、その中で安い順に確保する
          const byContest = Math.min(1, contested(a.id)) - Math.min(1, contested(b.id));
          if (byContest !== 0) return byContest;
          const la = fa ? listingFor(fa, a.id) : undefined;
          const lb = fa ? listingFor(fa, b.id) : undefined;
          return (la?.askingSalary ?? 0) - (lb?.askingSalary ?? 0);
        });
      const player = candidates[0];
      if (!player) break;
      const listing = fa ? listingFor(fa, player.id) : undefined;
      const salary = listing?.minimumSalary ?? MIN_SALARY;
      joinTeam(state, player, team.id, salary, 1);
      if (listing) listing.status = 'SIGNED';
      if (fa) {
        for (const offer of fa.offers) {
          if (offer.playerId === player.id && offer.status === 'PENDING') {
            offer.status = offer.teamId === team.id ? 'ACCEPTED' : 'REJECTED';
          }
        }
      }
      signings.push({
        playerId: player.id,
        name: player.name,
        teamId: team.id,
        salary,
        years: 1,
        offers: 0,
      });
      size += 1;
    }
  }
}

/* ---------------- 表示用（内部数値を直接見せない） ---------------- */

/**
 * 市場評価のラベル。
 * 潜在能力・内部の成長値は使わず、市場価値（＝公開情報から作れる値）だけで決める。
 */
export function marketGrade(marketValueAmount: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (marketValueAmount >= 200) return 'S';
  if (marketValueAmount >= 110) return 'A';
  if (marketValueAmount >= 60) return 'B';
  if (marketValueAmount >= 30) return 'C';
  return 'D';
}

export const MARKET_GRADE_LABELS: Record<'S' | 'A' | 'B' | 'C' | 'D', string> = {
  S: '別格',
  A: '高い',
  B: 'やや高い',
  C: '標準',
  D: '控えめ',
};

export const FA_ROLE_LABELS: Record<FARole, string> = {
  STARTER: 'レギュラー候補',
  ROTATION: '先発・救援の柱',
  BENCH: '控え・層の厚み',
  PROSPECT: '若手有望株',
};

/**
 * 球団のスカウト能力に応じた推定総合値の幅（PHASE 3.4 の簡易スカウト）。
 * ドラフト候補と違い、FA選手は実績があるので幅は狭い。真の値そのものは返さない。
 */
export function estimatedOverallRange(
  state: GameState,
  teamId: string,
  player: Player,
): { low: number; high: number } {
  const scout = state.scouting?.teams?.[teamId]?.ability;
  const accuracy = Math.max(20, Math.min(100, scout?.currentAbility ?? 55));
  const width = Math.round(3 + (100 - accuracy) / 12);
  const rng = faRng(state, 'range', teamId, player.id);
  const center = overallRating(player) + rng.normal(0, width / 3);
  return {
    low: Math.max(1, Math.round(center - width)),
    high: Math.min(100, Math.round(center + width)),
  };
}

/* ---------------- 読み込み時の修復 ---------------- */

/**
 * 壊れた状態を安全側に直す。
 * - FAなのに球団IDが残っている
 * - 同じ選手が複数の場所にいる
 * - 引退した選手がFA市場に残っている
 */
export function repairFreeAgents(state: GameState): void {
  if (!Array.isArray(state.freeAgents)) state.freeAgents = [];

  const rostered = new Set(state.players.map((p) => p.id));
  const retired = new Set(state.retiredPlayers?.map((r) => r.playerId) ?? []);
  const seen = new Set<string>();
  const pool: Player[] = [];

  for (const player of state.freeAgents) {
    if (!player || typeof player.id !== 'string') continue;
    if (seen.has(player.id)) continue;
    if (rostered.has(player.id)) continue;
    if (retired.has(player.id)) continue;
    seen.add(player.id);
    player.teamId = '';
    player.ext.contract = null;
    pool.push(player);
  }
  state.freeAgents = pool;

  // 所属しているのに契約がない選手は、市場が閉じている間は起こり得ない
  if (state.fa) {
    state.fa.listings = state.fa.listings.filter((l) => seen.has(l.playerId) || l.status === 'SIGNED');
    state.fa.offers = state.fa.offers.filter(
      (o) => state.teams.some((t) => t.id === o.teamId) && (seen.has(o.playerId) || o.status !== 'PENDING'),
    );
  }
}
