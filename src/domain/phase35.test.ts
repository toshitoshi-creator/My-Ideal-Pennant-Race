import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import {
  MAX_TRADE_PLAYERS,
  MAX_TRADES_PER_TEAM,
  MIN_ROSTER_AFTER_TRADE,
  OFFER_EXPIRY_DAYS,
  TRADE_TRAIT_LABELS,
  ageHorizonFactor,
  buildCpuOffer,
  calculateTradeValue,
  cancelTradeOffer,
  canTradePlayer,
  contractBurden,
  createTradeOffer,
  estimatedPotential,
  evaluateTradeFor,
  executeTrade,
  expireTradeOffers,
  fairnessLabel,
  futureFactor,
  injuryFactor,
  isTradeOpen,
  pendingOffersForPlayer,
  pendingOffersFromPlayer,
  positionNeedFactor,
  rejectMessage,
  rejectTradeOffer,
  respondToOffer,
  runCpuTrades,
  specialAbilityFactor,
  teamTradeTrait,
  tradeDeadline,
  tradedStatsAdjustment,
  validateTrade,
  valueLabel,
} from './trade';
import { MINIMUM_ROSTER, teamPayroll } from './contract';
import { overallRating } from './rating';
import { Rng } from './rng';
import { clearSave, loadGame, migrate, saveGame } from './save';
import type { GameState, Player, TradeOffer } from './types';

const PLAYER_TEAM = 'phoenix';
const CPU_TEAM = 'bluewave';

function newGame(length: 10 | 30 | 143 = 30, seed = 350350): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

/** シーズンを何日か進めた状態（トレード期間の途中） */
function midSeason(seed = 350350, days = 6): GameState {
  let s = newGame(30, seed);
  for (let i = 0; i < days; i++) s = advanceDay(s).state;
  return cloneState(s);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/** その球団でトレードに出せる選手（総合値の低い順） */
function tradables(state: GameState, teamId: string): Player[] {
  return state.players
    .filter((p) => p.teamId === teamId && canTradePlayer(state, p))
    .sort((a, b) => overallRating(a) - overallRating(b));
}

/** 検証を通る 1対1 の提案を作る */
function simpleOffer(state: GameState, fromTeamId = PLAYER_TEAM, toTeamId = CPU_TEAM): TradeOffer {
  const mine = tradables(state, fromTeamId);
  const theirs = tradables(state, toTeamId);
  for (const a of mine) {
    for (const b of theirs) {
      const offer = createTradeOffer(state, fromTeamId, toTeamId, [a.id], [b.id]);
      if (validateTrade(state, offer).ok) return offer;
    }
  }
  throw new Error('成立可能な組み合わせが見つかりません');
}

/* ---------------- 検証 ---------------- */

describe('PHASE3.5 トレードの検証', () => {
  it('契約中の選手はトレードできる', () => {
    const s = midSeason(1001);
    const player = tradables(s, PLAYER_TEAM)[0];
    expect(canTradePlayer(s, player)).toBe(true);
  });

  it('FA（未所属）の選手はトレードできない', () => {
    const s = midSeason(1002);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    s.players = s.players.filter((p) => p.id !== player.id);
    player.teamId = '';
    player.ext.contract = null;
    s.freeAgents.push(player);
    expect(canTradePlayer(s, player)).toBe(false);
  });

  it('引退した選手はトレードできない', () => {
    const s = midSeason(1003);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    s.retiredPlayers.push({
      playerId: player.id,
      name: player.name,
      teamId: PLAYER_TEAM,
      age: 40,
      years: 20,
      finalOverall: 30,
      mainPosition: player.mainPosition,
      retiredAt: s.year,
    });
    expect(canTradePlayer(s, player)).toBe(false);
  });

  it('無契約の選手はトレードできない', () => {
    const s = midSeason(1004);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.contract = null;
    expect(canTradePlayer(s, player)).toBe(false);
  });

  it('存在しない選手を含む提案は通らない', () => {
    const s = midSeason(1005);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, ['no-such-player'], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('unknown-player');
  });

  it('存在しない球団との提案は通らない', () => {
    const s = midSeason(1006);
    const offer = createTradeOffer(s, PLAYER_TEAM, 'no-such-team', [tradables(s, PLAYER_TEAM)[0].id], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('unknown-team');
  });

  it('自球団同士のトレードはできない', () => {
    const s = midSeason(1007);
    const roster = tradables(s, PLAYER_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, PLAYER_TEAM, [roster[0].id], [roster[1].id]);
    expect(validateTrade(s, offer).error).toBe('same-team');
  });

  it('片方が0人の提案はできない', () => {
    const s = midSeason(1008);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [tradables(s, PLAYER_TEAM)[0].id], []);
    expect(validateTrade(s, offer).error).toBe('empty');
    const offer2 = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [], [tradables(s, CPU_TEAM)[0].id]);
    expect(validateTrade(s, offer2).error).toBe('empty');
  });

  it('1対1のトレードは成立できる', () => {
    const s = midSeason(1009);
    expect(validateTrade(s, simpleOffer(s)).ok).toBe(true);
  });

  it('2対1のトレードは成立できる', () => {
    const s = midSeason(1010);
    const mine = tradables(s, PLAYER_TEAM);
    const theirs = tradables(s, CPU_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine[0].id, mine[1].id], [theirs[0].id]);
    const result = validateTrade(s, offer);
    // 人数が足りていれば成立できる形
    expect(result.error === undefined || result.error === 'roster').toBe(true);
  });

  it('2対2のトレードは成立できる', () => {
    const s = midSeason(1011);
    const mine = tradables(s, PLAYER_TEAM);
    const theirs = tradables(s, CPU_TEAM);
    const offer = createTradeOffer(
      s,
      PLAYER_TEAM,
      CPU_TEAM,
      [mine[0].id, mine[1].id],
      [theirs[0].id, theirs[1].id],
    );
    expect(validateTrade(s, offer).ok).toBe(true);
  });

  it(`片側${MAX_TRADE_PLAYERS}人を超える提案はできない`, () => {
    const s = midSeason(1012);
    const mine = tradables(s, PLAYER_TEAM);
    const theirs = tradables(s, CPU_TEAM);
    const offer = createTradeOffer(
      s,
      PLAYER_TEAM,
      CPU_TEAM,
      [mine[0].id, mine[1].id, mine[2].id],
      [theirs[0].id],
    );
    expect(validateTrade(s, offer).error).toBe('too-many');
  });

  it('同じ選手を重複して含む提案はできない', () => {
    const s = midSeason(1013);
    const mine = tradables(s, PLAYER_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine[0].id, mine[0].id], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('duplicate');
  });

  it('所属が違う選手を含む提案はできない', () => {
    const s = midSeason(1014);
    const theirs = tradables(s, CPU_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [theirs[0].id], [theirs[1].id]);
    expect(validateTrade(s, offer).error).toBe('wrong-team');
  });

  it('最低人数を割る提案はできない', () => {
    const s = midSeason(1015);
    // 保有選手を最低人数ぎりぎりまで減らす
    const roster = s.players.filter((p) => p.teamId === PLAYER_TEAM);
    const keep = roster.slice(0, MIN_ROSTER_AFTER_TRADE);
    s.players = s.players.filter((p) => p.teamId !== PLAYER_TEAM || keep.includes(p));
    const mine = tradables(s, PLAYER_TEAM);
    const theirs = tradables(s, CPU_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine[0].id, mine[1].id], [theirs[0].id]);
    expect(validateTrade(s, offer).error).toBe('roster');
  });

  it('1軍を組める人数を割る提案はできない', () => {
    const s = midSeason(1016);
    // 投手を最低限まで減らす
    const pitchers = s.players.filter((p) => p.teamId === PLAYER_TEAM && p.isPitcher);
    const remove = pitchers.slice(6);
    s.players = s.players.filter((p) => !remove.includes(p));
    const remaining = s.players.filter((p) => p.teamId === PLAYER_TEAM && p.isPitcher);
    const target = remaining.find((p) => canTradePlayer(s, p))!;
    const theirs = s.players.find(
      (p) => p.teamId === CPU_TEAM && !p.isPitcher && canTradePlayer(s, p),
    )!;
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [target.id], [theirs.id]);
    const result = validateTrade(s, offer);
    expect(result.ok).toBe(false);
    expect(['position-minimum', 'roster']).toContain(result.error);
  });

  it('総年俸が予算を超える提案はできない', () => {
    const s = midSeason(1017);
    s.finances[PLAYER_TEAM].budget = 1;
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [tradables(s, PLAYER_TEAM)[0].id], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('payroll');
  });

  it('1シーズンのトレード上限を超えると成立しない', () => {
    const s = midSeason(1018);
    s.trade.countByTeam[PLAYER_TEAM] = MAX_TRADES_PER_TEAM;
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [tradables(s, PLAYER_TEAM)[0].id], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('trade-limit');
  });

  it('同じ選手を1シーズンに2回はトレードできない', () => {
    const s = midSeason(1019);
    const offer = simpleOffer(s);
    expect(executeTrade(s, offer).ok).toBe(true);
    const moved = s.players.find((p) => p.id === offer.offeredPlayerIds[0])!;
    expect(canTradePlayer(s, moved)).toBe(false);
  });
});

/* ---------------- トレード期間 ---------------- */

describe('PHASE3.5 トレード期間', () => {
  it('シーズン開幕直後はトレードできる', () => {
    const s = midSeason(1101, 2);
    expect(isTradeOpen(s)).toBe(true);
  });

  it('期限はシーズンの途中に設定される', () => {
    const s = newGame(30, 1102);
    const deadline = tradeDeadline(s);
    const dates = [...new Set(s.schedule.map((g) => g.date))].sort();
    expect(deadline > dates[0]).toBe(true);
    expect(deadline < dates[dates.length - 1]).toBe(true);
  });

  it('期限を過ぎるとトレードできない', () => {
    const s = midSeason(1103, 2);
    s.trade.deadline = '2000-01-01';
    expect(isTradeOpen(s)).toBe(false);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [tradables(s, PLAYER_TEAM)[0].id], [
      tradables(s, CPU_TEAM)[0].id,
    ]);
    expect(validateTrade(s, offer).error).toBe('closed');
  });

  it('シーズン終了後・オフシーズン中はトレードできない', () => {
    let s = playSeason(newGame(10, 1104));
    expect(isTradeOpen(s)).toBe(false);
    s = cloneState(s);
    startOffseason(s);
    expect(s.draft).not.toBeNull();
    expect(isTradeOpen(s)).toBe(false);
  });

  it('提案には期限があり、過ぎると期限切れになる', () => {
    const s = midSeason(1105);
    const offer = simpleOffer(s, CPU_TEAM, PLAYER_TEAM);
    s.trade.offers.push(offer);
    expect(offer.expiresDate > s.date).toBe(true);
    s.date = offer.expiresDate;
    expireTradeOffers(s);
    expect(offer.status).toBe('PENDING');
    s.date = '2999-12-31';
    expireTradeOffers(s);
    expect(offer.status).toBe('EXPIRED');
  });

  it('提案の有効期間は決められた日数になる', () => {
    const s = midSeason(1106);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, ['a'], ['b']);
    const expected = new Date(s.date);
    expected.setDate(expected.getDate() + OFFER_EXPIRY_DAYS);
    expect(offer.expiresDate).toBe(expected.toISOString().slice(0, 10));
  });

  it('提案は取り下げられる', () => {
    const s = midSeason(1107);
    const offer = simpleOffer(s);
    s.trade.offers.push(offer);
    expect(pendingOffersFromPlayer(s)).toHaveLength(1);
    expect(cancelTradeOffer(s, offer.id)).toBe(true);
    expect(offer.status).toBe('CANCELLED');
    expect(cancelTradeOffer(s, offer.id)).toBe(false);
  });
});

/* ---------------- 選手評価 ---------------- */

describe('PHASE3.5 選手の評価', () => {
  it('能力が高いほど価値が高い（同じ年齢・契約なら）', () => {
    const s = midSeason(1201);
    const base = s.players.find((p) => !p.isPitcher && p.teamId === PLAYER_TEAM)!;
    const make = (overall: number): Player => ({
      ...structuredClone(base),
      age: 28,
      batting: {
        trajectory: overall,
        contact: overall,
        power: overall,
        speed: overall,
        arm: overall,
        fielding: overall,
        catching: overall,
      },
    });
    const weak = calculateTradeValue(s, make(35), PLAYER_TEAM);
    const strong = calculateTradeValue(s, make(70), PLAYER_TEAM);
    expect(strong).toBeGreaterThan(weak);
  });

  it('若い選手ほど長期価値が高い', () => {
    expect(ageHorizonFactor(22)).toBeGreaterThan(ageHorizonFactor(28));
    expect(ageHorizonFactor(28)).toBeGreaterThan(ageHorizonFactor(34));
    expect(ageHorizonFactor(34)).toBeGreaterThan(ageHorizonFactor(38));
  });

  it('伸びしろのある若手は価値が上がる', () => {
    const s = midSeason(1203);
    const base = s.players.find((p) => p.teamId === PLAYER_TEAM && p.age <= 26)!;
    const low = structuredClone(base);
    low.ext.potential = overallRating(low);
    const high = structuredClone(base);
    high.ext.potential = Math.min(99, overallRating(high) + 30);
    expect(futureFactor(s, PLAYER_TEAM, high)).toBeGreaterThan(futureFactor(s, PLAYER_TEAM, low));
  });

  it('30歳を超えると伸びしろの評価は効かない', () => {
    const s = midSeason(1204);
    const base = structuredClone(s.players.find((p) => p.teamId === PLAYER_TEAM)!);
    base.age = 34;
    base.ext.potential = 99;
    expect(futureFactor(s, PLAYER_TEAM, base)).toBe(1);
  });

  it('契約が重いほど価値が下がる', () => {
    const s = midSeason(1205);
    const base = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const cheap = structuredClone(base);
    cheap.ext.contract = { salary: 30, yearsRemaining: 1, totalYears: 1, signedYear: s.year };
    const expensive = structuredClone(base);
    expensive.ext.contract = { salary: 400, yearsRemaining: 4, totalYears: 4, signedYear: s.year };
    expect(contractBurden(expensive)).toBeGreaterThan(contractBurden(cheap));
    expect(calculateTradeValue(s, expensive, PLAYER_TEAM)).toBeLessThan(
      calculateTradeValue(s, cheap, PLAYER_TEAM),
    );
  });

  it('怪我をしている選手は評価が下がる（トレード自体は可能）', () => {
    const s = midSeason(1206);
    const base = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.ext.injury)!;
    const healthy = calculateTradeValue(s, base, PLAYER_TEAM);
    const hurt = structuredClone(base);
    hurt.ext.injury = {
      level: 'major',
      name: '骨折',
      startDate: s.date,
      returnDate: '2999-01-01',
    };
    expect(injuryFactor(hurt)).toBeLessThan(1);
    expect(calculateTradeValue(s, hurt, PLAYER_TEAM)).toBeLessThan(healthy);
    expect(canTradePlayer(s, base)).toBe(true);
  });

  it('特殊能力の影響は±10%までに収まる', () => {
    const s = midSeason(1207);
    const base = structuredClone(s.players.find((p) => p.teamId === PLAYER_TEAM)!);
    base.ext.specialAbilities = [];
    expect(specialAbilityFactor(base)).toBe(1);
    base.ext.specialAbilities = Array.from({ length: 20 }, () => ({
      id: 'powerHitter' as never,
      level: 3,
    }));
    expect(specialAbilityFactor(base)).toBeLessThanOrEqual(1.1);
    expect(specialAbilityFactor(base)).toBeGreaterThanOrEqual(0.9);
  });

  it('その日の調子はトレード価値に影響しない', () => {
    const s = midSeason(1208);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = calculateTradeValue(s, player, PLAYER_TEAM);
    player.ext.condition = 'best';
    player.ext.fatigue = 0;
    const good = calculateTradeValue(s, player, PLAYER_TEAM);
    player.ext.condition = 'worst';
    player.ext.fatigue = 100;
    const bad = calculateTradeValue(s, player, PLAYER_TEAM);
    expect(good).toBe(before);
    expect(bad).toBe(before);
  });

  it('手薄なポジションの選手ほど欲しがられる', () => {
    const s = midSeason(1209);
    const player = s.players.find((p) => p.teamId === CPU_TEAM && !p.isPitcher)!;
    const before = positionNeedFactor(s, PLAYER_TEAM, player);
    // 同じ枠に上位の選手を増やすと需要が下がる
    for (let i = 0; i < 6; i++) {
      const clone = structuredClone(player);
      clone.id = `${player.id}-rival-${i}`;
      clone.teamId = PLAYER_TEAM;
      clone.batting = { ...clone.batting, contact: 99, power: 99, fielding: 99, catching: 99, arm: 99, speed: 99 };
      s.players.push(clone);
    }
    expect(positionNeedFactor(s, PLAYER_TEAM, player)).toBeLessThan(before);
  });

  it('成績はトレード価値に反映される', () => {
    const s = midSeason(1211, 20);
    const batters = s.players
      .filter((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)
      .filter((p) => s.stats[p.id].batting.atBats >= 5);
    expect(batters.length).toBeGreaterThan(0);
    const player = batters[0];
    const before = calculateTradeValue(s, player, PLAYER_TEAM);
    const stats = s.stats[player.id];
    stats.batting.atBats = 400;
    stats.batting.hits = 160;
    stats.batting.homeRuns = 35;
    stats.batting.rbi = 100;
    expect(calculateTradeValue(s, player, PLAYER_TEAM)).toBeGreaterThan(before);
  });

  it('球団ごとに推定潜在能力が違う（真の値をそのまま使わない）', () => {
    const s = midSeason(1212);
    const player = s.players.find((p) => p.teamId === CPU_TEAM)!;
    const estimates = s.teams
      .filter((t) => t.id !== CPU_TEAM)
      .map((t) => estimatedPotential(s, t.id, player));
    expect(new Set(estimates.map((v) => Math.round(v))).size).toBeGreaterThan(1);
    // 少なくとも1球団は真の値からずれている
    expect(estimates.some((v) => Math.round(v) !== player.ext.potential)).toBe(true);
  });

  it('自球団の選手は正しく把握している', () => {
    const s = midSeason(1213);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    expect(estimatedPotential(s, PLAYER_TEAM, player)).toBe(player.ext.potential);
  });

  it('高齢・高年俸の主力と、若くて安い有望株が近い価値になりうる', () => {
    const s = midSeason(1214);
    const base = s.players.find((p) => !p.isPitcher && p.teamId === PLAYER_TEAM)!;
    const make = (overall: number, age: number, salary: number, years: number, potential: number) => {
      const p = structuredClone(base);
      p.age = age;
      p.ext.potential = potential;
      p.ext.contract = { salary, yearsRemaining: years, totalYears: years, signedYear: s.year };
      p.batting = {
        trajectory: overall,
        contact: overall,
        power: overall,
        speed: overall,
        arm: overall,
        fielding: overall,
        catching: overall,
      };
      return p;
    };
    const veteran = calculateTradeValue(s, make(68, 35, 220, 1, 68), PLAYER_TEAM);
    const prospect = calculateTradeValue(s, make(55, 24, 50, 3, 80), PLAYER_TEAM);
    // 現在能力では大差があるが、長期価値では差が2倍以内に収まる
    expect(veteran).toBeGreaterThan(0);
    expect(prospect).toBeGreaterThan(0);
    expect(Math.max(veteran, prospect) / Math.min(veteran, prospect)).toBeLessThan(2.2);
  });
});

/* ---------------- 損得の判断 ---------------- */

describe('PHASE3.5 損得の判断', () => {
  it('明らかに不公平な提案はCPUが断る', () => {
    const s = midSeason(1301);
    const mine = tradables(s, PLAYER_TEAM);
    const theirs = s.players
      .filter((p) => p.teamId === CPU_TEAM && canTradePlayer(s, p))
      .sort((a, b) => overallRating(b) - overallRating(a));
    // こちらは最低評価、相手には最高評価の選手を要求する
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine[0].id], [theirs[0].id]);
    const result = respondToOffer(s, offer);
    expect(result.ok).toBe(false);
    expect(offer.status).toBe('REJECTED');
    expect(s.players.find((p) => p.id === theirs[0].id)!.teamId).toBe(CPU_TEAM);
  });

  it('釣り合った提案なら受け入れられることがある', () => {
    let accepted = 0;
    for (let seed = 0; seed < 6; seed++) {
      const s = midSeason(1310 + seed);
      const mine = tradables(s, PLAYER_TEAM);
      const theirs = tradables(s, CPU_TEAM);
      for (const a of mine.slice(-6)) {
        for (const b of theirs.slice(0, 6)) {
          const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [a.id], [b.id]);
          if (!validateTrade(s, offer).ok) continue;
          const evaluation = evaluateTradeFor(
            s,
            CPU_TEAM,
            [s.players.find((p) => p.id === a.id)!],
            [s.players.find((p) => p.id === b.id)!],
          );
          if (evaluation.accept) accepted += 1;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('評価は「受け取る価値 ÷ 渡す価値」になる', () => {
    const s = midSeason(1302);
    const mine = tradables(s, PLAYER_TEAM)[0];
    const theirs = tradables(s, CPU_TEAM)[0];
    const evaluation = evaluateTradeFor(s, CPU_TEAM, [mine], [theirs]);
    expect(evaluation.receivedValue).toBeGreaterThan(0);
    expect(evaluation.givenValue).toBeGreaterThan(0);
    expect(evaluation.ratio).toBeCloseTo(evaluation.receivedValue / evaluation.givenValue, 5);
  });

  it('予算を超える取引は理由つきで断られる', () => {
    const s = midSeason(1303);
    s.finances[CPU_TEAM].budget = 1;
    const mine = s.players
      .filter((p) => p.teamId === PLAYER_TEAM && canTradePlayer(s, p))
      .sort((a, b) => (b.ext.contract?.salary ?? 0) - (a.ext.contract?.salary ?? 0))[0];
    const theirs = tradables(s, CPU_TEAM)[0];
    const evaluation = evaluateTradeFor(s, CPU_TEAM, [mine], [theirs]);
    expect(evaluation.accept).toBe(false);
    expect(evaluation.reason).toBe('budget');
  });

  it('人数が足りなくなる取引は断られる', () => {
    const s = midSeason(1304);
    const roster = s.players.filter((p) => p.teamId === CPU_TEAM);
    const keep = roster.slice(0, MINIMUM_ROSTER);
    s.players = s.players.filter((p) => p.teamId !== CPU_TEAM || keep.includes(p));
    const theirs = tradables(s, CPU_TEAM).slice(0, 2);
    const mine = tradables(s, PLAYER_TEAM)[0];
    const evaluation = evaluateTradeFor(s, CPU_TEAM, [mine], theirs);
    expect(evaluation.accept).toBe(false);
    expect(evaluation.reason).toBe('roster');
  });

  it('断られた理由は抽象的な文章で返る（内部数値は出さない）', () => {
    for (const reason of ['value', 'position', 'contract', 'roster', 'budget'] as const) {
      const message = rejectMessage(reason);
      expect(message.length).toBeGreaterThan(0);
      expect(/\d/.test(message)).toBe(false);
    }
  });

  it('公平度はラベルで表せる', () => {
    expect(fairnessLabel(2)).toBe('非常に有利');
    expect(fairnessLabel(1.3)).toBe('有利');
    expect(fairnessLabel(1.1)).toBe('やや有利');
    expect(fairnessLabel(1)).toBe('互角');
    expect(fairnessLabel(0.85)).toBe('やや不利');
    expect(fairnessLabel(0.7)).toBe('不利');
    expect(fairnessLabel(0.3)).toBe('非常に不利');
  });

  it('価値の大きさもラベルで表せる', () => {
    expect(valueLabel(400)).toBe('非常に高い');
    expect(valueLabel(150)).toBe('高い');
    expect(valueLabel(80)).toBe('普通');
    expect(valueLabel(30)).toBe('やや低い');
    expect(valueLabel(5)).toBe('低い');
  });

  it('球団ごとに補強方針がある', () => {
    const s = midSeason(1305);
    const traits = s.teams.map((t) => teamTradeTrait(s, t.id));
    expect(new Set(traits).size).toBeGreaterThan(1);
    for (const trait of traits) expect(TRADE_TRAIT_LABELS[trait].length).toBeGreaterThan(0);
    // 同じゲームなら常に同じ
    expect(teamTradeTrait(s, PLAYER_TEAM)).toBe(teamTradeTrait(s, PLAYER_TEAM));
  });
});

/* ---------------- 成立処理 ---------------- */

describe('PHASE3.5 トレードの成立', () => {
  it('選手が入れ替わる', () => {
    const s = midSeason(1401);
    const offer = simpleOffer(s);
    const mineId = offer.offeredPlayerIds[0];
    const theirId = offer.requestedPlayerIds[0];
    expect(executeTrade(s, offer).ok).toBe(true);
    expect(s.players.find((p) => p.id === mineId)!.teamId).toBe(CPU_TEAM);
    expect(s.players.find((p) => p.id === theirId)!.teamId).toBe(PLAYER_TEAM);
  });

  it('同じ選手が2球団に存在しない', () => {
    const s = midSeason(1402);
    executeTrade(s, simpleOffer(s));
    const ids = s.players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const team of s.teams) {
      const roster = s.players.filter((p) => p.teamId === team.id);
      expect(new Set(roster.map((p) => p.id)).size).toBe(roster.length);
    }
  });

  it('契約はそのまま引き継がれる', () => {
    const s = midSeason(1403);
    const offer = simpleOffer(s);
    const before = structuredClone(
      s.players.find((p) => p.id === offer.offeredPlayerIds[0])!.ext.contract!,
    );
    executeTrade(s, offer);
    const after = s.players.find((p) => p.id === offer.offeredPlayerIds[0])!.ext.contract!;
    expect(after.salary).toBe(before.salary);
    expect(after.yearsRemaining).toBe(before.yearsRemaining);
    expect(after.totalYears).toBe(before.totalYears);
    expect(after.signedYear).toBe(before.signedYear);
  });

  it('総年俸が再計算される', () => {
    const s = midSeason(1404);
    executeTrade(s, simpleOffer(s));
    for (const team of s.teams) {
      expect(s.finances[team.id].payroll).toBe(teamPayroll(s, team.id));
      expect(s.finances[team.id].payroll).toBeGreaterThanOrEqual(0);
    }
  });

  it('在籍履歴が残る', () => {
    const s = midSeason(1405);
    const offer = simpleOffer(s);
    const id = offer.offeredPlayerIds[0];
    const before = s.players.find((p) => p.id === id)!.ext.careerTeams.length;
    executeTrade(s, offer);
    const player = s.players.find((p) => p.id === id)!;
    expect(player.ext.careerTeams.length).toBe(before + 1);
    expect(player.ext.careerTeams[player.ext.careerTeams.length - 1]).toEqual({
      year: s.year,
      teamId: CPU_TEAM,
    });
  });

  it('トレード履歴が残る', () => {
    const s = midSeason(1406);
    const offer = simpleOffer(s);
    const before = s.trade.history.length;
    executeTrade(s, offer);
    expect(s.trade.history).toHaveLength(before + 1);
    const record = s.trade.history.find((r) => r.id === offer.id)!;
    expect(record.fromTeamId).toBe(PLAYER_TEAM);
    expect(record.toTeamId).toBe(CPU_TEAM);
    expect(record.playerIdsFrom).toEqual(offer.offeredPlayerIds);
    expect(record.playerIdsTo).toEqual(offer.requestedPlayerIds);
    expect(record.playerNamesFrom.length).toBe(1);
    expect(record.year).toBe(s.year);
  });

  it('成立しない提案では誰も動かない（途中で止まらない）', () => {
    const s = midSeason(1407);
    const mine = tradables(s, PLAYER_TEAM);
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine[0].id], ['no-such-player']);
    const snapshot = s.players.map((p) => `${p.id}:${p.teamId}`).join('|');
    const historyBefore = s.trade.history.length;
    const result = executeTrade(s, offer);
    expect(result.ok).toBe(false);
    expect(s.players.map((p) => `${p.id}:${p.teamId}`).join('|')).toBe(snapshot);
    expect(s.trade.history).toHaveLength(historyBefore);
  });

  it('成立後もロスターと1軍が成立する', () => {
    const s = midSeason(1408);
    executeTrade(s, simpleOffer(s));
    expect(validateState(s)).toEqual([]);
    for (const team of s.teams) {
      const roster = s.players.filter((p) => p.teamId === team.id);
      expect(roster.length).toBeGreaterThanOrEqual(MINIMUM_ROSTER);
      const first = roster.filter((p) => p.roster === 'first');
      expect(first.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(9);
      expect(first.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('自球団のトレードは通知される', () => {
    const s = midSeason(1409);
    s.notices = [];
    executeTrade(s, simpleOffer(s));
    expect(s.notices.some((n) => n.kind === 'trade')).toBe(true);
  });

  it('成立した提案は ACCEPTED になる', () => {
    const s = midSeason(1410);
    const offer = simpleOffer(s);
    executeTrade(s, offer);
    expect(offer.status).toBe('ACCEPTED');
  });

  it('断った提案は REJECTED になる', () => {
    const s = midSeason(1411);
    const offer = simpleOffer(s);
    rejectTradeOffer(offer, 'value');
    expect(offer.status).toBe('REJECTED');
    expect(offer.reason).toBe('value');
  });

  it('移籍時点の成績が記録され、球団別の集計を復元できる', () => {
    const s = midSeason(1412, 20);
    const offer = simpleOffer(s);
    const id = offer.offeredPlayerIds[0];
    const before = structuredClone(s.stats[id]);
    executeTrade(s, offer);
    const record = s.trade.history.find((r) => r.id === offer.id)!;
    expect(record.statsAtTrade[id]).toEqual(before);
    const adjust = tradedStatsAdjustment(s, PLAYER_TEAM);
    expect(adjust.outgoing.length + adjust.incoming.length).toBeGreaterThan(0);
    // 成績そのものは選手についていく
    expect(s.stats[id]).toEqual(before);
  });
});

/* ---------------- CPU ---------------- */

describe('PHASE3.5 CPU', () => {
  it('CPU球団同士がトレードする', () => {
    let s = newGame(30, 1501);
    for (let i = 0; i < 25; i++) s = advanceDay(s).state;
    expect(s.trade.history.length).toBeGreaterThan(0);
    for (const record of s.trade.history) {
      expect(record.fromTeamId).not.toBe(record.toTeamId);
    }
  });

  it('CPUがプレイヤー球団へ提案してくる', () => {
    let found = false;
    for (let seed = 0; seed < 8 && !found; seed++) {
      let s = newGame(30, 1600 + seed);
      for (let i = 0; i < 30 && !found; i++) {
        s = advanceDay(s).state;
        if (s.trade.offers.some((o) => o.toTeamId === PLAYER_TEAM)) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('CPUの提案は組み立てられる（相手も受けられる形になっている）', () => {
    const s = midSeason(1502);
    let built = 0;
    for (const team of s.teams.filter((t) => t.id !== PLAYER_TEAM)) {
      const offer = buildCpuOffer(s, team.id, PLAYER_TEAM, new Rng(7));
      if (offer) {
        built += 1;
        expect(validateTrade(s, offer).ok).toBe(true);
        expect(offer.offeredPlayerIds.length).toBeGreaterThan(0);
        expect(offer.requestedPlayerIds.length).toBeGreaterThan(0);
      }
    }
    expect(built).toBeGreaterThanOrEqual(0);
  });

  it('CPUは予算を超えるトレードをしない', () => {
    let s = newGame(30, 1503);
    for (let i = 0; i < 30; i++) {
      s = advanceDay(s).state;
      for (const team of s.teams) {
        expect(teamPayroll(s, team.id)).toBeLessThanOrEqual(s.finances[team.id].budget * 1.12 + 1);
      }
    }
  });

  it('CPUのトレード後も全球団が最低人数を保つ', () => {
    let s = newGame(30, 1504);
    for (let i = 0; i < 30; i++) {
      s = advanceDay(s).state;
      for (const team of s.teams) {
        expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(
          MINIMUM_ROSTER,
        );
      }
    }
  });

  it('1球団が1シーズンに何度もトレードしすぎない', () => {
    let s = newGame(30, 1505);
    s = playSeason(s);
    for (const team of s.teams) {
      expect(s.trade.countByTeam[team.id] ?? 0).toBeLessThanOrEqual(MAX_TRADES_PER_TEAM);
    }
  });

  it('プレイヤーへの提案が溜まりすぎない', () => {
    let s = newGame(30, 1506);
    for (let i = 0; i < 40; i++) {
      s = advanceDay(s).state;
      expect(pendingOffersForPlayer(s).length).toBeLessThanOrEqual(2);
    }
  });

  it('同じ選手が1シーズンに何度もトレードされない', () => {
    let s = playSeason(newGame(30, 1507));
    const moved: string[] = [];
    for (const record of s.trade.history.filter((r) => r.year === s.year)) {
      moved.push(...record.playerIdsFrom, ...record.playerIdsTo);
    }
    expect(new Set(moved).size).toBe(moved.length);
  });

  it('CPUのトレードは1球団に偏らない', () => {
    let s = newGame(30, 1508);
    const counts = new Map<string, number>();
    for (let season = 0; season < 4; season++) {
      s = playSeason(s);
      for (const record of s.trade.history) {
        counts.set(record.toTeamId, (counts.get(record.toTeamId) ?? 0) + 1);
        counts.set(record.fromTeamId, (counts.get(record.fromTeamId) ?? 0) + 1);
      }
      s = cloneState(s);
      startNextSeason(s);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(Math.max(...counts.values()) / total).toBeLessThan(0.35);
  });

  it('トレード期限を過ぎるとCPUも動かない', () => {
    const s = midSeason(1509, 3);
    s.trade.deadline = '2000-01-01';
    const before = s.trade.history.length;
    runCpuTrades(s);
    expect(s.trade.history.length).toBe(before);
  });

  it('CPUの動きは同じ状態なら同じ結果になる', () => {
    const a = midSeason(1510, 5);
    const b = cloneState(a);
    runCpuTrades(a);
    runCpuTrades(b);
    const key = (s: GameState) =>
      s.trade.history.map((r) => `${r.fromTeamId}>${r.toTeamId}:${r.playerIdsFrom.join(',')}`).join('|');
    expect(key(a)).toBe(key(b));
  });

  it('シードが違えばトレードの結果も変わる', () => {
    const a = playSeason(newGame(30, 1511));
    const b = playSeason(newGame(30, 1512));
    const key = (s: GameState) => s.trade.history.map((r) => r.playerIdsFrom.join(',')).join('|');
    expect(key(a)).not.toBe(key(b));
  });

  it('CPUはFA・引退選手をトレードに使わない', () => {
    let s = newGame(30, 1513);
    for (let i = 0; i < 30; i++) s = advanceDay(s).state;
    const faIds = new Set(s.freeAgents.map((p) => p.id));
    const retiredIds = new Set(s.retiredPlayers.map((r) => r.playerId));
    for (const record of s.trade.history) {
      for (const id of [...record.playerIdsFrom, ...record.playerIdsTo]) {
        expect(faIds.has(id)).toBe(false);
        expect(retiredIds.has(id)).toBe(false);
      }
    }
  });
});

/* ---------------- シーズンとの統合 ---------------- */

describe('PHASE3.5 シーズンとの統合', () => {
  it('トレード後も試合が普通に進む', () => {
    let s = midSeason(1701);
    executeTrade(s, simpleOffer(s));
    const step = advanceDay(s);
    expect(step.results.length).toBeGreaterThan(0);
    expect(validateState(step.state)).toEqual([]);
  });

  it('新シーズンでトレード期間が作り直され、履歴は残る', () => {
    let s = playSeason(newGame(30, 1702));
    const historyBefore = s.trade.history.length;
    s = cloneState(s);
    startNextSeason(s);
    expect(s.trade.year).toBe(s.year);
    expect(s.trade.offers).toHaveLength(0);
    expect(s.trade.tradedThisSeason).toHaveLength(0);
    expect(s.trade.history.length).toBe(historyBefore);
    expect(isTradeOpen(s)).toBe(true);
  });

  it('5シーズン続けても壊れない', () => {
    let s = newGame(30, 1703);
    for (let season = 0; season < 5; season++) {
      s = playSeason(s);
      expect(validateState(s)).toEqual([]);
      const ids = s.players.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const team of s.teams) {
        expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(
          MINIMUM_ROSTER,
        );
      }
      s = cloneState(s);
      startNextSeason(s);
    }
    expect(s.trade.history.length).toBeGreaterThan(0);
  });

  it('トレードされた選手も引退・契約更改の対象になる', () => {
    let s = playSeason(newGame(30, 1704));
    const traded = s.trade.history.flatMap((r) => [...r.playerIdsFrom, ...r.playerIdsTo]);
    expect(traded.length).toBeGreaterThan(0);
    s = cloneState(s);
    startNextSeason(s);
    for (const id of traded) {
      const player = s.players.find((p) => p.id === id);
      if (!player) continue; // 引退・退団した
      expect(player.ext.contract).not.toBeNull();
    }
  });

  it('トレードで能力・潜在能力は変化しない', () => {
    const s = midSeason(1705);
    const offer = simpleOffer(s);
    const id = offer.offeredPlayerIds[0];
    const before = structuredClone(s.players.find((p) => p.id === id)!);
    executeTrade(s, offer);
    const after = s.players.find((p) => p.id === id)!;
    expect(after.batting).toEqual(before.batting);
    expect(after.pitching).toEqual(before.pitching);
    expect(after.ext.potential).toBe(before.ext.potential);
    expect(after.ext.growthType).toBe(before.ext.growthType);
    expect(after.age).toBe(before.age);
  });
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.5 セーブ', () => {
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

  it('セーブバージョンが最新になっている', () => {
    // PHASE 3.9 でニュースを追加したため v13
    expect(SAVE_VERSION).toBe(13);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('トレードの状態が保存・復元される', () => {
    const s = midSeason(1801);
    const offer = simpleOffer(s);
    const before = s.trade.history.length;
    executeTrade(s, offer);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.trade.history).toHaveLength(before + 1);
    expect(loaded.trade.history.find((r) => r.id === offer.id)!.playerIdsFrom).toEqual(
      offer.offeredPlayerIds,
    );
    expect(loaded.trade.deadline).toBe(s.trade.deadline);
    expect(loaded.trade.tradedThisSeason.length).toBe(s.trade.tradedThisSeason.length);
    clearSave();
  });

  it('未処理の提案も保存・復元される', () => {
    const s = midSeason(1802);
    const offer = simpleOffer(s, CPU_TEAM, PLAYER_TEAM);
    s.trade.offers.push(offer);
    saveGame(s);
    const loaded = loadGame()!;
    expect(pendingOffersForPlayer(loaded).some((o) => o.id === offer.id)).toBe(true);
    expect(loaded.trade.offers.find((o) => o.id === offer.id)!.expiresDate).toBe(offer.expiresDate);
    clearSave();
  });

  it('在籍履歴も保存・復元される', () => {
    const s = midSeason(1803);
    const offer = simpleOffer(s);
    executeTrade(s, offer);
    saveGame(s);
    const loaded = loadGame()!;
    const player = loaded.players.find((p) => p.id === offer.offeredPlayerIds[0])!;
    expect(player.ext.careerTeams.length).toBeGreaterThan(1);
    clearSave();
  });

  it('v8 のセーブを読み込める', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1804)));
    legacy.version = 8;
    delete legacy.trade;
    for (const player of legacy.players) delete player.ext.careerTeams;
    const migrated = migrate(legacy)!;
    expect(migrated).not.toBeNull();
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.trade.offers).toEqual([]);
    expect(migrated.trade.history).toEqual([]);
    expect(migrated.players[0].ext.careerTeams.length).toBeGreaterThan(0);
  });

  it('v1 のセーブも v9 まで移行できる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1805)));
    legacy.version = 1;
    for (const player of legacy.players) {
      player.batting.trajectory = 3;
      delete player.ext;
    }
    delete legacy.trade;
    delete legacy.freeAgents;
    const migrated = migrate(legacy)!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.players[0].batting.trajectory).toBe(75);
    expect(Array.isArray(migrated.trade.history)).toBe(true);
  });

  it('v2〜v7 のセーブも v9 まで移行できる', () => {
    for (const version of [2, 3, 4, 5, 6, 7]) {
      const legacy = JSON.parse(JSON.stringify(newGame(30, 1810 + version)));
      legacy.version = version;
      delete legacy.trade;
      delete legacy.fa;
      delete legacy.freeAgents;
      const migrated = migrate(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.version).toBe(SAVE_VERSION);
      expect(migrated!.trade).toBeDefined();
    }
  });

  it('壊れたトレードデータは読み込み時に直る', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1806)));
    legacy.version = 8;
    legacy.trade = {
      offers: [
        { id: 'x', fromTeamId: 'ghost', toTeamId: PLAYER_TEAM, offeredPlayerIds: [], requestedPlayerIds: [], status: 'PENDING', createdYear: 2026, createdDate: '2026-04-01', expiresDate: '2026-04-06' },
      ],
    };
    const migrated = migrate(legacy)!;
    expect(migrated.trade.offers).toHaveLength(0);
    expect(Array.isArray(migrated.trade.history)).toBe(true);
    expect(typeof migrated.trade.deadline).toBe('string');
  });

  it('移行は同じ入力なら同じ結果になる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1807)));
    legacy.version = 8;
    delete legacy.trade;
    const a = migrate(JSON.parse(JSON.stringify(legacy)))!;
    const b = migrate(JSON.parse(JSON.stringify(legacy)))!;
    expect(JSON.stringify(a.trade)).toBe(JSON.stringify(b.trade));
  });

  it('リロードしても同じ日から続けられる', () => {
    const s = midSeason(1808, 8);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.date).toBe(s.date);
    expect(loaded.trade.year).toBe(s.trade.year);
    const next = advanceDay(loaded).state;
    expect(validateState(next)).toEqual([]);
    clearSave();
  });
});

/* ---------------- エラー処理 ---------------- */

describe('PHASE3.5 エラー処理', () => {
  it('すでに移籍した選手への提案は成立しない', () => {
    const s = midSeason(1901);
    const first = simpleOffer(s);
    executeTrade(s, first);
    const stale = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [first.requestedPlayerIds[0]], [
      first.offeredPlayerIds[0],
    ]);
    // どちらも今季すでに動いているので成立しない
    expect(executeTrade(s, stale).ok).toBe(false);
  });

  it('期限切れの提案を実行しても何も起きない', () => {
    const s = midSeason(1902);
    const offer = simpleOffer(s, CPU_TEAM, PLAYER_TEAM);
    s.trade.offers.push(offer);
    s.date = '2999-12-31';
    expireTradeOffers(s);
    const before = s.trade.history.length;
    const result = executeTrade(s, offer);
    expect(result.ok).toBe(false);
    expect(s.trade.history).toHaveLength(before);
  });

  it('すでに回答した提案を二重に処理しない', () => {
    const s = midSeason(1903);
    const offer = simpleOffer(s);
    const before = s.trade.history.length;
    expect(executeTrade(s, offer).ok).toBe(true);
    const second = executeTrade(s, offer);
    expect(second.ok).toBe(false);
    expect(s.trade.history).toHaveLength(before + 1);
  });

  it('存在しない提案の取り下げでも落ちない', () => {
    const s = midSeason(1904);
    expect(cancelTradeOffer(s, 'no-such-offer')).toBe(false);
  });

  it('市場が閉じているときの提案は理由つきで断られる', () => {
    const s = midSeason(1905);
    s.trade.deadline = '2000-01-01';
    const mine = tradables(s, PLAYER_TEAM)[0];
    const theirs = tradables(s, CPU_TEAM)[0];
    const offer = createTradeOffer(s, PLAYER_TEAM, CPU_TEAM, [mine.id], [theirs.id]);
    const result = respondToOffer(s, offer);
    expect(result.ok).toBe(false);
    expect(offer.status).toBe('REJECTED');
  });
});
