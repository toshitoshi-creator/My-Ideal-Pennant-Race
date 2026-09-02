import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import {
  autoCompleteContracts,
  completeOffseason,
  resolveFAPhase,
  startContractPhase,
  startFAPhase,
  startOffseason,
  startNextSeason,
} from './season';
import { beginDraftPicks } from './draft';
import { Rng } from './rng';
import {
  ACCEPT_THRESHOLD,
  MAX_USER_OFFERS,
  MARKET_GRADE_LABELS,
  MINIMUM_ROSTER,
  askingSalaryFor,
  budgetCeiling,
  cancelFAOffer,
  cpuInterest,
  estimatedAbility,
  estimatedOverallRange,
  evaluateOffer,
  faRole,
  freeAgentById,
  listingFor,
  makeFAOffer,
  marketGrade,
  offersByTeam,
  offersForPlayer,
  opportunityScore,
  preferredContractYears,
  repairFreeAgents,
  resolveFreeAgency,
  roleScore,
  runCpuFAOffers,
  salaryScore,
  staleDiscount,
  startFreeAgency,
  teamStrengthScore,
  unsignedYears,
  withinBudget,
  yearsScore,
} from './freeAgency';
import {
  MIN_SALARY,
  lastKnownSalary,
  marketValue,
  maxContractYears,
  releaseUnsignedPlayers,
  rememberSalary,
  teamPayroll,
} from './contract';
import { overallRating } from './rating';
import { clearSave, loadGame, saveGame, SAVE_KEY } from './save';
import { migrate } from './save';
import type { GameState, Player } from './types';

const PLAYER_TEAM = 'phoenix';
const OTHER_TEAM = 'bluewave';

function newGame(length: 10 | 30 | 143 = 10, seed = 340340): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/** 契約更改フェーズまで進めた状態 */
function toContractPhase(seed = 340340): GameState {
  let s = playSeason(newGame(10, seed));
  s = cloneState(s);
  startOffseason(s);
  beginDraftPicks(s, new Rng(1));
  startContractPhase(s);
  return s;
}

/** FA市場が開いた状態（CPUのオファーも出ている） */
function toFAPhase(seed = 340340): GameState {
  const s = toContractPhase(seed);
  autoCompleteContracts(s);
  startFAPhase(s);
  return s;
}

/**
 * プレイヤー球団から必ず何人かをFA市場に出す。
 * 契約更改で提示を行わずに契約を切ることで、確実に市場に選手を用意する。
 */
function toFAPhaseWithReleases(seed = 340340, count = 3): GameState {
  const s = toContractPhase(seed);
  const roster = s.players.filter((p) => p.teamId === PLAYER_TEAM);
  // 最低人数を割らない範囲で、余っている選手を放出する
  const releasable = roster
    .slice()
    .sort((a, b) => overallRating(a) - overallRating(b))
    .slice(0, Math.min(count, Math.max(0, roster.length - MINIMUM_ROSTER)));
  for (const player of releasable) {
    rememberSalary(player);
    player.ext.contract = null;
  }
  s.contractPhase!.pending = s.contractPhase!.pending.filter(
    (id) => !releasable.some((p) => p.id === id),
  );
  autoCompleteContracts(s);
  startFAPhase(s);
  return s;
}

function anyListing(state: GameState) {
  const fa = state.fa!;
  return fa.listings.find((l) => l.status !== 'SIGNED')!;
}

/* ---------------- FA登録 ---------------- */

describe('PHASE3.4 FA登録', () => {
  it('契約が成立しなかった選手はFA市場へ移る', () => {
    const s = toContractPhase(1111);
    const target = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    rememberSalary(target);
    target.ext.contract = null;
    releaseUnsignedPlayers(s);
    expect(s.players.some((p) => p.id === target.id)).toBe(false);
    expect(s.freeAgents.some((p) => p.id === target.id)).toBe(true);
  });

  it('FAになった選手はどの球団にも所属していない', () => {
    const s = toFAPhaseWithReleases(1212);
    for (const player of s.freeAgents) {
      expect(player.teamId).toBe('');
      expect(s.players.some((p) => p.id === player.id)).toBe(false);
    }
  });

  it('契約更改に成功した選手はFAにならない', () => {
    const s = toFAPhase(1313);
    const renewed = s.players.filter((p) => p.ext.contract && p.ext.contract.yearsRemaining > 0);
    expect(renewed.length).toBeGreaterThan(0);
    for (const player of renewed) {
      expect(s.freeAgents.some((p) => p.id === player.id)).toBe(false);
    }
  });

  it('引退した選手はFA市場に入らない', () => {
    let s = playSeason(newGame(10, 1414));
    for (const p of s.players.filter((p) => p.teamId === PLAYER_TEAM).slice(0, 8)) p.age = 43;
    s = cloneState(s);
    const { retirements } = startOffseason(s);
    expect(retirements.length).toBeGreaterThan(0);
    beginDraftPicks(s, new Rng(1));
    startContractPhase(s);
    autoCompleteContracts(s);
    startFAPhase(s);
    for (const record of retirements) {
      expect(s.freeAgents.some((p) => p.id === record.playerId)).toBe(false);
    }
  });

  it('同じ選手がFA市場に二重登録されない', () => {
    const s = toFAPhaseWithReleases(1515, 4);
    const ids = s.fa!.listings.map((l) => l.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    const poolIds = s.freeAgents.map((p) => p.id);
    expect(new Set(poolIds).size).toBe(poolIds.length);
  });

  it('FA選手には契約が残っていない', () => {
    const s = toFAPhaseWithReleases(1616, 3);
    for (const player of s.freeAgents) expect(player.ext.contract).toBeNull();
  });

  it('市場の情報（希望年俸・年数・役割）が作られる', () => {
    const s = toFAPhaseWithReleases(1717, 3);
    expect(s.fa!.listings.length).toBeGreaterThan(0);
    for (const listing of s.fa!.listings) {
      expect(listing.askingSalary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(listing.minimumSalary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(listing.minimumSalary).toBeLessThanOrEqual(listing.askingSalary);
      expect(listing.preferredYears).toBeGreaterThanOrEqual(1);
      expect(['STARTER', 'ROTATION', 'BENCH', 'PROSPECT']).toContain(listing.role);
      expect(listing.listedYear).toBe(s.year);
    }
  });

  it('FA選手が0人でも市場は正常に開く', () => {
    const s = toContractPhase(1818);
    autoCompleteContracts(s);
    // 契約が切れた選手を作らずに市場を開く
    s.freeAgents = [];
    const fa = startFreeAgency(s);
    expect(fa.listings).toHaveLength(0);
    expect(() => resolveFreeAgency(s)).not.toThrow();
    expect(s.fa!.results).toHaveLength(0);
  });

  it('市場は同じ年に二重で開催されない', () => {
    const s = toFAPhaseWithReleases(1919, 2);
    const first = s.fa!;
    const second = startFreeAgency(s);
    expect(second).toBe(first);
  });
});

/* ---------------- 希望年俸・希望年数 ---------------- */

describe('PHASE3.4 希望条件', () => {
  it('希望年俸は市場価値を土台にする', () => {
    const s = newGame();
    const player = s.players[0];
    const value = marketValue(player, undefined, s.year);
    const result = askingSalaryFor(player, undefined, s.year, new Rng(7));
    expect(result.marketValue).toBe(value);
    // ±12%以内の揺らぎに収まる
    expect(result.askingSalary).toBeGreaterThanOrEqual(Math.round(value * 0.85));
    expect(result.askingSalary).toBeLessThanOrEqual(Math.round(value * 1.15));
  });

  it('直近の年俸が高い選手は希望額も高くなる', () => {
    const s = newGame();
    const player = cloneState(s).players[0];
    const low = askingSalaryFor(player, undefined, s.year, new Rng(3)).askingSalary;
    player.ext.contract = null;
    player.ext.hiddenAttributes.lastSalary = 900;
    const high = askingSalaryFor(player, undefined, s.year, new Rng(3)).askingSalary;
    expect(high).toBeGreaterThan(low);
  });

  it('最低ラインは市場価値の70%程度になる', () => {
    const s = newGame();
    const player = s.players[0];
    const result = askingSalaryFor(player, undefined, s.year, new Rng(11));
    expect(result.minimumSalary).toBeLessThanOrEqual(
      Math.max(MIN_SALARY, Math.round(result.marketValue * 0.7)),
    );
  });

  it('希望年数は年齢の上限を超えない', () => {
    const s = newGame();
    for (const player of s.players.slice(0, 60)) {
      for (let seed = 0; seed < 4; seed++) {
        const years = preferredContractYears(player, new Rng(seed + 1));
        expect(years).toBeGreaterThanOrEqual(1);
        expect(years).toBeLessThanOrEqual(maxContractYears(player.age));
      }
    }
  });

  it('若手は長期、ベテランは短期を好む', () => {
    const s = newGame();
    const base = s.players.find((p) => !p.isPitcher)!;
    const young = { ...base, age: 24 };
    const old = { ...base, age: 37 };
    const youngYears = preferredContractYears(young, new Rng(5));
    const oldYears = preferredContractYears(old, new Rng(5));
    expect(youngYears).toBeGreaterThan(oldYears);
  });

  it('決まらない年が続くと希望額が下がる', () => {
    const s = newGame();
    const player = cloneState(s).players[0];
    expect(staleDiscount(player)).toBe(1);
    player.ext.hiddenAttributes.faUnsignedYears = 2;
    expect(unsignedYears(player)).toBe(2);
    expect(staleDiscount(player)).toBeLessThan(1);
    player.ext.hiddenAttributes.faUnsignedYears = 20;
    expect(staleDiscount(player)).toBeGreaterThanOrEqual(0.4);
  });

  it('役割ラベルは年齢と見えている能力で決まる', () => {
    const s = newGame();
    const base = s.players.find((p) => !p.isPitcher)!;
    expect(faRole({ ...base, age: 21 })).toBe('PROSPECT');
    const strong = {
      ...base,
      age: 28,
      batting: { ...base.batting, contact: 80, power: 80, fielding: 70, catching: 70, arm: 70, speed: 70 },
    };
    expect(faRole(strong)).toBe('STARTER');
  });

  it('直近の年俸を覚えている', () => {
    const s = newGame();
    const player = cloneState(s).players[0];
    const salary = player.ext.contract!.salary;
    rememberSalary(player);
    player.ext.contract = null;
    expect(lastKnownSalary(player)).toBe(salary);
  });
});

/* ---------------- オファー ---------------- */

describe('PHASE3.4 オファー', () => {
  it('FA選手に条件を提示できる', () => {
    const s = toFAPhaseWithReleases(2101, 3);
    const listing = anyListing(s);
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 2);
    expect(result.ok).toBe(true);
    expect(offersByTeam(s.fa!, PLAYER_TEAM)).toHaveLength(1);
    expect(offersForPlayer(s.fa!, listing.playerId).length).toBeGreaterThan(0);
  });

  it('年俸の下限より低い提示はできない', () => {
    const s = toFAPhaseWithReleases(2102, 3);
    const listing = anyListing(s);
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, 0, 2);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('salary-range');
  });

  it('年俸の上限を超える提示はできない', () => {
    const s = toFAPhaseWithReleases(2103, 3);
    const listing = anyListing(s);
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, 99999, 2);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('salary-range');
  });

  it('年齢の上限を超える契約年数は提示できない', () => {
    const s = toFAPhaseWithReleases(2104, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const tooLong = maxContractYears(player.age) + 1;
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, tooLong);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('years-range');
  });

  it('同じ選手に二重で提示できない', () => {
    const s = toFAPhaseWithReleases(2105, 3);
    const listing = anyListing(s);
    makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1);
    const second = makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('duplicate');
  });

  it(`同時に提示できるのは${MAX_USER_OFFERS}人まで`, () => {
    const s = toFAPhase(2106);
    // 市場に十分な人数を用意する
    const extra = s.players.filter((p) => p.teamId === OTHER_TEAM).slice(0, 12);
    for (const player of extra) {
      s.players = s.players.filter((p) => p.id !== player.id);
      player.teamId = '';
      player.ext.contract = null;
      s.freeAgents.push(player);
    }
    s.fa = null;
    startFreeAgency(s);
    const available = s.fa!.listings.filter((l) => l.status !== 'SIGNED');
    expect(available.length).toBeGreaterThan(MAX_USER_OFFERS);

    let accepted = 0;
    let limited = false;
    for (const listing of available) {
      const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, MIN_SALARY, 1);
      if (result.ok) accepted += 1;
      else if (result.error === 'limit') limited = true;
    }
    expect(accepted).toBe(MAX_USER_OFFERS);
    expect(limited).toBe(true);
  });

  it('提示は取り下げられる', () => {
    const s = toFAPhaseWithReleases(2107, 3);
    const listing = anyListing(s);
    makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1);
    expect(cancelFAOffer(s, PLAYER_TEAM, listing.playerId)).toBe(true);
    expect(offersByTeam(s.fa!, PLAYER_TEAM)).toHaveLength(0);
    expect(cancelFAOffer(s, PLAYER_TEAM, listing.playerId)).toBe(false);
  });

  it('予算の上限を超える提示はできない', () => {
    const s = toFAPhaseWithReleases(2108, 3);
    const listing = anyListing(s);
    s.finances[PLAYER_TEAM].budget = 1;
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, 1500, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('budget');
    expect(withinBudget(s, PLAYER_TEAM, 1500)).toBe(false);
  });

  it('総年俸が予算の1.12倍を超えないように制限される', () => {
    const s = toFAPhaseWithReleases(2109, 3);
    const ceiling = budgetCeiling(s, PLAYER_TEAM);
    expect(ceiling).toBeCloseTo(s.finances[PLAYER_TEAM].budget * 1.12, 5);
    const payroll = teamPayroll(s, PLAYER_TEAM);
    expect(withinBudget(s, PLAYER_TEAM, Math.max(1, ceiling - payroll - 1))).toBe(true);
  });

  it('存在しない選手・球団への提示は失敗する', () => {
    const s = toFAPhaseWithReleases(2110, 3);
    expect(makeFAOffer(s, PLAYER_TEAM, 'no-such-player', 50, 1).error).toBe('unknown-player');
    expect(makeFAOffer(s, 'no-such-team', anyListing(s).playerId, 50, 1).error).toBe('unknown-team');
  });

  it('FA市場がないときは提示できない', () => {
    const s = toContractPhase(2111);
    expect(makeFAOffer(s, PLAYER_TEAM, 'anything', 50, 1).error).toBe('no-market');
  });

  it('締め切ったあとは提示できない', () => {
    const s = toFAPhaseWithReleases(2112, 3);
    const listing = anyListing(s);
    resolveFreeAgency(s);
    const result = makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('market-closed');
  });

  it('契約済みの選手には提示できない', () => {
    const s = toFAPhaseWithReleases(2113, 3);
    const listing = anyListing(s);
    listing.status = 'SIGNED';
    expect(makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1).error).toBe(
      'already-signed',
    );
  });
});

/* ---------------- 選手の意思決定 ---------------- */

describe('PHASE3.4 選手の意思決定', () => {
  it('年俸の評価は希望額に近いほど高い', () => {
    expect(salaryScore(60, 100)).toBe(0);
    expect(salaryScore(80, 100)).toBeGreaterThan(salaryScore(70, 100));
    expect(salaryScore(100, 100)).toBeGreaterThan(salaryScore(90, 100));
    expect(salaryScore(130, 100)).toBe(1);
  });

  it('契約年数は希望に近いほど高く評価される', () => {
    expect(yearsScore(3, 3)).toBe(1);
    expect(yearsScore(2, 3)).toBeGreaterThan(yearsScore(1, 3));
    expect(yearsScore(5, 1)).toBe(0);
  });

  it('前年に勝った球団ほど魅力が高い', () => {
    const s = toFAPhaseWithReleases(2201, 3);
    const teams = s.teams
      .map((t) => ({ id: t.id, score: teamStrengthScore(s, t.id), wins: s.records[t.id].wins }))
      .sort((a, b) => b.wins - a.wins);
    expect(teams[0].score).toBeGreaterThanOrEqual(teams[teams.length - 1].score);
    for (const t of teams) {
      expect(t.score).toBeGreaterThanOrEqual(0);
      expect(t.score).toBeLessThanOrEqual(1);
    }
  });

  it('同じポジションに強い選手がいると出場機会の評価が下がる', () => {
    const s = toFAPhaseWithReleases(2202, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;

    // まず同じ枠のライバルを取り除く（＝出番がいちばん多い状態）
    const rivals = s.players.filter(
      (p) =>
        p.teamId === OTHER_TEAM &&
        p.isPitcher === player.isPitcher &&
        (player.isPitcher || p.mainPosition === player.mainPosition),
    );
    s.players = s.players.filter((p) => !rivals.includes(p));
    const alone = roleScore(s, OTHER_TEAM, player);

    // 同じ枠に上位の選手を増やす
    for (let i = 0; i < 8; i++) {
      const clone: Player = {
        ...structuredClone(player),
        id: `${player.id}-rival-${i}`,
        teamId: OTHER_TEAM,
      };
      clone.batting = {
        ...clone.batting,
        contact: 99,
        power: 99,
        fielding: 99,
        catching: 99,
        arm: 99,
        speed: 99,
      };
      if (clone.pitching) {
        clone.pitching = {
          ...clone.pitching,
          control: 99,
          power: 99,
          movement: 99,
          stamina: 99,
          velocity: 160,
        };
      }
      s.players.push(clone);
    }
    const crowded = roleScore(s, OTHER_TEAM, player);
    expect(alone).toBe(1);
    expect(crowded).toBeLessThan(alone);
  });

  it('人数が少ない球団ほど出番の評価が高い', () => {
    const s = toFAPhaseWithReleases(2203, 3);
    const small = opportunityScore(s, OTHER_TEAM);
    const filler = structuredClone(s.players.find((p) => p.teamId === OTHER_TEAM)!);
    for (let i = 0; i < 20; i++) {
      s.players.push({ ...structuredClone(filler), id: `${filler.id}-x${i}`, teamId: OTHER_TEAM });
    }
    expect(opportunityScore(s, OTHER_TEAM)).toBeLessThan(small);
  });

  it('高い提示ほど評価が高くなる', () => {
    const s = toFAPhaseWithReleases(2204, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const low = evaluateOffer(s, listing, player, {
      id: 'a',
      playerId: player.id,
      teamId: OTHER_TEAM,
      salary: Math.round(listing.askingSalary * 0.75),
      years: listing.preferredYears,
      offeredYear: s.year,
      status: 'PENDING',
    });
    const high = evaluateOffer(s, listing, player, {
      id: 'a',
      playerId: player.id,
      teamId: OTHER_TEAM,
      salary: Math.round(listing.askingSalary * 1.2),
      years: listing.preferredYears,
      offeredYear: s.year,
      status: 'PENDING',
    });
    expect(high.total).toBeGreaterThan(low.total);
    expect(high.salary).toBeGreaterThan(low.salary);
  });

  it('評価は0〜1の範囲に収まる', () => {
    const s = toFAPhaseWithReleases(2205, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    for (const salary of [MIN_SALARY, listing.askingSalary, 1500]) {
      const score = evaluateOffer(s, listing, player, {
        id: 'a',
        playerId: player.id,
        teamId: OTHER_TEAM,
        salary,
        years: 1,
        offeredYear: s.year,
        status: 'PENDING',
      });
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(1);
    }
  });

  it('同じ状態・同じ提示なら同じ評価になる（決定論）', () => {
    // 選手IDはゲームごとに一意なため、同じセーブを複製して比べる
    const a = toFAPhaseWithReleases(2206, 3);
    const b = cloneState(a);
    const la = anyListing(a);
    const lb = listingFor(b.fa!, la.playerId)!;
    const offer = {
      id: 'x',
      playerId: la.playerId,
      teamId: OTHER_TEAM,
      salary: la.askingSalary,
      years: 2,
      offeredYear: a.year,
      status: 'PENDING' as const,
    };
    const scoreA = evaluateOffer(a, la, freeAgentById(a, la.playerId)!, offer);
    const scoreB = evaluateOffer(b, lb, freeAgentById(b, lb.playerId)!, offer);
    expect(scoreA.total).toBe(scoreB.total);
  });

  it('提示する球団が違えば評価も変わる', () => {
    const s = toFAPhaseWithReleases(2207, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const scores = s.teams.map(
      (t) =>
        evaluateOffer(s, listing, player, {
          id: 'x',
          playerId: player.id,
          teamId: t.id,
          salary: listing.askingSalary,
          years: 2,
          offeredYear: s.year,
          status: 'PENDING',
        }).total,
    );
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it('市場価値の70%未満の提示は成立しない', () => {
    const s = toFAPhaseWithReleases(2208, 3);
    const listing = anyListing(s);
    // 他球団のオファーを消し、極端に安い提示だけを残す
    s.fa!.offers = [];
    const cheap = Math.max(MIN_SALARY, listing.minimumSalary - 1);
    if (cheap < listing.minimumSalary) {
      makeFAOffer(s, PLAYER_TEAM, listing.playerId, cheap, 1);
      resolveFreeAgency(s);
      expect(s.fa!.results.some((r) => r.playerId === listing.playerId)).toBe(false);
    }
  });

  it('受け入れの下限が定義されている', () => {
    expect(ACCEPT_THRESHOLD).toBeGreaterThan(0);
    expect(ACCEPT_THRESHOLD).toBeLessThan(1);
  });
});

/* ---------------- CPU ---------------- */

describe('PHASE3.4 CPU', () => {
  it('CPU球団もFA選手にオファーを出す', () => {
    const s = toFAPhaseWithReleases(2301, 3);
    const cpuOffers = s.fa!.offers.filter((o) => o.teamId !== PLAYER_TEAM);
    expect(cpuOffers.length).toBeGreaterThan(0);
  });

  it('CPUは予算の上限を超えるオファーを出さない', () => {
    const s = toFAPhaseWithReleases(2302, 3);
    for (const team of s.teams) {
      const pending = offersByTeam(s.fa!, team.id).reduce((sum, o) => sum + o.salary, 0);
      const payroll = teamPayroll(s, team.id);
      expect(payroll + pending).toBeLessThanOrEqual(budgetCeiling(s, team.id) + 0.001);
    }
  });

  it('CPUの推定能力は真の潜在能力を参照しない', () => {
    const s = toFAPhaseWithReleases(2303, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const before = estimatedAbility(s, OTHER_TEAM, player);
    player.ext.potential = 100;
    const after = estimatedAbility(s, OTHER_TEAM, player);
    expect(after).toBe(before);
  });

  it('推定能力は真の能力とは完全に一致しない（球団ごとに差がある）', () => {
    const s = toFAPhaseWithReleases(2304, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const estimates = s.teams.map((t) => estimatedAbility(s, t.id, player));
    expect(new Set(estimates.map((v) => Math.round(v * 100))).size).toBeGreaterThan(1);
    for (const value of estimates) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('CPUは1球団あたり無制限にはオファーしない', () => {
    const s = toFAPhaseWithReleases(2305, 4);
    for (const team of s.teams) {
      expect(offersByTeam(s.fa!, team.id).length).toBeLessThanOrEqual(8);
    }
  });

  it('CPUの興味は0〜1に収まり、割高な選手には下がる', () => {
    const s = toFAPhaseWithReleases(2306, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const need = {
      teamId: OTHER_TEAM,
      rosterShortage: 0,
      depthRoom: 2,
      fielderShortage: 0,
      pitcherShortage: 0,
      headroom: 400,
      budget: 1400,
      eagerness: 0.5,
    };
    const normal = cpuInterest(s, need, player, listing);
    const expensive = cpuInterest(s, need, player, {
      ...listing,
      askingSalary: 5000,
    });
    expect(normal).toBeGreaterThanOrEqual(0);
    expect(normal).toBeLessThanOrEqual(1);
    expect(expensive).toBeLessThanOrEqual(normal);
  });

  it('人数が足りない球団はロスター不足を優先する', () => {
    const s = toFAPhaseWithReleases(2307, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const base = {
      teamId: OTHER_TEAM,
      depthRoom: 2,
      fielderShortage: 0,
      pitcherShortage: 0,
      headroom: 400,
      budget: 1400,
      eagerness: 0.5,
    };
    const short = cpuInterest(s, { ...base, rosterShortage: 3 }, player, listing);
    const full = cpuInterest(s, { ...base, rosterShortage: 0 }, player, listing);
    expect(short).toBeGreaterThanOrEqual(full);
  });

  it('CPUのオファーは同じ状態なら同じ結果になる', () => {
    // 同じセーブから、もう一度 CPU のオファーを作り直しても同じになる
    const a = toFAPhaseWithReleases(2308, 3);
    const b = cloneState(a);
    b.fa!.offers = [];
    for (const listing of b.fa!.listings) {
      if (listing.status === 'OFFERED') listing.status = 'AVAILABLE';
    }
    runCpuFAOffers(b);
    const key = (s: GameState) =>
      s.fa!.offers
        .map((o) => `${o.teamId}:${o.playerId}:${o.salary}:${o.years}`)
        .sort()
        .join('|');
    expect(key(a)).toBe(key(b));
  });

  it('1つの球団がFA市場を独占しない', () => {
    let s = newGame(10, 2309);
    const counts = new Map<string, number>();
    for (let season = 0; season < 8; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startOffseason(s);
      startContractPhase(s);
      startFAPhase(s);
      runCpuFAOffers(s, { includePlayerTeam: true });
      resolveFAPhase(s);
      for (const r of s.fa!.results) counts.set(r.teamId, (counts.get(r.teamId) ?? 0) + 1);
      completeOffseason(s);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    const top = Math.max(...counts.values());
    expect(top / total).toBeLessThan(0.5);
  });
});

/* ---------------- 解決 ---------------- */

describe('PHASE3.4 契約の決定', () => {
  it('契約先は必ず1球団に決まる', () => {
    const s = toFAPhaseWithReleases(2401, 3);
    resolveFreeAgency(s);
    const signedIds = s.fa!.results.map((r) => r.playerId);
    expect(new Set(signedIds).size).toBe(signedIds.length);
    for (const record of s.fa!.results) {
      const owners = s.players.filter((p) => p.id === record.playerId);
      expect(owners).toHaveLength(1);
      expect(owners[0].teamId).toBe(record.teamId);
    }
  });

  it('成立したオファーは ACCEPTED、他は REJECTED になる', () => {
    const s = toFAPhaseWithReleases(2402, 3);
    resolveFreeAgency(s);
    for (const record of s.fa!.results) {
      const offers = s.fa!.offers.filter((o) => o.playerId === record.playerId);
      if (offers.length === 0) continue;
      const accepted = offers.filter((o) => o.status === 'ACCEPTED');
      expect(accepted.length).toBeLessThanOrEqual(1);
      if (accepted.length === 1) expect(accepted[0].teamId).toBe(record.teamId);
    }
    expect(s.fa!.offers.every((o) => o.status !== 'PENDING')).toBe(true);
  });

  it('契約が成立した選手はロスターに加わる', () => {
    const s = toFAPhaseWithReleases(2403, 3);
    resolveFreeAgency(s);
    for (const record of s.fa!.results) {
      const player = s.players.find((p) => p.id === record.playerId)!;
      expect(player).toBeDefined();
      expect(player.teamId).toBe(record.teamId);
      expect(player.ext.contract).not.toBeNull();
      expect(player.ext.contract!.salary).toBe(record.salary);
      expect(player.ext.contract!.yearsRemaining).toBe(record.years);
      expect(player.ext.contract!.signedYear).toBe(s.year);
      expect(s.stats[player.id]).toBeDefined();
      expect(s.freeAgents.some((p) => p.id === player.id)).toBe(false);
    }
  });

  it('契約が決まらなかった選手はFAのまま残る', () => {
    const s = toFAPhaseWithReleases(2404, 3);
    resolveFreeAgency(s);
    expect(s.fa!.unsigned).toBe(s.freeAgents.length);
    for (const player of s.freeAgents) {
      expect(player.teamId).toBe('');
      expect(player.ext.contract).toBeNull();
      expect(unsignedYears(player)).toBeGreaterThanOrEqual(1);
    }
  });

  it('二重に解決しても結果が変わらない', () => {
    const s = toFAPhaseWithReleases(2405, 3);
    const first = resolveFreeAgency(s);
    const playersAfter = s.players.length;
    const second = resolveFreeAgency(s);
    expect(second.signings.length).toBe(first.signings.length);
    expect(s.players.length).toBe(playersAfter);
  });

  it('同じ状態から解決すれば同じ結果になる（決定論）', () => {
    const a = toFAPhaseWithReleases(2406, 3);
    const b = cloneState(a);
    resolveFreeAgency(a);
    resolveFreeAgency(b);
    const key = (s: GameState) =>
      s.fa!.results.map((r) => `${r.playerId}:${r.teamId}:${r.salary}:${r.years}`).sort().join('|');
    expect(key(a)).toBe(key(b));
  });

  it('解決後もロスターは24人以上を保つ', () => {
    const s = toFAPhaseWithReleases(2407, 4);
    resolveFreeAgency(s);
    for (const team of s.teams) {
      const size = s.players.filter((p) => p.teamId === team.id).length;
      expect(size).toBeGreaterThanOrEqual(MINIMUM_ROSTER);
    }
  });

  it('解決後も総年俸が正しく再計算される', () => {
    const s = toFAPhaseWithReleases(2408, 3);
    resolveFreeAgency(s);
    for (const team of s.teams) {
      expect(s.finances[team.id].payroll).toBe(teamPayroll(s, team.id));
    }
  });
});

/* ---------------- ライフサイクル ---------------- */

describe('PHASE3.4 ライフサイクル', () => {
  it('ドラフト → 契約更改 → FA → 新シーズン が通る', () => {
    let s = playSeason(newGame(10, 2501));
    s = cloneState(s);
    startOffseason(s);
    expect(s.draft).not.toBeNull();
    startContractPhase(s);
    expect(s.contractPhase).not.toBeNull();
    autoCompleteContracts(s);
    startFAPhase(s);
    expect(s.contractPhase).toBeNull();
    expect(s.fa).not.toBeNull();
    resolveFAPhase(s);
    completeOffseason(s);
    expect(s.fa).toBeNull();
    expect(s.seasonFinished).toBe(false);
    expect(validateState(s)).toEqual([]);
  });

  it('FAで加入した選手は翌シーズンに出場できる', () => {
    let s = toFAPhaseWithReleases(2502, 3);
    resolveFAPhase(s);
    const joined = s.fa!.results.map((r) => r.playerId);
    completeOffseason(s);
    for (const id of joined) {
      const player = s.players.find((p) => p.id === id);
      expect(player).toBeDefined();
      expect(s.stats[id]).toBeDefined();
    }
    s = advanceDay(s).state;
    expect(s.results.length).toBeGreaterThan(0);
  });

  it('自動でオフシーズンを進めてもFAが処理される', () => {
    let s = playSeason(newGame(10, 2503));
    s = cloneState(s);
    startNextSeason(s);
    expect(s.fa).toBeNull();
    expect(s.lastOffseason!.faListed).toBeGreaterThanOrEqual(0);
    expect(s.lastOffseason!.faSigned).toBeGreaterThanOrEqual(0);
    expect(s.lastOffseason!.faUnsigned).toBe(s.freeAgents.length);
    expect(validateState(s)).toEqual([]);
  });

  it('選手数の増減が引退・新人・FAと一致する', () => {
    let s = playSeason(newGame(10, 2504));
    const before = s.players.length;
    s = cloneState(s);
    const { retirements } = startOffseason(s);
    const rookies = completeOffseason(s);
    const released = s.lastOffseason!.released;
    expect(s.players.length).toBe(before - retirements.length + rookies.length - released);
  });

  it('10シーズン続けてもFAで壊れない', () => {
    let s = newGame(10, 2505);
    for (let season = 0; season < 10; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      expect(validateState(s)).toEqual([]);
      const ids = new Set<string>();
      for (const p of s.players) {
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
      }
      for (const p of s.freeAgents) expect(ids.has(p.id)).toBe(false);
      for (const team of s.teams) {
        expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(
          MINIMUM_ROSTER,
        );
      }
    }
  });

  it('引退した選手はFA市場にもロスターにも残らない', () => {
    let s = newGame(10, 2506);
    for (let season = 0; season < 6; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    const retiredIds = new Set(s.retiredPlayers.map((r) => r.playerId));
    for (const id of retiredIds) {
      expect(s.players.some((p) => p.id === id)).toBe(false);
      expect(s.freeAgents.some((p) => p.id === id)).toBe(false);
    }
  });

  it('新人はFA市場を経由せず球団に加入する', () => {
    let s = playSeason(newGame(10, 2507));
    s = cloneState(s);
    startOffseason(s);
    const rookies = startContractPhase(s);
    for (const rookie of rookies) {
      expect(rookie.ext.contract).not.toBeNull();
      expect(s.freeAgents.some((p) => p.id === rookie.id)).toBe(false);
    }
  });

  it('FA市場を開いたあとは契約更改に戻らない', () => {
    const s = toFAPhaseWithReleases(2508, 3);
    expect(s.contractPhase).toBeNull();
    expect(s.fa).not.toBeNull();
  });
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.4 セーブ', () => {
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

  it('セーブバージョンが8になっている', () => {
    expect(SAVE_VERSION).toBe(8);
    expect(newGame().version).toBe(8);
  });

  it('FA市場の途中でも保存して復元できる', () => {
    clearSave();
    const s = toFAPhaseWithReleases(2601, 3);
    const listing = anyListing(s);
    makeFAOffer(s, PLAYER_TEAM, listing.playerId, listing.askingSalary, 1);
    expect(saveGame(s)).toBe(true);
    const loaded = loadGame()!;
    expect(loaded.fa).not.toBeNull();
    expect(loaded.fa!.listings.length).toBe(s.fa!.listings.length);
    expect(offersByTeam(loaded.fa!, PLAYER_TEAM)).toHaveLength(1);
    expect(loaded.freeAgents.length).toBe(s.freeAgents.length);
    clearSave();
  });

  it('FA解決後の状態も保存して復元できる', () => {
    clearSave();
    const s = toFAPhaseWithReleases(2602, 3);
    resolveFreeAgency(s);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.fa!.phase).toBe('resolved');
    expect(loaded.fa!.results.length).toBe(s.fa!.results.length);
    clearSave();
  });

  it('FA市場を開く前の状態も保存して復元できる', () => {
    clearSave();
    const s = toContractPhase(2603);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.fa).toBeNull();
    expect(Array.isArray(loaded.freeAgents)).toBe(true);
    clearSave();
  });

  it('翌シーズンに入った状態も保存して復元できる', () => {
    clearSave();
    let s = playSeason(newGame(10, 2604));
    s = cloneState(s);
    startNextSeason(s);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.year).toBe(s.year);
    expect(loaded.freeAgents.length).toBe(s.freeAgents.length);
    clearSave();
  });

  it('v7 のセーブを読み込める', () => {
    const s = newGame(10, 2605) as GameState & { fa?: unknown };
    const legacy = JSON.parse(JSON.stringify(s));
    legacy.version = 7;
    delete legacy.freeAgents;
    delete legacy.fa;
    delete legacy.lastFaYear;
    const migrated = migrate(legacy)!;
    expect(migrated).not.toBeNull();
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.freeAgents).toEqual([]);
    expect(migrated.fa).toBeNull();
    expect(migrated.lastFaYear).toBeNull();
  });

  it('v1 のセーブも v8 まで移行できる', () => {
    const s = newGame(10, 2606);
    const legacy = JSON.parse(JSON.stringify(s));
    legacy.version = 1;
    for (const player of legacy.players) {
      player.batting.trajectory = 2;
      delete player.ext;
    }
    delete legacy.freeAgents;
    delete legacy.fa;
    const migrated = migrate(legacy)!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(Array.isArray(migrated.freeAgents)).toBe(true);
    expect(migrated.players[0].batting.trajectory).toBe(50);
  });

  it('v2〜v6 のセーブも v8 まで移行できる', () => {
    for (const version of [2, 3, 4, 5, 6]) {
      const legacy = JSON.parse(JSON.stringify(newGame(10, 2607 + version)));
      legacy.version = version;
      delete legacy.freeAgents;
      delete legacy.fa;
      delete legacy.lastFaYear;
      const migrated = migrate(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.version).toBe(SAVE_VERSION);
      expect(Array.isArray(migrated!.freeAgents)).toBe(true);
    }
  });

  it('移行は同じ入力なら同じ結果になる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(10, 2608)));
    legacy.version = 7;
    delete legacy.freeAgents;
    const a = migrate(JSON.parse(JSON.stringify(legacy)))!;
    const b = migrate(JSON.parse(JSON.stringify(legacy)))!;
    expect(JSON.stringify(a.freeAgents)).toBe(JSON.stringify(b.freeAgents));
  });

  it('壊れたFAデータは読み込み時に直る', () => {
    const s = toFAPhaseWithReleases(2609, 3);
    // 所属している選手をFAプールにも入れてしまった状態
    const rostered = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    s.freeAgents.push(structuredClone(rostered));
    // 引退した選手を混ぜる
    const ghost = structuredClone(s.freeAgents[0]);
    ghost.id = 'ghost-player';
    s.retiredPlayers.push({
      playerId: ghost.id,
      name: ghost.name,
      teamId: PLAYER_TEAM,
      age: 40,
      years: 20,
      finalOverall: 30,
      mainPosition: ghost.mainPosition,
      retiredAt: s.year,
    });
    s.freeAgents.push(ghost);
    // 球団IDが残ってしまった状態
    s.freeAgents[0].teamId = OTHER_TEAM;

    repairFreeAgents(s);
    expect(s.freeAgents.some((p) => p.id === rostered.id)).toBe(false);
    expect(s.freeAgents.some((p) => p.id === 'ghost-player')).toBe(false);
    expect(s.freeAgents.every((p) => p.teamId === '')).toBe(true);
    const ids = s.freeAgents.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('壊れたセーブでもクラッシュしない', () => {
    localStorage.setItem(SAVE_KEY, '{bad json');
    expect(loadGame()).toBeNull();
    clearSave();
  });
});

/* ---------------- 表示 ---------------- */

describe('PHASE3.4 表示', () => {
  it('市場評価は内部数値ではなくラベルで表せる', () => {
    expect(marketGrade(500)).toBe('S');
    expect(marketGrade(150)).toBe('A');
    expect(marketGrade(80)).toBe('B');
    expect(marketGrade(40)).toBe('C');
    expect(marketGrade(16)).toBe('D');
    for (const grade of ['S', 'A', 'B', 'C', 'D'] as const) {
      expect(MARKET_GRADE_LABELS[grade].length).toBeGreaterThan(0);
    }
  });

  it('推定総合は幅で表され、真の値そのものは返さない', () => {
    const s = toFAPhaseWithReleases(2701, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const range = estimatedOverallRange(s, PLAYER_TEAM, player);
    expect(range.low).toBeLessThan(range.high);
    expect(range.low).toBeGreaterThanOrEqual(1);
    expect(range.high).toBeLessThanOrEqual(100);
  });

  it('推定総合は球団ごとに異なる', () => {
    const s = toFAPhaseWithReleases(2702, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const ranges = s.teams.map((t) => `${estimatedOverallRange(s, t.id, player).low}`);
    expect(new Set(ranges).size).toBeGreaterThan(1);
  });

  it('推定総合は潜在能力を参照しない', () => {
    const s = toFAPhaseWithReleases(2703, 3);
    const listing = anyListing(s);
    const player = freeAgentById(s, listing.playerId)!;
    const before = estimatedOverallRange(s, PLAYER_TEAM, player);
    player.ext.potential = 99;
    const after = estimatedOverallRange(s, PLAYER_TEAM, player);
    expect(after).toEqual(before);
  });
});

/* ---------------- バランス ---------------- */

describe('PHASE3.4 バランス', () => {
  it('FA市場に選手が出て、そのほとんどが契約に至る', () => {
    let s = newGame(10, 2801);
    let listed = 0;
    let signed = 0;
    for (let season = 0; season < 10; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startOffseason(s);
      startContractPhase(s);
      startFAPhase(s);
      runCpuFAOffers(s, { includePlayerTeam: true });
      listed += s.fa!.listings.length;
      resolveFAPhase(s);
      signed += s.fa!.results.length;
      completeOffseason(s);
    }
    expect(listed).toBeGreaterThan(0);
    expect(signed).toBeGreaterThan(0);
    expect(signed / listed).toBeGreaterThan(0.5);
    expect(signed / listed).toBeLessThanOrEqual(1);
  });

  it('FAで年俸がインフレしない', () => {
    let s = newGame(10, 2802);
    const salaryOf = (state: GameState) =>
      state.players.reduce((sum, p) => sum + (p.ext.contract?.salary ?? 0), 0) /
      state.players.length;
    const before = salaryOf(s);
    for (let season = 0; season < 12; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    const after = salaryOf(s);
    expect(after).toBeLessThan(before * 2.5);
    expect(after).toBeGreaterThan(before * 0.4);
  });

  it('FAを続けても平均年齢・平均総合が崩れない', () => {
    let s = newGame(10, 2803);
    for (let season = 0; season < 12; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    const avgAge = s.players.reduce((a, p) => a + p.age, 0) / s.players.length;
    const avgOverall =
      s.players.reduce((a, p) => a + overallRating(p), 0) / s.players.length;
    expect(avgAge).toBeGreaterThan(23);
    expect(avgAge).toBeLessThan(32);
    expect(avgOverall).toBeGreaterThan(30);
    expect(avgOverall).toBeLessThan(50);
  });

  it('球団資金がFAで破綻しない', () => {
    let s = newGame(10, 2804);
    for (let season = 0; season < 12; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      for (const team of s.teams) {
        expect(Number.isFinite(s.finances[team.id].cash)).toBe(true);
        expect(s.finances[team.id].payroll).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('1軍の人数（野手9人・投手5人）が保たれる', () => {
    let s = newGame(10, 2805);
    for (let season = 0; season < 8; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      for (const team of s.teams) {
        const first = s.players.filter((p) => p.teamId === team.id && p.roster === 'first');
        expect(first.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(9);
        expect(first.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(5);
      }
    }
  });
});
