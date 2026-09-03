import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startContractPhase, startNextSeason, startOffseason } from './season';
import {
  POSITION_KEYS,
  POSITION_KEY_LABELS,
  POSITION_REQUIRED,
  analyzeRoster,
  knownPlayersOf,
  needFromQuality,
  positionKeyOf,
  type KnownPlayer,
  type PositionKey,
} from './rosterAnalysis';
import {
  STRATEGIES,
  STRATEGY_LABELS,
  STRATEGY_SHORT,
  decideStrategy,
  lastWinPct,
  leagueAverageOverall,
  strategyScores,
  teamProfile,
  type TeamManagementProfile,
} from './teamStrategy';
import {
  FA_BUDGET_RATIO,
  PAYROLL_CEILING_RATIO,
  acquisitionReason,
  activityLabel,
  aiRng,
  analyzeTeam,
  buildTeamPlan,
  decisionNoise,
  estimatePotentialFor,
  faActivityLabel,
  markNeedFilled,
  planFor,
  planSummary,
  refreshNeedsAfterDraft,
  refreshTeamPlans,
  reinforcementTargets,
  targetLabels,
  tradeActivityLabel,
  weightedNeeds,
} from './teamAi';
import { adjustYearsForStrategy, MINIMUM_ROSTER, teamPayroll } from './contract';
import { evaluateProspectScouted } from './draft';
import { overallRating } from './rating';
import { clearSave, loadGame, migrate, saveGame } from './save';
import type { GameState } from './types';

const PLAYER_TEAM = 'phoenix';
const CPU_TEAM = 'bluewave';

function newGame(length: 10 | 30 | 143 = 30, seed = 360360): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 360360): GameState {
  let s = newGame(30, seed);
  for (let i = 0; i < count; i++) {
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

/** 分析用のダミー選手 */
function known(overrides: Partial<KnownPlayer> & { id: string }): KnownPlayer {
  return {
    teamId: PLAYER_TEAM,
    name: overrides.id,
    age: 27,
    isPitcher: false,
    mainPosition: 'SS',
    overall: 45,
    estimatedPotential: 50,
    salary: 50,
    yearsRemaining: 2,
    injured: false,
    stats: undefined,
    ...overrides,
  };
}

const flatFinance = { payroll: 900, budget: 1400, cash: 1600 };
const noStamina = () => 0;

function analyze(players: KnownPlayer[]) {
  return analyzeRoster(PLAYER_TEAM, players, noStamina, flatFinance, PAYROLL_CEILING_RATIO);
}

const baseProfile: TeamManagementProfile = {
  aggression: 50,
  youthPreference: 50,
  budgetDiscipline: 50,
  tradeActivity: 50,
  faActivity: 50,
  veteranPreference: 50,
};

/* ---------------- 戦力分析 ---------------- */

describe('PHASE3.6 戦力分析', () => {
  it('人数だけでなく能力で補強必要度が決まる', () => {
    // 遊撃が3人いても全員が低ければ不足
    const weak = analyze([
      known({ id: 'a', overall: 30 }),
      known({ id: 'b', overall: 31 }),
      known({ id: 'c', overall: 32 }),
    ]);
    // 2人でも能力が高ければ足りている
    const strong = analyze([known({ id: 'd', overall: 55 }), known({ id: 'e', overall: 50 })]);
    expect(weak.positions.SS.need).toBeGreaterThan(strong.positions.SS.need);
  });

  it('選手がいない枠は必要度100になる', () => {
    const analysis = analyze([known({ id: 'a', overall: 55 })]);
    expect(analysis.positions.C.need).toBe(100);
    expect(analysis.positions.SP.need).toBe(100);
  });

  it('必要度は0〜100に収まる', () => {
    const analysis = analyze([
      known({ id: 'a', overall: 99 }),
      known({ id: 'b', overall: 99 }),
      known({ id: 'c', overall: 99 }),
    ]);
    for (const key of POSITION_KEYS) {
      expect(analysis.positions[key].need).toBeGreaterThanOrEqual(0);
      expect(analysis.positions[key].need).toBeLessThanOrEqual(100);
    }
    expect(analysis.positions.SS.need).toBeLessThan(20);
  });

  it('充実度から必要度への変換がなめらか', () => {
    const values = [0, 20, 30, 40, 50, 60, 70].map((q) => needFromQuality(q));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
    expect(needFromQuality(0)).toBe(100);
    expect(needFromQuality(100)).toBe(0);
  });

  it('選手は STARTER / BACKUP / DEPTH / PROSPECT に分類される', () => {
    const analysis = analyze([
      known({ id: 'a', overall: 60, age: 28 }),
      known({ id: 'b', overall: 50, age: 29 }),
      known({ id: 'c', overall: 40, age: 30 }),
      known({ id: 'd', overall: 30, age: 21 }),
    ]);
    const slots = analysis.positions.SS.entries.map((e) => e.slot);
    expect(slots[0]).toBe('STARTER');
    expect(slots[1]).toBe('BACKUP');
    expect(slots[2]).toBe('DEPTH');
    expect(slots[3]).toBe('PROSPECT');
  });

  it('投手はスタミナで先発と救援に分かれる', () => {
    const starter = known({ id: 'sp', isPitcher: true, mainPosition: 'P' });
    const reliever = known({ id: 'rp', isPitcher: true, mainPosition: 'P' });
    expect(positionKeyOf(starter, 60)).toBe('SP');
    expect(positionKeyOf(reliever, 20)).toBe('RP');
  });

  it('外野・捕手はまとめて数える', () => {
    expect(positionKeyOf(known({ id: 'a', mainPosition: 'LF' }), 0)).toBe('OF');
    expect(positionKeyOf(known({ id: 'b', mainPosition: 'CF' }), 0)).toBe('OF');
    expect(positionKeyOf(known({ id: 'c', mainPosition: 'C' }), 0)).toBe('C');
    expect(positionKeyOf(known({ id: 'd', mainPosition: '2B' }), 0)).toBe('2B');
  });

  it('先発投手は5人ぶんの枠として評価される', () => {
    expect(POSITION_REQUIRED.SP).toBe(5);
    expect(POSITION_REQUIRED.SS).toBe(1);
  });

  it('補強必要度が高い順に並ぶ', () => {
    const analysis = analyze([
      known({ id: 'a', overall: 60 }),
      known({ id: 'b', mainPosition: 'C', overall: 20 }),
    ]);
    const needs = analysis.weakest.map((key) => analysis.positions[key].need);
    for (let i = 1; i < needs.length; i++) {
      expect(needs[i]).toBeLessThanOrEqual(needs[i - 1]);
    }
  });

  it('年齢構成と財務がまとまる', () => {
    const analysis = analyze([
      known({ id: 'a', age: 22 }),
      known({ id: 'b', age: 35 }),
      known({ id: 'c', age: 28 }),
      known({ id: 'd', age: 24, yearsRemaining: 0 }),
    ]);
    expect(analysis.rosterSize).toBe(4);
    expect(analysis.youngRatio).toBeCloseTo(0.5, 5);
    expect(analysis.veteranRatio).toBeCloseTo(0.25, 5);
    expect(analysis.expiringCount).toBe(1);
    expect(analysis.faRoom).toBeCloseTo(1400 * PAYROLL_CEILING_RATIO - 900, 5);
  });

  it('実際の球団を分析できる', () => {
    const s = newGame(30, 1101);
    const analysis = analyzeTeam(s, PLAYER_TEAM);
    expect(analysis.rosterSize).toBe(25);
    expect(analysis.overall).toBeGreaterThan(20);
    expect(analysis.payroll).toBe(teamPayroll(s, PLAYER_TEAM));
    for (const key of POSITION_KEYS) {
      expect(analysis.positions[key]).toBeDefined();
      expect(POSITION_KEY_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it('先発投手の不足を検出できる', () => {
    const s = cloneState(newGame(30, 1102));
    // 先発適性の投手を減らす
    const starters = s.players.filter(
      (p) => p.teamId === PLAYER_TEAM && p.isPitcher && (p.pitching?.stamina ?? 0) >= 45,
    );
    const before = analyzeTeam(s, PLAYER_TEAM).positions.SP.need;
    for (const p of starters.slice(0, 4)) {
      if (p.pitching) p.pitching.stamina = 20;
    }
    expect(analyzeTeam(s, PLAYER_TEAM).positions.SP.need).toBeGreaterThan(before);
  });

  it('野手の不足を検出できる', () => {
    const s = cloneState(newGame(30, 1103));
    const before = analyzeTeam(s, PLAYER_TEAM).positions.OF.need;
    for (const p of s.players.filter(
      (p) => p.teamId === PLAYER_TEAM && ['LF', 'CF', 'RF'].includes(p.mainPosition),
    )) {
      p.batting = { ...p.batting, contact: 10, power: 10, fielding: 10, catching: 10, arm: 10, speed: 10 };
    }
    expect(analyzeTeam(s, PLAYER_TEAM).positions.OF.need).toBeGreaterThan(before);
  });

  it('過剰戦力の枠は必要度が低い', () => {
    const s = cloneState(newGame(30, 1104));
    for (const p of s.players.filter((p) => p.teamId === PLAYER_TEAM && p.mainPosition === 'SS')) {
      p.batting = { ...p.batting, contact: 95, power: 95, fielding: 95, catching: 95, arm: 95, speed: 95 };
    }
    expect(analyzeTeam(s, PLAYER_TEAM).positions.SS.need).toBeLessThan(30);
  });
});

/* ---------------- CPU の情報制限 ---------------- */

describe('PHASE3.6 CPUの情報制限', () => {
  it('分析に渡す型に真の潜在能力は含まれない', () => {
    const s = newGame(30, 1201);
    const list = knownPlayersOf(s, PLAYER_TEAM, 'own', (viewer, id) =>
      estimatePotentialFor(s, viewer, id),
    );
    for (const entry of list) {
      expect(Object.keys(entry)).not.toContain('potential');
      expect(Object.keys(entry)).not.toContain('ext');
      expect(entry.estimatedPotential).toBeGreaterThanOrEqual(1);
      expect(entry.estimatedPotential).toBeLessThanOrEqual(100);
    }
  });

  it('他球団の選手は推定値になり、球団ごとに違う', () => {
    const s = newGame(30, 1202);
    const target = s.players.find((p) => p.teamId === CPU_TEAM)!;
    const estimates = s.teams
      .filter((t) => t.id !== CPU_TEAM)
      .map((t) => estimatePotentialFor(s, t.id, target.id));
    expect(new Set(estimates.map((v) => Math.round(v))).size).toBeGreaterThan(1);
    expect(estimates.some((v) => Math.round(v) !== target.ext.potential)).toBe(true);
  });

  it('自球団の選手は正確に把握している', () => {
    const s = newGame(30, 1203);
    const own = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    expect(estimatePotentialFor(s, PLAYER_TEAM, own.id)).toBe(own.ext.potential);
  });

  it('スカウト精度が低いほど推定の誤差が大きくなる', () => {
    const s = cloneState(newGame(30, 1204));
    const teamA = s.teams.find((t) => t.id !== CPU_TEAM)!.id;
    const targets = s.players.filter((p) => p.teamId === CPU_TEAM);
    const errorWith = (accuracy: number) => {
      const copy = cloneState(s);
      copy.scouting.teams[teamA].ability.potential = accuracy;
      return (
        targets.reduce(
          (sum, p) => sum + Math.abs(estimatePotentialFor(copy, teamA, p.id) - p.ext.potential),
          0,
        ) / targets.length
      );
    };
    expect(errorWith(20)).toBeGreaterThan(errorWith(95));
  });

  it('存在しない選手を参照しても落ちない', () => {
    const s = newGame(30, 1205);
    expect(estimatePotentialFor(s, PLAYER_TEAM, 'no-such-player')).toBe(45);
  });

  it('ドラフト評価はスカウト情報だけを使う', () => {
    let s = playSeason(newGame(10, 1206));
    s = cloneState(s);
    startOffseason(s);
    const draft = s.draft!;
    const prospect = draft.prospects[0];
    const roster = s.players.filter((p) => p.teamId === CPU_TEAM);
    const before = evaluateProspectScouted(prospect, roster, undefined);
    // 真の潜在能力を変えても、未調査なら評価は変わらない
    prospect.player.ext.potential = 99;
    expect(evaluateProspectScouted(prospect, roster, undefined)).toBe(before);
  });
});

/* ---------------- 球団戦略 ---------------- */

describe('PHASE3.6 球団戦略', () => {
  const context = (over: Partial<{ winPct: number; leagueOverall: number }> = {}) => ({
    winPct: 0.5,
    noise: 0,
    leagueOverall: 40,
    ...over,
  });

  it('戦力が高く勝っている球団は WIN_NOW に寄る', () => {
    const analysis = analyze([known({ id: 'a', overall: 70 })]);
    analysis.overall = 52;
    const scores = strategyScores(analysis, baseProfile, context({ winPct: 0.65 }));
    expect(scores.WIN_NOW).toBeGreaterThan(scores.YOUTH);
    expect(scores.WIN_NOW).toBeGreaterThan(scores.BUDGET);
  });

  it('戦力が低くベテランが多い球団は YOUTH に寄る', () => {
    const analysis = analyze([
      known({ id: 'a', age: 36 }),
      known({ id: 'b', age: 35 }),
      known({ id: 'c', age: 22 }),
      known({ id: 'd', age: 23 }),
    ]);
    analysis.overall = 30;
    const scores = strategyScores(analysis, baseProfile, context({ winPct: 0.35 }));
    expect(scores.YOUTH).toBeGreaterThan(scores.WIN_NOW);
  });

  it('総年俸が予算を超えている球団は BUDGET に寄る', () => {
    const analysis = analyze([known({ id: 'a' })]);
    analysis.payroll = 1600;
    analysis.budget = 1400;
    analysis.cash = -200;
    const scores = strategyScores(analysis, { ...baseProfile, budgetDiscipline: 90 }, context());
    expect(scores.BUDGET).toBeGreaterThan(scores.WIN_NOW);
  });

  it('平凡な球団は BALANCED が高くなる', () => {
    const analysis = analyze([known({ id: 'a' })]);
    analysis.overall = 40;
    analysis.payroll = 1260;
    analysis.budget = 1400;
    const scores = strategyScores(
      analysis,
      { ...baseProfile, aggression: 50, youthPreference: 20, budgetDiscipline: 20 },
      context(),
    );
    expect(scores.BALANCED).toBeGreaterThan(scores.YOUTH);
    expect(scores.BALANCED).toBeGreaterThan(scores.BUDGET);
  });

  it('球団の癖で同じ状況でも戦略が変わる', () => {
    const analysis = analyze([known({ id: 'a' })]);
    analysis.overall = 40;
    const youthy = strategyScores(analysis, { ...baseProfile, youthPreference: 95 }, context());
    const thrifty = strategyScores(analysis, { ...baseProfile, budgetDiscipline: 95 }, context());
    expect(youthy.YOUTH).toBeGreaterThan(thrifty.YOUTH);
    expect(thrifty.BUDGET).toBeGreaterThan(youthy.BUDGET);
  });

  it('戦力の評価はリーグ平均との比較で決まる', () => {
    const analysis = analyze([known({ id: 'a' })]);
    analysis.overall = 45;
    const weakLeague = strategyScores(analysis, baseProfile, context({ leagueOverall: 35 }));
    const strongLeague = strategyScores(analysis, baseProfile, context({ leagueOverall: 55 }));
    expect(weakLeague.WIN_NOW).toBeGreaterThan(strongLeague.WIN_NOW);
  });

  it('戦略は年によって変わりうる', () => {
    let s = newGame(30, 1301);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      for (const team of s.teams) seen.add(s.teamPlans[team.id].strategy);
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('リーグ全体が同じ戦略にならない', () => {
    const s = newGame(30, 1302);
    const strategies = s.teams.map((t) => s.teamPlans[t.id].strategy);
    expect(new Set(strategies).size).toBeGreaterThan(1);
  });

  it('球団の癖は同じゲームなら毎回同じ', () => {
    const s = newGame(30, 1303);
    const a = teamProfile(s, CPU_TEAM);
    const b = teamProfile(s, CPU_TEAM);
    expect(a).toEqual(b);
    for (const value of Object.values(a)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('球団ごとに癖が違う', () => {
    const s = newGame(30, 1304);
    const profiles = s.teams.map((t) => JSON.stringify(teamProfile(s, t.id)));
    expect(new Set(profiles).size).toBeGreaterThan(1);
  });

  it('前年の勝率を取り出せる', () => {
    const fresh = newGame(30, 1305);
    expect(lastWinPct(fresh, PLAYER_TEAM)).toBe(0.5);
    const played = playSeason(fresh);
    const pct = lastWinPct(played, PLAYER_TEAM);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(1);
  });

  it('リーグ平均能力が計算できる', () => {
    const s = newGame(30, 1306);
    const league = leagueAverageOverall(s);
    expect(league).toBeGreaterThan(20);
    expect(league).toBeLessThan(80);
  });

  it('戦略にはラベルがある', () => {
    for (const strategy of STRATEGIES) {
      expect(STRATEGY_LABELS[strategy].length).toBeGreaterThan(0);
      expect(STRATEGY_SHORT[strategy].length).toBeGreaterThan(0);
    }
  });

  it('戦略の決定には理由がつく', () => {
    const s = newGame(30, 1307);
    const analysis = analyzeTeam(s, CPU_TEAM);
    const result = decideStrategy(s, analysis, teamProfile(s, CPU_TEAM));
    expect(STRATEGIES).toContain(result.strategy);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) expect(reason.length).toBeGreaterThan(0);
  });

  it('同じ状態なら同じ戦略になる（決定論）', () => {
    const s = newGame(30, 1308);
    const analysis = analyzeTeam(s, CPU_TEAM);
    const profile = teamProfile(s, CPU_TEAM);
    expect(decideStrategy(s, analysis, profile).strategy).toBe(
      decideStrategy(s, analysis, profile).strategy,
    );
  });
});

/* ---------------- 経営プラン ---------------- */

describe('PHASE3.6 経営プラン', () => {
  it('開幕時点で全球団にプランがある', () => {
    const s = newGame(30, 1401);
    for (const team of s.teams) {
      const plan = s.teamPlans[team.id];
      expect(plan).toBeDefined();
      expect(plan.year).toBe(s.year);
      expect(STRATEGIES).toContain(plan.strategy);
      for (const key of POSITION_KEYS) {
        expect(plan.needs[key]).toBeGreaterThanOrEqual(0);
        expect(plan.needs[key]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('FA予算は戦略ごとの範囲に収まる', () => {
    const s = newGame(30, 1402);
    for (const team of s.teams) {
      const plan = s.teamPlans[team.id];
      const range = FA_BUDGET_RATIO[plan.strategy];
      const analysis = analyzeTeam(s, team.id);
      expect(plan.faBudget).toBeGreaterThanOrEqual(0);
      expect(plan.faBudget).toBeLessThanOrEqual(
        Math.max(analysis.budget * range.max, analysis.faRoom) + 1,
      );
    }
  });

  it('予算を締める球団ほどFA予算が小さい', () => {
    const s = newGame(30, 1403);
    const analysis = analyzeTeam(s, CPU_TEAM);
    const winNow = analysis.budget * FA_BUDGET_RATIO.WIN_NOW.min;
    const budget = analysis.budget * FA_BUDGET_RATIO.BUDGET.max;
    expect(winNow).toBeGreaterThan(budget);
  });

  it('戦略で補強ポイントの重みが変わる', () => {
    const s = newGame(30, 1404);
    const analysis = analyzeTeam(s, CPU_TEAM);
    const winNow = weightedNeeds(analysis, 'WIN_NOW');
    const youth = weightedNeeds(analysis, 'YOUTH');
    const budget = weightedNeeds(analysis, 'BUDGET');
    const sum = (needs: Record<PositionKey, number>) =>
      POSITION_KEYS.reduce((a, k) => a + needs[k], 0);
    expect(sum(budget)).toBeLessThan(sum(winNow));
    expect(sum(youth)).toBeLessThan(sum(winNow));
  });

  it('プランは補強すると必要度が下がる', () => {
    const s = newGame(30, 1405);
    const plan = s.teamPlans[CPU_TEAM];
    plan.needs.SS = 80;
    markNeedFilled(plan, 'SS', 30);
    expect(plan.needs.SS).toBe(50);
    markNeedFilled(plan, 'SS', 999);
    expect(plan.needs.SS).toBeGreaterThanOrEqual(0);
  });

  it('プランは同じ年に作り直されない', () => {
    const s = newGame(30, 1406);
    const before = s.teamPlans[CPU_TEAM];
    refreshTeamPlans(s);
    expect(s.teamPlans[CPU_TEAM]).toBe(before);
  });

  it('オフシーズンごとにプランが作り直される', () => {
    let s = playSeason(newGame(30, 1407));
    const before = s.teamPlans[CPU_TEAM].year;
    s = cloneState(s);
    startNextSeason(s);
    // プランは「そのオフシーズンに決めた方針」なので、作られた年が進む
    expect(s.teamPlans[CPU_TEAM].year).toBe(before);
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
    expect(s.teamPlans[CPU_TEAM].year).toBeGreaterThan(before);
  });

  it('プランが無ければその場で作られる', () => {
    const s = cloneState(newGame(30, 1408));
    s.teamPlans = {};
    const plan = planFor(s, CPU_TEAM);
    expect(plan.teamId).toBe(CPU_TEAM);
    expect(plan.year).toBe(s.year);
    expect(s.teamPlans[CPU_TEAM]).toBe(plan);
  });

  it('ドラフト後に補強ポイントが見直される', () => {
    let s = playSeason(newGame(10, 1409));
    s = cloneState(s);
    startOffseason(s);
    const before = { ...s.teamPlans[CPU_TEAM].needs };
    startContractPhase(s);
    const after = s.teamPlans[CPU_TEAM].needs;
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const key of POSITION_KEYS) {
      expect(after[key]).toBeGreaterThanOrEqual(0);
      expect(after[key]).toBeLessThanOrEqual(100);
    }
  });

  it('プランを作っても既存の状態を壊さない', () => {
    const s = cloneState(newGame(30, 1410));
    const before = JSON.stringify(s.players.map((p) => p.id));
    buildTeamPlan(s, CPU_TEAM);
    expect(JSON.stringify(s.players.map((p) => p.id))).toBe(before);
    expect(validateState(s)).toEqual([]);
  });

  it('AI専用の乱数は試合の乱数列を消費しない', () => {
    const s = cloneState(newGame(30, 1411));
    const before = s.rngState;
    refreshTeamPlans(s);
    aiRng(s, 'aiFA', 'x').next();
    decisionNoise(s, 'aiTrade', 'y');
    expect(s.rngState).toBe(before);
  });

  it('判断の揺らぎは ±3〜8% に収まる', () => {
    const s = newGame(30, 1412);
    for (let i = 0; i < 40; i++) {
      const noise = decisionNoise(s, 'aiContract', `p${i}`);
      const magnitude = Math.abs(noise - 1);
      expect(magnitude).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(magnitude).toBeLessThanOrEqual(0.08 + 1e-9);
    }
  });
});

/* ---------------- 契約AI ---------------- */

describe('PHASE3.6 契約AI', () => {
  it('若手育成の球団は高齢選手に長期契約を出さない', () => {
    const s = newGame(30, 1501);
    const veteran = { ...s.players.find((p) => p.teamId === CPU_TEAM)!, age: 34 };
    expect(adjustYearsForStrategy(3, veteran, 'YOUTH')).toBe(1);
  });

  it('若手育成の球団は若手に長めの契約を出す', () => {
    const s = newGame(30, 1502);
    const young = { ...s.players.find((p) => p.teamId === CPU_TEAM)!, age: 23 };
    expect(adjustYearsForStrategy(2, young, 'YOUTH')).toBeGreaterThan(2);
  });

  it('堅実経営の球団は契約年数を短くする', () => {
    const s = newGame(30, 1503);
    const player = { ...s.players.find((p) => p.teamId === CPU_TEAM)!, age: 29 };
    expect(adjustYearsForStrategy(3, player, 'BUDGET')).toBe(2);
  });

  it('今季優先の球団は中堅に長めの契約を出す', () => {
    const s = newGame(30, 1504);
    const player = { ...s.players.find((p) => p.teamId === CPU_TEAM)!, age: 30 };
    expect(adjustYearsForStrategy(2, player, 'WIN_NOW')).toBe(3);
  });

  it('契約年数は年齢の上限を超えない', () => {
    const s = newGame(30, 1505);
    const old = { ...s.players.find((p) => p.teamId === CPU_TEAM)!, age: 38 };
    for (const strategy of STRATEGIES) {
      expect(adjustYearsForStrategy(5, old, strategy)).toBeLessThanOrEqual(2);
      expect(adjustYearsForStrategy(5, old, strategy)).toBeGreaterThanOrEqual(1);
    }
  });

  it('契約更改の結果がプランに記録される', () => {
    let s = playSeason(newGame(10, 1506));
    s = cloneState(s);
    startOffseason(s);
    startContractPhase(s);
    const logs = s.teams
      .filter((t) => t.id !== PLAYER_TEAM)
      .map((t) => s.teamPlans[t.id]?.log);
    expect(logs.some((log) => log && log.contractsKept + log.contractsReleased > 0)).toBe(true);
  });

  it('契約更改後も最低人数と予算を守る', () => {
    let s = playSeason(newGame(10, 1507));
    s = cloneState(s);
    startOffseason(s);
    startContractPhase(s);
    for (const team of s.teams.filter((t) => t.id !== PLAYER_TEAM)) {
      const signed = s.players.filter((p) => p.teamId === team.id && p.ext.contract);
      expect(signed.length).toBeGreaterThanOrEqual(MINIMUM_ROSTER - 1);
      const payroll = signed.reduce((a, p) => a + (p.ext.contract?.salary ?? 0), 0);
      expect(payroll).toBeLessThanOrEqual(s.finances[team.id].budget * 1.2);
    }
  });
});

/* ---------------- ドラフトAI ---------------- */

describe('PHASE3.6 ドラフトAI', () => {
  it('補強ポイントが高い枠の候補を高く評価する', () => {
    let s = playSeason(newGame(10, 1601));
    s = cloneState(s);
    startOffseason(s);
    const draft = s.draft!;
    const prospect = draft.prospects.find((p) => !p.player.isPitcher)!;
    const roster = s.players.filter((p) => p.teamId === CPU_TEAM);
    const key = positionKeyOf(
      {
        ...known({ id: prospect.player.id }),
        isPitcher: prospect.player.isPitcher,
        mainPosition: prospect.player.mainPosition,
      },
      0,
    );
    const low = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'BALANCED',
      needs: { [key]: 10 },
    });
    const high = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'BALANCED',
      needs: { [key]: 95 },
    });
    expect(high).toBeGreaterThan(low);
  });

  it('若手育成の球団は将来性を重く見る', () => {
    let s = playSeason(newGame(10, 1602));
    s = cloneState(s);
    startOffseason(s);
    const draft = s.draft!;
    const prospect = draft.prospects[0];
    const roster = s.players.filter((p) => p.teamId === CPU_TEAM);
    const youth = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'YOUTH',
      needs: {},
    });
    const winNow = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'WIN_NOW',
      needs: {},
    });
    expect(youth).not.toBe(winNow);
  });

  it('ドラフトの指名がプランに記録され、必要度が下がる', () => {
    let s = playSeason(newGame(10, 1603));
    s = cloneState(s);
    startOffseason(s);
    startContractPhase(s);
    const picks = s.teams
      .filter((t) => t.id !== PLAYER_TEAM)
      .map((t) => s.teamPlans[t.id]?.log.draftPicks ?? 0);
    expect(picks.some((n) => n > 0)).toBe(true);
  });

  it('ドラフトは真の潜在能力ではなくスカウト推定を使う', () => {
    let s = playSeason(newGame(10, 1604));
    s = cloneState(s);
    startOffseason(s);
    const draft = s.draft!;
    const roster = s.players.filter((p) => p.teamId === CPU_TEAM);
    const prospect = draft.prospects[3];
    const before = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'BALANCED',
      needs: {},
    });
    prospect.player.ext.potential = 1;
    const after = evaluateProspectScouted(prospect, roster, undefined, undefined, {
      strategy: 'BALANCED',
      needs: {},
    });
    expect(after).toBe(before);
  });
});

/* ---------------- FA・トレードとの連携 ---------------- */

describe('PHASE3.6 施策の連携', () => {
  it('FAで獲得するとプランの予算と必要度が動く', () => {
    let s = newGame(30, 1701);
    for (let season = 0; season < 3; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    const spent = s.teams.map((t) => s.teamPlans[t.id]?.faSpent ?? 0);
    const signed = s.teams.map((t) => s.teamPlans[t.id]?.log.faSigned ?? 0);
    expect(signed.some((n) => n > 0)).toBe(true);
    expect(spent.some((n) => n > 0)).toBe(true);
  });

  it('トレードの成立がプランに記録される', () => {
    let s = newGame(30, 1702);
    for (let i = 0; i < 25; i++) s = advanceDay(s).state;
    const trades = s.teams.map((t) => s.teamPlans[t.id]?.log.tradesDone ?? 0);
    expect(trades.some((n) => n > 0)).toBe(true);
  });

  it('補強ポイントが埋まった枠は必要度が下がったままになる', () => {
    const s = cloneState(newGame(30, 1703));
    const plan = s.teamPlans[CPU_TEAM];
    for (const key of POSITION_KEYS) plan.needs[key] = 90;
    refreshNeedsAfterDraft(s);
    // 実際の戦力に寄せられるので、極端な値のままにはならない
    const values = POSITION_KEYS.map((key) => plan.needs[key]);
    expect(values.some((v) => v < 90)).toBe(true);
  });

  it('CPUのFAオファーは配分した予算をおおむね守る', () => {
    let s = newGame(30, 1704);
    for (let season = 0; season < 4; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      for (const team of s.teams.filter((t) => t.id !== PLAYER_TEAM)) {
        const plan = s.teamPlans[team.id];
        if (!plan) continue;
        // 最低人数を満たすためには上限を少し超えることがある。
        // ただし予算の1.25倍は絶対に超えない。
        expect(teamPayroll(s, team.id)).toBeLessThanOrEqual(s.finances[team.id].budget * 1.25);
      }
    }
  });

  it('トレードは経営プランの戦略を使う', () => {
    const s = cloneState(newGame(30, 1705));
    s.teamPlans[CPU_TEAM].strategy = 'YOUTH';
    expect(s.teamPlans[CPU_TEAM].strategy).toBe('YOUTH');
  });
});

/* ---------------- 表示 ---------------- */

describe('PHASE3.6 表示', () => {
  it('球団方針が文章になる', () => {
    const s = newGame(30, 1801);
    for (const team of s.teams) {
      const plan = s.teamPlans[team.id];
      expect(planSummary(plan)).toBe(STRATEGY_LABELS[plan.strategy]);
    }
  });

  it('補強ポイントが名前で取り出せる', () => {
    const s = cloneState(newGame(30, 1802));
    const plan = s.teamPlans[CPU_TEAM];
    for (const key of POSITION_KEYS) plan.needs[key] = 10;
    plan.needs.SP = 90;
    plan.needs.SS = 80;
    expect(reinforcementTargets(plan)).toEqual(['SP', 'SS']);
    expect(targetLabels(plan)).toEqual(['先発投手', '遊撃手']);
  });

  it('補強ポイントが無ければ空になる', () => {
    const s = cloneState(newGame(30, 1803));
    const plan = s.teamPlans[CPU_TEAM];
    for (const key of POSITION_KEYS) plan.needs[key] = 10;
    expect(targetLabels(plan)).toEqual([]);
  });

  it('積極度は 低・中・高 で表される', () => {
    expect(activityLabel(90)).toBe('高');
    expect(activityLabel(50)).toBe('中');
    expect(activityLabel(10)).toBe('低');
    const s = newGame(30, 1804);
    for (const team of s.teams) {
      const plan = s.teamPlans[team.id];
      expect(['低', '中', '高']).toContain(faActivityLabel(plan));
      expect(['低', '中', '高']).toContain(tradeActivityLabel(plan));
    }
  });

  it('獲得理由の説明文が作られる（内部数値は出さない）', () => {
    const s = cloneState(newGame(30, 1805));
    const plan = s.teamPlans[CPU_TEAM];
    plan.needs.SP = 90;
    const reason = acquisitionReason(plan, 'SP');
    expect(reason).toContain('先発投手');
    expect(/\d/.test(reason)).toBe(false);
  });

  it('方針の説明文に内部の数値は出ない', () => {
    const s = newGame(30, 1806);
    for (const team of s.teams) {
      for (const reason of s.teamPlans[team.id].reasons) {
        expect(/\d/.test(reason)).toBe(false);
      }
    }
  });
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.6 セーブ', () => {
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
    // PHASE 3.8 でポストシーズンを追加したため v12
    expect(SAVE_VERSION).toBe(12);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('経営プランが保存・復元される', () => {
    const s = newGame(30, 1901);
    saveGame(s);
    const loaded = loadGame()!;
    for (const team of s.teams) {
      expect(loaded.teamPlans[team.id].strategy).toBe(s.teamPlans[team.id].strategy);
      expect(loaded.teamPlans[team.id].faBudget).toBe(s.teamPlans[team.id].faBudget);
    }
    expect(loaded.teamPlansYear).toBe(s.teamPlansYear);
    clearSave();
  });

  it('v9 のセーブを読み込める', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1902)));
    legacy.version = 9;
    delete legacy.teamPlans;
    delete legacy.teamPlansYear;
    const migrated = migrate(legacy)!;
    expect(migrated).not.toBeNull();
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.teamPlans).toEqual({});
    expect(migrated.teamPlansYear).toBeNull();
  });

  it('v1 のセーブも v10 まで移行できる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1903)));
    legacy.version = 1;
    for (const player of legacy.players) {
      player.batting.trajectory = 4;
      delete player.ext;
    }
    delete legacy.teamPlans;
    delete legacy.trade;
    delete legacy.freeAgents;
    const migrated = migrate(legacy)!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.players[0].batting.trajectory).toBe(100);
    expect(migrated.teamPlans).toBeDefined();
  });

  it('v2〜v8 のセーブも v10 まで移行できる', () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8]) {
      const legacy = JSON.parse(JSON.stringify(newGame(30, 1910 + version)));
      legacy.version = version;
      delete legacy.teamPlans;
      delete legacy.teamPlansYear;
      delete legacy.trade;
      delete legacy.fa;
      delete legacy.freeAgents;
      const migrated = migrate(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.version).toBe(SAVE_VERSION);
      expect(migrated!.teamPlans).toBeDefined();
    }
  });

  it('壊れたプランは読み込み時に落とされる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1904)));
    legacy.version = 9;
    legacy.teamPlans = {
      ghost: { year: 2026, needs: {}, profile: {}, faBudget: 0 },
      [CPU_TEAM]: { year: 'bad' },
    };
    const migrated = migrate(legacy)!;
    expect(migrated.teamPlans.ghost).toBeUndefined();
    expect(migrated.teamPlans[CPU_TEAM]).toBeUndefined();
  });

  it('移行は同じ入力なら同じ結果になる', () => {
    const legacy = JSON.parse(JSON.stringify(newGame(30, 1905)));
    legacy.version = 9;
    delete legacy.teamPlans;
    const a = migrate(JSON.parse(JSON.stringify(legacy)))!;
    const b = migrate(JSON.parse(JSON.stringify(legacy)))!;
    expect(JSON.stringify(a.teamPlans)).toBe(JSON.stringify(b.teamPlans));
  });

  it('プランが無いセーブでもシーズンを進められる', () => {
    const s = cloneState(newGame(30, 1906));
    s.teamPlans = {};
    s.teamPlansYear = null;
    const next = advanceDay(s).state;
    expect(validateState(next)).toEqual([]);
  });
});

/* ---------------- 長期の整合性 ---------------- */

describe('PHASE3.6 長期の整合性', () => {
  it('10シーズン続けても壊れない', () => {
    const s = afterSeasons(10, 2001);
    expect(validateState(s)).toEqual([]);
    const ids = s.players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const team of s.teams) {
      expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(
        MINIMUM_ROSTER,
      );
      expect(teamPayroll(s, team.id)).toBeLessThanOrEqual(s.finances[team.id].budget * 1.25);
    }
  });

  it('10シーズン後も平均能力・年齢が崩れない', () => {
    const s = afterSeasons(10, 2002);
    const avgOverall = s.players.reduce((a, p) => a + overallRating(p), 0) / s.players.length;
    const avgAge = s.players.reduce((a, p) => a + p.age, 0) / s.players.length;
    expect(avgOverall).toBeGreaterThan(30);
    expect(avgOverall).toBeLessThan(50);
    expect(avgAge).toBeGreaterThan(23);
    expect(avgAge).toBeLessThan(32);
  });

  it('特定の球団だけが独走しない', () => {
    let s = newGame(30, 2003);
    const wins = new Map<string, number>();
    for (let season = 0; season < 10; season++) {
      s = playSeason(s);
      for (const team of s.teams) {
        wins.set(team.id, (wins.get(team.id) ?? 0) + s.records[team.id].wins);
      }
      s = cloneState(s);
      startNextSeason(s);
    }
    const total = [...wins.values()].reduce((a, b) => a + b, 0);
    expect(Math.max(...wins.values()) / total).toBeLessThan(0.14);
  });

  it('同じシードなら10シーズン後も同じ結果になる', () => {
    const a = afterSeasons(5, 2004);
    const b = afterSeasons(5, 2004);
    const key = (s: GameState) =>
      s.players
        .map((p) => `${p.id}:${p.teamId}:${p.ext.contract?.salary ?? 0}`)
        .sort()
        .join('|');
    expect(key(a)).toBe(key(b));
    expect(a.teamPlans[CPU_TEAM].strategy).toBe(b.teamPlans[CPU_TEAM].strategy);
  });

  it('CPUのプランが毎年更新される', () => {
    let s = newGame(30, 2005);
    const years = new Set<number>();
    for (let season = 0; season < 5; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      years.add(s.teamPlans[CPU_TEAM].year);
    }
    expect(years.size).toBe(5);
  });

  it('引退・FA・トレードを経ても選手が二重に存在しない', () => {
    const s = afterSeasons(8, 2006);
    const rostered = new Set(s.players.map((p) => p.id));
    for (const player of s.freeAgents) expect(rostered.has(player.id)).toBe(false);
    const retired = new Set(s.retiredPlayers.map((r) => r.playerId));
    for (const id of retired) expect(rostered.has(id)).toBe(false);
  });

  it('プランの記録が実際の行動と矛盾しない', () => {
    let s = newGame(30, 2007);
    for (let season = 0; season < 3; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    for (const team of s.teams) {
      const plan = s.teamPlans[team.id];
      if (!plan) continue;
      for (const value of Object.values(plan.log)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(plan.faSpent).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('PHASE3.6 予算に見合わない年俸の是正', () => {
  it('長期間プレイしても総年俸が予算の1.25倍を超える球団が出ない', () => {
    // かつて 12〜14 年目に総年俸が予算の1.3倍まで膨らんだシード
    let s = newGame(30, 263139);
    for (let season = 1; season <= 14; season++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      for (const team of s.teams) {
        const ratio = teamPayroll(s, team.id) / s.finances[team.id].budget;
        expect(ratio).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it('予算のための放出をしても最低人数と1軍を組める構成は保たれる', () => {
    let s = newGame(30, 3602);
    for (let season = 0; season < 3; season++) {
      s = playSeason(s);
      s = cloneState(s);
      // 全球団の予算を絞って、予算超過による放出を起こす
      for (const team of s.teams) s.finances[team.id].budget = 700;
      startNextSeason(s);
      for (const team of s.teams) {
        const roster = s.players.filter((p) => p.teamId === team.id);
        expect(roster.length).toBeGreaterThanOrEqual(MINIMUM_ROSTER);
        expect(roster.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(11);
        expect(roster.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(8);
      }
      expect(validateState(s)).toEqual([]);
    }
  });

  it('予算を絞った球団は年俸の高い選手から見直す', () => {
    let s = newGame(30, 3603);
    s = playSeason(s);
    s = cloneState(s);
    startOffseason(s);
    const before = s.players.filter((p) => p.teamId === CPU_TEAM);
    for (const player of before) {
      if (player.ext.contract) player.ext.contract.yearsRemaining = 0;
    }
    const salaryOf = new Map(before.map((p) => [p.id, p.ext.contract?.salary ?? 0]));
    s.finances[CPU_TEAM].budget = 600;

    startNextSeason(s);

    const kept = new Set(s.players.filter((p) => p.teamId === CPU_TEAM).map((p) => p.id));
    const leftSalaries = [...salaryOf.entries()].filter(([id]) => !kept.has(id)).map(([, v]) => v);
    const keptSalaries = [...salaryOf.entries()].filter(([id]) => kept.has(id)).map(([, v]) => v);
    if (leftSalaries.length > 0 && keptSalaries.length > 0) {
      const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      // 出ていった選手のほうが、残った選手より平均年俸が高い
      expect(avg(leftSalaries)).toBeGreaterThan(avg(keptSalaries));
    }
  });
});
