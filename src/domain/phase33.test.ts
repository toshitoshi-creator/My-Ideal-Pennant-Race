import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import {
  autoCompleteContracts,
  completeOffseason,
  startContractPhase,
  startOffseason,
  startNextSeason,
} from './season';
import { beginDraftPicks } from './draft';
import { Rng } from './rng';
import {
  MAX_SALARY,
  MIN_SALARY,
  acceptsOffer,
  ageSalaryFactor,
  applySeasonFinance,
  contractStatus,
  createContract,
  expectedSalary,
  experienceFactor,
  formatMoney,
  formatSalary,
  isExpiring,
  isInDebt,
  isOverBudget,
  marketValue,
  maxContractYears,
  offerContract,
  performanceFactor,
  refreshPayrolls,
  releaseUnsignedPlayers,
  remainingBudget,
  renewTeamContracts,
  rookieContract,
  runCpuRenewals,
  teamPayroll,
  tickContracts,
} from './contract';
import { overallRating } from './rating';
import { clearSave, loadGame, saveGame, SAVE_KEY } from './save';
import { CONDITIONS } from './condition';
import { effectiveBreakdown, EFFECTIVE_MIN, EFFECTIVE_MAX } from './effective';
import type { GameState, Player } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 10, seed = 330330): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/** 契約更改フェーズまで進めた状態 */
function toContractPhase(seed = 330330): GameState {
  let s = playSeason(newGame(10, seed));
  s = cloneState(s);
  startOffseason(s);
  beginDraftPicks(s, new Rng(1));
  startContractPhase(s);
  return s;
}

function withAbility(base: Player, overall: number): Player {
  return {
    ...base,
    isPitcher: false,
    pitching: null,
    batting: {
      trajectory: overall,
      contact: overall,
      power: overall,
      speed: overall,
      arm: overall,
      fielding: overall,
      catching: overall,
    },
  };
}

/* ---------------- 契約 ---------------- */

describe('PHASE3.3 契約', () => {
  it('開幕時点で全選手が契約を持つ', () => {
    const state = newGame();
    for (const player of state.players) {
      const contract = player.ext.contract;
      expect(contract).not.toBeNull();
      expect(contract!.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(contract!.salary).toBeLessThanOrEqual(MAX_SALARY);
      expect(contract!.yearsRemaining).toBeGreaterThanOrEqual(1);
      expect(contract!.yearsRemaining).toBeLessThanOrEqual(contract!.totalYears);
      expect(Number.isFinite(contract!.signedYear)).toBe(true);
    }
  });

  it('契約を作ると年俸・年数が正しく設定される', () => {
    const contract = createContract(120, 3, 2026);
    expect(contract.salary).toBe(120);
    expect(contract.yearsRemaining).toBe(3);
    expect(contract.totalYears).toBe(3);
    expect(contract.signedYear).toBe(2026);
  });

  it('不正な年俸・年数は安全な値に補正される', () => {
    expect(createContract(-50, 3, 2026).salary).toBe(MIN_SALARY);
    expect(createContract(99999, 3, 2026).salary).toBe(MAX_SALARY);
    expect(createContract(100, 0, 2026).yearsRemaining).toBe(1);
    expect(createContract(100, 99, 2026).yearsRemaining).toBe(5);
  });

  it('契約状態を判定できる', () => {
    const state = newGame();
    const player = state.players[0];
    player.ext.contract = createContract(100, 2, 2026);
    expect(contractStatus(player)).toBe('contracted');
    expect(isExpiring(player)).toBe(false);
    player.ext.contract.yearsRemaining = 0;
    expect(contractStatus(player)).toBe('expiring');
    expect(isExpiring(player)).toBe(true);
    player.ext.contract = null;
    expect(contractStatus(player)).toBe('unsigned');
    expect(isExpiring(player)).toBe(true);
  });

  it('契約年数は1シーズンに1回だけ減る', () => {
    const state = newGame();
    const player = state.players[0];
    player.ext.contract = createContract(100, 3, 2026);
    tickContracts(state);
    expect(player.ext.contract!.yearsRemaining).toBe(2);
    // 同じ年に再実行しても減らない
    tickContracts(state);
    tickContracts(state);
    expect(player.ext.contract!.yearsRemaining).toBe(2);
    // 翌年は減る
    state.year += 1;
    tickContracts(state);
    expect(player.ext.contract!.yearsRemaining).toBe(1);
  });

  it('契約年数は0未満にならない', () => {
    const state = newGame();
    const player = state.players[0];
    player.ext.contract = createContract(100, 1, 2026);
    for (let i = 0; i < 5; i++) {
      state.year += 1;
      tickContracts(state);
    }
    expect(player.ext.contract!.yearsRemaining).toBe(0);
  });

  it('年齢によって契約年数の上限が変わる', () => {
    expect(maxContractYears(24)).toBe(5);
    expect(maxContractYears(30)).toBe(4);
    expect(maxContractYears(34)).toBe(3);
    expect(maxContractYears(38)).toBe(2);
  });
});

/* ---------------- 年俸の算定 ---------------- */

describe('PHASE3.3 年俸の算定', () => {
  const state = newGame();
  const base = state.players.find((p) => !p.isPitcher)!;

  it('能力が高いほど年俸が高い（急な段差がない）', () => {
    const values: number[] = [];
    for (let overall = 20; overall <= 95; overall += 5) {
      const player = { ...withAbility(base, overall), age: 28 };
      values.push(marketValue(player, undefined, 2026));
    }
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
      // 5ポイントの能力差で3倍以上跳ねない
      expect(values[i] / Math.max(1, values[i - 1])).toBeLessThan(3);
    }
  });

  it('年齢補正が効く（若手は安く、ベテランは緩やかに下がる）', () => {
    expect(ageSalaryFactor(20)).toBeLessThan(ageSalaryFactor(24));
    expect(ageSalaryFactor(24)).toBeLessThan(ageSalaryFactor(30));
    expect(ageSalaryFactor(30)).toBeGreaterThan(ageSalaryFactor(34));
    expect(ageSalaryFactor(34)).toBeGreaterThan(ageSalaryFactor(38));
    // ベテランでも0にはならない
    expect(ageSalaryFactor(40)).toBeGreaterThan(0.5);

    const young = { ...withAbility(base, 65), age: 20 };
    const prime = { ...withAbility(base, 65), age: 29 };
    expect(marketValue(young, undefined, 2026)).toBeLessThan(marketValue(prime, undefined, 2026));
  });

  it('成績が年俸に反映される', () => {
    const player = { ...withAbility(base, 55), age: 28 };
    const good = {
      playerId: player.id,
      batting: { games: 140, plateAppearances: 600, atBats: 520, hits: 170, doubles: 30, triples: 2, homeRuns: 30, rbi: 95, runs: 80, steals: 5, strikeouts: 90, walks: 60 },
      pitching: { games: 0, starts: 0, outs: 0, wins: 0, losses: 0, holds: 0, saves: 0, strikeouts: 0, walks: 0, hitsAllowed: 0, homeRunsAllowed: 0, runsAllowed: 0, earnedRuns: 0 },
    };
    const bad = {
      ...good,
      batting: { ...good.batting, hits: 100, homeRuns: 2, rbi: 25 },
    };
    expect(performanceFactor(player, good)).toBeGreaterThan(0);
    expect(performanceFactor(player, bad)).toBeLessThan(performanceFactor(player, good));
    expect(marketValue(player, good, 2026)).toBeGreaterThan(marketValue(player, bad, 2026));
  });

  it('出場が少ない選手の成績は評価に使わない', () => {
    const player = { ...withAbility(base, 50), age: 28 };
    const few = {
      playerId: player.id,
      batting: { games: 5, plateAppearances: 12, atBats: 10, hits: 0, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, runs: 0, steals: 0, strikeouts: 6, walks: 2 },
      pitching: { games: 0, starts: 0, outs: 0, wins: 0, losses: 0, holds: 0, saves: 0, strikeouts: 0, walks: 0, hitsAllowed: 0, homeRunsAllowed: 0, runsAllowed: 0, earnedRuns: 0 },
    };
    expect(performanceFactor(player, few)).toBe(0);
  });

  it('実績（通算年数）が年俸を支える', () => {
    const rookie = { ...base, age: 30, ext: { ...base.ext, debutYear: 2026 } };
    const veteran = { ...base, age: 30, ext: { ...base.ext, debutYear: 2016 } };
    expect(experienceFactor(veteran, 2026)).toBeGreaterThan(experienceFactor(rookie, 2026));
    expect(experienceFactor(veteran, 2026)).toBeLessThanOrEqual(1.25);
  });

  it('年俸に上限と下限がある', () => {
    const monster = { ...withAbility(base, 100), age: 29, ext: { ...base.ext, debutYear: 2000 } };
    expect(marketValue(monster, undefined, 2026)).toBeLessThanOrEqual(MAX_SALARY);
    const weak = { ...withAbility(base, 1), age: 40 };
    expect(marketValue(weak, undefined, 2026)).toBeGreaterThanOrEqual(MIN_SALARY);
  });

  it('年俸が負数やNaNにならない', () => {
    const broken = { ...withAbility(base, 40), age: Number.NaN };
    const value = marketValue(broken, undefined, 2026);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(MIN_SALARY);
  });

  it('契約は選手の能力を変化させない', () => {
    const state2 = newGame();
    const player = state2.players[0];
    const before = JSON.stringify(player.batting);
    const beforePotential = player.ext.potential;
    offerContract(state2, player, { salary: 500, years: 3 });
    expect(JSON.stringify(player.batting)).toBe(before);
    expect(player.ext.potential).toBe(beforePotential);
  });

  it('年俸の表示が読みやすい', () => {
    expect(formatSalary(120)).toBe('1.20億円');
    expect(formatSalary(50)).toBe('5000万円');
    expect(formatMoney(1450)).toBe('14.5億円');
  });
});

/* ---------------- 新人契約 ---------------- */

describe('PHASE3.3 新人契約', () => {
  it('ドラフト新人が自動的に契約する', () => {
    const s = toContractPhase(4242);
    const rookies = s.players.filter((p) => p.ext.debutYear === s.year + 1);
    expect(rookies.length).toBeGreaterThan(0);
    for (const rookie of rookies) {
      expect(rookie.ext.contract).not.toBeNull();
      expect(rookie.ext.contract!.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(rookie.ext.contract!.yearsRemaining).toBeGreaterThanOrEqual(2);
    }
  });

  it('ドラフト上位ほど新人年俸が高いが、差は大きくない', () => {
    const state = newGame();
    const player = state.players.find((p) => p.age <= 22) ?? state.players[0];
    const rng = new Rng(7);
    const first = rookieContract(player, 1, 2026, rng).salary;
    const middle = rookieContract(player, 3, 2026, rng).salary;
    const late = rookieContract(player, 5, 2026, rng).salary;
    expect(first).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(late);
    // 1位が下位の3倍を超えない
    expect(first / late).toBeLessThan(3);
  });

  it('新人の年俸は市場価値より安い', () => {
    const state = newGame();
    const rng = new Rng(9);
    for (const player of state.players.filter((p) => p.age <= 22).slice(0, 10)) {
      const value = marketValue(player, undefined, 2026);
      const contract = rookieContract(player, 2, 2026, rng);
      expect(contract.salary).toBeLessThan(value + 20);
    }
  });

  it('新人が無契約でシーズンに入らない', () => {
    let s = toContractPhase(5150);
    completeOffseason(s);
    s = cloneState(s);
    for (const player of s.players) {
      expect(player.ext.contract).not.toBeNull();
    }
  });
});

/* ---------------- 球団資金 ---------------- */

describe('PHASE3.3 球団資金', () => {
  it('全球団が資金・予算を持つ', () => {
    const state = newGame();
    for (const team of state.teams) {
      const finance = state.finances[team.id];
      expect(finance).toBeDefined();
      expect(Number.isFinite(finance.cash)).toBe(true);
      expect(Number.isFinite(finance.budget)).toBe(true);
      expect(finance.budget).toBeGreaterThan(0);
    }
    // 資金格差が極端でない
    const budgets = state.teams.map((t) => state.finances[t.id].budget);
    expect(Math.max(...budgets) / Math.min(...budgets)).toBeLessThan(1.5);
  });

  it('総年俸を計算できる', () => {
    const state = newGame();
    const payroll = teamPayroll(state, PLAYER_TEAM);
    const manual = state.players
      .filter((p) => p.teamId === PLAYER_TEAM)
      .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
    expect(payroll).toBe(manual);
    expect(payroll).toBeGreaterThan(0);
    refreshPayrolls(state);
    expect(state.finances[PLAYER_TEAM].payroll).toBe(payroll);
  });

  it('予算残りと超過を判定できる', () => {
    const state = newGame();
    expect(remainingBudget(state, PLAYER_TEAM)).toBe(
      state.finances[PLAYER_TEAM].budget - teamPayroll(state, PLAYER_TEAM),
    );
    state.finances[PLAYER_TEAM].budget = 1;
    expect(isOverBudget(state, PLAYER_TEAM)).toBe(true);
    state.finances[PLAYER_TEAM].cash = -100;
    expect(isInDebt(state, PLAYER_TEAM)).toBe(true);
  });

  it('シーズン分の人件費が1回だけ支払われる', () => {
    const state = newGame();
    const before = state.finances[PLAYER_TEAM].cash;
    const payroll = teamPayroll(state, PLAYER_TEAM);
    applySeasonFinance(state);
    const after = state.finances[PLAYER_TEAM].cash;
    expect(after).toBe(
      Math.round(before + state.finances[PLAYER_TEAM].annualRevenue - payroll),
    );
    // 同じ年に再実行しても二重に引かれない
    applySeasonFinance(state);
    applySeasonFinance(state);
    expect(state.finances[PLAYER_TEAM].cash).toBe(after);
  });

  it('資金が0未満でも破綻しない', () => {
    const state = newGame();
    state.finances[PLAYER_TEAM].cash = -50000;
    applySeasonFinance(state);
    expect(Number.isFinite(state.finances[PLAYER_TEAM].cash)).toBe(true);
    expect(isInDebt(state, PLAYER_TEAM)).toBe(true);
    // 試合は普通に進む
    const step = advanceDay(state);
    expect(step.results.length).toBeGreaterThan(0);
  });

  it('引退した選手に年俸が発生しない', () => {
    let s = playSeason(newGame(10, 8642));
    for (const p of s.players.filter((p) => p.teamId === PLAYER_TEAM).slice(0, 6)) p.age = 42;
    s = cloneState(s);
    const { retirements } = startOffseason(s);
    expect(retirements.length).toBeGreaterThan(0);
    const payroll = teamPayroll(s, PLAYER_TEAM);
    for (const record of retirements) {
      expect(s.players.some((p) => p.id === record.playerId)).toBe(false);
    }
    // 引退者の年俸は総年俸に含まれない
    const manual = s.players
      .filter((p) => p.teamId === PLAYER_TEAM)
      .reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0);
    expect(payroll).toBe(manual);
  });
});

/* ---------------- 契約更改 ---------------- */

describe('PHASE3.3 契約更改', () => {
  it('契約満了の選手が交渉対象になる', () => {
    const s = toContractPhase(2468);
    expect(s.contractPhase).not.toBeNull();
    for (const id of s.contractPhase!.pending) {
      const player = s.players.find((p) => p.id === id)!;
      expect(player.teamId).toBe(PLAYER_TEAM);
      expect(isExpiring(player)).toBe(true);
    }
  });

  it('希望額以上を提示すれば契約が成立する', () => {
    const s = toContractPhase(1357);
    const id = s.contractPhase!.pending[0];
    if (!id) return;
    const player = s.players.find((p) => p.id === id)!;
    const expected = expectedSalary(player, s.stats[player.id], s.year);
    const result = offerContract(s, player, { salary: expected + 10, years: 2 });
    expect(result.accepted).toBe(true);
    expect(player.ext.contract).not.toBeNull();
    expect(player.ext.contract!.salary).toBe(expected + 10);
    expect(player.ext.contract!.yearsRemaining).toBe(2);
    expect(player.ext.contract!.signedYear).toBe(s.year);
    expect(isExpiring(player)).toBe(false);
  });

  it('大幅な減俸は拒否される', () => {
    const s = toContractPhase(9753);
    const id = s.contractPhase!.pending[0];
    if (!id) return;
    const player = s.players.find((p) => p.id === id)!;
    const result = offerContract(s, player, { salary: MIN_SALARY, years: 1 });
    expect(result.accepted).toBe(false);
    expect(isExpiring(player)).toBe(true);
  });

  it('年齢の上限を超える契約年数は拒否される', () => {
    const state = newGame();
    const veteran = { ...state.players[0], age: 38 };
    expect(acceptsOffer(veteran, undefined, 2026, { salary: 9999, years: 5 })).toBe(false);
    expect(acceptsOffer(veteran, undefined, 2026, { salary: 9999, years: 2 })).toBe(true);
  });

  it('長期契約はやや割安になる', () => {
    const s = toContractPhase(4321);
    const id = s.contractPhase!.pending[0];
    if (!id) return;
    const player = s.players.find((p) => p.id === id)!;
    const expected = expectedSalary(player, s.stats[player.id], s.year);
    // 1年契約では通らない額でも、長期なら通ることがある
    const shortOk = acceptsOffer(player, s.stats[player.id], s.year, {
      salary: Math.round(expected * 0.95),
      years: 1,
    });
    const longOk = acceptsOffer(player, s.stats[player.id], s.year, {
      salary: Math.round(expected * 0.95),
      years: 5,
    });
    expect(longOk || !shortOk).toBe(true);
  });

  it('拒否された選手は球団を去る', () => {
    const s = toContractPhase(6543);
    const id = s.contractPhase!.pending[0];
    if (!id) return;
    const player = s.players.find((p) => p.id === id)!;
    offerContract(s, player, { salary: MIN_SALARY, years: 1 });
    player.ext.contract = null;
    const released = releaseUnsignedPlayers(s);
    expect(released.some((p) => p.id === id)).toBe(true);
    expect(s.players.some((p) => p.id === id)).toBe(false);
    expect(s.stats[id]).toBeUndefined();
  });

  it('残りの交渉を自動で決められる', () => {
    const s = toContractPhase(8080);
    autoCompleteContracts(s);
    expect(s.contractPhase!.completed).toBe(true);
    expect(s.contractPhase!.pending).toHaveLength(0);
  });
});

/* ---------------- CPU ---------------- */

describe('PHASE3.3 CPUの契約更改', () => {
  it('CPU球団も契約更改を行う', () => {
    let s = playSeason(newGame(10, 1122));
    s = cloneState(s);
    startOffseason(s);
    beginDraftPicks(s, new Rng(1));
    startContractPhase(s);
    for (const team of s.teams) {
      if (team.id === PLAYER_TEAM) continue;
      const expiring = s.players.filter((p) => p.teamId === team.id && isExpiring(p));
      // CPU は交渉を終えている（残っていても契約なしの状態にはしない）
      expect(expiring.every((p) => p.ext.contract === null)).toBe(true);
    }
  });

  it('CPUは予算を考慮する', () => {
    let s = playSeason(newGame(10, 3344));
    s = cloneState(s);
    startOffseason(s);
    // 最低人数(24人)を割っている球団は誰も手放せないので、余裕のある球団で試す
    const teamId = s.teams
      .filter((t) => t.id !== PLAYER_TEAM)
      .map((t) => ({ id: t.id, size: s.players.filter((p) => p.teamId === t.id).length }))
      .sort((a, b) => b.size - a.size)[0].id;
    // 予算を極端に絞ると契約を見送る選手が出る
    s.finances[teamId].budget = 1;
    for (const player of s.players.filter((p) => p.teamId === teamId)) {
      if (player.ext.contract) player.ext.contract.yearsRemaining = 0;
    }
    const summary = renewTeamContracts(s, teamId, new Rng(2));
    expect(summary.released).toBeGreaterThan(0);
    // ただし最低人数は割らない
    const remaining = s.players.filter((p) => p.teamId === teamId && p.ext.contract).length;
    expect(remaining).toBeGreaterThanOrEqual(20);
  });

  it('CPUは主力・若手有望株を優先して残す', () => {
    let s = playSeason(newGame(10, 5566));
    s = cloneState(s);
    startOffseason(s);
    const teamId = s.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const roster = s.players.filter((p) => p.teamId === teamId);
    for (const player of roster) {
      if (player.ext.contract) player.ext.contract.yearsRemaining = 0;
    }
    s.finances[teamId].budget = 400;
    renewTeamContracts(s, teamId, new Rng(3));

    const kept = roster.filter((p) => p.ext.contract);
    const dropped = roster.filter((p) => !p.ext.contract);
    if (dropped.length > 0 && kept.length > 0) {
      const keptAvg = kept.reduce((a, p) => a + overallRating(p), 0) / kept.length;
      const droppedAvg = dropped.reduce((a, p) => a + overallRating(p), 0) / dropped.length;
      expect(keptAvg).toBeGreaterThan(droppedAvg - 3);
    }
  });

  it('CPUの契約更改でロスターが崩壊しない', () => {
    let s = playSeason(newGame(10, 7788));
    s = cloneState(s);
    startOffseason(s);
    beginDraftPicks(s, new Rng(4));
    runCpuRenewals(s, new Rng(5));
    completeOffseason(s);
    for (const team of s.teams) {
      const roster = s.players.filter((p) => p.teamId === team.id);
      expect(roster.length).toBeGreaterThanOrEqual(20);
      const healthy = roster.filter((p) => p.roster === 'first' && !p.ext.injury);
      expect(healthy.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(9);
      expect(healthy.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(5);
    }
    expect(validateState(s)).toEqual([]);
  });
});

/* ---------------- シーズンとの統合 ---------------- */

describe('PHASE3.3 シーズンとの統合', () => {
  it('シーズン終了→引退→ドラフト→新人契約→契約更改→開幕が成立する', () => {
    let s = playSeason(newGame(10, 2244));
    s = cloneState(s);
    startOffseason(s);
    expect(s.draft).not.toBeNull();
    beginDraftPicks(s, new Rng(1));
    startContractPhase(s);
    expect(s.contractPhase).not.toBeNull();
    autoCompleteContracts(s);
    completeOffseason(s);

    expect(s.contractPhase).toBeNull();
    expect(s.seasonFinished).toBe(false);
    for (const player of s.players) {
      expect(player.ext.contract).not.toBeNull();
      expect(player.ext.contract!.yearsRemaining).toBeGreaterThanOrEqual(1);
    }
    expect(validateState(s)).toEqual([]);
    const step = advanceDay(s);
    expect(step.results.length).toBeGreaterThan(0);
  });

  it('年齢+1と契約年数-1がそれぞれ1回だけ起きる', () => {
    let s = playSeason(newGame(10, 4466));
    const ages = new Map(s.players.map((p) => [p.id, p.age]));
    const years = new Map(s.players.map((p) => [p.id, p.ext.contract?.yearsRemaining ?? 0]));
    const salaries = new Map(s.players.map((p) => [p.id, p.ext.contract?.salary ?? 0]));
    s = cloneState(s);
    startNextSeason(s);

    let checked = 0;
    for (const player of s.players) {
      const beforeAge = ages.get(player.id);
      if (beforeAge === undefined) continue; // 新人
      expect(player.age).toBe(beforeAge + 1);
      const beforeYears = years.get(player.id) ?? 0;
      // 残り2年以上の選手は今オフに更改対象にならないため、純粋に -1 されるはず
      if (beforeYears < 2) continue;
      const contract = player.ext.contract!;
      expect(contract.yearsRemaining).toBe(beforeYears - 1);
      expect(contract.salary).toBe(salaries.get(player.id));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('人件費が1シーズンに1回だけ支払われる', () => {
    let s = playSeason(newGame(10, 6688));
    s = cloneState(s);
    const before = s.finances[PLAYER_TEAM].cash;
    const payroll = teamPayroll(s, PLAYER_TEAM);
    startOffseason(s);
    const afterFirst = s.finances[PLAYER_TEAM].cash;
    expect(afterFirst).toBe(
      Math.round(before + s.finances[PLAYER_TEAM].annualRevenue - payroll),
    );
    // オフシーズン処理を再度呼んでも二重に引かれない
    applySeasonFinance(s);
    expect(s.finances[PLAYER_TEAM].cash).toBe(afterFirst);
  });

  it('10シーズン続けても契約・資金が壊れない', () => {
    let s = newGame(10, 9900);
    for (let season = 0; season < 10; season++) {
      s = playSeason(s);
      startNextSeason(s);
      expect(validateState(s)).toEqual([]);
      for (const player of s.players) {
        const contract = player.ext.contract;
        expect(contract).not.toBeNull();
        expect(contract!.salary).toBeGreaterThanOrEqual(MIN_SALARY);
        expect(contract!.salary).toBeLessThanOrEqual(MAX_SALARY);
        expect(contract!.yearsRemaining).toBeGreaterThanOrEqual(0);
      }
      for (const team of s.teams) {
        expect(Number.isFinite(s.finances[team.id].cash)).toBe(true);
        expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(20);
      }
    }
    // 年俸が暴走していない
    const salaries = s.players.map((p) => p.ext.contract!.salary);
    const average = salaries.reduce((a, b) => a + b, 0) / salaries.length;
    expect(average).toBeLessThan(200);
  }, 120000);

  it('契約システムが能力インフレを起こさない', () => {
    let s = newGame(10, 1010);
    const before = s.players.reduce((a, p) => a + overallRating(p), 0) / s.players.length;
    for (let season = 0; season < 8; season++) {
      s = playSeason(s);
      startNextSeason(s);
    }
    const after = s.players.reduce((a, p) => a + overallRating(p), 0) / s.players.length;
    expect(after).toBeGreaterThan(before - 6);
    expect(after).toBeLessThan(before + 8);
  }, 120000);

  it('PHASE2.5の調子・実効能力・PHASE3.2のスカウトが壊れていない', () => {
    const s = toContractPhase(3131);
    for (const player of s.players) {
      expect(CONDITIONS).toContain(player.ext.condition);
      const breakdown = effectiveBreakdown(player, { teamMorale: 50 });
      expect(breakdown.finalMultiplier).toBeGreaterThanOrEqual(EFFECTIVE_MIN);
      expect(breakdown.finalMultiplier).toBeLessThanOrEqual(EFFECTIVE_MAX);
    }
    expect(s.scouting.teams[PLAYER_TEAM].ability.potential).toBeGreaterThan(0);
  });
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.3 セーブ', () => {
  class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string) {
      return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.map.set(key, value);
    }
    removeItem(key: string) {
      this.map.delete(key);
    }
  }

  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  });

  it('契約と球団資金が保存・復元される', () => {
    let s = playSeason(newGame(10, 1212));
    s = cloneState(s);
    const sample = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    sample.ext.contract = createContract(234, 3, s.year);
    s.finances[PLAYER_TEAM].cash = 777;
    saveGame(s);

    const loaded = loadGame()!;
    const restored = loaded.players.find((p) => p.id === sample.id)!;
    expect(restored.ext.contract).toEqual(sample.ext.contract);
    expect(loaded.finances[PLAYER_TEAM].cash).toBe(777);
    expect(loaded.finances[PLAYER_TEAM].budget).toBe(s.finances[PLAYER_TEAM].budget);
    expect(loaded.lastPayrollYear).toBe(s.lastPayrollYear);
    clearSave();
  });

  it('契約更改の途中経過が保存・復元される', () => {
    const s = toContractPhase(1414);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.contractPhase).not.toBeNull();
    expect(loaded.contractPhase!.pending).toEqual(s.contractPhase!.pending);
    expect(loaded.contractPhase!.year).toBe(s.contractPhase!.year);
    // ロード後も交渉を続けられる
    autoCompleteContracts(loaded);
    completeOffseason(loaded);
    expect(validateState(loaded)).toEqual([]);
  });

  it('PHASE3.2(v6)の古いセーブを移行できる', () => {
    const s = newGame(10, 1616);
    const legacy = JSON.parse(JSON.stringify(s)) as GameState;
    legacy.version = 6;
    delete (legacy as Partial<GameState>).finances;
    delete (legacy as Partial<GameState>).contractPhase;
    delete (legacy as Partial<GameState>).lastPayrollYear;
    delete (legacy as Partial<GameState>).lastContractYear;
    for (const player of legacy.players) {
      player.ext.contract = null;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded.version).toBe(SAVE_VERSION);
    for (const team of loaded.teams) {
      const finance = loaded.finances[team.id];
      expect(Number.isFinite(finance.cash)).toBe(true);
      expect(finance.budget).toBeGreaterThan(0);
    }
    for (const player of loaded.players) {
      expect(player.ext.contract).not.toBeNull();
      expect(player.ext.contract!.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(player.ext.contract!.yearsRemaining).toBeGreaterThanOrEqual(1);
    }
    const played = playSeason(loaded);
    startNextSeason(played);
    expect(validateState(played)).toEqual([]);
  }, 60000);

  it('壊れた契約・資金データを安全な値に補正する', () => {
    const s = newGame(10, 1818);
    const legacy = JSON.parse(JSON.stringify(s)) as GameState;
    legacy.version = 6;
    legacy.finances = {
      phoenix: { cash: Number.NaN, budget: Number.NaN, annualRevenue: Number.NaN, payroll: Number.NaN, lastResult: Number.NaN },
    } as GameState['finances'];
    for (const player of legacy.players) {
      (player.ext as { contract: unknown }).contract = { salary: -100, years: -3 };
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    for (const team of loaded.teams) {
      const finance = loaded.finances[team.id];
      expect(Number.isFinite(finance.cash)).toBe(true);
      expect(Number.isFinite(finance.budget)).toBe(true);
      expect(Number.isFinite(finance.annualRevenue)).toBe(true);
    }
    for (const player of loaded.players) {
      expect(player.ext.contract!.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(player.ext.contract!.yearsRemaining).toBeGreaterThanOrEqual(1);
    }
  });

  it('v1〜v6のどのセーブでも読み込める', () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
      const s = newGame(10, 2000 + version);
      const legacy = JSON.parse(JSON.stringify(s)) as GameState;
      legacy.version = version;
      if (version <= 1) {
        for (const p of legacy.players) p.batting.trajectory = 2;
      }
      if (version <= 6) {
        for (const p of legacy.players) p.ext.contract = null;
        delete (legacy as Partial<GameState>).finances;
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));
      const loaded = loadGame();
      expect(loaded, `v${version} が読み込めない`).not.toBeNull();
      expect(loaded!.version).toBe(SAVE_VERSION);
      expect(loaded!.players.every((p) => p.ext.contract !== null)).toBe(true);
    }
  });
});

/* ---------------- 財政バランス ---------------- */

describe('PHASE3.3 年俸バランス', () => {
  it('新人 < 若手 < 主力 の年俸構造になる', () => {
    let s = newGame(10, 2626);
    for (let season = 0; season < 4; season++) {
      s = playSeason(s);
      startNextSeason(s);
    }
    const salary = (p: Player) => p.ext.contract?.salary ?? 0;
    const rookies = s.players.filter((p) => p.ext.debutYear === s.year);
    const stars = [...s.players].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 12);
    const avg = (list: Player[]) =>
      list.length === 0 ? 0 : list.reduce((a, p) => a + salary(p), 0) / list.length;

    expect(rookies.length).toBeGreaterThan(0);
    expect(avg(rookies)).toBeLessThan(avg(stars));
    // 主力は平均よりはっきり高い
    const overall = avg(s.players);
    expect(avg(stars)).toBeGreaterThan(overall);
  }, 120000);

  it('球団資金が短期間で破綻しない', () => {
    let s = newGame(10, 2828);
    for (let season = 0; season < 6; season++) {
      s = playSeason(s);
      startNextSeason(s);
    }
    for (const team of s.teams) {
      const finance = s.finances[team.id];
      expect(Number.isFinite(finance.cash)).toBe(true);
      // 6シーズンで資金がマイナス50億まで落ちない
      expect(finance.cash).toBeGreaterThan(-5000);
    }
  }, 120000);
});
