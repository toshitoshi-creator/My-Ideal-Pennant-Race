/**
 * トレード（PHASE 3.5）。
 *
 * ライフサイクル：
 *   シーズン開幕 → トレード期間 → トレード期限 → シーズン終了 → オフシーズン
 *
 * 設計上の約束：
 *  - 契約は選手と一緒に動く。年俸・残り年数・契約年をリセットしない。
 *  - 成立するのは「両球団にとって釣り合う」場合だけ。片方だけ得をする取引は通らない。
 *  - CPU は真の潜在能力そのものではなく、スカウト精度ぶんの誤差を乗せた推定値で判断する。
 *  - 成立後は同じ選手が2球団に存在しない（検証してから一括で反映する）。
 *  - 乱数はすべてゲーム内シードから作る（Math.random は使わない）。
 */
import type {
  GameState,
  Player,
  PlayerSeasonStats,
  TradeOffer,
  TradeRecord,
  TradeRejectReason,
  TradeState,
  TradeTrait,
} from './types';
import { Rng, seedFrom } from './rng';
import { overallRating } from './rating';
import { positionGroup } from './positions';
import { clamp1to100 } from './rank';
import { addDays } from './dates';
import {
  MINIMUM_ROSTER,
  MIN_FIELDERS,
  MIN_PITCHERS,
  marketValue,
  refreshPayrolls,
  teamPayroll,
} from './contract';
import { repairAllSetups } from './engine';
import { ensureFirstTeamViable } from './daily';
import { generateTradeNews } from './news';

/**
 * トレード後に必要な野手・投手の人数（contract.ts と共有）。
 * 1軍は野手9人・投手5人が必要なので、怪我が重なっても組めるだけの余裕を残す。
 */
export { MIN_FIELDERS, MIN_PITCHERS };

/** 1回のトレードで動かせる人数の上限（片側） */
export const MAX_TRADE_PLAYERS = 2;

/** シーズンの何割の時点をトレード期限にするか */
export const TRADE_DEADLINE_RATIO = 0.75;

/** CPUからの提案が有効な日数 */
export const OFFER_EXPIRY_DAYS = 5;

/** 同時にプレイヤー球団へ届く提案の上限（通知だらけにしない） */
export const MAX_PENDING_OFFERS_TO_PLAYER = 2;

/** 1シーズンに1球団が成立させられるトレード数の上限 */
export const MAX_TRADES_PER_TEAM = 4;

/** リーグ全体で1シーズンに試みるトレードの目安 */
export const TRADE_ATTEMPTS_PER_SEASON = 110;

/** 総年俸の上限（PHASE 3.3 / 3.4 と同じ） */
export const PAYROLL_CEILING_RATIO = 1.12;

/**
 * トレード後に保たなければならない保有人数。
 * 24人（リーグの最低人数）ちょうどまで削ると、その後の契約更改や怪我で
 * 身動きが取れなくなるため、1人ぶんの余裕を必ず残す。
 */
export const MIN_ROSTER_AFTER_TRADE = MINIMUM_ROSTER + 1;

/* ---------------- 乱数 ---------------- */

function tradeRng(state: GameState, ...parts: Array<string | number>): Rng {
  return new Rng(seedFrom(`trade:${state.seed}:${state.year}:${parts.join(':')}`));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/* ---------------- 球団の補強方針 ---------------- */

const TRAITS: TradeTrait[] = ['WIN_NOW', 'BALANCED', 'YOUTH', 'BUDGET'];

export const TRADE_TRAIT_LABELS: Record<TradeTrait, string> = {
  WIN_NOW: '今季優先',
  BALANCED: 'バランス',
  YOUTH: '若手育成',
  BUDGET: '堅実経営',
};

/**
 * 球団の補強方針。
 * PHASE 3.6 からは、その年の経営プランで決めた戦略を使う。
 * プランがまだ無い場合だけ、seed から決まる既定の方針を使う。
 */
export function teamTradeTrait(state: GameState, teamId: string): TradeTrait {
  const plan = state.teamPlans?.[teamId];
  if (plan && plan.strategy) return plan.strategy;
  const rng = new Rng(seedFrom(`trait:${state.seed}:${teamId}`));
  return rng.pick(TRAITS);
}

/** 経営プランで使う枠のキー（rosterAnalysis と同じ分け方） */
function planKeyOf(player: Player): string {
  if (player.isPitcher) return (player.pitching?.stamina ?? 0) >= 45 ? 'SP' : 'RP';
  const pos = player.mainPosition;
  if (pos === 'C') return 'C';
  if (pos === 'LF' || pos === 'CF' || pos === 'RF') return 'OF';
  return pos;
}

/** その枠の補強必要度（プランが無ければ中立の50） */
function planNeed(state: GameState, teamId: string, player: Player): number {
  return state.teamPlans?.[teamId]?.needs?.[planKeyOf(player)] ?? 50;
}

/* ---------------- トレード期間 ---------------- */

/** トレード期限の日付。シーズン日程の 75% を過ぎた時点 */
export function tradeDeadline(state: GameState): string {
  const dates = [...new Set(state.schedule.map((g) => g.date))].sort();
  if (dates.length === 0) return state.date;
  const index = Math.max(0, Math.min(dates.length - 1, Math.floor(dates.length * TRADE_DEADLINE_RATIO)));
  return dates[index];
}

/** 今トレードができるか */
export function isTradeOpen(state: GameState): boolean {
  // オフシーズン（ドラフト・契約更改・FA）の間はトレードしない
  if (state.draft || state.contractPhase || state.fa) return false;
  if (state.seasonFinished) return false;
  const deadline = state.trade?.deadline ?? tradeDeadline(state);
  return state.date <= deadline;
}

/** シーズン開幕時にトレードの状態を作り直す（履歴は残す） */
export function resetTradeSeason(state: GameState): void {
  const history = state.trade?.history ?? [];
  // 過去シーズンの statsAtTrade はもう使わない（球団別の成績は歴史に確定済み）。
  // 何十年も持ち続けるとセーブデータが膨らむので、シーズンが変わったら空にする。
  // フィールド自体は残すので、古いセーブや既存の処理はそのまま動く。
  for (const record of history) {
    if (record.year >= state.year) continue;
    if (Object.keys(record.statsAtTrade ?? {}).length > 0) record.statsAtTrade = {};
  }
  state.trade = {
    year: state.year,
    deadline: tradeDeadline(state),
    offers: [],
    history,
    tradedThisSeason: [],
    countByTeam: {},
  };
}

export function createTradeState(state: GameState): TradeState {
  return {
    year: state.year,
    deadline: tradeDeadline(state),
    offers: [],
    history: [],
    tradedThisSeason: [],
    countByTeam: {},
  };
}

/* ---------------- トレードできる選手 ---------------- */

/**
 * その選手をトレードに出せるか。
 * 契約中の選手だけが対象で、未所属（FA）・引退選手は動かせない。
 * 怪我をしているだけならトレードは可能（価値は下がる）。
 */
export function canTradePlayer(state: GameState, player: Player | undefined): boolean {
  if (!player) return false;
  if (!player.teamId) return false;
  if (!state.teams.some((t) => t.id === player.teamId)) return false;
  if (!player.ext.contract) return false;
  if (player.ext.contract.yearsRemaining <= 0) return false;
  if (state.freeAgents.some((p) => p.id === player.id)) return false;
  if (state.retiredPlayers.some((r) => r.playerId === player.id)) return false;
  if (!state.players.some((p) => p.id === player.id)) return false;
  // 同じ選手を1シーズンに何度も動かさない
  if (state.trade?.tradedThisSeason.includes(player.id)) return false;
  return true;
}

/* ---------------- 選手の評価 ---------------- */

/**
 * 球団から見た推定潜在能力。
 * 自球団の選手は正確に把握しているが、他球団の選手はスカウト精度ぶんの誤差が乗る。
 */
export function estimatedPotential(state: GameState, teamId: string, player: Player): number {
  if (player.teamId === teamId) return player.ext.potential;
  const scout = state.scouting?.teams?.[teamId]?.ability;
  const accuracy = Math.max(20, Math.min(100, scout?.potential ?? 55));
  const rng = tradeRng(state, 'pot', teamId, player.id);
  return clamp1to100(player.ext.potential + rng.normal(0, (100 - accuracy) / 8 + 3));
}

/** 年齢による長期価値の係数。若いほど長く戦力になる */
export function ageHorizonFactor(age: number): number {
  if (age <= 23) return 1.2;
  if (age <= 26) return 1.15;
  if (age <= 29) return 1.05;
  if (age <= 32) return 0.95;
  if (age <= 35) return 0.82;
  return 0.7;
}

/**
 * 伸びしろの係数。若くて（推定）潜在能力が高い選手ほど高い。
 * 30歳を過ぎた選手には効かない。
 */
export function futureFactor(state: GameState, teamId: string, player: Player): number {
  if (player.age > 30) return 1;
  const potential = estimatedPotential(state, teamId, player);
  const gap = potential - overallRating(player);
  if (gap <= 0) return 1;
  const youth = clamp01((30 - player.age) / 10);
  return 1 + clamp01(gap / 30) * youth * 0.85;
}

/** 怪我による割引 */
export function injuryFactor(player: Player): number {
  const injury = player.ext.injury;
  if (!injury) return 1;
  if (injury.level === 'minor') return 0.95;
  if (injury.level === 'moderate') return 0.85;
  return 0.72;
}

/**
 * 特殊能力の係数。1つで価値が跳ね上がらないよう、全体で ±10% までに抑える。
 */
export function specialAbilityFactor(player: Player): number {
  let score = 0;
  for (const entry of player.ext.specialAbilities) {
    score += entry.level ?? 1;
  }
  return 1 + Math.max(-0.1, Math.min(0.1, score * 0.012));
}

/** 契約の負担。残り年数ぶんの年俸を負債として見る */
export function contractBurden(player: Player): number {
  const contract = player.ext.contract;
  if (!contract) return 0;
  const years = Math.max(1, contract.yearsRemaining);
  return contract.salary * years * 0.18;
}

/**
 * トレード価値。
 * 「戦力としての資産価値 − 契約の負担」で表すので、
 * 能力が高くても年俸が高すぎる選手は価値が下がる。
 * その日の調子・疲労は使わない（一時的な状態で価値が乱高下しないように）。
 */
export function calculateTradeValue(
  state: GameState,
  player: Player,
  viewerTeamId: string,
): number {
  const stats = state.stats[player.id];
  // 能力・年齢・成績・実績は PHASE 3.3 の市場価値をそのまま土台にする
  const asset =
    marketValue(player, stats, state.year) *
    ageHorizonFactor(player.age) *
    futureFactor(state, viewerTeamId, player) *
    injuryFactor(player) *
    specialAbilityFactor(player);
  const value = asset - contractBurden(player);
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

/* ---------------- ポジション需要 ---------------- */

export interface PositionDepth {
  /** その枠にいる選手のうち、上位の総合値 */
  best: number;
  second: number;
  count: number;
}

function depthKey(player: Player): string {
  return player.isPitcher ? 'P' : positionGroup(player.mainPosition);
}

export function positionDepth(state: GameState, teamId: string, player: Player): PositionDepth {
  const rivals = state.players
    .filter((p) => p.teamId === teamId && p.id !== player.id && depthKey(p) === depthKey(player))
    .map((p) => overallRating(p))
    .sort((a, b) => b - a);
  return {
    best: rivals[0] ?? 0,
    second: rivals[1] ?? 0,
    count: rivals.length,
  };
}

/**
 * その球団がその選手をどれくらい必要としているか（0.75〜1.3）。
 * 手薄な枠なら高く、既に足りている枠なら低い。
 */
export function positionNeedFactor(state: GameState, teamId: string, player: Player): number {
  const depth = positionDepth(state, teamId, player);
  const overall = overallRating(player);
  const need = player.isPitcher ? 9 : depthKey(player) === 'C' ? 2 : 5;

  let factor = 1;
  if (depth.count < need) factor += 0.18;
  if (overall > depth.best) factor += 0.12;
  else if (overall > depth.second) factor += 0.05;
  else if (depth.count >= need + 2) factor -= 0.18;
  return Math.max(0.75, Math.min(1.3, factor));
}

/** 補強方針による重みづけ */
export function traitFactor(trait: TradeTrait, player: Player): number {
  switch (trait) {
    case 'WIN_NOW':
      // 今すぐ戦力になる選手を高く見る
      return player.age >= 27 && player.age <= 34 ? 1.12 : player.age <= 23 ? 0.88 : 1;
    case 'YOUTH':
      return player.age <= 25 ? 1.15 : player.age >= 33 ? 0.85 : 1;
    case 'BUDGET': {
      const salary = player.ext.contract?.salary ?? 0;
      return salary >= 150 ? 0.85 : salary <= 60 ? 1.08 : 1;
    }
    default:
      return 1;
  }
}

/* ---------------- トレードの評価 ---------------- */

export interface TradeEvaluation {
  /** 受け取る価値 ÷ 渡す価値 */
  ratio: number;
  receivedValue: number;
  givenValue: number;
  accept: boolean;
  reason?: TradeRejectReason;
}

/** その球団にとって、選手を受け取る価値 */
function incomingValue(state: GameState, teamId: string, player: Player): number {
  const trait = teamTradeTrait(state, teamId);
  // PHASE 3.6: 経営プランの補強ポイントを上乗せする（0.88〜1.16倍）
  const need = planNeed(state, teamId, player);
  const planFactor = 1 + (need - 50) * 0.0032;
  return (
    calculateTradeValue(state, player, teamId) *
    positionNeedFactor(state, teamId, player) *
    traitFactor(trait, player) *
    planFactor
  );
}

/** その球団にとって、選手を手放す痛み */
function outgoingValue(state: GameState, teamId: string, player: Player): number {
  const trait = teamTradeTrait(state, teamId);
  // 余っている枠の選手は、手放しても痛くない
  const depth = positionDepth(state, teamId, player);
  const overall = overallRating(player);
  const need = player.isPitcher ? 9 : depthKey(player) === 'C' ? 2 : 5;
  let surplus = 1;
  if (depth.count >= need && overall <= depth.second) surplus = 0.82;
  else if (depth.count < need) surplus = 1.12;
  // PHASE 3.6: 補強ポイントが高い枠の選手は手放したくない
  const planFactor = 1 + (planNeed(state, teamId, player) - 50) * 0.0028;
  return (
    calculateTradeValue(state, player, teamId) * surplus * traitFactor(trait, player) * planFactor
  );
}

/**
 * teamId から見たトレードの損得。
 * incoming を受け取り、outgoing を手放す。
 */
export function evaluateTradeFor(
  state: GameState,
  teamId: string,
  incoming: Player[],
  outgoing: Player[],
): TradeEvaluation {
  const receivedValue = incoming.reduce((sum, p) => sum + incomingValue(state, teamId, p), 0);
  const givenValue = outgoing.reduce((sum, p) => sum + outgoingValue(state, teamId, p), 0);
  const ratio = givenValue <= 0 ? (receivedValue > 0 ? 2 : 1) : receivedValue / givenValue;

  // 総年俸が増えすぎる取引は受けない
  const salaryIn = incoming.reduce((s, p) => s + (p.ext.contract?.salary ?? 0), 0);
  const salaryOut = outgoing.reduce((s, p) => s + (p.ext.contract?.salary ?? 0), 0);
  const finance = state.finances[teamId];
  const ceiling = (finance?.budget ?? 900) * PAYROLL_CEILING_RATIO;
  const after = teamPayroll(state, teamId) + salaryIn - salaryOut;
  if (after > ceiling) {
    return { ratio, receivedValue, givenValue, accept: false, reason: 'budget' };
  }

  // 人数が減る取引は、手薄な球団ほど受けにくい
  const rosterSize = state.players.filter((p) => p.teamId === teamId).length;
  if (rosterSize - outgoing.length + incoming.length < MIN_ROSTER_AFTER_TRADE) {
    return { ratio, receivedValue, givenValue, accept: false, reason: 'roster' };
  }

  // 自分の主力を、代わりの利かない枠から抜かれる提案は断る
  for (const player of outgoing) {
    const depth = positionDepth(state, teamId, player);
    const overall = overallRating(player);
    const need = player.isPitcher ? 9 : depthKey(player) === 'C' ? 2 : 5;
    if (depth.count < need - 1 && overall >= depth.best) {
      return { ratio, receivedValue, givenValue, accept: false, reason: 'position' };
    }
  }

  const accept = ratio >= acceptThreshold(state, teamId);
  return {
    ratio,
    receivedValue,
    givenValue,
    accept,
    reason: accept ? undefined : 'value',
  };
}

/** 受諾に必要な比率。球団ごとに少しだけ違う */
export function acceptThreshold(state: GameState, teamId: string): number {
  const rng = tradeRng(state, 'threshold', teamId);
  return 1.05 + rng.next() * 0.08;
}

/* ---------------- 検証 ---------------- */

export type TradeError =
  | 'closed'
  | 'same-team'
  | 'unknown-team'
  | 'unknown-player'
  | 'empty'
  | 'too-many'
  | 'duplicate'
  | 'not-tradable'
  | 'wrong-team'
  | 'roster'
  | 'position-minimum'
  | 'payroll'
  | 'trade-limit';

export interface ValidationResult {
  ok: boolean;
  error?: TradeError;
  message?: string;
}

const ERROR_MESSAGES: Record<TradeError, string> = {
  closed: 'トレード市場は閉鎖されています',
  'same-team': '同じ球団同士ではトレードできません',
  'unknown-team': '存在しない球団です',
  'unknown-player': '存在しない選手が含まれています',
  empty: '両球団から最低1人ずつ選んでください',
  'too-many': `1回のトレードで動かせるのは片側${MAX_TRADE_PLAYERS}人までです`,
  duplicate: '同じ選手が重複しています',
  'not-tradable': 'トレードできない選手が含まれています',
  'wrong-team': '選手の所属球団が正しくありません',
  roster: `トレード後に保有選手が${MIN_ROSTER_AFTER_TRADE}人を下回ります`,
  'position-minimum': 'トレード後に1軍を組める人数を確保できません',
  payroll: 'トレード後に総年俸が予算を超えます',
  'trade-limit': '今シーズンのトレード上限に達しています',
};

function playersOf(state: GameState, ids: string[]): Player[] | null {
  const found: Player[] = [];
  for (const id of ids) {
    const player = state.players.find((p) => p.id === id);
    if (!player) return null;
    found.push(player);
  }
  return found;
}

/** トレード成立後の人数・年俸を先に確かめる */
function checkTeamAfterTrade(
  state: GameState,
  teamId: string,
  incoming: Player[],
  outgoing: Player[],
): TradeError | null {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const outIds = new Set(outgoing.map((p) => p.id));
  const after = [...roster.filter((p) => !outIds.has(p.id)), ...incoming];

  if (after.length < MIN_ROSTER_AFTER_TRADE) return 'roster';
  const fielders = after.filter((p) => !p.isPitcher).length;
  const pitchers = after.filter((p) => p.isPitcher).length;
  if (fielders < MIN_FIELDERS || pitchers < MIN_PITCHERS) return 'position-minimum';

  const payroll = after.reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
  const ceiling = (state.finances[teamId]?.budget ?? 900) * PAYROLL_CEILING_RATIO;
  if (payroll > ceiling) return 'payroll';

  const done = state.trade?.countByTeam[teamId] ?? 0;
  if (done >= MAX_TRADES_PER_TEAM) return 'trade-limit';
  return null;
}

/** トレードが成立できる形かどうかを、実行前に確かめる */
export function validateTrade(state: GameState, offer: TradeOffer): ValidationResult {
  const fail = (error: TradeError): ValidationResult => ({
    ok: false,
    error,
    message: ERROR_MESSAGES[error],
  });

  if (!isTradeOpen(state)) return fail('closed');
  if (offer.fromTeamId === offer.toTeamId) return fail('same-team');
  if (
    !state.teams.some((t) => t.id === offer.fromTeamId) ||
    !state.teams.some((t) => t.id === offer.toTeamId)
  ) {
    return fail('unknown-team');
  }

  const offered = offer.offeredPlayerIds;
  const requested = offer.requestedPlayerIds;
  if (offered.length === 0 || requested.length === 0) return fail('empty');
  if (offered.length > MAX_TRADE_PLAYERS || requested.length > MAX_TRADE_PLAYERS) {
    return fail('too-many');
  }
  const all = [...offered, ...requested];
  if (new Set(all).size !== all.length) return fail('duplicate');

  const fromPlayers = playersOf(state, offered);
  const toPlayers = playersOf(state, requested);
  if (!fromPlayers || !toPlayers) return fail('unknown-player');

  for (const player of fromPlayers) {
    if (player.teamId !== offer.fromTeamId) return fail('wrong-team');
    if (!canTradePlayer(state, player)) return fail('not-tradable');
  }
  for (const player of toPlayers) {
    if (player.teamId !== offer.toTeamId) return fail('wrong-team');
    if (!canTradePlayer(state, player)) return fail('not-tradable');
  }

  const fromError = checkTeamAfterTrade(state, offer.fromTeamId, toPlayers, fromPlayers);
  if (fromError) return fail(fromError);
  const toError = checkTeamAfterTrade(state, offer.toTeamId, fromPlayers, toPlayers);
  if (toError) return fail(toError);

  return { ok: true };
}

/* ---------------- 提案 ---------------- */

function nextOfferId(state: GameState, offer: Omit<TradeOffer, 'id'>): string {
  const seq = (state.trade?.offers.length ?? 0) + (state.trade?.history.length ?? 0);
  return `tr-${offer.createdYear}-${offer.fromTeamId}-${offer.toTeamId}-${seq}`;
}

export function createTradeOffer(
  state: GameState,
  fromTeamId: string,
  toTeamId: string,
  offeredPlayerIds: string[],
  requestedPlayerIds: string[],
): TradeOffer {
  const base = {
    fromTeamId,
    toTeamId,
    offeredPlayerIds: [...offeredPlayerIds],
    requestedPlayerIds: [...requestedPlayerIds],
    status: 'PENDING' as const,
    createdYear: state.year,
    createdDate: state.date,
    expiresDate: addDays(state.date, OFFER_EXPIRY_DAYS),
  };
  return { id: nextOfferId(state, base), ...base };
}

/* ---------------- 成立処理 ---------------- */

function movePlayer(state: GameState, player: Player, teamId: string): void {
  player.teamId = teamId;
  player.lastRosterChangeDate = null;
  player.ext.injuryDemotion = false;
  const firstCount = state.players.filter((p) => p.teamId === teamId && p.roster === 'first').length;
  player.roster = firstCount < 31 ? 'first' : 'second';
  if (!Array.isArray(player.ext.careerTeams)) player.ext.careerTeams = [];
  player.ext.careerTeams.push({ year: state.year, teamId });
}

export interface TradeResult {
  ok: boolean;
  error?: TradeError;
  message?: string;
  record?: TradeRecord;
}

/**
 * トレードを実行する。
 * 先に検証を通してから移動するので、途中で片方だけ動くことはない。
 */
export function executeTrade(state: GameState, offer: TradeOffer): TradeResult {
  const check = validateTrade(state, offer);
  if (!check.ok) return { ok: false, error: check.error, message: check.message };

  // 検証を通ったので、ここから先は必ず全員そろっている
  const fromPlayers = playersOf(state, offer.offeredPlayerIds)!;
  const toPlayers = playersOf(state, offer.requestedPlayerIds)!;

  // 成績は選手についていくので、移籍時点の数字を控えておく
  const statsAtTrade: Record<string, PlayerSeasonStats> = {};
  for (const player of [...fromPlayers, ...toPlayers]) {
    const stats = state.stats[player.id];
    if (stats) statsAtTrade[player.id] = structuredClone(stats);
  }

  const record: TradeRecord = {
    id: offer.id,
    year: state.year,
    date: state.date,
    fromTeamId: offer.fromTeamId,
    toTeamId: offer.toTeamId,
    playerIdsFrom: fromPlayers.map((p) => p.id),
    playerIdsTo: toPlayers.map((p) => p.id),
    playerNamesFrom: fromPlayers.map((p) => p.name),
    playerNamesTo: toPlayers.map((p) => p.name),
    statsAtTrade,
  };

  for (const player of fromPlayers) movePlayer(state, player, offer.toTeamId);
  for (const player of toPlayers) movePlayer(state, player, offer.fromTeamId);

  offer.status = 'ACCEPTED';

  const trade = state.trade;
  trade.history.push(record);
  for (const id of [...record.playerIdsFrom, ...record.playerIdsTo]) {
    if (!trade.tradedThisSeason.includes(id)) trade.tradedThisSeason.push(id);
  }
  trade.countByTeam[offer.fromTeamId] = (trade.countByTeam[offer.fromTeamId] ?? 0) + 1;
  trade.countByTeam[offer.toTeamId] = (trade.countByTeam[offer.toTeamId] ?? 0) + 1;

  // PHASE 3.6: 経営プランに結果を反映する（埋まった枠は必要度が下がる）
  for (const [teamId, arrived] of [
    [offer.toTeamId, fromPlayers],
    [offer.fromTeamId, toPlayers],
  ] as Array<[string, Player[]]>) {
    const plan = state.teamPlans?.[teamId];
    if (!plan) continue;
    plan.log.tradesDone += 1;
    for (const player of arrived) {
      const key = planKeyOf(player);
      const drop = 12 + Math.max(0, overallRating(player) - 30) * 0.6;
      plan.needs[key] = Math.max(0, Math.round((plan.needs[key] ?? 50) - drop));
    }
  }

  refreshPayrolls(state);
  ensureFirstTeamViable(state, offer.fromTeamId);
  ensureFirstTeamViable(state, offer.toTeamId);
  repairAllSetups(state);

  // 自球団が関わるトレードだけ通知する
  if (offer.fromTeamId === state.playerTeamId || offer.toTeamId === state.playerTeamId) {
    const gained =
      offer.toTeamId === state.playerTeamId ? record.playerNamesFrom : record.playerNamesTo;
    const lost =
      offer.toTeamId === state.playerTeamId ? record.playerNamesTo : record.playerNamesFrom;
    state.notices.push({
      date: state.date,
      kind: 'trade',
      message: `トレード成立：${lost.join('・')} ⇄ ${gained.join('・')}`,
    });
  }

  // PHASE 3.9: トレード成立をニュースにする
  generateTradeNews(
    state,
    offer.fromTeamId,
    offer.toTeamId,
    record.playerNamesFrom,
    record.playerNamesTo,
    record.playerIdsFrom,
    record.playerIdsTo,
    record.id,
  );

  return { ok: true, record };
}

/** 提案を断る */
export function rejectTradeOffer(offer: TradeOffer, reason?: TradeRejectReason): void {
  offer.status = 'REJECTED';
  if (reason) offer.reason = reason;
}

/** 自分が出した提案を取り下げる */
export function cancelTradeOffer(state: GameState, offerId: string): boolean {
  const offer = state.trade.offers.find((o) => o.id === offerId && o.status === 'PENDING');
  if (!offer) return false;
  offer.status = 'CANCELLED';
  return true;
}

/** 期限切れの提案を片づける */
export function expireTradeOffers(state: GameState): void {
  for (const offer of state.trade.offers) {
    if (offer.status !== 'PENDING') continue;
    if (state.date > offer.expiresDate || !isTradeOpen(state)) offer.status = 'EXPIRED';
  }
}

/** プレイヤー球団に届いている未処理の提案 */
export function pendingOffersForPlayer(state: GameState): TradeOffer[] {
  return state.trade.offers.filter(
    (o) => o.toTeamId === state.playerTeamId && o.status === 'PENDING',
  );
}

/** プレイヤー球団が出している提案 */
export function pendingOffersFromPlayer(state: GameState): TradeOffer[] {
  return state.trade.offers.filter(
    (o) => o.fromTeamId === state.playerTeamId && o.status === 'PENDING',
  );
}

/**
 * プレイヤーからの提案に CPU が即答する。
 * 交渉のやり取りはせず、受諾か拒否かだけを返す。
 */
export function respondToOffer(state: GameState, offer: TradeOffer): TradeResult {
  const check = validateTrade(state, offer);
  if (!check.ok) {
    rejectTradeOffer(offer, 'roster');
    return { ok: false, error: check.error, message: check.message };
  }

  const incoming = playersOf(state, offer.offeredPlayerIds)!;
  const outgoing = playersOf(state, offer.requestedPlayerIds)!;
  const evaluation = evaluateTradeFor(state, offer.toTeamId, incoming, outgoing);
  offer.evaluation = Math.round(evaluation.ratio * 1000) / 1000;

  if (!evaluation.accept) {
    rejectTradeOffer(offer, evaluation.reason ?? 'value');
    return { ok: false, error: 'not-tradable', message: rejectMessage(evaluation.reason) };
  }
  return executeTrade(state, offer);
}

export function rejectMessage(reason: TradeRejectReason | undefined): string {
  switch (reason) {
    case 'position':
      return 'このポジションの選手を放出する予定はありません';
    case 'contract':
      return '契約条件を考えると、受け入れるのは難しいと判断しました';
    case 'budget':
      return '年俸の負担が大きく、球団の予算では受けられません';
    case 'roster':
      return '選手層が薄くなるため、この人数では受けられません';
    default:
      return '戦力面で釣り合わないと判断しました';
  }
}

/**
 * その球団の「今季トレードで出入りした成績」を集計する。
 * 成績は選手についていくため、球団単位の合計を出すときはこの差分で調整する。
 */
export function tradedStatsAdjustment(
  state: GameState,
  teamId: string,
): { incoming: PlayerSeasonStats[]; outgoing: PlayerSeasonStats[] } {
  const incoming: PlayerSeasonStats[] = [];
  const outgoing: PlayerSeasonStats[] = [];
  for (const record of state.trade.history) {
    if (record.year !== state.year) continue;
    const movedToFrom = record.playerIdsTo; // toTeam → fromTeam
    const movedToTo = record.playerIdsFrom; // fromTeam → toTeam
    if (record.fromTeamId === teamId) {
      for (const id of movedToFrom) if (record.statsAtTrade[id]) incoming.push(record.statsAtTrade[id]);
      for (const id of movedToTo) if (record.statsAtTrade[id]) outgoing.push(record.statsAtTrade[id]);
    } else if (record.toTeamId === teamId) {
      for (const id of movedToTo) if (record.statsAtTrade[id]) incoming.push(record.statsAtTrade[id]);
      for (const id of movedToFrom) if (record.statsAtTrade[id]) outgoing.push(record.statsAtTrade[id]);
    }
  }
  return { incoming, outgoing };
}

/* ---------------- 公平度の表示 ---------------- */

export type FairnessLabel =
  | '非常に不利'
  | '不利'
  | 'やや不利'
  | '互角'
  | 'やや有利'
  | '有利'
  | '非常に有利';

/** 比率を「互角」「やや有利」などのラベルにする（内部数値は出さない） */
export function fairnessLabel(ratio: number): FairnessLabel {
  if (!Number.isFinite(ratio)) return '互角';
  if (ratio >= 1.6) return '非常に有利';
  if (ratio >= 1.25) return '有利';
  if (ratio >= 1.08) return 'やや有利';
  if (ratio > 0.93) return '互角';
  if (ratio > 0.8) return 'やや不利';
  if (ratio > 0.62) return '不利';
  return '非常に不利';
}

/** 価値の大きさを抽象的に表す */
export function valueLabel(value: number): '非常に高い' | '高い' | '普通' | 'やや低い' | '低い' {
  if (value >= 220) return '非常に高い';
  if (value >= 120) return '高い';
  if (value >= 55) return '普通';
  if (value >= 25) return 'やや低い';
  return '低い';
}

/* ---------------- CPU ---------------- */

interface TeamNeedInfo {
  teamId: string;
  trait: TradeTrait;
  /** 手薄な枠（'P' / 'C' / 'IF' / 'OF'） */
  weakest: string;
  rosterSize: number;
}

const DEPTH_KEYS = ['P', 'C', 'IF', 'OF'] as const;

function analyzeTeam(state: GameState, teamId: string): TeamNeedInfo {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const strength = new Map<string, number>();
  for (const key of DEPTH_KEYS) {
    const group = roster
      .filter((p) => (p.isPitcher ? 'P' : positionGroup(p.mainPosition)) === key)
      .map((p) => overallRating(p))
      .sort((a, b) => b - a);
    const top = group.slice(0, key === 'P' ? 6 : key === 'C' ? 2 : 4);
    strength.set(key, top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0);
  }
  let weakest = 'P';
  let lowest = Infinity;
  for (const key of DEPTH_KEYS) {
    const value = strength.get(key) ?? 0;
    if (value < lowest) {
      lowest = value;
      weakest = key;
    }
  }
  return { teamId, trait: teamTradeTrait(state, teamId), weakest, rosterSize: roster.length };
}

function tradableRoster(state: GameState, teamId: string): Player[] {
  return state.players.filter((p) => p.teamId === teamId && canTradePlayer(state, p));
}

/**
 * 1球団が1件のトレードを組み立てる。
 * 相手にとっても釣り合う組み合わせが見つからなければ null。
 */
export function buildCpuOffer(
  state: GameState,
  fromTeamId: string,
  toTeamId: string,
  rng: Rng,
): TradeOffer | null {
  const need = analyzeTeam(state, fromTeamId);

  // 欲しい選手：相手の中で、自分の手薄な枠を埋められる選手。
  // PHASE 3.6: 経営プランの補強ポイントが高い枠も対象にする。
  const planNeeds = state.teamPlans?.[fromTeamId]?.needs;
  const wanted = (p: Player) => {
    if ((p.isPitcher ? 'P' : positionGroup(p.mainPosition)) === need.weakest) return true;
    return planNeeds ? (planNeeds[planKeyOf(p)] ?? 0) >= 65 : false;
  };

  const targets = tradableRoster(state, toTeamId)
    .filter(wanted)
    .sort(
      (a, b) =>
        incomingValue(state, fromTeamId, b) - incomingValue(state, fromTeamId, a),
    )
    .slice(0, 5);
  if (targets.length === 0) return null;

  // 出せる選手：自分の中で余っている枠から（補強ポイントが高い枠は出さない）
  const assets = tradableRoster(state, fromTeamId)
    .filter((p) => (p.isPitcher ? 'P' : positionGroup(p.mainPosition)) !== need.weakest)
    .filter((p) => !planNeeds || (planNeeds[planKeyOf(p)] ?? 0) < 70)
    .sort((a, b) => outgoingValue(state, fromTeamId, a) - outgoingValue(state, fromTeamId, b))
    .slice(0, 8);
  if (assets.length === 0) return null;

  // 毎回同じ組み合わせにならないよう、候補の順番を少しだけ揺らす
  const target = targets[rng.int(0, Math.min(2, targets.length - 1))];

  const tryOffer = (offered: Player[]): TradeOffer | null => {
    if (offered.length === 0) return null;
    const offer = createTradeOffer(
      state,
      fromTeamId,
      toTeamId,
      offered.map((p) => p.id),
      [target.id],
    );
    if (!validateTrade(state, offer).ok) return null;
    // 自分にとって損なら提案しない。
    // 持ちかける側なので、相手ほど強くは求めない（釣り合っていれば動く）。
    const mine = evaluateTradeFor(state, fromTeamId, [target], offered);
    if (mine.reason === 'budget' || mine.reason === 'roster' || mine.reason === 'position') return null;
    if (mine.ratio < 1) return null;
    // 相手が受けられる見込みがなければ提案しない
    const theirs = evaluateTradeFor(state, toTeamId, offered, [target]);
    offer.evaluation = Math.round(theirs.ratio * 1000) / 1000;
    return theirs.accept ? offer : null;
  };

  // 1対1 → 2対1 の順に試す
  for (const asset of assets) {
    const offer = tryOffer([asset]);
    if (offer) return offer;
  }
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const offer = tryOffer([assets[i], assets[j]]);
      if (offer) return offer;
    }
  }
  return null;
}

/** 1日の中で試みるトレードの回数（シーズンの長さに合わせる） */
export function tradeAttemptsPerDay(state: GameState, rng: Rng): number {
  const dates = [...new Set(state.schedule.map((g) => g.date))];
  const windowDays = Math.max(1, Math.floor(dates.length * TRADE_DEADLINE_RATIO));
  const perDay = TRADE_ATTEMPTS_PER_SEASON / windowDays;
  const whole = Math.floor(perDay);
  return whole + (rng.next() < perDay - whole ? 1 : 0);
}

/**
 * CPU球団のトレード活動。
 * CPU同士は即座に成立し、プレイヤー球団宛は提案として届く。
 */
export function runCpuTrades(state: GameState): void {
  expireTradeOffers(state);
  if (!isTradeOpen(state)) return;

  // 試合や成長で使う乱数列とは分けておく。
  // 同じ列を共有すると、トレードの有無で既存の抽選結果がすべてずれてしまう。
  const rng = tradeRng(state, 'day', state.date);
  const attempts = tradeAttemptsPerDay(state, rng);
  for (let i = 0; i < attempts; i++) {
    const teams = state.teams.filter((t) => t.id !== state.playerTeamId);
    if (teams.length < 2) return;
    const from = teams[rng.int(0, teams.length - 1)];
    if ((state.trade.countByTeam[from.id] ?? 0) >= MAX_TRADES_PER_TEAM) continue;
    // PHASE 3.6: トレードに消極的な球団は動きが少ない
    const activity = state.teamPlans?.[from.id]?.profile.tradeActivity;
    if (activity !== undefined && rng.next() > 0.62 + activity / 160) continue;

    // 相手はプレイヤー球団も含む
    const partners = state.teams.filter((t) => t.id !== from.id);
    const to = partners[rng.int(0, partners.length - 1)];

    if (to.id === state.playerTeamId) {
      // 提案が溜まりすぎないようにする
      if (pendingOffersForPlayer(state).length >= MAX_PENDING_OFFERS_TO_PLAYER) continue;
      if (state.trade.offers.some((o) => o.fromTeamId === from.id && o.createdYear === state.year)) {
        continue;
      }
      const offer = buildCpuOffer(state, from.id, to.id, rng);
      if (!offer) continue;
      state.trade.offers.push(offer);
      state.notices.push({
        date: state.date,
        kind: 'trade',
        message: `${state.teams.find((t) => t.id === from.id)?.name ?? from.id} からトレードの申し入れがありました`,
      });
      continue;
    }

    const offer = buildCpuOffer(state, from.id, to.id, rng);
    if (!offer) continue;
    state.trade.offers.push(offer);
    executeTrade(state, offer);
  }
}
