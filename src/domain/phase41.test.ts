import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason } from './season';
import {
  analyzePlayer,
  ageFactor,
  battingScore,
  buildRadar,
  buildSummary,
  contractValueScore,
  developmentTrend,
  futureStarsFromLabel,
  injuryRisk,
  performanceScore,
  pitchingScore,
  projectionUpside,
  roleFitScore,
  scoutingConfidence,
  trendPoints,
  GRADE_LABELS,
  RECOMMENDATION_LABELS,
  USAGE_ADVICE_LABELS,
  type PlayerAnalysis,
} from './playerAnalysis';
import {
  analyzeTeamForDisplay,
  TEAM_AXIS_LABELS,
  TEAM_STATUS_LABELS,
} from './teamAnalysis';
import { POSITION_KEYS } from './rosterAnalysis';
import { emptyBatting, emptyPitching } from './stats';
import { overallRating } from './rating';
import { setUsageRole, setDirection } from './club';
import type { BattingStats, GameState, PitchingStats, Player } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 410410): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 410410, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
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
  const player = myPlayers(state).find((p) => !p.isPitcher);
  if (!player) throw new Error('野手がいない');
  return player;
}

function anyPitcher(state: GameState): Player {
  const player = myPlayers(state).find((p) => p.isPitcher && p.pitching);
  if (!player) throw new Error('投手がいない');
  return player;
}

/** 打撃成績を作る小道具 */
function batting(over: Partial<BattingStats>): BattingStats {
  return { ...emptyBatting(), ...over };
}

function pitching(over: Partial<PitchingStats>): PitchingStats {
  return { ...emptyPitching(), ...over };
}

/** 全選手の基本能力の指紋（分析で変わらないことの確認に使う） */
function abilityFingerprint(state: GameState): string {
  return state.players
    .map((p) => {
      const b = p.batting;
      const t = p.pitching;
      return [
        p.id,
        b.trajectory, b.contact, b.power, b.speed, b.arm, b.fielding, b.catching,
        t ? [t.velocity, t.control, t.stamina, t.power, t.movement].join(',') : '-',
      ].join(':');
    })
    .join('|');
}

/* ================= 成績のスコア化 ================= */

describe('PHASE4.1 成績のスコア化', () => {
  it('打席が少なければ評価しない', () => {
    expect(battingScore(batting({ plateAppearances: 10, atBats: 9, hits: 3 }))).toBeNull();
  });

  it('打席が十分なら数値が出る', () => {
    const score = battingScore(batting({ plateAppearances: 500, atBats: 450, hits: 130 }));
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
    expect(score!).toBeLessThanOrEqual(100);
  });

  it('打率が高いほどスコアが高い', () => {
    const low = battingScore(batting({ plateAppearances: 500, atBats: 450, hits: 90 }))!;
    const high = battingScore(batting({ plateAppearances: 500, atBats: 450, hits: 150 }))!;
    expect(high).toBeGreaterThan(low);
  });

  it('本塁打が多いほどスコアが高い', () => {
    const base = { plateAppearances: 500, atBats: 450, hits: 120 };
    const low = battingScore(batting({ ...base, homeRuns: 2 }))!;
    const high = battingScore(batting({ ...base, homeRuns: 35 }))!;
    expect(high).toBeGreaterThan(low);
  });

  it('打点が多いほどスコアが高い', () => {
    const base = { plateAppearances: 500, atBats: 450, hits: 120 };
    expect(battingScore(batting({ ...base, rbi: 90 }))!).toBeGreaterThan(
      battingScore(batting({ ...base, rbi: 20 }))!,
    );
  });

  it('三振が多いとスコアが下がる', () => {
    const base = { plateAppearances: 500, atBats: 450, hits: 120 };
    expect(battingScore(batting({ ...base, strikeouts: 160 }))!).toBeLessThan(
      battingScore(batting({ ...base, strikeouts: 40 }))!,
    );
  });

  it('打撃スコアは 0〜100 に収まる', () => {
    const monster = battingScore(
      batting({ plateAppearances: 600, atBats: 500, hits: 250, homeRuns: 80, rbi: 200, walks: 120 }),
    )!;
    expect(monster).toBeLessThanOrEqual(100);
    const awful = battingScore(
      batting({ plateAppearances: 600, atBats: 560, hits: 40, strikeouts: 300 }),
    )!;
    expect(awful).toBeGreaterThanOrEqual(0);
  });

  it('投球回が少なければ評価しない', () => {
    expect(pitchingScore(pitching({ outs: 20, earnedRuns: 2 }))).toBeNull();
  });

  it('防御率が良いほどスコアが高い', () => {
    const base = { outs: 450, hitsAllowed: 130, walks: 40, strikeouts: 120 };
    const good = pitchingScore(pitching({ ...base, earnedRuns: 40 }))!;
    const bad = pitchingScore(pitching({ ...base, earnedRuns: 90 }))!;
    expect(good).toBeGreaterThan(bad);
  });

  it('奪三振が多いほどスコアが高い', () => {
    const base = { outs: 450, earnedRuns: 55, hitsAllowed: 130, walks: 40 };
    expect(pitchingScore(pitching({ ...base, strikeouts: 200 }))!).toBeGreaterThan(
      pitchingScore(pitching({ ...base, strikeouts: 60 }))!,
    );
  });

  it('被安打・与四球が多いとスコアが下がる', () => {
    const base = { outs: 450, earnedRuns: 55, strikeouts: 120 };
    expect(pitchingScore(pitching({ ...base, hitsAllowed: 220, walks: 90 }))!).toBeLessThan(
      pitchingScore(pitching({ ...base, hitsAllowed: 110, walks: 25 }))!,
    );
  });

  it('被本塁打が多いとスコアが下がる', () => {
    const base = { outs: 450, earnedRuns: 55, hitsAllowed: 130, walks: 40, strikeouts: 120 };
    expect(pitchingScore(pitching({ ...base, homeRunsAllowed: 40 }))!).toBeLessThan(
      pitchingScore(pitching({ ...base, homeRunsAllowed: 5 }))!,
    );
  });

  it('投手スコアは 0〜100 に収まる', () => {
    const ace = pitchingScore(
      pitching({ outs: 600, earnedRuns: 10, hitsAllowed: 90, walks: 15, strikeouts: 260, wins: 22 }),
    )!;
    expect(ace).toBeLessThanOrEqual(100);
    const bad = pitchingScore(
      pitching({ outs: 300, earnedRuns: 120, hitsAllowed: 300, walks: 120, strikeouts: 20 }),
    )!;
    expect(bad).toBeGreaterThanOrEqual(0);
  });

  it('野手は打撃成績で、投手は投球成績で評価される', () => {
    const s = newGame();
    const fielder = anyFielder(s);
    const pitcher = anyPitcher(s);
    const stats = {
      batting: batting({ plateAppearances: 500, atBats: 450, hits: 140 }),
      pitching: pitching({ outs: 450, earnedRuns: 40, hitsAllowed: 120, walks: 30, strikeouts: 150 }),
    };
    expect(performanceScore(fielder, stats)).toBe(battingScore(stats.batting));
    expect(performanceScore(pitcher, stats)).toBe(pitchingScore(stats.pitching));
  });

  it('成績が無ければ null', () => {
    const s = newGame();
    expect(performanceScore(anyFielder(s), undefined)).toBeNull();
  });
});

/* ================= 年齢・怪我・契約 ================= */

describe('PHASE4.1 補助的な指標', () => {
  it('若いほど年齢の余地が大きい', () => {
    expect(ageFactor(20)).toBeGreaterThan(ageFactor(26));
    expect(ageFactor(26)).toBeGreaterThan(ageFactor(33));
    expect(ageFactor(33)).toBeGreaterThan(ageFactor(38));
  });

  it('年齢の余地は 0〜100 に収まる', () => {
    for (let age = 16; age <= 45; age++) {
      expect(ageFactor(age)).toBeGreaterThanOrEqual(0);
      expect(ageFactor(age)).toBeLessThanOrEqual(100);
    }
  });

  it('怪我をしていると離脱リスクが上がる', () => {
    const s = newGame();
    const player = anyFielder(s);
    const before = injuryRisk(player);
    const injured = cloneState(s).players.find((p) => p.id === player.id)!;
    injured.ext.injury = {
      level: 'major',
      name: '靭帯損傷',
      startDate: s.date,
      returnDate: s.date,
    };
    expect(injuryRisk(injured)).toBeGreaterThan(before);
  });

  it('疲労が高いと離脱リスクが上がる', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.fatigue = 0;
    const low = injuryRisk(player);
    player.ext.fatigue = 90;
    expect(injuryRisk(player)).toBeGreaterThan(low);
  });

  it('年齢が高いと離脱リスクが上がる', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.fatigue = 20;
    player.age = 24;
    const young = injuryRisk(player);
    player.age = 37;
    expect(injuryRisk(player)).toBeGreaterThan(young);
  });

  it('離脱リスクは 0〜100 に収まる', () => {
    const s = playSeason(newGame(10, 4101));
    for (const player of s.players) {
      const risk = injuryRisk(player);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    }
  });

  it('年俸が市場価値より安いほど費用対効果が高い', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && p.ext.contract)!;
    const salary = player.ext.contract!.salary;
    player.ext.contract!.salary = Math.max(15, Math.round(salary * 0.4));
    const cheap = contractValueScore(s, player, s.stats[player.id]);
    player.ext.contract!.salary = Math.round(salary * 3);
    const pricey = contractValueScore(s, player, s.stats[player.id]);
    expect(cheap).toBeGreaterThan(pricey);
  });

  it('費用対効果は 0〜100 に収まる', () => {
    const s = newGame();
    for (const player of myPlayers(s)) {
      const value = contractValueScore(s, player, s.stats[player.id]);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('契約が無ければ中立の 50', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.contract = null;
    expect(contractValueScore(s, player, undefined)).toBe(50);
  });

  it('役割との噛み合いは 0〜100 に収まる', () => {
    const s = newGame();
    for (const player of s.players) {
      const fit = roleFitScore(player);
      expect(fit).toBeGreaterThanOrEqual(0);
      expect(fit).toBeLessThanOrEqual(100);
    }
  });

  it('能力が高いほど噛み合いも高くなりやすい', () => {
    const s = newGame();
    const fielders = myPlayers(s).filter((p) => !p.isPitcher);
    const sorted = [...fielders].sort((a, b) => overallRating(b) - overallRating(a));
    expect(roleFitScore(sorted[0])).toBeGreaterThan(roleFitScore(sorted[sorted.length - 1]));
  });
});

/* ================= 情報の確度 ================= */

describe('PHASE4.1 スカウト精度による情報差', () => {
  it('自球団の選手は他球団の選手より確度が高い', () => {
    const s = newGame();
    const mine = anyFielder(s);
    const other = s.players.find((p) => p.teamId !== PLAYER_TEAM)!;
    expect(scoutingConfidence(s, mine)).toBeGreaterThan(scoutingConfidence(s, other));
  });

  it('確度は 0〜1 に収まる', () => {
    const s = playSeason(newGame(10, 4102));
    for (const player of s.players) {
      const confidence = scoutingConfidence(s, player);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('記録が増えるほど確度が上がる', () => {
    const fresh = newGame(10, 4103);
    const later = afterSeasons(2, 4103, 10);
    const id = anyFielder(fresh).id;
    const before = scoutingConfidence(fresh, fresh.players.find((p) => p.id === id)!);
    const after = later.players.find((p) => p.id === id);
    if (after) {
      expect(scoutingConfidence(later, after)).toBeGreaterThanOrEqual(before);
    }
  });

  it('他球団の選手は分析でも確度が低いと分かる', () => {
    const s = newGame();
    const other = s.players.find((p) => p.teamId !== PLAYER_TEAM)!;
    expect(analyzePlayer(s, other).scoutingConfidence).toBeLessThan(0.68);
  });

  it('確度が低いほど予測レンジは広い', () => {
    const wide = projectionUpside({ future: 5, confidence: 0.3, age: 22 });
    const narrow = projectionUpside({ future: 5, confidence: 0.95, age: 22 });
    expect(wide).toBeGreaterThan(narrow);
  });
});

/* ================= 成長の傾向 ================= */

describe('PHASE4.1 成長期待・成績の推移', () => {
  it('記録が無ければ推移は判定しない', () => {
    const s = newGame();
    const { trend, seasons } = developmentTrend(s, anyFielder(s));
    expect(trend).toBe('UNKNOWN');
    expect(seasons).toBe(0);
  });

  it('年度別成績が無ければ推移データも空', () => {
    const s = newGame();
    expect(trendPoints(s, anyFielder(s))).toEqual([]);
  });

  it('シーズンを重ねると年度別成績が記録される', () => {
    const s = afterSeasons(2, 4104);
    const withHistory = myPlayers(s).filter((p) => trendPoints(s, p).length > 0);
    expect(withHistory.length).toBeGreaterThan(0);
  });

  it('年度別成績は年の古い順に並ぶ', () => {
    const s = afterSeasons(3, 4105);
    let checked = 0;
    for (const player of s.players) {
      const points = trendPoints(s, player);
      for (let i = 1; i < points.length; i++) {
        // シーズン途中でトレードされた選手は同じ年に2件（球団ごと）並ぶ
        expect(points[i].year).toBeGreaterThanOrEqual(points[i - 1].year);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('同じ年が2件並ぶのはトレードで球団が変わったときだけ', () => {
    const s = afterSeasons(3, 4105);
    for (const player of s.players) {
      const points = trendPoints(s, player);
      for (let i = 1; i < points.length; i++) {
        if (points[i].year === points[i - 1].year) {
          expect(points[i].teamId).not.toBe(points[i - 1].teamId);
        }
      }
    }
  });

  it('野手の推移には打率・本塁打が入る', () => {
    const s = afterSeasons(2, 4106);
    const fielder = myPlayers(s).find((p) => !p.isPitcher && trendPoints(s, p).length > 0);
    if (fielder) {
      const point = trendPoints(s, fielder)[0];
      expect(point.values).toHaveProperty('average');
      expect(point.values).toHaveProperty('homeRuns');
    }
  });

  it('投手の推移には防御率・奪三振が入る', () => {
    const s = afterSeasons(2, 4107);
    const pitcher = myPlayers(s).find((p) => p.isPitcher && trendPoints(s, p).length > 0);
    if (pitcher) {
      const point = trendPoints(s, pitcher)[0];
      expect(point.values).toHaveProperty('era');
      expect(point.values).toHaveProperty('strikeouts');
    }
  });

  it('推移の判定は UP / FLAT / DOWN / UNKNOWN のいずれか', () => {
    const s = afterSeasons(3, 4108);
    const allowed = ['UP', 'FLAT', 'DOWN', 'UNKNOWN'];
    for (const player of s.players) {
      expect(allowed).toContain(developmentTrend(s, player).trend);
    }
  });

  it('複数年プレイすると推移を判定できる選手が出てくる', () => {
    const s = afterSeasons(4, 4109);
    const judged = s.players.filter((p) => developmentTrend(s, p).trend !== 'UNKNOWN');
    expect(judged.length).toBeGreaterThan(0);
  });

  it('将来性ラベルは 1〜5 の星になる', () => {
    expect(futureStarsFromLabel('非常に高い')).toBe(5);
    expect(futureStarsFromLabel('高い')).toBe(4);
    expect(futureStarsFromLabel('普通')).toBe(3);
    expect(futureStarsFromLabel('低い')).toBe(2);
    expect(futureStarsFromLabel('非常に低い')).toBe(1);
  });

  it('知らないラベルでも星は 1 以上', () => {
    expect(futureStarsFromLabel('？')).toBe(1);
  });

  it('高齢の選手は将来性の星が抑えられる', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.potential = 90;
    player.age = 22;
    const young = analyzePlayer(s, player).stars.future;
    player.age = 35;
    const old = analyzePlayer(s, player).stars.future;
    expect(old).toBeLessThan(young);
  });

  it('若くて将来性が高いほど成長期待が高い', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    player.age = 22;
    player.ext.potential = 85;
    const high = analyzePlayer(s, player).stars.development;
    player.age = 34;
    player.ext.potential = 40;
    const low = analyzePlayer(s, player).stars.development;
    expect(high).toBeGreaterThan(low);
  });

  it('星はすべて 1〜5 に収まる', () => {
    const s = playSeason(newGame(10, 4110));
    for (const player of s.players) {
      const { stars } = analyzePlayer(s, player);
      for (const value of [stars.current, stars.future, stars.development, stars.usage]) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});

/* ================= 評価とおすすめ ================= */

describe('PHASE4.1 選手評価', () => {
  it('全選手に S〜D の評価がつく', () => {
    const s = playSeason(newGame(10, 4111));
    const allowed = ['S', 'A', 'B', 'C', 'D'];
    for (const player of s.players) {
      expect(allowed).toContain(analyzePlayer(s, player).grade);
    }
  });

  it('評価にはすべて表示名がある', () => {
    for (const grade of ['S', 'A', 'B', 'C', 'D'] as const) {
      expect(GRADE_LABELS[grade]).toBeTruthy();
    }
  });

  it('能力が高い選手のほうが評価が高くなりやすい', () => {
    const s = newGame(30, 4112);
    const sorted = [...myPlayers(s)].sort((a, b) => overallRating(b) - overallRating(a));
    const order = { S: 5, A: 4, B: 3, C: 2, D: 1 };
    const best = order[analyzePlayer(s, sorted[0]).grade];
    const worst = order[analyzePlayer(s, sorted[sorted.length - 1]).grade];
    expect(best).toBeGreaterThanOrEqual(worst);
  });

  it('リーグ全体で評価が1種類に偏らない', () => {
    const s = playSeason(newGame(30, 4113));
    const grades = new Set(s.players.map((p) => analyzePlayer(s, p).grade));
    expect(grades.size).toBeGreaterThan(1);
  });

  it('扱いの助言にはすべて表示名がある', () => {
    const kinds = [
      'CORE',
      'KEEP',
      'DEVELOP',
      'ADJUST',
      'RELEASE_CANDIDATE',
      'INJURY_RETURN',
    ] as const;
    for (const kind of kinds) expect(RECOMMENDATION_LABELS[kind]).toBeTruthy();
  });

  it('起用の助言にはすべて表示名がある', () => {
    const kinds = [
      'FIRST_TEAM',
      'SECOND_TEAM',
      'DEVELOP',
      'COMPETE',
      'REST',
      'INJURED',
    ] as const;
    for (const kind of kinds) expect(USAGE_ADVICE_LABELS[kind]).toBeTruthy();
  });

  it('どの選手にも必ず理由がつく', () => {
    const s = playSeason(newGame(10, 4114));
    for (const player of s.players) {
      const analysis = analyzePlayer(s, player);
      expect(analysis.recommendationReason.length).toBeGreaterThan(5);
      expect(analysis.usageReason.length).toBeGreaterThan(5);
    }
  });
});

describe('PHASE4.1 怪我をしている選手', () => {
  function injuredAnalysis(level: 'minor' | 'moderate' | 'major'): PlayerAnalysis {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.injury = {
      level,
      name: '肉離れ',
      startDate: s.date,
      returnDate: '2026-06-01',
    };
    return analyzePlayer(s, player);
  }

  it('怪我中は復帰待ちになる', () => {
    expect(injuredAnalysis('major').recommendation).toBe('INJURY_RETURN');
  });

  it('怪我中は起用の助言も復帰待ち', () => {
    expect(injuredAnalysis('moderate').usage).toBe('INJURED');
  });

  it('軽傷でも整理候補より復帰待ちが優先される', () => {
    expect(injuredAnalysis('minor').recommendation).toBe('INJURY_RETURN');
  });

  it('怪我中は復帰予定日が理由に入る', () => {
    expect(injuredAnalysis('major').recommendationReason).toContain('2026-06-01');
  });

  it('怪我中は起用優先度の星が下がる', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const healthy = analyzePlayer(s, player).stars.usage;
    player.ext.injury = {
      level: 'major',
      name: '骨折',
      startDate: s.date,
      returnDate: '2026-07-01',
    };
    expect(analyzePlayer(s, player).stars.usage).toBeLessThan(healthy);
  });
});

describe('PHASE4.1 育成・整理・調整の判定', () => {
  /** 条件を作りこんだ選手で分析する */
  function tweak(fn: (player: Player, state: GameState) => void, seed = 4120): PlayerAnalysis {
    const s = cloneState(newGame(30, seed));
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    fn(player, s);
    return analyzePlayer(s, player);
  }

  it('若くて能力が低い選手は育成候補になる', () => {
    const analysis = tweak((player) => {
      player.age = 21;
      player.ext.potential = 80;
      player.batting.contact = 30;
      player.batting.power = 28;
      player.batting.fielding = 32;
      player.batting.catching = 32;
      player.batting.arm = 30;
      player.batting.speed = 40;
    });
    expect(analysis.recommendation).toBe('DEVELOP');
  });

  it('育成候補には年齢が理由に入る', () => {
    const analysis = tweak((player) => {
      player.age = 22;
      player.ext.potential = 82;
      player.batting.contact = 32;
      player.batting.power = 30;
    });
    expect(analysis.recommendationReason).toContain('22歳');
  });

  it('高齢・低能力・低成績が重なると整理候補になる', () => {
    const analysis = tweak((player, s) => {
      player.age = 36;
      player.ext.potential = 30;
      player.batting.contact = 26;
      player.batting.power = 24;
      player.batting.speed = 24;
      player.batting.arm = 26;
      player.batting.fielding = 26;
      player.batting.catching = 26;
      if (player.ext.contract) player.ext.contract.salary = 900;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({ games: 40, plateAppearances: 120, atBats: 110, hits: 18 }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).toBe('RELEASE_CANDIDATE');
  });

  it('整理候補には重なった理由が並ぶ', () => {
    const analysis = tweak((player, s) => {
      player.age = 35;
      player.ext.potential = 28;
      player.batting.contact = 24;
      player.batting.power = 22;
      player.batting.speed = 24;
      player.batting.arm = 24;
      player.batting.fielding = 24;
      player.batting.catching = 24;
      if (player.ext.contract) player.ext.contract.salary = 800;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({ games: 30, plateAppearances: 90, atBats: 85, hits: 12 }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('能力が低くても若ければ整理候補にしない', () => {
    const analysis = tweak((player, s) => {
      player.age = 21;
      player.ext.potential = 30;
      player.batting.contact = 24;
      player.batting.power = 22;
      player.batting.speed = 24;
      player.batting.arm = 24;
      player.batting.fielding = 24;
      player.batting.catching = 24;
      if (player.ext.contract) player.ext.contract.salary = 700;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({ games: 20, plateAppearances: 60, atBats: 55, hits: 6 }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).not.toBe('RELEASE_CANDIDATE');
  });

  it('能力が高いのに成績が悪ければ調整候補になる', () => {
    const analysis = tweak((player, s) => {
      player.age = 28;
      player.ext.potential = 70;
      player.batting.contact = 68;
      player.batting.power = 66;
      player.batting.speed = 60;
      player.batting.arm = 62;
      player.batting.fielding = 64;
      player.batting.catching = 62;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({ games: 100, plateAppearances: 400, atBats: 370, hits: 66 }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).toBe('ADJUST');
  });

  it('能力・成績ともに高ければ中心選手になる', () => {
    const analysis = tweak((player, s) => {
      player.age = 27;
      player.ext.potential = 80;
      player.batting.contact = 80;
      player.batting.power = 78;
      player.batting.speed = 70;
      player.batting.arm = 72;
      player.batting.fielding = 74;
      player.batting.catching = 72;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({
          games: 140,
          plateAppearances: 600,
          atBats: 530,
          hits: 170,
          homeRuns: 32,
          rbi: 100,
          walks: 60,
        }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).toBe('CORE');
  });

  it('低能力でも好成績なら整理候補にはならない', () => {
    const analysis = tweak((player, s) => {
      player.age = 30;
      player.ext.potential = 40;
      player.batting.contact = 40;
      player.batting.power = 38;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({
          games: 130,
          plateAppearances: 520,
          atBats: 470,
          hits: 155,
          homeRuns: 18,
          rbi: 80,
        }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).not.toBe('RELEASE_CANDIDATE');
  });

  it('契約が高額なだけでは整理候補にしない', () => {
    const analysis = tweak((player, s) => {
      player.age = 28;
      player.ext.potential = 72;
      if (player.ext.contract) player.ext.contract.salary = 1400;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({
          games: 140,
          plateAppearances: 580,
          atBats: 520,
          hits: 160,
          homeRuns: 25,
          rbi: 85,
        }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.recommendation).not.toBe('RELEASE_CANDIDATE');
  });
});

describe('PHASE4.1 1軍／2軍の助言', () => {
  function tweak(fn: (player: Player, state: GameState) => void): PlayerAnalysis {
    const s = cloneState(newGame(30, 4130));
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    fn(player, s);
    return analyzePlayer(s, player);
  }

  it('能力が高ければ1軍起用を勧める', () => {
    const analysis = tweak((player) => {
      player.age = 27;
      player.batting.contact = 76;
      player.batting.power = 74;
      player.batting.speed = 68;
      player.batting.arm = 70;
      player.batting.fielding = 72;
      player.batting.catching = 70;
      player.ext.fatigue = 10;
    });
    expect(analysis.usage).toBe('FIRST_TEAM');
  });

  it('若くて能力が足りなければ育成を勧める', () => {
    const analysis = tweak((player) => {
      player.age = 22;
      player.batting.contact = 38;
      player.batting.power = 36;
      player.batting.speed = 44;
      player.batting.arm = 38;
      player.batting.fielding = 40;
      player.batting.catching = 38;
      player.ext.fatigue = 10;
    });
    expect(analysis.usage).toBe('DEVELOP');
  });

  it('育成の助言には出場機会の話が入る', () => {
    const analysis = tweak((player) => {
      player.age = 21;
      player.batting.contact = 34;
      player.batting.power = 32;
      player.ext.fatigue = 5;
    });
    expect(analysis.usageReason).toContain('出場機会');
  });

  it('成績不振なら2軍調整を勧める', () => {
    const analysis = tweak((player, s) => {
      player.age = 29;
      player.batting.contact = 52;
      player.batting.power = 50;
      player.batting.speed = 48;
      player.batting.arm = 50;
      player.batting.fielding = 50;
      player.batting.catching = 48;
      player.ext.fatigue = 10;
      s.stats[player.id] = {
        playerId: player.id,
        batting: batting({ games: 90, plateAppearances: 350, atBats: 320, hits: 52 }),
        pitching: emptyPitching(),
      };
    });
    expect(analysis.usage).toBe('SECOND_TEAM');
  });

  it('疲労がたまっていれば休養を勧める', () => {
    const analysis = tweak((player) => {
      player.ext.fatigue = 85;
      player.ext.consecutiveGames = 18;
    });
    expect(analysis.usage).toBe('REST');
  });

  it('連続出場が長ければ休養を勧める', () => {
    const analysis = tweak((player) => {
      player.ext.fatigue = 40;
      player.ext.consecutiveGames = 20;
    });
    expect(analysis.usage).toBe('REST');
  });

  it('休養の助言には疲労の数字が入る', () => {
    const analysis = tweak((player) => {
      player.ext.fatigue = 80;
      player.ext.consecutiveGames = 16;
    });
    expect(analysis.usageReason).toMatch(/疲労/);
  });

  it('突出した強みも不安もなければ競争枠になる', () => {
    const analysis = tweak((player) => {
      player.age = 27;
      player.batting.contact = 50;
      player.batting.power = 50;
      player.batting.speed = 50;
      player.batting.arm = 50;
      player.batting.fielding = 50;
      player.batting.catching = 50;
      player.ext.fatigue = 10;
    });
    expect(analysis.usage).toBe('COMPETE');
  });

  it('球団方針が若手育成なら競争枠の理由に反映される', () => {
    const s = cloneState(newGame(30, 4131));
    setDirection(s, PLAYER_TEAM, 'DEVELOP');
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    player.age = 27;
    player.batting.contact = 50;
    player.batting.power = 50;
    player.batting.speed = 50;
    player.batting.arm = 50;
    player.batting.fielding = 50;
    player.batting.catching = 50;
    player.ext.fatigue = 10;
    const analysis = analyzePlayer(s, player);
    if (analysis.usage === 'COMPETE') {
      expect(analysis.usageReason).toContain('若手');
    }
  });

  it('起用方針を主力にすると起用優先度が下がらない', () => {
    const s = cloneState(newGame(30, 4132));
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = analyzePlayer(s, player).stars.usage;
    setUsageRole(s, player.id, 'CORE');
    expect(analyzePlayer(s, player).stars.usage).toBeGreaterThanOrEqual(before);
  });

  it('起用方針を控えにすると起用優先度が下がる', () => {
    const s = cloneState(newGame(30, 4133));
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    setUsageRole(s, player.id, 'CORE');
    const core = analyzePlayer(s, player).stars.usage;
    setUsageRole(s, player.id, 'BENCH');
    expect(analyzePlayer(s, player).stars.usage).toBeLessThanOrEqual(core);
  });

  it('助言は自動でロスターを変えない', () => {
    const s = cloneState(newGame(30, 4134));
    const before = s.players.map((p) => `${p.id}:${p.roster}`).join('|');
    for (const player of s.players) analyzePlayer(s, player);
    expect(s.players.map((p) => `${p.id}:${p.roster}`).join('|')).toBe(before);
  });
});

/* ================= 一言の分析 ================= */

describe('PHASE4.1 球団分析の文章', () => {
  it('必ず文章が作られる', () => {
    const s = playSeason(newGame(10, 4140));
    for (const player of s.players) {
      expect(analyzePlayer(s, player).summary.length).toBeGreaterThan(10);
    }
  });

  it('年齢が文章に入る', () => {
    const s = newGame();
    const player = anyFielder(s);
    expect(analyzePlayer(s, player).summary).toContain(`${player.age}歳`);
  });

  it('同じデータからは同じ文章になる', () => {
    const s = newGame(30, 4141);
    const player = anyFielder(s);
    expect(analyzePlayer(s, player).summary).toBe(analyzePlayer(s, player).summary);
  });

  it('文章は句点で終わる', () => {
    const s = playSeason(newGame(10, 4142));
    for (const player of myPlayers(s)) {
      expect(analyzePlayer(s, player).summary.endsWith('。')).toBe(true);
    }
  });

  it('「。。」のような重複が出ない', () => {
    const s = playSeason(newGame(10, 4143));
    for (const player of s.players) {
      expect(analyzePlayer(s, player).summary).not.toContain('。。');
    }
  });

  it('怪我中は離脱が文章に入る', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.injury = {
      level: 'moderate',
      name: '打撲',
      startDate: s.date,
      returnDate: '2026-05-01',
    };
    expect(analyzePlayer(s, player).summary).toContain('離脱');
  });

  it('文章の組み立ては直接呼んでも決定論的', () => {
    const s = newGame();
    const player = anyFielder(s);
    const input = {
      player,
      overall: 60,
      recent: 55,
      trend: 'UP' as const,
      future: 4,
      usage: 'FIRST_TEAM' as const,
    };
    expect(buildSummary(input)).toBe(buildSummary(input));
  });

  it('上昇傾向は文章に現れる', () => {
    const s = newGame();
    const text = buildSummary({
      player: anyFielder(s),
      overall: 60,
      recent: 62,
      trend: 'UP',
      future: 4,
      usage: 'FIRST_TEAM',
    });
    expect(text).toContain('上向');
  });

  it('下降傾向は文章に現れる', () => {
    const s = newGame();
    const text = buildSummary({
      player: anyFielder(s),
      overall: 50,
      recent: 40,
      trend: 'DOWN',
      future: 2,
      usage: 'SECOND_TEAM',
    });
    expect(text).toContain('下降');
  });

  it('出場が少ないことも文章になる', () => {
    const s = newGame();
    const text = buildSummary({
      player: anyFielder(s),
      overall: 50,
      recent: null,
      trend: 'UNKNOWN',
      future: 3,
      usage: 'COMPETE',
    });
    expect(text).toContain('出場が少なく');
  });
});

/* ================= レーダーチャート ================= */

describe('PHASE4.1 レーダーチャート', () => {
  it('野手は6軸', () => {
    const s = newGame();
    expect(analyzePlayer(s, anyFielder(s)).radar).toHaveLength(6);
  });

  it('野手の軸はミート・パワー・走力・肩・守備・捕球', () => {
    const s = newGame();
    const labels = analyzePlayer(s, anyFielder(s)).radar.map((a) => a.label);
    expect(labels).toEqual(['ミート', 'パワー', '走力', '肩', '守備', '捕球']);
  });

  it('投手は5軸', () => {
    const s = newGame();
    expect(analyzePlayer(s, anyPitcher(s)).radar).toHaveLength(5);
  });

  it('投手の軸は球速・制球・スタミナ・球威・変化', () => {
    const s = newGame();
    const labels = analyzePlayer(s, anyPitcher(s)).radar.map((a) => a.label);
    expect(labels).toEqual(['球速', '制球', 'スタミナ', '球威', '変化']);
  });

  it('軸の値は 1〜100 に収まる', () => {
    const s = newGame(30, 4150);
    for (const player of s.players) {
      for (const axis of analyzePlayer(s, player).radar) {
        expect(axis.value).toBeGreaterThanOrEqual(1);
        expect(axis.value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('野手の軸は基本能力と一致する', () => {
    const s = newGame();
    const player = anyFielder(s);
    const radar = analyzePlayer(s, player).radar;
    expect(radar.find((a) => a.key === 'contact')!.value).toBe(player.batting.contact);
    expect(radar.find((a) => a.key === 'power')!.value).toBe(player.batting.power);
    expect(radar.find((a) => a.key === 'catching')!.value).toBe(player.batting.catching);
  });

  it('投手の制球・スタミナは基本能力と一致する', () => {
    const s = newGame();
    const player = anyPitcher(s);
    const radar = analyzePlayer(s, player).radar;
    expect(radar.find((a) => a.key === 'control')!.value).toBe(player.pitching!.control);
    expect(radar.find((a) => a.key === 'stamina')!.value).toBe(player.pitching!.stamina);
  });

  it('予測レンジは現在値以上', () => {
    const s = newGame(30, 4151);
    for (const player of s.players) {
      for (const axis of analyzePlayer(s, player).radar) {
        if (axis.projected !== null) {
          expect(axis.projected).toBeGreaterThanOrEqual(axis.value);
          expect(axis.projected).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('29歳以上には予測レンジを出さない', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.age = 31;
    player.ext.potential = 90;
    for (const axis of analyzePlayer(s, player).radar) {
      expect(axis.projected).toBeNull();
    }
  });

  it('将来性が低ければ予測レンジを出さない', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.age = 22;
    player.ext.potential = 20;
    for (const axis of analyzePlayer(s, player).radar) {
      expect(axis.projected).toBeNull();
    }
  });

  it('伸びしろ幅は年齢が上がるとゼロになる', () => {
    expect(projectionUpside({ future: 5, confidence: 0.8, age: 29 })).toBe(0);
    expect(projectionUpside({ future: 5, confidence: 0.8, age: 24 })).toBeGreaterThan(0);
  });

  it('レーダーの計算は選手を書き換えない', () => {
    const s = newGame();
    const player = anyFielder(s);
    const before = JSON.stringify(player.batting);
    buildRadar(player, { future: 5, confidence: 0.9, age: 22 });
    expect(JSON.stringify(player.batting)).toBe(before);
  });
});

/* ================= 情報の秘匿 ================= */

describe('PHASE4.1 潜在能力の真値が漏れない', () => {
  it('分析結果のどこにも潜在能力の実数値が入らない', () => {
    const s = playSeason(newGame(10, 4160));
    for (const player of s.players) {
      const analysis = analyzePlayer(s, player);
      const json = JSON.stringify(analysis);
      // potential という語も、その数値も含まれない
      expect(json).not.toContain('potential');
      expect(json).not.toContain('"ext"');
    }
  });

  it('分析結果に真の潜在能力を持つフィールドが無い', () => {
    const s = newGame();
    const analysis = analyzePlayer(s, anyFielder(s));
    expect(Object.keys(analysis)).not.toContain('potential');
    expect(Object.keys(analysis)).not.toContain('truePotential');
  });

  it('潜在能力が 1 違っても星は変わらない（粗いラベルしか使わない）', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.age = 24;
    player.ext.potential = 70;
    const a = analyzePlayer(s, player).stars.future;
    player.ext.potential = 71;
    expect(analyzePlayer(s, player).stars.future).toBe(a);
  });

  it('予測レンジは確定値ではなく幅として出る', () => {
    const s = cloneState(newGame());
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.age = 22;
    player.ext.potential = 85;
    const radar = analyzePlayer(s, player).radar;
    const withRange = radar.filter((a) => a.projected !== null);
    expect(withRange.length).toBeGreaterThan(0);
    // 現在値と同じではない（幅がある）
    expect(withRange.some((a) => a.projected! > a.value)).toBe(true);
  });

  it('能力の履歴は保存していないと明示される', () => {
    const s = afterSeasons(2, 4161);
    for (const player of myPlayers(s)) {
      expect(analyzePlayer(s, player).abilityHistoryAvailable).toBe(false);
    }
  });
});

/* ================= 決定論性・非破壊 ================= */

describe('PHASE4.1 決定論性', () => {
  it('同じ状態からは完全に同じ分析になる', () => {
    const s = playSeason(newGame(10, 4170));
    for (const player of myPlayers(s)) {
      expect(JSON.stringify(analyzePlayer(s, player))).toBe(
        JSON.stringify(analyzePlayer(s, player)),
      );
    }
  });

  it('同じシードの別インスタンスでも同じ分析になる', () => {
    const a = newGame(30, 4171);
    const b = newGame(30, 4171);
    const pa = a.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const pb = b.players.find((p) => p.id === pa.id)!;
    expect(JSON.stringify(analyzePlayer(a, pa))).toBe(JSON.stringify(analyzePlayer(b, pb)));
  });

  it('分析しても乱数の状態が進まない', () => {
    const s = playSeason(newGame(10, 4172));
    const before = s.rngState;
    for (const player of s.players) analyzePlayer(s, player);
    expect(s.rngState).toBe(before);
  });

  it('分析しても選手の基本能力が変わらない', () => {
    const s = playSeason(newGame(10, 4173));
    const before = abilityFingerprint(s);
    for (const player of s.players) analyzePlayer(s, player);
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('分析しても成績が変わらない', () => {
    const s = playSeason(newGame(10, 4174));
    const before = JSON.stringify(s.stats);
    for (const player of s.players) analyzePlayer(s, player);
    expect(JSON.stringify(s.stats)).toBe(before);
  });

  it('分析しても状態の検証に通る', () => {
    const s = playSeason(newGame(10, 4175));
    for (const player of s.players) analyzePlayer(s, player);
    expect(validateState(s)).toEqual([]);
  });

  it('チーム分析しても状態が変わらない', () => {
    const s = playSeason(newGame(10, 4176));
    const before = JSON.stringify(s);
    for (const team of s.teams) analyzeTeamForDisplay(s, team.id);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('チーム分析は同じ状態からは同じ結果', () => {
    const s = playSeason(newGame(10, 4177));
    expect(JSON.stringify(analyzeTeamForDisplay(s, PLAYER_TEAM))).toBe(
      JSON.stringify(analyzeTeamForDisplay(s, PLAYER_TEAM)),
    );
  });
});

/* ================= チーム分析 ================= */

describe('PHASE4.1 チーム分析', () => {
  it('7つの軸がそろう', () => {
    const s = newGame();
    expect(analyzeTeamForDisplay(s, PLAYER_TEAM).axes).toHaveLength(7);
  });

  it('軸にはすべて表示名がある', () => {
    const s = newGame();
    for (const axis of analyzeTeamForDisplay(s, PLAYER_TEAM).axes) {
      expect(TEAM_AXIS_LABELS[axis.key]).toBe(axis.label);
    }
  });

  it('軸の値は 1〜100 に収まる', () => {
    const s = playSeason(newGame(10, 4180));
    for (const team of s.teams) {
      for (const axis of analyzeTeamForDisplay(s, team.id).axes) {
        expect(axis.value).toBeGreaterThanOrEqual(1);
        expect(axis.value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('リーグ平均との差は全球団で釣り合う', () => {
    const s = newGame(30, 4181);
    for (const key of ['batting', 'pitching', 'defense'] as const) {
      const sum = s.teams
        .map((t) => analyzeTeamForDisplay(s, t.id).axes.find((a) => a.key === key)!.vsLeague)
        .reduce((a, b) => a + b, 0);
      expect(Math.abs(sum)).toBeLessThan(1);
    }
  });

  it('ポジションの深度がすべてそろう', () => {
    const s = newGame();
    const depth = analyzeTeamForDisplay(s, PLAYER_TEAM).depth;
    expect(depth.map((d) => d.key)).toEqual(POSITION_KEYS);
  });

  it('深度の選手は能力の高い順に並ぶ', () => {
    const s = newGame(30, 4182);
    for (const column of analyzeTeamForDisplay(s, PLAYER_TEAM).depth) {
      for (let i = 1; i < column.entries.length; i++) {
        expect(column.entries[i - 1].overall).toBeGreaterThanOrEqual(column.entries[i].overall);
      }
    }
  });

  it('深度に載る選手は全員その球団の所属', () => {
    const s = newGame(30, 4183);
    const ids = new Set(myPlayers(s).map((p) => p.id));
    for (const column of analyzeTeamForDisplay(s, PLAYER_TEAM).depth) {
      for (const entry of column.entries) expect(ids.has(entry.playerId)).toBe(true);
    }
  });

  it('深度の合計はロスター人数と一致する', () => {
    const s = newGame(30, 4184);
    const analysis = analyzeTeamForDisplay(s, PLAYER_TEAM);
    const total = analysis.depth.reduce((sum, c) => sum + c.entries.length, 0);
    expect(total).toBe(myPlayers(s).length);
  });

  it('深度には枠のラベルがつく', () => {
    const s = newGame();
    const allowed = ['STARTER', 'BACKUP', 'DEPTH', 'PROSPECT'];
    for (const column of analyzeTeamForDisplay(s, PLAYER_TEAM).depth) {
      for (const entry of column.entries) expect(allowed).toContain(entry.slot);
    }
  });

  it('深度の選手には名前が入る', () => {
    const s = newGame();
    for (const column of analyzeTeamForDisplay(s, PLAYER_TEAM).depth) {
      for (const entry of column.entries) expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('課題は最大3件', () => {
    const s = playSeason(newGame(10, 4185));
    for (const team of s.teams) {
      expect(analyzeTeamForDisplay(s, team.id).issues.length).toBeLessThanOrEqual(3);
    }
  });

  it('課題には必ず文章がつく', () => {
    const s = playSeason(newGame(10, 4186));
    for (const team of s.teams) {
      for (const issue of analyzeTeamForDisplay(s, team.id).issues) {
        expect(issue.text.length).toBeGreaterThan(3);
        expect([1, 2, 3]).toContain(issue.severity);
      }
    }
  });

  it('課題は重い順に並ぶ', () => {
    const s = playSeason(newGame(30, 4187));
    for (const team of s.teams) {
      const issues = analyzeTeamForDisplay(s, team.id).issues;
      for (let i = 1; i < issues.length; i++) {
        expect(issues[i - 1].severity).toBeGreaterThanOrEqual(issues[i].severity);
      }
    }
  });

  it('課題のIDは重複しない', () => {
    const s = playSeason(newGame(30, 4188));
    for (const team of s.teams) {
      const ids = analyzeTeamForDisplay(s, team.id).issues.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('状態は4段階のいずれか', () => {
    const s = playSeason(newGame(30, 4189));
    const allowed = ['GOOD', 'STABLE', 'CAUTION', 'RISK'];
    for (const team of s.teams) {
      const analysis = analyzeTeamForDisplay(s, team.id);
      expect(allowed).toContain(analysis.status);
      expect(TEAM_STATUS_LABELS[analysis.status]).toBeTruthy();
    }
  });

  it('状態には必ず理由がつく', () => {
    const s = playSeason(newGame(10, 4190));
    for (const team of s.teams) {
      expect(analyzeTeamForDisplay(s, team.id).statusReason.length).toBeGreaterThan(5);
    }
  });

  it('開幕直後は編成から判断したと分かる', () => {
    const s = newGame();
    expect(analyzeTeamForDisplay(s, PLAYER_TEAM).statusReason).toContain('編成');
  });

  it('人数の内訳が実際のロスターと合う', () => {
    const s = newGame(30, 4191);
    const analysis = analyzeTeamForDisplay(s, PLAYER_TEAM);
    const roster = myPlayers(s);
    expect(analysis.counts.total).toBe(roster.length);
    expect(analysis.counts.firstTeam).toBe(roster.filter((p) => p.roster === 'first').length);
    expect(analysis.counts.fielders).toBe(roster.filter((p) => !p.isPitcher).length);
    expect(analysis.counts.starters + analysis.counts.relievers).toBe(
      roster.filter((p) => p.isPitcher && p.pitching).length,
    );
  });

  it('若手・ベテランの人数が合う', () => {
    const s = newGame(30, 4192);
    const analysis = analyzeTeamForDisplay(s, PLAYER_TEAM);
    const roster = myPlayers(s);
    expect(analysis.counts.young).toBe(roster.filter((p) => p.age <= 25).length);
    expect(analysis.counts.veteran).toBe(roster.filter((p) => p.age >= 31).length);
  });

  it('補強必要度は 0〜100 に収まる', () => {
    const s = newGame(30, 4193);
    for (const team of s.teams) {
      for (const column of analyzeTeamForDisplay(s, team.id).depth) {
        expect(column.need).toBeGreaterThanOrEqual(0);
        expect(column.need).toBeLessThanOrEqual(100);
      }
    }
  });

  it('全12球団を分析できる', () => {
    const s = playSeason(newGame(10, 4194));
    expect(s.teams.length).toBe(12);
    for (const team of s.teams) {
      expect(analyzeTeamForDisplay(s, team.id).teamId).toBe(team.id);
    }
  });

  it('シーズンをまたいでも分析できる', () => {
    const s = afterSeasons(2, 4195, 10);
    for (const team of s.teams) {
      expect(analyzeTeamForDisplay(s, team.id).axes).toHaveLength(7);
    }
  });
});

/* ================= 情報が足りないとき ================= */

describe('PHASE4.1 情報不足のとき', () => {
  it('開幕直後でも分析はできる', () => {
    const s = newGame();
    for (const player of myPlayers(s)) {
      const analysis = analyzePlayer(s, player);
      expect(analysis.grade).toBeTruthy();
      expect(analysis.summary.length).toBeGreaterThan(0);
    }
  });

  it('開幕直後は直近成績が無い', () => {
    const s = newGame();
    expect(analyzePlayer(s, anyFielder(s)).recentPerformance).toBeNull();
  });

  it('開幕直後は通算成績も無い', () => {
    const s = newGame();
    expect(analyzePlayer(s, anyFielder(s)).careerPerformance).toBeNull();
  });

  it('推移の年数は 0 から始まる', () => {
    const s = newGame();
    expect(analyzePlayer(s, anyFielder(s)).trendSeasons).toBe(0);
  });

  it('成績が無くても評価は決まる', () => {
    const s = newGame();
    const grades = new Set(myPlayers(s).map((p) => analyzePlayer(s, p).grade));
    expect(grades.size).toBeGreaterThan(0);
  });

  it('成績が無い選手は成績を理由にしない', () => {
    const s = newGame();
    for (const player of myPlayers(s)) {
      const analysis = analyzePlayer(s, player);
      if (analysis.recentPerformance === null) {
        expect(analysis.reasons.join('')).not.toContain('直近成績が低水準');
      }
    }
  });
});

/* ================= 既存システムが壊れていない ================= */

describe('PHASE4.1 既存システムが壊れていない', () => {
  it('セーブのバージョンは変えていない', () => {
    expect(SAVE_VERSION).toBe(14);
  });

  it('シーズンを最後まで進められる', () => {
    const s = playSeason(newGame(10, 4200));
    expect(s.seasonFinished).toBe(true);
    expect(validateState(s)).toEqual([]);
  });

  it('翌シーズンに進める', () => {
    const s = afterSeasons(2, 4201, 10);
    expect(s.year).toBeGreaterThan(2026);
    expect(validateState(s)).toEqual([]);
  });

  it('球団経営（PHASE 4.0）が引き続き動く', () => {
    const s = afterSeasons(1, 4202, 10);
    expect(Object.keys(s.clubs).length).toBe(12);
    for (const team of s.teams) {
      expect(s.clubs[team.id].facilities.development).toBeGreaterThanOrEqual(1);
    }
  });

  it('歴史（PHASE 3.7）が引き続き記録される', () => {
    const s = afterSeasons(1, 4203, 10);
    expect(s.history.seasons.length).toBeGreaterThan(0);
  });

  it('ニュース（PHASE 3.9）が引き続き作られる', () => {
    const s = afterSeasons(1, 4204, 10);
    expect(s.news.items.length).toBeGreaterThan(0);
  });

  it('ロスターは最低人数を保つ', () => {
    const s = afterSeasons(2, 4205, 10);
    for (const team of s.teams) {
      expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(24);
    }
  });

  it('分析を挟んでもシーズンの結果は変わらない', () => {
    const plain = playSeason(newGame(10, 4206));
    let analysed = newGame(10, 4206);
    for (let i = 0; i < 400 && !analysed.seasonFinished; i++) {
      // 毎日分析を呼んでも、試合結果には一切影響しない
      for (const player of analysed.players.slice(0, 5)) analyzePlayer(analysed, player);
      analyzeTeamForDisplay(analysed, PLAYER_TEAM);
      analysed = advanceDay(analysed).state;
    }
    expect(JSON.stringify(analysed.records)).toBe(JSON.stringify(plain.records));
    expect(analysed.date).toBe(plain.date);
  });

  it('分析を挟んでも乱数の状態が一致する', () => {
    const plain = playSeason(newGame(10, 4207));
    let analysed = newGame(10, 4207);
    for (let i = 0; i < 400 && !analysed.seasonFinished; i++) {
      analyzeTeamForDisplay(analysed, PLAYER_TEAM);
      analysed = advanceDay(analysed).state;
    }
    expect(analysed.rngState).toBe(plain.rngState);
  });
});
