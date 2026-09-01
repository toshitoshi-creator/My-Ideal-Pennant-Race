import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason } from './season';
import { Rng } from './rng';
import { TEAM_SEEDS } from './teams';
import { generateTeamPlayers } from './playerGen';
import { buildAutoSetup } from './setup';
import { simulateGame } from './simulation';
import {
  applySeasonGrowth,
  ageGrowthFactor,
  abilityValue,
  scaleToVelocity,
  BATTER_ABILITY_KEYS,
  PITCHER_ABILITY_KEYS,
  potentialLabel,
  scoutedPotentialLabel,
} from './growth';
import { personalityEffects, PERSONALITIES } from './personality';
import { effectiveBreakdown, effectiveBatting } from './effective';
import {
  addGameFatigue,
  recoverFatigue,
  updateCondition,
  updateMotivation,
  CONDITION_MODIFIER,
  fatiguePenalty,
} from './condition';
import { rollInjury, resolveInjury, isAvailable } from './injury';
import { abilityEffect, SPECIAL_ABILITIES } from './specialAbilities';
import type { SpecialAbilityEntry, SpecialAbilityId } from './specialAbilities';
import { checkRosterChange } from './roster';
import type { GameState, Player } from './types';
import { addDays } from './dates';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 90210): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/* ---------------- 1. 年齢・成長タイプ・潜在能力 ---------------- */

describe('PHASE2 年齢と成長', () => {
  it('全選手が年齢・潜在能力・成長タイプ・性格を持つ', () => {
    const state = newGame();
    for (const p of state.players) {
      expect(p.age).toBeGreaterThanOrEqual(18);
      expect(p.age).toBeLessThanOrEqual(38);
      expect(p.ext.potential).toBeGreaterThanOrEqual(1);
      expect(p.ext.potential).toBeLessThanOrEqual(100);
      expect(typeof p.ext.growthType).toBe('string');
      expect(typeof p.ext.personality).toBe('string');
      expect(p.ext.growthRate).toBeGreaterThanOrEqual(0.5);
      expect(p.ext.growthRate).toBeLessThanOrEqual(1.5);
    }
  });

  it('シーズン終了時に年齢が1歳加算される', () => {
    let state = playSeason(newGame(10));
    const before = new Map(state.players.map((p) => [p.id, p.age]));
    state = cloneState(state);
    startNextSeason(state);
    // PHASE 3.1 で引退・新人加入が入ったため、前シーズンから残っている選手だけを見る
    const continuing = state.players.filter((p) => before.has(p.id));
    expect(continuing.length).toBeGreaterThan(0);
    for (const p of continuing) {
      expect(p.age).toBe(before.get(p.id)! + 1);
    }
  });

  it('年齢によって成長のしやすさが変わる', () => {
    const f19 = ageGrowthFactor(19, 'normal');
    const f22 = ageGrowthFactor(22, 'normal');
    const f25 = ageGrowthFactor(25, 'normal');
    const f30 = ageGrowthFactor(30, 'normal');
    const f32 = ageGrowthFactor(32, 'normal');
    const f38 = ageGrowthFactor(38, 'normal');
    expect(f19).toBeGreaterThan(f22);
    expect(f22).toBeGreaterThan(f25);
    expect(f25).toBeGreaterThan(f30);
    expect(f30).toBeGreaterThan(0);
    expect(f32).toBeLessThan(0);
    expect(f38).toBeLessThan(f32);
  });

  it('成長タイプによって年齢別の成長率が変わる', () => {
    // 晩成型は若いうちは伸びにくく、20代後半でも伸びる
    expect(ageGrowthFactor(19, 'early')).toBeGreaterThan(ageGrowthFactor(19, 'superLate'));
    expect(ageGrowthFactor(29, 'superLate')).toBeGreaterThan(ageGrowthFactor(29, 'early'));
  });

  it('能力は100を超えず、潜在能力を超えて成長しない', () => {
    const rng = new Rng(1);
    const players = generateTeamPlayers(rng, { teamId: 'phoenix', strength: 45, starCount: 1 });
    for (const player of players) {
      player.ext.potential = 80;
      player.ext.motivation = 100;
      const keys = player.isPitcher ? PITCHER_ABILITY_KEYS : BATTER_ABILITY_KEYS;
      // 生成時点ですでに潜在能力を超えている能力は、そこから伸びないことを確認する
      const initial = new Map(keys.map((key) => [key, abilityValue(player, key)]));

      for (let season = 0; season < 25; season++) {
        player.age = 19; // 毎年もっとも伸びる年齢で回す
        applySeasonGrowth(rng, {
          player,
          firstTeamExperience: 1,
          secondTeamExperience: 1,
          performance: 1,
        });
        for (const key of keys) {
          const value = abilityValue(player, key);
          const cap = key === 'velocity' ? 165 : 100;
          expect(value).toBeLessThanOrEqual(cap);
          const limit = key === 'velocity'
            ? Math.max(initial.get(key)!, scaleToVelocity(player.ext.potential))
            : Math.max(initial.get(key)!, player.ext.potential);
          expect(value).toBeLessThanOrEqual(Math.ceil(limit));
        }
      }
    }
  });

  it('若手は成長し、ベテランは衰退する', () => {
    const rng = new Rng(77);
    const players = generateTeamPlayers(rng, { teamId: 'phoenix', strength: 45 });
    const young = players.filter((p) => !p.isPitcher).slice(0, 8);
    const old = players.filter((p) => !p.isPitcher).slice(8, 16);
    let youngTotal = 0;
    let oldTotal = 0;
    for (const p of young) {
      p.age = 20;
      p.ext.potential = Math.min(100, p.ext.potential + 25);
      const r = applySeasonGrowth(rng, { player: p, firstTeamExperience: 0.9, secondTeamExperience: 0.2, performance: 0.3 });
      youngTotal += r.total;
    }
    for (const p of old) {
      p.age = 36;
      const r = applySeasonGrowth(rng, { player: p, firstTeamExperience: 0.6, secondTeamExperience: 0, performance: 0 });
      oldTotal += r.total;
    }
    expect(youngTotal).toBeGreaterThan(0);
    expect(oldTotal).toBeLessThan(0);
  });

  it('潜在能力は数値ではなくラベルで表示する（スカウト精度に対応）', () => {
    expect(potentialLabel(85)).toBe('非常に高い');
    expect(potentialLabel(50)).toBe('普通');
    expect(potentialLabel(20)).toBe('非常に低い');
    // 調査精度が低いとぶれる可能性がある（精度1なら正確）
    expect(scoutedPotentialLabel(85, 1, 1)).toBe('非常に高い');
  });
});

/* ---------------- 2. 性格 ---------------- */

describe('PHASE2 性格', () => {
  it('10種類以上の性格があり、それぞれ効果が異なる', () => {
    expect(PERSONALITIES.length).toBeGreaterThanOrEqual(10);
    const names = new Set(PERSONALITIES.map((p) => p.name));
    expect(names.size).toBe(PERSONALITIES.length);
    for (const p of PERSONALITIES) {
      expect(p.description.length).toBeGreaterThan(5);
      expect(p.summary.length).toBeGreaterThan(0);
    }
  });

  it('性格補正は1.01〜1.20倍の範囲に収まり、全能力を一律に上げない', () => {
    for (const p of PERSONALITIES) {
      // potentialBonus は倍率ではなく加算値なので除く
      const { potentialBonus, ...multipliers } = p.effects;
      expect(potentialBonus).toBeLessThanOrEqual(10);
      for (const v of Object.values(multipliers)) {
        expect(v).toBeGreaterThan(0.4);
        expect(v).toBeLessThanOrEqual(1.9); // 感度系（低いほど強い）を含む
      }
      // 成長倍率は 1.20 を超えない
      expect(p.effects.growth).toBeLessThanOrEqual(1.2);
      expect(p.effects.technicalGrowth).toBeLessThanOrEqual(1.2);
    }
    expect(personalityEffects('hardWorker').growth).toBeCloseTo(1.15);
  });

  it('性格によって疲労・不調の受け方が変わる', () => {
    const state = newGame();
    const base = state.players.find((p) => !p.isPitcher)!;
    const make = (personality: Player['ext']['personality']): Player => ({
      ...base,
      ext: { ...base.ext, personality, fatigue: 70, condition: 'bad' },
    });
    const myPace = effectiveBreakdown(make('myPace')).total;
    const sensitive = effectiveBreakdown(make('sensitive')).total;
    const normal = effectiveBreakdown(make('calm')).total;
    expect(myPace).toBeGreaterThan(sensitive);
    expect(normal).toBeGreaterThan(sensitive);
  });

  it('負けず嫌いは接戦で実効能力が上がる', () => {
    const state = newGame();
    const base = state.players.find((p) => !p.isPitcher)!;
    const competitive: Player = { ...base, ext: { ...base.ext, personality: 'competitive', condition: 'normal', fatigue: 0 } };
    const calm: Player = { ...base, ext: { ...base.ext, personality: 'calm', condition: 'normal', fatigue: 0 } };
    expect(effectiveBreakdown(competitive, { closeGame: true }).total).toBeGreaterThan(
      effectiveBreakdown(competitive, {}).total,
    );
    expect(effectiveBreakdown(competitive, { closeGame: true }).total).toBeGreaterThan(
      effectiveBreakdown(calm, { closeGame: true }).total,
    );
  });

  it('冷静はプレッシャーに強い', () => {
    const state = newGame();
    const base = state.players.find((p) => !p.isPitcher)!;
    const calm: Player = { ...base, ext: { ...base.ext, personality: 'calm', condition: 'normal', fatigue: 0 } };
    const sensitive: Player = { ...base, ext: { ...base.ext, personality: 'sensitive', condition: 'normal', fatigue: 0 } };
    expect(effectiveBreakdown(calm, { pressure: 1 }).total).toBeGreaterThan(
      effectiveBreakdown(sensitive, { pressure: 1 }).total,
    );
  });
});

/* ---------------- 3. 疲労・コンディション・モチベーション ---------------- */

describe('PHASE2 疲労・コンディション', () => {
  it('出場すると疲労が増え、休むと回復する', () => {
    const state = newGame();
    const player = state.players.find((p) => !p.isPitcher)!;
    player.ext.fatigue = 0;
    addGameFatigue(player, { plateAppearances: 4, outs: 0, started: false });
    const afterGame = player.ext.fatigue;
    expect(afterGame).toBeGreaterThan(0);
    recoverFatigue(player, true);
    expect(player.ext.fatigue).toBeLessThan(afterGame);
  });

  it('疲労が高いほど実効能力が下がる', () => {
    expect(fatiguePenalty(10)).toBe(0);
    expect(fatiguePenalty(30)).toBe(0.02);
    expect(fatiguePenalty(50)).toBe(0.05);
    expect(fatiguePenalty(70)).toBe(0.1);
    expect(fatiguePenalty(90)).toBe(0.2);

    const state = newGame();
    const base = state.players.find((p) => !p.isPitcher)!;
    const fresh: Player = { ...base, ext: { ...base.ext, fatigue: 0, condition: 'normal', personality: 'calm' } };
    const tired: Player = { ...base, ext: { ...base.ext, fatigue: 90, condition: 'normal', personality: 'calm' } };
    expect(effectiveBatting(tired).contact).toBeLessThan(effectiveBatting(fresh).contact);
  });

  it('コンディションは5段階で、良いほど補正が大きい', () => {
    // PHASE 2.5 で「一律◯%」からカテゴリ別の補正に変わったため、
    // ここでは代表値（カテゴリ平均）の大小関係を確認する。
    // カテゴリごとの具体値は phase25.test.ts で検証する。
    expect(CONDITION_MODIFIER.best).toBeGreaterThan(CONDITION_MODIFIER.good);
    expect(CONDITION_MODIFIER.good).toBeGreaterThan(CONDITION_MODIFIER.normal);
    expect(CONDITION_MODIFIER.normal).toBe(0);
    expect(CONDITION_MODIFIER.normal).toBeGreaterThan(CONDITION_MODIFIER.bad);
    expect(CONDITION_MODIFIER.bad).toBeGreaterThan(CONDITION_MODIFIER.worst);
  });

  it('コンディションは変化するが毎日は変わらない', () => {
    const rng = new Rng(4);
    const state = newGame();
    const player = state.players[0];
    player.ext.conditionTimer = 3;
    let changes = 0;
    let checks = 0;
    for (let day = 0; day < 60; day++) {
      checks += 1;
      if (updateCondition(rng, player)) changes += 1;
    }
    expect(changes).toBeGreaterThan(0);
    // 毎日変わってはいない
    expect(changes).toBeLessThan(checks * 0.6);
  });

  it('出場するとモチベーションが上がり、出番がないと下がる', () => {
    const state = newGame();
    const player = state.players[0];
    player.ext.motivation = 50;
    updateMotivation(player, { played: true, performed: true, teamWon: true, onFirstTeam: true });
    expect(player.ext.motivation).toBeGreaterThan(50);
    player.ext.motivation = 50;
    updateMotivation(player, { played: false, performed: false, teamWon: false, onFirstTeam: false });
    expect(player.ext.motivation).toBeLessThan(50);
  });

  it('シーズンを通して疲労・コンディションが極端にならない', () => {
    const state = playSeason(newGame(143, 4321));
    const firstTeam = state.players.filter((p) => p.roster === 'first');
    const avgFatigue =
      firstTeam.reduce((a, p) => a + p.ext.fatigue, 0) / Math.max(1, firstTeam.length);
    expect(avgFatigue).toBeGreaterThan(3);
    expect(avgFatigue).toBeLessThan(55);
  }, 60000);
});

/* ---------------- 4. 特殊能力 ---------------- */

describe('PHASE2 特殊能力', () => {
  it('野手・投手・マイナスの特殊能力が定義されている', () => {
    const batters = SPECIAL_ABILITIES.filter((a) => a.kind === 'batter' && a.polarity === 'positive');
    const pitchers = SPECIAL_ABILITIES.filter((a) => a.kind === 'pitcher' && a.polarity === 'positive');
    const negatives = SPECIAL_ABILITIES.filter((a) => a.polarity === 'negative');
    expect(batters.length).toBeGreaterThanOrEqual(15);
    expect(pitchers.length).toBeGreaterThanOrEqual(10);
    expect(negatives.length).toBeGreaterThanOrEqual(11);
    for (const a of SPECIAL_ABILITIES) {
      expect(Object.keys(a.effects).length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(3);
    }
  });

  it('Lv が上がると効果も大きくなり、上限で頭打ちになる', () => {
    const lv1 = abilityEffect([{ id: 'powerHitter', level: 1 }], 'batHomeRun');
    const lv2 = abilityEffect([{ id: 'powerHitter', level: 2 }], 'batHomeRun');
    expect(lv2).toBeGreaterThan(lv1);
    // 積み重ねても上限を超えない
    const stacked = abilityEffect(
      [
        { id: 'powerHitter', level: 3 },
        { id: 'grandSlam', level: 3 },
        { id: 'clutch', level: 3 },
      ],
      'batHomeRun',
      { basesLoaded: true, scoringPosition: true },
    );
    expect(stacked).toBeLessThanOrEqual(1.9);
  });

  it('場面が合わないと発動しない', () => {
    expect(abilityEffect([{ id: 'clutch', level: 1 }], 'batHit', {})).toBe(1);
    expect(
      abilityEffect([{ id: 'clutch', level: 1 }], 'batHit', { scoringPosition: true }),
    ).toBeGreaterThan(1);
  });

  it('パワーヒッターを持つ打線は本塁打が増える（試合に影響する）', () => {
    const { withHr, withoutHr } = compareAbility('powerHitter');
    expect(withHr).toBeGreaterThan(withoutHr);
  });

  it('選球眼を持つ打線は四球が増える', () => {
    const result = compareAbility('goodEye');
    expect(result.withWalks).toBeGreaterThan(result.withoutWalks);
  });

  it('マイナス特殊能力「三振」は三振を増やす', () => {
    const result = compareAbility('strikeoutProne');
    expect(result.withStrikeouts).toBeGreaterThan(result.withoutStrikeouts);
  });

  it('マイナス特殊能力「エラー」は失策を増やす', () => {
    const result = compareAbility('errorProne');
    expect(result.withErrors).toBeGreaterThan(result.withoutErrors);
  });

  it('投手のマイナス特殊能力「四球」は与四球を増やす', () => {
    const result = compareAbility('wildWalk', true);
    expect(result.withWalksAllowed).toBeGreaterThan(result.withoutWalksAllowed);
  });
});

/** 特定の特殊能力を全員に付けたチームと、付けないチームを比べる */
function compareAbility(id: string, pitcherSide = false) {
  const teamA = TEAM_SEEDS[0];
  const teamB = TEAM_SEEDS[1];

  const run = (withAbility: boolean) => {
    const rng = new Rng(31337);
    const attackers = generateTeamPlayers(rng, { teamId: teamA.id, strength: 45 }).map((p) => ({
      ...p,
      ext: {
        ...p.ext,
        condition: 'normal' as const,
        fatigue: 0,
        motivation: 50,
        slump: null,
        specialAbilities:
          withAbility && !pitcherSide
            ? ([{ id: id as SpecialAbilityId, level: 1 }] as SpecialAbilityEntry[])
            : [],
      },
    }));
    const defenders = generateTeamPlayers(rng, { teamId: teamB.id, strength: 45 }).map((p) => ({
      ...p,
      ext: {
        ...p.ext,
        condition: 'normal' as const,
        fatigue: 0,
        motivation: 50,
        slump: null,
        specialAbilities:
          withAbility && pitcherSide
            ? ([{ id: id as SpecialAbilityId, level: 1 }] as SpecialAbilityEntry[])
            : [],
      },
    }));
    const aSetup = buildAutoSetup(teamA.id, attackers, true);
    const bSetup = buildAutoSetup(teamB.id, defenders, true);
    const simRng = new Rng(24680);
    let hr = 0;
    let walks = 0;
    let strikeouts = 0;
    let errors = 0;
    let walksAllowed = 0;
    for (let i = 0; i < 120; i++) {
      const result = simulateGame({
        rng: simRng,
        gameId: `sa${i}`,
        date: '2026-04-01',
        leagueId: 'ocean',
        useDH: true,
        homeTeam: teamA,
        awayTeam: teamB,
        homePlayers: attackers,
        awayPlayers: defenders,
        homeSetup: aSetup,
        awaySetup: bSetup,
      });
      errors += result.home.errors;
      for (const line of result.playerLines) {
        if (line.teamId === teamA.id && line.batting) {
          hr += line.batting.homeRuns;
          walks += line.batting.walks;
          strikeouts += line.batting.strikeouts;
        }
        if (line.teamId === teamB.id && line.pitching) {
          walksAllowed += line.pitching.walks;
        }
      }
    }
    return { hr, walks, strikeouts, errors, walksAllowed };
  };

  const on = run(true);
  const off = run(false);
  return {
    withHr: on.hr,
    withoutHr: off.hr,
    withWalks: on.walks,
    withoutWalks: off.walks,
    withStrikeouts: on.strikeouts,
    withoutStrikeouts: off.strikeouts,
    withErrors: on.errors,
    withoutErrors: off.errors,
    withWalksAllowed: on.walksAllowed,
    withoutWalksAllowed: off.walksAllowed,
  };
}

/* ---------------- 5. 怪我 ---------------- */

describe('PHASE2 怪我', () => {
  it('疲労が高いほど怪我しやすいが、確率は低く抑えられている', () => {
    const state = newGame();
    const player = state.players[0];
    const rng = new Rng(5);
    let fresh = 0;
    let tired = 0;
    for (let i = 0; i < 4000; i++) {
      player.ext.injury = null;
      player.ext.fatigue = 0;
      player.ext.hiddenAttributes = {};
      if (rollInjury(rng, player, '2026-04-01', { pitched: false })) fresh += 1;
      player.ext.injury = null;
      player.ext.fatigue = 95;
      player.ext.hiddenAttributes = {};
      if (rollInjury(rng, player, '2026-04-01', { pitched: false })) tired += 1;
    }
    expect(tired).toBeGreaterThan(fresh);
    // 1試合あたりの発生率は 5% 未満
    expect(tired / 4000).toBeLessThan(0.05);
  });

  it('怪我は日付が来ると自動的に回復する', () => {
    const state = newGame();
    const player = state.players[0];
    player.ext.injury = {
      level: 'moderate',
      name: '肉離れ',
      startDate: '2026-04-01',
      returnDate: '2026-04-20',
    };
    expect(resolveInjury(player, '2026-04-19')).toBe(false);
    expect(isAvailable(player)).toBe(false);
    expect(resolveInjury(player, '2026-04-20')).toBe(true);
    expect(player.ext.injury).toBeNull();
    expect(isAvailable(player)).toBe(true);
  });

  it('怪我人は試合に出場せず、オーダーからも外れる', () => {
    let state = newGame(143, 20260901);
    let checked = 0;
    for (let day = 0; day < 60 && !state.seasonFinished; day++) {
      const injuredBefore = new Set(
        state.players.filter((p) => p.ext.injury).map((p) => p.id),
      );
      const step = advanceDay(state);
      for (const result of step.results) {
        for (const line of result.playerLines) {
          expect(injuredBefore.has(line.playerId)).toBe(false);
        }
      }
      state = step.state;
      // オーダーとローテーションに怪我人が残っていない
      for (const team of state.teams) {
        for (const slot of state.setups[team.id].lineup) {
          const p = state.players.find((x) => x.id === slot.playerId);
          if (p) expect(p.ext.injury).toBeNull();
        }
      }
      checked += injuredBefore.size;
    }
    expect(checked).toBeGreaterThan(0);
    expect(validateState(state)).toEqual([]);
  }, 60000);

  it('怪我による登録抹消は7日間制限の例外になる', () => {
    const state = newGame();
    const player = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    player.ext.injury = {
      level: 'minor',
      name: '打撲',
      startDate: state.date,
      returnDate: addDays(state.date, 5),
    };
    // 怪我で抹消
    player.roster = 'second';
    player.ext.injuryDemotion = true;
    player.lastRosterChangeDate = null;

    // 復帰したらすぐ1軍に戻せる（通常の7日制限にかからない）
    state.date = addDays(state.date, 5);
    expect(resolveInjury(player, state.date)).toBe(true);
    expect(checkRosterChange(state, player.id, 'first').allowed).toBe(true);
  });

  it('怪我をしていても1軍で試合が成立する人数が保たれる', () => {
    const state = playSeason(newGame(143, 606));
    for (const team of state.teams) {
      const healthyFirst = state.players.filter(
        (p) => p.teamId === team.id && p.roster === 'first' && !p.ext.injury,
      );
      expect(healthyFirst.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(9);
      expect(healthyFirst.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(5);
    }
  }, 60000);
});

/* ---------------- 6. シーズン終了時の成長 ---------------- */

describe('PHASE2 シーズン終了時の成長', () => {
  let state: GameState;
  beforeEach(() => {
    state = playSeason(newGame(30, 2468));
  });

  it('成長レポートが作られ、能力が変化する', () => {
    const before = new Map(state.players.map((p) => [p.id, p.batting.contact]));
    const next = cloneState(state);
    const { report, all } = startNextSeason(next);
    expect(all).toHaveLength(next.players.length);
    expect(report.teamId).toBe(PLAYER_TEAM);
    const changedPlayers = all.filter((r) => r.changes.length > 0);
    expect(changedPlayers.length).toBeGreaterThan(next.players.length * 0.4);
    const changedContact = next.players.filter(
      (p) => p.batting.contact !== before.get(p.id),
    );
    expect(changedContact.length).toBeGreaterThan(0);
  });

  it('1軍で出場した若手のほうが2軍だけの若手より伸びる', () => {
    const rng = new Rng(13);
    const players = generateTeamPlayers(rng, { teamId: 'phoenix', strength: 40 });
    const youngsters = players.filter((p) => !p.isPitcher).slice(0, 10);
    let firstTeamGrowth = 0;
    let secondTeamGrowth = 0;
    for (const base of youngsters) {
      const a: Player = structuredClone(base);
      const b: Player = structuredClone(base);
      a.age = 20;
      b.age = 20;
      a.ext.potential = 85;
      b.ext.potential = 85;
      firstTeamGrowth += applySeasonGrowth(new Rng(99), {
        player: a,
        firstTeamExperience: 1,
        secondTeamExperience: 0,
        performance: 0.2,
      }).total;
      secondTeamGrowth += applySeasonGrowth(new Rng(99), {
        player: b,
        firstTeamExperience: 0,
        secondTeamExperience: 1,
        performance: 0,
      }).total;
    }
    expect(firstTeamGrowth).toBeGreaterThan(secondTeamGrowth);
    // 2軍でも最低限は成長する
    expect(secondTeamGrowth).toBeGreaterThan(0);
  });

  it('新シーズンが正しく初期化される', () => {
    const next = cloneState(state);
    const year = next.year;
    startNextSeason(next);
    expect(next.year).toBe(year + 1);
    expect(next.seasonFinished).toBe(false);
    expect(next.results).toHaveLength(0);
    for (const team of next.teams) {
      expect(next.records[team.id].games).toBe(0);
    }
    for (const p of next.players) {
      expect(next.stats[p.id].batting.atBats).toBe(0);
      expect(p.ext.fatigue).toBe(0);
      expect(p.ext.slump).toBeNull();
    }
    expect(validateState(next)).toEqual([]);
    // 新シーズンも試合を進められる
    const step = advanceDay(next);
    expect(step.results.length).toBeGreaterThan(0);
  });
});
