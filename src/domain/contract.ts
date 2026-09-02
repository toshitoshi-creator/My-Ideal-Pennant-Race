/**
 * 契約・年俸・球団資金（PHASE 3.3）。
 *
 * 年俸の内部単位は「1 = 100万円」。UI では 1.2億円 のように変換して表示する。
 *
 * 契約は選手の能力を一切変化させない（高年俸だから成長する、といった処理はしない）。
 * 年俸は「長期的な能力・年齢・実績」から決まり、その日の調子・疲労は使わない。
 */
import type {
  Contract,
  GameState,
  Player,
  PlayerSeasonStats,
  TeamFinance,
} from './types';
import { Rng } from './rng';
import { overallRating } from './rating';

/** 年俸の下限（1500万円） */
export const MIN_SALARY = 15;
/** 年俸の上限（15億円）。青天井にしないための歯止め */
export const MAX_SALARY = 1500;

/** 球団が保有する最低人数。これを割らないように契約・FAを調整する */
export const MINIMUM_ROSTER = 24;

/** 契約年数の上限（年齢で変わる） */
export function maxContractYears(age: number): number {
  if (age <= 27) return 5;
  if (age <= 32) return 4;
  if (age <= 35) return 3;
  return 2;
}

/** 内部単位（100万円）を「1.2億円」のような表示にする */
export function formatSalary(value: number): string {
  const amount = Math.max(0, Math.round(value));
  if (amount >= 100) {
    const oku = amount / 100;
    return `${oku.toFixed(oku >= 10 ? 1 : 2)}億円`;
  }
  return `${amount}00万円`;
}

/** 資金・予算のような大きな金額の表示 */
export function formatMoney(value: number): string {
  const oku = value / 100;
  return `${oku.toFixed(1)}億円`;
}

/* ---------------- 年俸の算定 ---------------- */

/** 年齢による年俸の補正。若手は安く、ベテランは緩やかに下がる */
export function ageSalaryFactor(age: number): number {
  if (age <= 21) return 0.55;
  if (age <= 24) return 0.7;
  if (age <= 27) return 0.9;
  if (age <= 32) return 1;
  if (age <= 35) return 0.92;
  return 0.8;
}

/**
 * 直近シーズンの成績評価（-0.25〜+0.5）。
 * 出場が少ない選手は 0（評価なし）になる。
 */
export function performanceFactor(player: Player, stats: PlayerSeasonStats | undefined): number {
  if (!stats) return 0;
  if (player.isPitcher) {
    const innings = stats.pitching.outs / 3;
    if (innings < 20) return 0;
    const era = (stats.pitching.earnedRuns * 9) / innings;
    const value = (4.1 - era) / 3.2 + Math.min(0.2, innings / 900);
    return Math.max(-0.25, Math.min(0.5, value));
  }
  if (stats.batting.atBats < 80) return 0;
  const avg = stats.batting.hits / stats.batting.atBats;
  const hrRate = stats.batting.homeRuns / stats.batting.atBats;
  const value = (avg - 0.255) * 6 + hrRate * 9 + Math.min(0.15, stats.batting.rbi / 600);
  return Math.max(-0.25, Math.min(0.5, value));
}

/** 通算年数（実績）による補正。長く在籍した選手は急には下がらない */
export function experienceFactor(player: Player, year: number): number {
  const debut = player.ext.debutYear ?? year;
  const years = Math.max(1, year - debut + 1);
  return 1 + Math.min(0.25, (years - 1) * 0.03);
}

/**
 * 選手の市場価値（年俸の目安）。
 * 能力に対してなめらかな指数曲線で、上限で頭打ちになる。
 */
export function marketValue(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  year: number,
): number {
  const overall = overallRating(player);
  const base = 26 * Math.exp((overall - 32) / 17);
  const value =
    base * ageSalaryFactor(player.age) * (1 + performanceFactor(player, stats)) *
    experienceFactor(player, year);
  if (!Number.isFinite(value)) return MIN_SALARY;
  return Math.max(MIN_SALARY, Math.min(MAX_SALARY, Math.round(value)));
}

/**
 * 契約更改で選手が求める最低年俸。
 * 市場価値をやや下回る額までは受け入れるが、現年俸からの大幅減俸は拒否する。
 */
export function expectedSalary(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  year: number,
): number {
  const market = marketValue(player, stats, year);
  const current = player.ext.contract?.salary ?? market;
  return Math.max(MIN_SALARY, Math.round(Math.max(market * 0.92, current * 0.55)));
}

/** 長期契約はやや割安になる（選手にとっては安定が得られる） */
export function yearsDiscount(years: number): number {
  return 1 - Math.max(0, Math.min(4, years - 1)) * 0.02;
}

/** 提示を受け入れるか */
export function acceptsOffer(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  year: number,
  offer: { salary: number; years: number },
): boolean {
  if (offer.salary <= 0 || offer.years <= 0) return false;
  if (offer.years > maxContractYears(player.age)) return false;
  const required = expectedSalary(player, stats, year) * yearsDiscount(offer.years);
  return offer.salary >= Math.round(required);
}

/* ---------------- 契約 ---------------- */

export function createContract(salary: number, years: number, signedYear: number): Contract {
  const safeSalary = Math.max(MIN_SALARY, Math.min(MAX_SALARY, Math.round(salary)));
  const safeYears = Math.max(1, Math.min(5, Math.round(years)));
  return {
    salary: safeSalary,
    yearsRemaining: safeYears,
    totalYears: safeYears,
    signedYear,
  };
}

/**
 * 直近の年俸を覚えておく（PHASE 3.4）。
 * 契約を解除すると salary が失われるため、FA の希望年俸の計算に使う。
 * hiddenAttributes は PHASE 3 以降の拡張用に用意されている置き場所。
 */
export function rememberSalary(player: Player): void {
  const salary = player.ext.contract?.salary;
  if (typeof salary !== 'number' || !Number.isFinite(salary)) return;
  if (!player.ext.hiddenAttributes || typeof player.ext.hiddenAttributes !== 'object') {
    player.ext.hiddenAttributes = {};
  }
  player.ext.hiddenAttributes.lastSalary = salary;
}

/** 覚えている直近の年俸（不明なら 0） */
export function lastKnownSalary(player: Player): number {
  const current = player.ext.contract?.salary;
  if (typeof current === 'number' && Number.isFinite(current)) return current;
  const remembered = player.ext.hiddenAttributes?.lastSalary;
  return typeof remembered === 'number' && Number.isFinite(remembered) ? remembered : 0;
}

/** 契約が切れている（更改が必要な）状態か */
export function isExpiring(player: Player): boolean {
  const contract = player.ext.contract;
  return !contract || contract.yearsRemaining <= 0;
}

export function contractStatus(player: Player): 'contracted' | 'expiring' | 'unsigned' {
  const contract = player.ext.contract;
  if (!contract) return 'unsigned';
  if (contract.yearsRemaining <= 0) return 'expiring';
  return 'contracted';
}

/** ドラフト順位から新人契約を作る。上位でも極端に高くはしない */
export function rookieContract(
  player: Player,
  round: number,
  year: number,
  rng: Rng,
): Contract {
  // 新人契約は市場価値より安く抑える（若手を安く保有できることを育成の価値にする）。
  // ドラフト順位による差は小さめにとどめる。
  const value = marketValue(player, undefined, year);
  const roundBonus = round <= 1 ? 14 : round <= 3 ? 7 : 0;
  const years = round <= 1 ? 4 : round <= 3 ? 3 : 2;
  return createContract(
    Math.round(value * 0.7) + roundBonus + rng.int(0, 4),
    years,
    year,
  );
}

/* ---------------- 球団の資金 ---------------- */

export function createTeamFinance(rng: Rng): TeamFinance {
  // 球団ごとに少しだけ差をつけるが、資金力で勝敗が固定されない範囲にとどめる
  const budget = Math.round(1400 + rng.normal(0, 70));
  return {
    cash: Math.round(1600 + rng.normal(0, 150)),
    budget,
    // PHASE 3.3 では収入の内訳（チケット・グッズなど）は作らず、年間収入をひとまとめに扱う
    annualRevenue: budget,
    payroll: 0,
    lastResult: 0,
  };
}

/** 球団の総年俸（契約している選手の年俸合計） */
export function teamPayroll(state: GameState, teamId: string): number {
  return state.players
    .filter((p) => p.teamId === teamId && p.ext.contract)
    .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
}

/** 全球団の総年俸を計算し直す */
export function refreshPayrolls(state: GameState): void {
  for (const team of state.teams) {
    const finance = state.finances[team.id];
    if (finance) finance.payroll = teamPayroll(state, team.id);
  }
}

export function remainingBudget(state: GameState, teamId: string): number {
  const finance = state.finances[teamId];
  if (!finance) return 0;
  return finance.budget - teamPayroll(state, teamId);
}

/** 予算を大きく超えているか（警告表示に使う） */
export function isOverBudget(state: GameState, teamId: string): boolean {
  return remainingBudget(state, teamId) < 0;
}

export function isInDebt(state: GameState, teamId: string): boolean {
  return (state.finances[teamId]?.cash ?? 0) < 0;
}

/**
 * リーグ全体の「選手価値の水準」（1球団あたり）。
 *
 * 選手が実際にいくら貰っているかではなく、能力・年齢・実績から決まる市場価値を使う。
 * 球団の支払い額を参照すると「予算が増える→年俸が上がる→予算が増える」と
 * 際限なく膨らむため、支払い額からは独立させている。
 */
export function leagueSalaryLevel(state: GameState): number {
  if (state.teams.length === 0) return 0;
  const total = state.players.reduce(
    (sum, p) => sum + marketValue(p, state.stats[p.id], state.year),
    0,
  );
  return total / state.teams.length;
}

/**
 * 年間予算をリーグの選手価値の水準に合わせて少しずつ動かす（PHASE 3.6）。
 *
 * PHASE 3.3 では予算がゲーム開始時の値で固定だったため、
 * リーグ全体の能力が上がって年俸水準が上がると、
 * 契約が残っているだけで総年俸が予算を大きく超え続ける球団が出ていた。
 */
export function adjustBudgets(state: GameState): void {
  const level = leagueSalaryLevel(state);
  if (!Number.isFinite(level) || level <= 0) return;
  for (const team of state.teams) {
    const finance = state.finances[team.id];
    if (!finance || !Number.isFinite(finance.budget)) continue;
    // 収入は年俸水準をわずかに上回る程度。急に変わらないよう緩やかに追随させる
    const target = level * 1.06;
    finance.budget = Math.round(finance.budget * 0.72 + target * 0.28);
    finance.annualRevenue = finance.budget;
  }
}

/**
 * シーズン分の人件費を支払う（1シーズンに1回だけ）。
 * 資金が0を下回っても破綻はさせず、警告として扱う。
 */
export function applySeasonFinance(state: GameState): void {
  if (state.lastPayrollYear === state.year) return;
  refreshPayrolls(state);
  // PHASE 3.6: 年間予算をリーグの水準に合わせる
  adjustBudgets(state);
  for (const team of state.teams) {
    const finance = state.finances[team.id];
    if (!finance) continue;
    const payroll = finance.payroll;
    const result = finance.annualRevenue - payroll;
    finance.cash = Math.round(finance.cash + result);
    finance.lastResult = Math.round(result);
  }
  state.lastPayrollYear = state.year;
}

/**
 * 契約年数を1年進める（1シーズンに1回だけ）。
 * 0 になった選手が契約更改の対象になる。
 */
export function tickContracts(state: GameState): Player[] {
  if (state.lastContractYear === state.year) {
    return state.players.filter((p) => p.teamId && isExpiring(p));
  }
  for (const player of state.players) {
    const contract = player.ext.contract;
    if (!contract) continue;
    contract.yearsRemaining = Math.max(0, contract.yearsRemaining - 1);
  }
  state.lastContractYear = state.year;
  return state.players.filter((p) => p.teamId && isExpiring(p));
}

/* ---------------- 契約更改 ---------------- */

export interface RenewalOffer {
  salary: number;
  years: number;
}

export interface RenewalResult {
  accepted: boolean;
  salary: number;
  years: number;
  expected: number;
}

/** 契約更改を適用する。拒否された場合は契約が成立しない */
export function offerContract(
  state: GameState,
  player: Player,
  offer: RenewalOffer,
): RenewalResult {
  const stats = state.stats[player.id];
  const expected = expectedSalary(player, stats, state.year);
  const accepted = acceptsOffer(player, stats, state.year, offer);
  if (accepted) {
    player.ext.contract = createContract(offer.salary, offer.years, state.year);
  }
  return { accepted, salary: offer.salary, years: offer.years, expected };
}

/** CPU が提示する契約年数（若手ほど長く） */
export function cpuContractYears(player: Player, rng: Rng): number {
  const max = maxContractYears(player.age);
  if (player.age <= 24) return Math.min(max, 3 + rng.int(0, 2));
  if (player.age <= 30) return Math.min(max, 2 + rng.int(0, 2));
  return Math.min(max, 1 + rng.int(0, 1));
}

/**
 * 球団戦略にあわせて契約年数を調整する（PHASE 3.6）。
 * 若手育成なら高齢選手に長期契約を与えず、堅実経営なら全体に短くする。
 */
export function adjustYearsForStrategy(
  years: number,
  player: Player,
  strategy: 'WIN_NOW' | 'BALANCED' | 'YOUTH' | 'BUDGET',
): number {
  const max = maxContractYears(player.age);
  let adjusted = years;
  if (strategy === 'YOUTH' && player.age >= 32) adjusted = 1;
  else if (strategy === 'YOUTH' && player.age <= 25) adjusted = Math.min(max, years + 1);
  else if (strategy === 'BUDGET') adjusted = Math.max(1, years - 1);
  else if (strategy === 'WIN_NOW' && player.age >= 27 && player.age <= 33) {
    adjusted = Math.min(max, years + 1);
  }
  return Math.max(1, Math.min(max, adjusted));
}

export interface CpuRenewalSummary {
  renewed: number;
  released: number;
}

/**
 * CPU球団の契約更改。
 * 主力・若手有望株を優先し、予算を見ながら判断する。
 * 予算が厳しい場合は評価の低い選手から契約を見送る。
 */
export function runCpuRenewals(state: GameState, rng: Rng): Record<string, CpuRenewalSummary> {
  const summary: Record<string, CpuRenewalSummary> = {};

  for (const team of state.teams) {
    if (team.id === state.playerTeamId) continue;
    summary[team.id] = renewTeamContracts(state, team.id, rng);
  }
  refreshPayrolls(state);
  return summary;
}

/**
 * 経営プランで使う枠のキー。
 * rosterAnalysis と同じ分け方だが、循環参照を避けるためここで判定する。
 */
function positionKeyForPlan(state: GameState, player: Player): string {
  if (player.isPitcher) {
    const stamina = state.players.find((p) => p.id === player.id)?.pitching?.stamina ?? 0;
    return stamina >= 45 ? 'SP' : 'RP';
  }
  const pos = player.mainPosition;
  if (pos === 'C') return 'C';
  if (pos === 'LF' || pos === 'CF' || pos === 'RF') return 'OF';
  return pos;
}

/**
 * 同じ枠を争う選手が十分にいる（＝余剰である）か。
 * PHASE 3.4 で、CPUが更改を見送る判断に使う。真の潜在能力は参照しない。
 */
export function isSurplusAtPosition(state: GameState, teamId: string, player: Player): boolean {
  const overall = overallRating(player);
  const better = state.players.filter((p) => {
    if (p.id === player.id) return false;
    if (p.teamId !== teamId) return false;
    if (p.isPitcher !== player.isPitcher) return false;
    if (!player.isPitcher && p.mainPosition !== player.mainPosition) return false;
    return overallRating(p) >= overall;
  }).length;
  // 投手はローテ＋救援で枠が広いので、余剰と見なす人数も多くする
  return player.isPitcher ? better >= 6 : better >= 2;
}

/** 1球団分の契約更改（CPU用。プレイヤー球団の自動処理にも使う） */
export function renewTeamContracts(
  state: GameState,
  teamId: string,
  rng: Rng,
  options: { skip?: string[] } = {},
): CpuRenewalSummary {
  const finance = state.finances[teamId];
  const roster = state.players.filter((p) => p.teamId === teamId);
  // すでに交渉が終わっている選手（決裂した選手を含む）は対象にしない
  const skip = new Set(options.skip ?? []);
  const expiring = roster.filter((p) => isExpiring(p) && !skip.has(p.id));
  if (expiring.length === 0) return { renewed: 0, released: 0 };

  // 契約が残っている選手の年俸は確定分として扱う
  const committed = roster
    .filter((p) => !isExpiring(p))
    .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
  const budget = finance?.budget ?? 900;

  // PHASE 3.6: 球団の経営プラン（戦略・補強ポイント）を判断に反映する
  const plan = state.teamPlans?.[teamId];
  const strategy = plan?.strategy ?? 'BALANCED';
  const needOf = (player: Player) => plan?.needs?.[positionKeyForPlan(state, player)] ?? 50;

  // 優先度：主力 → 若手有望株 → その他
  const ranked = expiring
    .map((player) => {
      const stats = state.stats[player.id];
      const value = marketValue(player, stats, state.year);
      const overall = overallRating(player);
      // 自球団の選手なので潜在能力は把握している（他球団の隠し情報は見ない）
      const youngProspect = player.age <= 24 && player.ext.potential >= overall + 12;
      // 価値のわりに安い選手を優先する
      let priority = overall + (youngProspect ? 18 : 0) - value / 12;
      // 手薄な枠の選手は残す価値が高い
      priority += (needOf(player) - 50) * 0.12;
      if (strategy === 'YOUTH') priority += player.age <= 25 ? 10 : player.age >= 33 ? -12 : 0;
      if (strategy === 'WIN_NOW') priority += player.age >= 27 && player.age <= 33 ? 8 : -3;
      if (strategy === 'BUDGET') priority -= value / 18;
      return { player, value, priority };
    })
    .sort((a, b) => b.priority - a.priority);

  // 予算を超えそうな場合は、あらかじめ「費用対効果の低い選手」を見送り対象にする。
  // 優先度の高い（高年俸の）選手から順に契約すると、先に予算を使い切ってしまい、
  // 安い選手だけが切られて総年俸が下がらないため。
  const minimumRoster = MINIMUM_ROSTER;
  const budgetCeiling = budget * 1.12;
  const projected =
    committed +
    ranked.reduce(
      (sum, entry) => sum + expectedSalary(entry.player, state.stats[entry.player.id], state.year),
      0,
    );
  const skipForBudget = new Set<string>();
  if (projected > budgetCeiling) {
    // 「優先度 ÷ 年俸」が低い順に見送る。最低人数を割らない範囲で。
    const byValue = [...ranked].sort((a, b) => {
      const va = a.priority / Math.max(1, a.value);
      const vb = b.priority / Math.max(1, b.value);
      return va - vb;
    });
    let remaining = projected;
    let canRelease = roster.length - minimumRoster;
    for (const entry of byValue) {
      if (remaining <= budgetCeiling || canRelease <= 0) break;
      const cost = expectedSalary(entry.player, state.stats[entry.player.id], state.year);
      skipForBudget.add(entry.player.id);
      remaining -= cost;
      canRelease -= 1;
    }
  }

  let spent = committed;
  let renewed = 0;
  let released = 0;
  // 余剰を理由に手放すのは1オフに2人まで。
  // 上限がないとロスターが増えるほど放出も増え、FA市場に選手が溜まり続けてしまう。
  const maxSurplusReleases = 2;
  let surplusReleases = 0;

  for (const entry of ranked) {
    const stats = state.stats[entry.player.id];
    const expected = expectedSalary(entry.player, stats, state.year);
    const years = adjustYearsForStrategy(cpuContractYears(entry.player, rng), entry.player, strategy);
    const offer = Math.max(expected, Math.round(expected * yearsDiscount(years)));
    const remainingPlayers = roster.length - released;

    // 予算のために見送ると決めた選手
    if (skipForBudget.has(entry.player.id) && remainingPlayers > minimumRoster) {
      released += 1;
      if (plan) plan.log.contractsReleased += 1;
      rememberSalary(entry.player);
      entry.player.ext.contract = null;
      continue;
    }

    // PHASE 3.4: 同じ枠に十分な戦力がいる選手（＝優先度が低く、後ろが詰まっている）は
    // 更改を見送る。この選手が FA 市場へ出る。最低人数は必ず守る。
    const lowPriority = ranked.indexOf(entry) >= Math.floor(ranked.length / 2);
    const surplus =
      lowPriority &&
      surplusReleases < maxSurplusReleases &&
      isSurplusAtPosition(state, teamId, entry.player);
    if (surplus && remainingPlayers > minimumRoster) {
      released += 1;
      surplusReleases += 1;
      if (plan) plan.log.contractsReleased += 1;
      rememberSalary(entry.player);
      entry.player.ext.contract = null;
      continue;
    }

    // 予算に余裕がない場合でも、最低人数を割る手前では契約する
    const overBudget = spent + offer > budget * 1.12;
    if (overBudget && remainingPlayers > minimumRoster) {
      released += 1;
      if (plan) plan.log.contractsReleased += 1;
      rememberSalary(entry.player);
      entry.player.ext.contract = null;
      continue;
    }
    const result = offerContract(state, entry.player, { salary: offer, years });
    if (result.accepted) {
      spent += offer;
      renewed += 1;
      if (plan) plan.log.contractsKept += 1;
    } else {
      released += 1;
      if (plan) plan.log.contractsReleased += 1;
      rememberSalary(entry.player);
      entry.player.ext.contract = null;
    }
  }

  return { renewed, released };
}

/**
 * 契約が成立しなかった選手を球団から外す。
 *
 * PHASE 3.4 からは選手を消さず、未所属（FA）のプールへ移す。
 * state.players からは外れるので、試合・成績・順位には一切関わらない。
 */
export function releaseUnsignedPlayers(state: GameState): Player[] {
  // 最低人数を割ってしまう場合は、1年契約で引き止める。
  // （FA市場が空だと補充できず、1軍を組めなくなるため）
  // 総年俸が膨らまないよう、「年俸のわりに戦力になる選手」から順に残す。
  for (const team of state.teams) {
    const roster = state.players.filter((p) => p.teamId === team.id);
    const signed = roster.filter((p) => p.ext.contract);
    const valuePerCost = (player: Player) => {
      const cost = expectedSalary(player, state.stats[player.id], state.year);
      return overallRating(player) / Math.max(1, cost);
    };
    const unsigned = roster
      .filter((p) => !p.ext.contract)
      .sort((a, b) => valuePerCost(b) - valuePerCost(a));
    let keep = MINIMUM_ROSTER - signed.length;
    for (const player of unsigned) {
      if (keep <= 0) break;
      const stats = state.stats[player.id];
      player.ext.contract = createContract(
        expectedSalary(player, stats, state.year),
        1,
        state.year,
      );
      keep -= 1;
    }
  }

  const released: Player[] = [];
  const remaining: Player[] = [];
  for (const player of state.players) {
    if (player.ext.contract) {
      remaining.push(player);
      continue;
    }
    rememberSalary(player);
    player.teamId = '';
    released.push(player);
    delete state.stats[player.id];
  }
  state.players = remaining;

  if (!Array.isArray(state.freeAgents)) state.freeAgents = [];
  const known = new Set(state.freeAgents.map((p) => p.id));
  for (const player of released) {
    // 同じ選手を二重に登録しない
    if (known.has(player.id)) continue;
    known.add(player.id);
    state.freeAgents.push(player);
  }
  return released;
}
