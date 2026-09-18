/**
 * PHASE 4.9-B 検査。
 *
 * 確かめたいのは5つ。
 *   1. 7軸レーダーが「保存されている能力」だけで作られていること
 *   2. 能力履歴・成長判定・通算推移が、記録の無い年を捏造しないこと
 *   3. 順位推移が既存の TeamSeasonHistory だけから作られること
 *   4. 発掘力（見つける力）と調査力（推定の当たり具合）が別物として働くこと
 *      ・発掘力が高い＝早く・多く・条件に合う候補が見つかる
 *      ・調査力が高い＝推定の幅が狭い（真の能力そのものは変わらない）
 *   5. 契約しても能力が変わらないこと・既存セーブが移行できること
 */
import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import { migrateV15ToV16 } from './migrate';
import { Rng, seedFrom } from './rng';
import { buildRadar, analyzePlayer } from './playerAnalysis';
import { overallRating } from './rating';
import {
  BATTER_ABILITY_FIELDS,
  PITCHER_ABILITY_FIELDS,
  abilityPoints,
  abilitySnapshot,
  careerCumulative,
  hasAbilityHistory,
  packBatterAbilities,
  packPitcherAbilities,
  readGrowth,
  unpackBatterAbilities,
  unpackPitcherAbilities,
} from './abilityHistory';
import {
  STANDINGS_METRIC_LABELS,
  isInverted,
  standingsTrend,
  formatStandingsValue,
} from './standingsHistory';
import {
  AMATEUR_CANDIDATE_LIMIT,
  AMATEUR_SEARCH_MAX_DAYS,
  AMATEUR_SEARCH_MIN_DAYS,
  FOREIGN_CANDIDATE_LIMIT,
  FOREIGN_SEARCH_MAX_DAYS,
  FOREIGN_SEARCH_MIN_DAYS,
  advanceDiscovery,
  ageBandOf,
  amateurExtraProspects,
  amateurInvestigationProgress,
  amateurReportOf,
  amateurSearchDays,
  amateurSearchProgress,
  buildNotes,
  cancelAmateurInvestigation,
  cancelAmateurSearch,
  cancelForeignSearch,
  clearStaleCandidates,
  conditionMatchChance,
  createDiscoveryState,
  discoveryPowerOf,
  emptyCondition,
  foreignCandidateCount,
  foreignReportOf,
  foreignSearchDays,
  investigateDaysFor,
  matchesCondition,
  pitcherRoleOf,
  removeAmateurPreset,
  saveAmateurPreset,
  searchProgress,
  setAmateurCondition,
  signForeignCandidate,
  startAmateurInvestigation,
  startAmateurSearch,
  startForeignSearch,
  typeOf,
} from './discovery';
import { buildInitialReport } from './scouting';
import { ROSTER_LIMIT } from './types';
import type { GameState, Player, TeamScoutAbility } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 490490): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 490490): GameState {
  let s = newGame(30, seed);
  for (let i = 0; i < count; i++) {
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

function myPlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.teamId === PLAYER_TEAM);
}

function anyFielder(state: GameState): Player {
  return myPlayers(state).find((p) => !p.isPitcher)!;
}

function anyPitcher(state: GameState): Player {
  return myPlayers(state).find((p) => p.isPitcher)!;
}

/* ================================================================
 * A. 7軸レーダー
 * ============================================================== */

describe('PHASE4.9-B A. 7軸レーダー', () => {
  const ctx = { future: 3, confidence: 0.8, age: 25 };

  it('野手は7軸で、弾道・パワー・ミート・走力・肩・守備・捕球', () => {
    const player = anyFielder(newGame());
    const axes = buildRadar(player, ctx);
    expect(axes).toHaveLength(7);
    expect(axes.map((a) => a.label)).toEqual([
      '弾道',
      'パワー',
      'ミート',
      '走力',
      '肩',
      '守備',
      '捕球',
    ]);
  });

  it('野手の各軸は保存されている能力そのもの', () => {
    const player = anyFielder(newGame());
    const axes = buildRadar(player, ctx);
    const find = (key: string) => axes.find((a) => a.key === key)!.value;
    expect(find('trajectory')).toBe(player.batting.trajectory);
    expect(find('power')).toBe(player.batting.power);
    expect(find('contact')).toBe(player.batting.contact);
    expect(find('catching')).toBe(player.batting.catching);
  });

  it('投手も7軸になる', () => {
    const axes = buildRadar(anyPitcher(newGame()), ctx);
    expect(axes).toHaveLength(7);
    expect(axes.map((a) => a.label)).toEqual([
      '球速',
      '制球',
      'スタミナ',
      '球威',
      '変化',
      '守備',
      '打撃',
    ]);
  });

  it('投手の追加2軸も保存されている能力から作る（新しい能力値は増やさない）', () => {
    const player = anyPitcher(newGame());
    const axes = buildRadar(player, ctx);
    expect(axes.find((a) => a.key === 'fielding')!.value).toBe(player.batting.fielding);
    expect(axes.find((a) => a.key === 'batting')!.value).toBe(
      Math.round((player.batting.contact + player.batting.power) / 2),
    );
  });

  it('レーダーを作っても選手を書き換えない', () => {
    const player = anyPitcher(newGame());
    const before = JSON.stringify(player);
    buildRadar(player, ctx);
    expect(JSON.stringify(player)).toBe(before);
  });

  it('すべての軸は1〜100に収まる', () => {
    const state = newGame();
    for (const player of myPlayers(state)) {
      for (const axis of buildRadar(player, ctx)) {
        expect(axis.value).toBeGreaterThanOrEqual(1);
        expect(axis.value).toBeLessThanOrEqual(100);
      }
    }
  });
});

/* ================================================================
 * B. 能力履歴と成長曲線
 * ============================================================== */

describe('PHASE4.9-B B. 能力履歴', () => {
  it('pack と unpack が往復する（野手）', () => {
    const player = anyFielder(newGame());
    const line = packBatterAbilities(player.batting);
    expect(line).toHaveLength(BATTER_ABILITY_FIELDS.length);
    expect(unpackBatterAbilities(line)).toEqual(player.batting);
  });

  it('pack と unpack が往復する（投手）', () => {
    const player = anyPitcher(newGame());
    const line = packPitcherAbilities(player.pitching!);
    expect(line).toHaveLength(PITCHER_ABILITY_FIELDS.length);
    expect(unpackPitcherAbilities(line)).toEqual(player.pitching);
  });

  it('記録の無い配列からは null が返る（現在値で埋めない）', () => {
    expect(unpackBatterAbilities(undefined)).toBeNull();
    expect(unpackPitcherAbilities(undefined)).toBeNull();
  });

  it('シーズンを始めたばかりなら能力履歴は空', () => {
    const state = newGame();
    for (const player of myPlayers(state)) {
      expect(hasAbilityHistory(state.history.players[player.id])).toBe(false);
      expect(abilityPoints(state.history.players[player.id])).toEqual([]);
    }
  });

  it('シーズンを締めると1年ぶんだけ能力が残る', () => {
    const state = afterSeasons(1);
    const player = myPlayers(state).find(
      (p) => abilityPoints(state.history.players[p.id]).length > 0,
    )!;
    expect(abilityPoints(state.history.players[player.id])).toHaveLength(1);
  });

  it('3シーズンで3年ぶんになり、年は古い順に並ぶ', () => {
    const state = afterSeasons(3);
    const points = myPlayers(state)
      .map((p) => abilityPoints(state.history.players[p.id]))
      .find((p) => p.length >= 3)!;
    expect(points.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].year).toBeGreaterThan(points[i - 1].year);
    }
  });

  it('記録した総合力は、その時点の overallRating と同じ', () => {
    const player = anyFielder(newGame());
    expect(abilitySnapshot(player).o).toBe(overallRating(player));
  });

  it('記録が無ければ成長は UNKNOWN で、推測した数値を返さない', () => {
    const reading = readGrowth([]);
    expect(reading.phase).toBe('UNKNOWN');
    expect(reading.peakOverall).toBeNull();
    expect(reading.latestOverall).toBeNull();
  });

  it('1年ぶんだけなら、まだ推移は読めない', () => {
    const reading = readGrowth([
      { year: 2026, age: 22, overall: 50, batting: null, pitching: null },
    ]);
    expect(reading.phase).toBe('UNKNOWN');
    expect(reading.latestOverall).toBe(50);
  });

  it('上がり続けていれば GROWING', () => {
    const reading = readGrowth([
      { year: 2026, age: 21, overall: 40, batting: null, pitching: null },
      { year: 2027, age: 22, overall: 45, batting: null, pitching: null },
      { year: 2028, age: 23, overall: 52, batting: null, pitching: null },
    ]);
    expect(reading.phase).toBe('GROWING');
    expect(reading.peakOverall).toBe(52);
  });

  it('ピークから落ちていれば DECLINING', () => {
    const reading = readGrowth([
      { year: 2026, age: 30, overall: 70, batting: null, pitching: null },
      { year: 2027, age: 31, overall: 66, batting: null, pitching: null },
      { year: 2028, age: 32, overall: 61, batting: null, pitching: null },
    ]);
    expect(reading.phase).toBe('DECLINING');
    expect(reading.peakYear).toBe(2026);
    expect(reading.fromPeak).toBe(-9);
  });

  it('横ばいなら PEAK', () => {
    const reading = readGrowth([
      { year: 2026, age: 27, overall: 68, batting: null, pitching: null },
      { year: 2027, age: 28, overall: 69, batting: null, pitching: null },
      { year: 2028, age: 29, overall: 68, batting: null, pitching: null },
    ]);
    expect(reading.phase).toBe('PEAK');
  });

  it('成長の判定は潜在能力の実数値を持ち出さない', () => {
    const state = afterSeasons(2);
    for (const player of myPlayers(state)) {
      const reading = readGrowth(abilityPoints(state.history.players[player.id]));
      expect(JSON.stringify(reading)).not.toContain(String(player.ext.potential));
    }
  });

  it('分析は能力履歴があるかどうかを正しく伝える', () => {
    const fresh = newGame();
    expect(analyzePlayer(fresh, anyFielder(fresh)).abilityHistoryAvailable).toBe(false);
    const later = afterSeasons(1);
    const player = myPlayers(later).find(
      (p) => abilityPoints(later.history.players[p.id]).length > 0,
    )!;
    expect(analyzePlayer(later, player).abilityHistoryAvailable).toBe(true);
  });
});

/* ================================================================
 * C. 通算成績の推移
 * ============================================================== */

describe('PHASE4.9-B C. 通算成績の推移', () => {
  it('履歴が無ければ空', () => {
    expect(careerCumulative(undefined, () => 1)).toEqual([]);
  });

  it('積み上げは減らない', () => {
    const state = afterSeasons(3);
    for (const player of myPlayers(state)) {
      const points = careerCumulative(state.history.players[player.id], (s) => s.b?.[0] ?? null);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].total).toBeGreaterThanOrEqual(points[i - 1].total);
      }
    }
  });

  it('記録の無い年は積み上げを増やさない', () => {
    const history = {
      playerId: 'x',
      name: 'テスト',
      mainPosition: 'CF' as const,
      isPitcher: false,
      birthYear: 2000,
      debutYear: 2020,
      retiredAt: null,
      seasons: [
        { year: 2026, teamId: 't', b: [10] },
        { year: 2027, teamId: 't' },
        { year: 2028, teamId: 't', b: [5] },
      ],
      career: { batting: {}, pitching: {} },
      awards: [],
      records: 0,
      championships: 0,
      finalOverall: null,
    } as unknown as Parameters<typeof careerCumulative>[0];
    const points = careerCumulative(history, (s) => s.b?.[0] ?? null);
    expect(points.map((p) => p.total)).toEqual([10, 10, 15]);
    expect(points[1].season).toBeNull();
  });
});

/* ================================================================
 * D. 順位推移
 * ============================================================== */

describe('PHASE4.9-B D. 順位推移', () => {
  it('順位だけが「小さいほど上」', () => {
    expect(isInverted('rank')).toBe(true);
    expect(isInverted('wins')).toBe(false);
    expect(isInverted('winPct')).toBe(false);
  });

  it('5つの指標にすべて名前がある', () => {
    expect(Object.keys(STANDINGS_METRIC_LABELS)).toHaveLength(5);
  });

  it('終えたシーズンが無ければ年も空', () => {
    const state = newGame();
    const trend = standingsTrend(state, state.leagues[0].id, 'rank');
    expect(trend.years).toEqual([]);
  });

  it('シーズンを終えるとリーグの全球団ぶんの線ができる', () => {
    const state = afterSeasons(2);
    const league = state.leagues[0];
    const trend = standingsTrend(state, league.id, 'rank');
    const teams = state.teams.filter((t) => t.leagueId === league.id);
    expect(trend.series).toHaveLength(teams.length);
    for (const series of trend.series) {
      expect(series.values).toHaveLength(trend.years.length);
      for (const value of series.values) {
        if (value === null) continue;
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(teams.length);
      }
    }
  });

  it('順位の下端は必ず1位', () => {
    const state = afterSeasons(2);
    expect(standingsTrend(state, state.leagues[0].id, 'rank').min).toBe(1);
  });

  it('推移を作っても state を書き換えない', () => {
    const state = afterSeasons(1);
    const before = JSON.stringify(state);
    standingsTrend(state, state.leagues[0].id, 'wins');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('表示の書式が指標ごとに変わる', () => {
    expect(formatStandingsValue('rank', 1)).toBe('1位');
    expect(formatStandingsValue('winPct', 0.512)).toBe('.512');
    expect(formatStandingsValue('wins', 70)).toBe('70');
  });
});

/* ================================================================
 * E. 発掘力（見つける力）
 * ============================================================== */

describe('PHASE4.9-B E. 発掘力', () => {
  it('発掘力が高いほど、見つかるまでの日数が短い', () => {
    const low: number[] = [];
    const high: number[] = [];
    for (let i = 0; i < 300; i++) {
      low.push(foreignSearchDays(20, new Rng(seedFrom(`low:${i}`))));
      high.push(foreignSearchDays(90, new Rng(seedFrom(`high:${i}`))));
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(high)).toBeLessThan(avg(low));
  });

  it('日数は決めた範囲に収まる', () => {
    for (let i = 0; i < 300; i++) {
      const days = foreignSearchDays(i % 101, new Rng(seedFrom(`d:${i}`)));
      expect(days).toBeGreaterThanOrEqual(FOREIGN_SEARCH_MIN_DAYS);
      expect(days).toBeLessThanOrEqual(FOREIGN_SEARCH_MAX_DAYS);
    }
  });

  it('発掘力が高いほど、見つかる人数が多い', () => {
    const count = (power: number) => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += foreignCandidateCount(power, new Rng(seedFrom(`c${power}:${i}`)));
      return total;
    };
    expect(count(90)).toBeGreaterThan(count(20));
  });

  it('見つかる人数は上限を超えない', () => {
    for (let i = 0; i < 200; i++) {
      const n = foreignCandidateCount(100, new Rng(seedFrom(`m:${i}`)));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(FOREIGN_CANDIDATE_LIMIT);
    }
  });

  it('発掘力が高いほど、条件に合う確率が高い', () => {
    expect(conditionMatchChance(90)).toBeGreaterThan(conditionMatchChance(20));
    expect(conditionMatchChance(0)).toBeGreaterThan(0);
    expect(conditionMatchChance(100)).toBeLessThanOrEqual(1);
  });

  it('発掘力が高いほど、ドラフトで見つかる候補が増える', () => {
    expect(amateurExtraProspects(100)).toBeGreaterThan(amateurExtraProspects(0));
    expect(amateurExtraProspects(0)).toBe(0);
  });

  it('発掘力は1〜100に収まる', () => {
    const state = newGame();
    for (const team of state.teams) {
      const power = discoveryPowerOf(state, team.id);
      expect(power).toBeGreaterThanOrEqual(1);
      expect(power).toBeLessThanOrEqual(100);
    }
  });
});

/* ================================================================
 * F. 調査力（推定の当たり具合）は発掘力とは別
 * ============================================================== */

describe('PHASE4.9-B F. 調査力と発掘力の切り分け', () => {
  const LOW: TeamScoutAbility = {
    currentAbility: 20,
    potential: 20,
    personality: 20,
    skills: 20,
    discovery: 20,
  };
  const HIGH: TeamScoutAbility = {
    currentAbility: 95,
    potential: 95,
    personality: 95,
    skills: 95,
    discovery: 20,
  };

  it('調査力が違っても、真の能力はまったく同じ', () => {
    const state = newGame();
    const player = anyFielder(state);
    const before = overallRating(player);
    buildInitialReport({ id: 'p1', player, draftRank: 1, projectedAbility: before, projectedPotential: 'B' }, LOW, 't', state.year);
    buildInitialReport({ id: 'p1', player, draftRank: 1, projectedAbility: before, projectedPotential: 'B' }, HIGH, 't', state.year);
    expect(overallRating(player)).toBe(before);
  });

  it('調査力が高いほど、推定の幅が狭い', () => {
    const state = newGame();
    let lowWidth = 0;
    let highWidth = 0;
    let count = 0;
    for (const player of myPlayers(state).slice(0, 40)) {
      const prospect = {
        id: player.id,
        player,
        draftRank: 1,
        projectedAbility: overallRating(player),
        projectedPotential: 'B' as const,
      };
      const low = buildInitialReport(prospect, LOW, 't', state.year);
      const high = buildInitialReport(prospect, HIGH, 't', state.year);
      lowWidth += low.estimate.abilityHigh - low.estimate.abilityLow;
      highWidth += high.estimate.abilityHigh - high.estimate.abilityLow;
      count++;
    }
    expect(count).toBeGreaterThan(0);
    expect(highWidth).toBeLessThan(lowWidth);
  });

  it('発掘力を変えても推定の幅は変わらない', () => {
    const state = newGame();
    const player = anyFielder(state);
    const prospect = {
      id: player.id,
      player,
      draftRank: 1,
      projectedAbility: overallRating(player),
      projectedPotential: 'B' as const,
    };
    const weak = buildInitialReport(prospect, { ...LOW, discovery: 5 }, 't', state.year);
    const strong = buildInitialReport(prospect, { ...LOW, discovery: 99 }, 't', state.year);
    expect(strong.estimate.abilityHigh - strong.estimate.abilityLow).toBe(
      weak.estimate.abilityHigh - weak.estimate.abilityLow,
    );
  });
});

/* ================================================================
 * G. 外国人助っ人の発掘
 * ============================================================== */

/** 発掘フェーズだけ進める（候補は見つかるが、まだ調査は終わっていない） */
function searchTo(state: GameState): GameState {
  let s = state;
  startForeignSearch(s, emptyCondition(false));
  for (let i = 0; i < 40; i++) {
    if ((s.discovery.foreign.candidates.length ?? 0) > 0) break;
    s = advanceDay(s).state;
  }
  return s;
}

/** 発掘→調査の両方を終わらせる */
function investigateTo(state: GameState): GameState {
  let s = searchTo(state);
  for (let i = 0; i < 40; i++) {
    if (!s.discovery.foreign.search) break;
    s = advanceDay(s).state;
  }
  return s;
}

describe('PHASE4.9-B G. 外国人助っ人', () => {
  it('新しいゲームは発掘データを持っている', () => {
    const state = newGame();
    expect(state.discovery).toBeTruthy();
    expect(state.discovery.foreign.candidates).toEqual([]);
    expect(state.discovery.foreign.search).toBeNull();
  });

  it('発掘を始めると日数が決まる', () => {
    const state = newGame();
    expect(startForeignSearch(state, emptyCondition(false)).ok).toBe(true);
    expect(state.discovery.foreign.search!.findDays).toBeGreaterThanOrEqual(FOREIGN_SEARCH_MIN_DAYS);
  });

  it('発掘中は二重に始められない', () => {
    const state = newGame();
    startForeignSearch(state, emptyCondition(false));
    expect(startForeignSearch(state, emptyCondition(false)).ok).toBe(false);
  });

  it('やめれば発掘中ではなくなる', () => {
    const state = newGame();
    startForeignSearch(state, emptyCondition(false));
    cancelForeignSearch(state);
    expect(state.discovery.foreign.search).toBeNull();
  });

  it('進み具合は0〜100', () => {
    expect(searchProgress(null)).toBe(0);
    expect(searchProgress({ days: 10, elapsed: 5 })).toBe(50);
    expect(searchProgress({ days: 10, elapsed: 30 })).toBe(100);
  });

  it('発掘フェーズが終わると候補が見つかるが、調査はまだ終わっていない', () => {
    const state = searchTo(newGame());
    expect(state.discovery.foreign.candidates.length).toBeGreaterThan(0);
    expect(state.discovery.foreign.search).toBeTruthy();
    for (const candidate of state.discovery.foreign.candidates) {
      expect(foreignReportOf(state, candidate)).toBeNull();
    }
  });

  it('調査フェーズが終わると search が空になり、レポートができる', () => {
    const state = investigateTo(newGame());
    expect(state.discovery.foreign.search).toBeNull();
    expect(state.discovery.foreign.candidates.length).toBeGreaterThan(0);
    for (const candidate of state.discovery.foreign.candidates) {
      expect(foreignReportOf(state, candidate)).toBeTruthy();
    }
  });

  it('見つかった候補には必ず推定レポートが付く（調査完了後）', () => {
    const state = investigateTo(newGame());
    for (const candidate of state.discovery.foreign.candidates) {
      const report = foreignReportOf(state, candidate)!;
      expect(report.estimate.abilityLow).toBeLessThanOrEqual(report.estimate.abilityHigh);
    }
  });

  it('調査力が高いほど、調査にかかる日数が短い', () => {
    const avg = (ability: number) => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += investigateDaysFor(ability, new Rng(seedFrom(`inv:${ability}:${i}`)));
      return total / 300;
    };
    expect(avg(90)).toBeLessThan(avg(20));
  });

  it('候補はまだ球団に所属していない', () => {
    const state = searchTo(newGame());
    for (const candidate of state.discovery.foreign.candidates) {
      expect(candidate.player.teamId).toBe('');
      expect(state.players.some((p) => p.id === candidate.player.id)).toBe(false);
    }
  });

  it('備考は能力の一覧ではない', () => {
    const state = newGame();
    const rng = new Rng(seedFrom('notes'));
    for (const player of myPlayers(state).slice(0, 30)) {
      const notes = buildNotes(player, rng, null);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length).toBeLessThanOrEqual(4);
      const text = notes.join('');
      for (const label of ['ミート', 'パワー:', '守備力', '捕球', '弾道']) {
        expect(text).not.toContain(label);
      }
      // 能力値そのもの（1〜100）を書かない。球速の km/h だけは例外
      const numbers = text.replace(/最速\d+km\/h/g, '').match(/\d+/g) ?? [];
      expect(numbers).toEqual([]);
    }
  });

  it('年が変わると去年の候補は消える', () => {
    const state = searchTo(newGame());
    expect(state.discovery.foreign.candidates.length).toBeGreaterThan(0);
    state.year += 1;
    clearStaleCandidates(state);
    expect(state.discovery.foreign.candidates).toEqual([]);
    expect(Object.keys(state.discovery.foreign.reports)).toEqual([]);
  });

  it('契約しても能力は1つも変わらない', () => {
    const state = searchTo(newGame());
    const candidate = state.discovery.foreign.candidates[0];
    const before = JSON.stringify({
      batting: candidate.player.batting,
      pitching: candidate.player.pitching,
      potential: candidate.player.ext.potential,
    });
    // 受け入れられるまで十分高い額を出す
    signForeignCandidate(state, candidate.id, candidate.askingSalary * 3, 2);
    const after = JSON.stringify({
      batting: candidate.player.batting,
      pitching: candidate.player.pitching,
      potential: candidate.player.ext.potential,
    });
    expect(after).toBe(before);
  });

  it('契約が成立すると支配下に入り、資金が減る', () => {
    const state = searchTo(newGame());
    const candidate = state.discovery.foreign.candidates[0];
    const cash = state.finances[PLAYER_TEAM].cash;
    const salary = Math.min(candidate.askingSalary * 3, cash);
    const result = signForeignCandidate(state, candidate.id, salary, 2);
    if (result.ok) {
      const signed = state.players.find((p) => p.id === candidate.player.id)!;
      expect(signed.teamId).toBe(PLAYER_TEAM);
      expect(signed.ext.contract).toBeTruthy();
      expect(state.finances[PLAYER_TEAM].cash).toBe(cash - salary);
      expect(validateState(state)).toEqual([]);
    } else {
      expect(state.players.some((p) => p.id === candidate.player.id)).toBe(false);
    }
  });

  it('資金が足りなければ契約できない', () => {
    const state = searchTo(newGame());
    const candidate = state.discovery.foreign.candidates[0];
    state.finances[PLAYER_TEAM].cash = 0;
    const result = signForeignCandidate(state, candidate.id, 100, 2);
    expect(result.ok).toBe(false);
    expect(state.players.some((p) => p.id === candidate.player.id)).toBe(false);
  });

  it('支配下70人が埋まっていれば契約できない', () => {
    const state = searchTo(newGame());
    const candidate = state.discovery.foreign.candidates[0];
    // 70人になるまで他球団の選手を移す（テストのための作為）
    const others = state.players.filter((p) => p.teamId !== PLAYER_TEAM);
    let i = 0;
    while (state.players.filter((p) => p.teamId === PLAYER_TEAM).length < ROSTER_LIMIT) {
      others[i].teamId = PLAYER_TEAM;
      others[i].roster = 'second';
      i++;
    }
    const result = signForeignCandidate(state, candidate.id, candidate.askingSalary * 3, 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(String(ROSTER_LIMIT));
  });

  it('同じ種から始めれば、発掘の結果は毎回同じ', () => {
    const a = searchTo(newGame(30, 777));
    const b = searchTo(newGame(30, 777));
    expect(a.discovery.foreign.candidates.map((c) => c.player.name)).toEqual(
      b.discovery.foreign.candidates.map((c) => c.player.name),
    );
  });

  it('発掘は試合用のRNGを消費しない', () => {
    const state = newGame();
    const before = state.rngState;
    startForeignSearch(state, emptyCondition(false));
    cancelForeignSearch(state);
    advanceDiscovery(state);
    expect(state.rngState).toBe(before);
  });
});

/* ================================================================
 * G2. アマチュアの発掘（シーズン中に1人ずつ探す）
 * ============================================================== */

/** 発掘を始めて、候補が1人見つかるまで進める（発掘は続いたまま） */
function amateurSearchTo(state: GameState): GameState {
  let s = state;
  startAmateurSearch(s, emptyCondition(false));
  for (let i = 0; i < 40; i++) {
    if ((s.discovery.amateur.candidates.length ?? 0) > 0) break;
    s = advanceDay(s).state;
  }
  return s;
}

/** 見つけた1人目の候補について、個別の調査を完了させる */
function amateurInvestigateTo(state: GameState): GameState {
  let s = amateurSearchTo(state);
  const candidateId = s.discovery.amateur.candidates[0].id;
  startAmateurInvestigation(s, candidateId);
  for (let i = 0; i < 40; i++) {
    if (amateurReportOf(s, s.discovery.amateur.candidates[0])) break;
    s = advanceDay(s).state;
  }
  return s;
}

describe('PHASE4.9-B G2. アマチュアの発掘', () => {
  it('新しいゲームは発掘データを持っている', () => {
    const state = newGame();
    expect(state.discovery.amateur.candidates).toEqual([]);
    expect(state.discovery.amateur.search).toBeNull();
  });

  it('発掘を始めると日数が決まる', () => {
    const state = newGame();
    expect(startAmateurSearch(state, emptyCondition(false)).ok).toBe(true);
    expect(state.discovery.amateur.search!.findDays).toBeGreaterThanOrEqual(AMATEUR_SEARCH_MIN_DAYS);
    expect(state.discovery.amateur.search!.findDays).toBeLessThanOrEqual(AMATEUR_SEARCH_MAX_DAYS);
  });

  it('日数は外国人助っ人より短い傾向がある（国内なので）', () => {
    const avg = (fn: (power: number, rng: Rng) => number, power: number) => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += fn(power, new Rng(seedFrom(`cmp:${power}:${i}`)));
      return total / 300;
    };
    expect(avg(amateurSearchDays, 50)).toBeLessThan(avg(foreignSearchDays, 50));
  });

  it('発掘中は二重に始められない', () => {
    const state = newGame();
    startAmateurSearch(state, emptyCondition(false));
    expect(startAmateurSearch(state, emptyCondition(false)).ok).toBe(false);
  });

  it('やめれば発掘中ではなくなる', () => {
    const state = newGame();
    startAmateurSearch(state, emptyCondition(false));
    cancelAmateurSearch(state);
    expect(state.discovery.amateur.search).toBeNull();
  });

  it('候補が1人見つかっても、発掘そのものは続く（まとめて何人でも見つかる）', () => {
    const state = amateurSearchTo(newGame());
    expect(state.discovery.amateur.candidates.length).toBeGreaterThan(0);
    expect(state.discovery.amateur.search).toBeTruthy();
    for (const candidate of state.discovery.amateur.candidates) {
      expect(candidate.investigation).toBeNull();
      expect(amateurReportOf(state, candidate)).toBeNull();
    }
  });

  it('発掘を続けると2人目も見つかる', () => {
    let state = amateurSearchTo(newGame(30, 999));
    const firstCount = state.discovery.amateur.candidates.length;
    for (let i = 0; i < 60; i++) {
      state = advanceDay(state).state;
      if (state.discovery.amateur.candidates.length > firstCount) break;
    }
    expect(state.discovery.amateur.candidates.length).toBeGreaterThan(firstCount);
  });

  it('見つけた候補を選んで調査を依頼できる', () => {
    const state = amateurSearchTo(newGame());
    const candidateId = state.discovery.amateur.candidates[0].id;
    expect(startAmateurInvestigation(state, candidateId).ok).toBe(true);
    expect(state.discovery.amateur.candidates[0].investigation).toBeTruthy();
  });

  it('同じ候補を二重に調査できない', () => {
    const state = amateurSearchTo(newGame());
    const candidateId = state.discovery.amateur.candidates[0].id;
    startAmateurInvestigation(state, candidateId);
    expect(startAmateurInvestigation(state, candidateId).ok).toBe(false);
  });

  it('調査をやめれば調査中ではなくなる（能力はまだ分からない）', () => {
    const state = amateurSearchTo(newGame());
    const candidateId = state.discovery.amateur.candidates[0].id;
    startAmateurInvestigation(state, candidateId);
    cancelAmateurInvestigation(state, candidateId);
    expect(state.discovery.amateur.candidates[0].investigation).toBeNull();
    expect(amateurReportOf(state, state.discovery.amateur.candidates[0])).toBeNull();
  });

  it('調査が終わるとレポートができ、調査中ではなくなる', () => {
    const state = amateurInvestigateTo(newGame());
    const candidate = state.discovery.amateur.candidates[0];
    expect(candidate.investigation).toBeNull();
    expect(amateurReportOf(state, candidate)).toBeTruthy();
  });

  it('見つかった候補には必ず推定レポートが付く（調査完了後）', () => {
    const state = amateurInvestigateTo(newGame());
    const report = amateurReportOf(state, state.discovery.amateur.candidates[0])!;
    expect(report.estimate.abilityLow).toBeLessThanOrEqual(report.estimate.abilityHigh);
  });

  it('調査していない候補は発掘が続いたままでも未調査のままでいる', () => {
    let state = amateurSearchTo(newGame(30, 321));
    for (let i = 0; i < 10; i++) state = advanceDay(state).state;
    for (const candidate of state.discovery.amateur.candidates) {
      expect(amateurReportOf(state, candidate)).toBeNull();
    }
  });

  it('複数の候補を並行して調査できる', () => {
    let state = amateurSearchTo(newGame(30, 4242));
    for (let i = 0; i < 60 && state.discovery.amateur.candidates.length < 2; i++) {
      state = advanceDay(state).state;
    }
    expect(state.discovery.amateur.candidates.length).toBeGreaterThanOrEqual(2);
    const [a, b] = state.discovery.amateur.candidates;
    startAmateurInvestigation(state, a.id);
    startAmateurInvestigation(state, b.id);
    for (let i = 0; i < 40; i++) {
      state = advanceDay(state).state;
      if (amateurReportOf(state, a) && amateurReportOf(state, b)) break;
    }
    expect(amateurReportOf(state, a)).toBeTruthy();
    expect(amateurReportOf(state, b)).toBeTruthy();
  });

  it('候補はまだどの球団にも所属していない', () => {
    const state = amateurSearchTo(newGame());
    for (const candidate of state.discovery.amateur.candidates) {
      expect(candidate.prospect.player.teamId).toBe('');
      expect(state.players.some((p) => p.id === candidate.prospect.player.id)).toBe(false);
    }
  });

  it('候補は上限（AMATEUR_CANDIDATE_LIMIT）を超えて増えず、達すると発掘が自動的に止まる', () => {
    const state = amateurSearchTo(newGame(30, 111));
    const template = state.discovery.amateur.candidates[0];
    // 上限の1人手前まで、テストのためにスタブ候補を直接積む
    for (let i = state.discovery.amateur.candidates.length; i < AMATEUR_CANDIDATE_LIMIT - 1; i++) {
      state.discovery.amateur.candidates.push({
        ...template,
        id: `${template.id}-stub${i}`,
        investigation: null,
      });
    }
    expect(state.discovery.amateur.candidates.length).toBe(AMATEUR_CANDIDATE_LIMIT - 1);
    startAmateurSearch(state, emptyCondition(false));
    let next = state;
    for (let i = 0; i < 40; i++) {
      next = advanceDay(next).state;
      if (next.discovery.amateur.candidates.length >= AMATEUR_CANDIDATE_LIMIT) break;
    }
    expect(next.discovery.amateur.candidates.length).toBe(AMATEUR_CANDIDATE_LIMIT);
    expect(next.discovery.amateur.search).toBeNull();
  });

  it('発掘は試合用のRNGを消費しない', () => {
    const state = newGame();
    const before = state.rngState;
    startAmateurSearch(state, emptyCondition(false));
    cancelAmateurSearch(state);
    advanceDiscovery(state);
    expect(state.rngState).toBe(before);
  });

  it('発掘中の進み具合が0〜100の範囲で増えていく', () => {
    const state = newGame();
    startAmateurSearch(state, emptyCondition(false));
    const search = state.discovery.amateur.search!;
    expect(amateurSearchProgress(search)).toBe(0);
    search.elapsed = Math.floor(search.findDays / 2);
    const mid = amateurSearchProgress(search);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });

  it('調査していない候補の進み具合は0で、調査中は0〜100で増えていく', () => {
    const state = amateurSearchTo(newGame());
    const candidate = state.discovery.amateur.candidates[0];
    expect(amateurInvestigationProgress(candidate)).toBe(0);
    startAmateurInvestigation(state, candidate.id);
    const investigation = candidate.investigation!;
    investigation.elapsed = Math.floor(investigation.investigateDays / 2);
    const mid = amateurInvestigationProgress(candidate);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });

  it('見つけた候補は、そのまま今年のドラフト候補プールに合流する', () => {
    let state = amateurSearchTo(newGame(30, 12345));
    expect(state.discovery.amateur.candidates.length).toBeGreaterThan(0);
    const foundIds = state.discovery.amateur.candidates.map((c) => c.id);

    state = playSeason(state);
    state = cloneState(state);
    startOffseason(state);

    expect(state.draft).toBeTruthy();
    const draftIds = new Set(state.draft!.prospects.map((p) => p.id));
    for (const id of foundIds) {
      expect(draftIds.has(id)).toBe(true);
    }
  });

  it('ドラフトに合流すると、シーズン中に調べたレポートが調査結果へ引き継がれる', () => {
    let state = amateurInvestigateTo(newGame(30, 12345));
    const candidate = state.discovery.amateur.candidates[0];
    const before = amateurReportOf(state, candidate);
    expect(before).toBeTruthy();

    state = playSeason(state);
    state = cloneState(state);
    startOffseason(state);

    const carried = state.scouting.teams[PLAYER_TEAM].reports[candidate.id];
    expect(carried).toBeTruthy();
    expect(carried).toEqual(before);
  });

  it('ドラフトへ合流したあと、発掘の入れ物は空になる（発掘中でも止まる）', () => {
    let state = amateurSearchTo(newGame(30, 12345));
    expect(state.discovery.amateur.candidates.length).toBeGreaterThan(0);
    expect(state.discovery.amateur.search).toBeTruthy();

    state = playSeason(state);
    state = cloneState(state);
    startOffseason(state);

    expect(state.discovery.amateur.candidates).toEqual([]);
    expect(state.discovery.amateur.reports).toEqual({});
    expect(state.discovery.amateur.search).toBeNull();
  });

  it('シーズンを通して進めても state は壊れない', () => {
    let state = amateurSearchTo(newGame(30, 555));
    state = playSeason(state);
    expect(validateState(state)).toEqual([]);
  });
});

/* ================================================================
 * H. 条件の判定
 * ============================================================== */

describe('PHASE4.9-B H. 条件', () => {
  it('区分が違えば合わない', () => {
    const state = newGame();
    expect(matchesCondition(anyFielder(state), emptyCondition(true))).toBe(false);
    expect(matchesCondition(anyPitcher(state), emptyCondition(true))).toBe(true);
  });

  it('年齢帯は境目で切り替わる', () => {
    expect(ageBandOf(22)).toBe('young');
    expect(ageBandOf(28)).toBe('prime');
    expect(ageBandOf(35)).toBe('veteran');
  });

  it('タイプは能力から素直に決まる', () => {
    const state = newGame();
    for (const player of myPlayers(state).slice(0, 20)) {
      const type = typeOf(player);
      if (player.isPitcher) expect(['fastball', 'breaking', 'control']).toContain(type);
      else expect(['power', 'speed', 'defense']).toContain(type);
    }
  });

  it('投手の役割はスタミナで決まる', () => {
    const state = newGame();
    for (const player of myPlayers(state).filter((p) => p.isPitcher).slice(0, 20)) {
      const role = pitcherRoleOf(player);
      const stamina = player.pitching!.stamina;
      if (stamina >= 55) expect(role).toBe('starter');
      else if (stamina >= 38) expect(role).toBe('relief');
      else expect(role).toBe('closer');
    }
  });

  it('スカウトへの指示は保存・取り消しができる', () => {
    const state = newGame();
    const condition = { ...emptyCondition(true), role: 'starter' as const };
    setAmateurCondition(state, condition);
    expect(state.discovery.amateur.active).toEqual(condition);
    setAmateurCondition(state, null);
    expect(state.discovery.amateur.active).toBeNull();
  });

  it('条件のひな形は保存・削除ができる', () => {
    const state = newGame();
    const id = saveAmateurPreset(state, '即戦力', emptyCondition(true));
    expect(state.discovery.amateur.presets).toHaveLength(1);
    removeAmateurPreset(state, id);
    expect(state.discovery.amateur.presets).toEqual([]);
  });

  it('ひな形は増えすぎない', () => {
    const state = newGame();
    for (let i = 0; i < 12; i++) saveAmateurPreset(state, `条件${i}`, emptyCondition(false));
    expect(state.discovery.amateur.presets.length).toBeLessThanOrEqual(8);
  });
});

/* ================================================================
 * I. セーブと移行
 * ============================================================== */

describe('PHASE4.9-B I. セーブ', () => {
  it('SAVE_VERSION は 16', () => {
    expect(SAVE_VERSION).toBe(16);
    expect(newGame().version).toBe(16);
  });

  it('v15 のセーブが v16 に移行する', () => {
    const state = newGame();
    const old = cloneState(state);
    old.version = 15;
    delete (old as unknown as Record<string, unknown>).discovery;
    for (const team of Object.values(old.scouting?.teams ?? {})) {
      delete (team.ability as unknown as Record<string, unknown>).discovery;
    }
    migrateV15ToV16(old);
    expect(old.version).toBe(16);
    expect(old.discovery).toEqual(createDiscoveryState());
    for (const team of Object.values(old.scouting?.teams ?? {})) {
      expect(team.ability.discovery).toBeGreaterThanOrEqual(1);
      expect(team.ability.discovery).toBeLessThanOrEqual(100);
    }
  });

  it('移行しても既存のデータは変わらない', () => {
    const state = playSeason(newGame(10, 4902));
    const old = cloneState(state);
    old.version = 15;
    delete (old as unknown as Record<string, unknown>).discovery;
    migrateV15ToV16(old);
    expect(old.date).toBe(state.date);
    expect(old.players.map((p) => overallRating(p))).toEqual(
      state.players.map((p) => overallRating(p)),
    );
    expect(validateState(old)).toEqual([]);
  });

  it('移行は過去の能力履歴を作り出さない', () => {
    const state = cloneState(newGame());
    state.version = 15;
    delete (state as unknown as Record<string, unknown>).discovery;
    migrateV15ToV16(state);
    for (const history of Object.values(state.history.players)) {
      for (const season of history.seasons) {
        expect(season.o).toBeUndefined();
      }
    }
  });

  it('シーズンを進めても state は壊れない', () => {
    const state = afterSeasons(2);
    expect(validateState(state)).toEqual([]);
  });
});
