import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay, cloneState } from './engine';
import { Rng } from './rng';
import { TEAM_SEEDS } from './teams';
import { generateTeamPlayers } from './playerGen';
import { buildAutoSetup } from './setup';
import { simulateGame } from './simulation';
import {
  CONDITIONS,
  CONDITION_CATEGORY_MODIFIER,
  CONDITION_LABELS,
  CONDITION_HISTORY_LENGTH,
  conditionBias,
  conditionEventScale,
  updateCondition,
  ABILITY_CATEGORIES,
} from './condition';
import {
  EFFECTIVE_MAX,
  EFFECTIVE_MIN,
  conditionModifierFor,
  effectiveBatting,
  effectiveBreakdown,
  effectiveMultiplierFor,
  effectivePitching,
} from './effective';
import { abilityEffect } from './specialAbilities';
import { clearSave, loadGame, saveGame, SAVE_KEY } from './save';
import { SAVE_VERSION } from './newGame';
import type { ConditionId, GameState, Player } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 250250): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

/** 調子だけを変えた同一選手を作る */
function withCondition(base: Player, condition: ConditionId, overrides: Partial<Player['ext']> = {}): Player {
  return {
    ...base,
    ext: {
      ...base.ext,
      condition,
      fatigue: 0,
      motivation: 50,
      morale: 50,
      slump: null,
      personality: 'calm',
      ...overrides,
    },
  };
}

/* ---------------- 調子の判定 ---------------- */

describe('PHASE2.5 調子5段階', () => {
  it('絶好調・好調・普通・不調・絶不調の5段階が識別できる', () => {
    expect(CONDITIONS).toHaveLength(5);
    expect(CONDITION_LABELS.best).toBe('絶好調');
    expect(CONDITION_LABELS.good).toBe('好調');
    expect(CONDITION_LABELS.normal).toBe('普通');
    expect(CONDITION_LABELS.bad).toBe('不調');
    expect(CONDITION_LABELS.worst).toBe('絶不調');
  });

  it('カテゴリ別の補正値が仕様どおり', () => {
    expect(CONDITION_CATEGORY_MODIFIER.best).toEqual({
      contact: 0.06, power: 0.05, speed: 0.04, defense: 0.04,
      pitchPower: 0.05, pitchControl: 0.04, pitchMovement: 0.04, stamina: 0.03,
    });
    expect(CONDITION_CATEGORY_MODIFIER.good).toEqual({
      contact: 0.03, power: 0.02, speed: 0.02, defense: 0.02,
      pitchPower: 0.03, pitchControl: 0.02, pitchMovement: 0.02, stamina: 0.01,
    });
    for (const category of ABILITY_CATEGORIES) {
      expect(CONDITION_CATEGORY_MODIFIER.normal[category]).toBe(0);
      // 不調・絶不調は好調・絶好調の裏返し
      expect(CONDITION_CATEGORY_MODIFIER.bad[category]).toBeCloseTo(
        -CONDITION_CATEGORY_MODIFIER.good[category],
        6,
      );
      expect(CONDITION_CATEGORY_MODIFIER.worst[category]).toBeCloseTo(
        -CONDITION_CATEGORY_MODIFIER.best[category],
        6,
      );
    }
  });
});

/* ---------------- 実効能力への反映 ---------------- */

describe('PHASE2.5 調子と実効能力', () => {
  const state = newGame();
  const batter = state.players.find((p) => !p.isPitcher)!;
  const pitcher = state.players.find((p) => p.isPitcher)!;

  it('普通のときは調子による補正がない', () => {
    const normal = withCondition(batter, 'normal');
    const breakdown = effectiveBreakdown(normal);
    expect(breakdown.conditionModifier).toBe(0);
    expect(breakdown.finalMultiplier).toBeCloseTo(1, 6);
    const abilities = effectiveBatting(normal);
    expect(abilities.contact).toBeCloseTo(normal.batting.contact, 6);
    expect(abilities.power).toBeCloseTo(normal.batting.power, 6);
  });

  it('絶好調で能力が上がり、絶不調で下がる', () => {
    const best = effectiveBatting(withCondition(batter, 'best'));
    const normal = effectiveBatting(withCondition(batter, 'normal'));
    const worst = effectiveBatting(withCondition(batter, 'worst'));
    expect(best.contact).toBeGreaterThan(normal.contact);
    expect(normal.contact).toBeGreaterThan(worst.contact);
    expect(best.power).toBeGreaterThan(worst.power);

    const bestPit = effectivePitching(withCondition(pitcher, 'best'))!;
    const normalPit = effectivePitching(withCondition(pitcher, 'normal'))!;
    const worstPit = effectivePitching(withCondition(pitcher, 'worst'))!;
    expect(bestPit.control).toBeGreaterThan(normalPit.control);
    expect(normalPit.control).toBeGreaterThan(worstPit.control);
  });

  it('好調 > 普通 > 不調 の順に実効能力が並ぶ', () => {
    const values = CONDITIONS.map((c) => effectiveMultiplierFor(withCondition(batter, c), 'contact'));
    // CONDITIONS は worst→best の順
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('能力カテゴリごとに補正量が異なる（全能力一律ではない）', () => {
    const breakdown = effectiveBreakdown(withCondition(batter, 'best'));
    const contact = breakdown.byCategory.contact;
    const stamina = breakdown.byCategory.stamina;
    const speed = breakdown.byCategory.speed;
    expect(contact).toBeGreaterThan(speed);
    expect(speed).toBeGreaterThan(stamina);

    // 実際の能力値にもカテゴリ差が出る
    const best = withCondition(batter, 'best');
    const abilities = effectiveBatting(best);
    const contactGain = abilities.contact / best.batting.contact;
    const speedGain = abilities.speed / best.batting.speed;
    expect(contactGain).toBeGreaterThan(speedGain);
  });

  it('基本能力は書き換わらない', () => {
    const before = { ...batter.batting };
    effectiveBatting(withCondition(batter, 'best'));
    effectiveBatting(withCondition(batter, 'worst'));
    expect(batter.batting).toEqual(before);
  });

  it('弾道は調子で変わらない（打球の性質のため）', () => {
    const best = effectiveBatting(withCondition(batter, 'best'));
    expect(best.trajectory).toBe(batter.batting.trajectory);
  });

  it('補正が重なっても最終倍率は 0.72〜1.16 に収まる', () => {
    const worstCase = withCondition(batter, 'worst', {
      fatigue: 100,
      motivation: 0,
      morale: 0,
      slump: { until: '2030-01-01', severity: 0.12 },
      personality: 'sensitive',
    });
    const bestCase = withCondition(batter, 'best', {
      fatigue: 0,
      motivation: 100,
      morale: 100,
      personality: 'sensitive',
    });
    for (const category of ABILITY_CATEGORIES) {
      const low = effectiveMultiplierFor(worstCase, category, { teamMorale: 0, pressure: 1 });
      const high = effectiveMultiplierFor(bestCase, category, { teamMorale: 100, closeGame: true });
      expect(low).toBeGreaterThanOrEqual(EFFECTIVE_MIN);
      expect(high).toBeLessThanOrEqual(EFFECTIVE_MAX);
    }
    expect(effectiveBreakdown(worstCase, { teamMorale: 0 }).finalMultiplier).toBeGreaterThanOrEqual(
      EFFECTIVE_MIN,
    );
    expect(effectiveBreakdown(bestCase, { teamMorale: 100 }).finalMultiplier).toBeLessThanOrEqual(
      EFFECTIVE_MAX,
    );
  });

  it('内訳（breakdown）で各補正を個別に確認できる', () => {
    const player = withCondition(batter, 'bad', { fatigue: 70, motivation: 80 });
    const breakdown = effectiveBreakdown(player, { teamMorale: 70 });
    expect(breakdown.base).toBe(1);
    expect(breakdown.conditionModifier).toBeLessThan(0);
    expect(breakdown.fatigueModifier).toBeLessThan(0);
    expect(breakdown.motivationModifier).toBeGreaterThan(0);
    expect(breakdown.moraleModifier).toBeGreaterThan(0);
    expect(breakdown.slumpModifier).toBe(0);
    expect(Object.keys(breakdown.byCategory)).toHaveLength(ABILITY_CATEGORIES.length);
  });
});

/* ---------------- 性格との相互作用 ---------------- */

describe('PHASE2.5 調子と性格', () => {
  const state = newGame();
  const batter = state.players.find((p) => !p.isPitcher)!;

  it('努力家は不調の影響を軽減する（不調 -20% / 絶不調 -15%）', () => {
    const hardWorkerBad = conditionModifierFor('bad', 'contact', 'hardWorker');
    const normalBad = conditionModifierFor('bad', 'contact', 'genius');
    expect(hardWorkerBad).toBeGreaterThan(normalBad);
    expect(hardWorkerBad / normalBad).toBeCloseTo(0.8, 2);

    const hardWorkerWorst = conditionModifierFor('worst', 'contact', 'hardWorker');
    const normalWorst = conditionModifierFor('worst', 'contact', 'genius');
    expect(hardWorkerWorst / normalWorst).toBeCloseTo(0.85, 2);

    // 好調時には差がつかない（不調にだけ効く）
    expect(conditionModifierFor('best', 'contact', 'hardWorker')).toBeCloseTo(
      conditionModifierFor('best', 'contact', 'genius'),
      6,
    );
  });

  it('繊細（気分屋タイプ）は調子の影響を強く受ける', () => {
    const sensitiveBest = conditionModifierFor('best', 'contact', 'sensitive');
    const calmBest = conditionModifierFor('best', 'contact', 'calm');
    expect(sensitiveBest).toBeGreaterThan(calmBest);
    const sensitiveWorst = conditionModifierFor('worst', 'contact', 'sensitive');
    const calmWorst = conditionModifierFor('worst', 'contact', 'calm');
    expect(sensitiveWorst).toBeLessThan(calmWorst);
  });

  it('冷静・職人気質は調子の波が小さい', () => {
    for (const personality of ['calm', 'craftsman'] as const) {
      expect(conditionModifierFor('best', 'contact', personality)).toBeLessThan(
        conditionModifierFor('best', 'contact', 'genius'),
      );
      expect(conditionModifierFor('worst', 'contact', personality)).toBeGreaterThan(
        conditionModifierFor('worst', 'contact', 'genius'),
      );
    }
  });

  it('ムードメーカーはチーム士気の影響を強く受ける', () => {
    const mood = withCondition(batter, 'normal', { personality: 'moodMaker' });
    const other = withCondition(batter, 'normal', { personality: 'genius' });
    const moodHigh = effectiveBreakdown(mood, { teamMorale: 90 }).moraleModifier;
    const otherHigh = effectiveBreakdown(other, { teamMorale: 90 }).moraleModifier;
    expect(moodHigh).toBeGreaterThan(otherHigh);
  });

  it('既存の性格効果（接戦・プレッシャー・疲労）が壊れていない', () => {
    const competitive = withCondition(batter, 'normal', { personality: 'competitive' });
    expect(effectiveBreakdown(competitive, { closeGame: true }).finalMultiplier).toBeGreaterThan(
      effectiveBreakdown(competitive).finalMultiplier,
    );
    const calm = withCondition(batter, 'normal', { personality: 'calm' });
    const sensitive = withCondition(batter, 'normal', { personality: 'sensitive' });
    expect(effectiveBreakdown(calm, { pressure: 1 }).finalMultiplier).toBeGreaterThan(
      effectiveBreakdown(sensitive, { pressure: 1 }).finalMultiplier,
    );
    const myPaceTired = withCondition(batter, 'normal', { personality: 'myPace', fatigue: 85 });
    const sensitiveTired = withCondition(batter, 'normal', { personality: 'sensitive', fatigue: 85 });
    expect(effectiveBreakdown(myPaceTired).fatigueModifier).toBeGreaterThan(
      effectiveBreakdown(sensitiveTired).fatigueModifier,
    );
  });

  it('同じ能力でも性格と調子の組み合わせでパフォーマンスが変わる', () => {
    const a = withCondition(batter, 'good', { personality: 'hardWorker' });
    const b = withCondition(batter, 'good', { personality: 'sensitive' });
    const c = withCondition(batter, 'normal', { personality: 'craftsman' });
    const values = [a, b, c].map((p) => effectiveMultiplierFor(p, 'contact'));
    expect(new Set(values.map((v) => v.toFixed(4))).size).toBe(3);
  });
});

/* ---------------- 疲労との相互作用 ---------------- */

describe('PHASE2.5 調子と疲労', () => {
  const state = newGame();

  function conditionDistribution(fatigue: number, seed: number): Record<ConditionId, number> {
    const rng = new Rng(seed);
    const counts: Record<ConditionId, number> = { worst: 0, bad: 0, normal: 0, good: 0, best: 0 };
    const player = cloneState(state).players[0];
    player.ext.fatigue = fatigue;
    player.ext.motivation = 55;
    player.ext.morale = 50;
    player.ext.condition = 'normal';
    player.ext.conditionTimer = 0;
    for (let day = 0; day < 4000; day++) {
      player.ext.fatigue = fatigue;
      updateCondition(rng, player);
      counts[player.ext.condition] += 1;
    }
    return counts;
  }

  it('疲労が高いと好調・絶好調になりにくい', () => {
    const fresh = conditionDistribution(5, 11);
    const tired = conditionDistribution(90, 11);
    const freshGood = fresh.good + fresh.best;
    const tiredGood = tired.good + tired.best;
    expect(freshGood).toBeGreaterThan(tiredGood);
    expect(conditionBias({ ext: { fatigue: 90, motivation: 55, morale: 50 } } as Player)).toBeLessThan(
      conditionBias({ ext: { fatigue: 0, motivation: 55, morale: 50 } } as Player),
    );
  });

  it('疲労が低いと好調になりやすい', () => {
    const fresh = conditionDistribution(5, 22);
    expect(fresh.good + fresh.best).toBeGreaterThan(0);
    expect(fresh.best).toBeGreaterThan(0);
  });

  it('疲労が高くても絶好調になる可能性は残る（疲労だけで決まらない）', () => {
    const tired = conditionDistribution(95, 33);
    expect(tired.best + tired.good).toBeGreaterThan(0);
    expect(tired.normal).toBeGreaterThan(0);
  });
});

/* ---------------- 日次変動 ---------------- */

describe('PHASE2.5 調子の日次変動', () => {
  const state = newGame();

  it('日次更新で調子が変化する', () => {
    const rng = new Rng(7);
    const player = cloneState(state).players[0];
    player.ext.conditionTimer = 0;
    let changes = 0;
    for (let day = 0; day < 120; day++) {
      if (updateCondition(rng, player)) changes += 1;
    }
    expect(changes).toBeGreaterThan(5);
    expect(changes).toBeLessThan(120);
  });

  it('通常は1段階ずつ動き、いきなり極端な状態へは飛びにくい', () => {
    const rng = new Rng(8);
    const player = cloneState(state).players[0];
    player.ext.conditionTimer = 0;
    let jumps = 0;
    let steps = 0;
    for (let day = 0; day < 3000; day++) {
      const before = CONDITIONS.indexOf(player.ext.condition);
      updateCondition(rng, player);
      const after = CONDITIONS.indexOf(player.ext.condition);
      const distance = Math.abs(after - before);
      if (distance > 0) steps += 1;
      if (distance >= 2) jumps += 1;
    }
    expect(steps).toBeGreaterThan(0);
    // 2段階以上の移動は全変化の 15% 未満
    expect(jumps / steps).toBeLessThan(0.15);
  });

  it('シードを固定すれば結果が再現できる', () => {
    const run = () => {
      const rng = new Rng(1234);
      const player = cloneState(state).players[0];
      player.ext.condition = 'normal';
      player.ext.conditionTimer = 0;
      const log: ConditionId[] = [];
      for (let day = 0; day < 50; day++) {
        updateCondition(rng, player);
        log.push(player.ext.condition);
      }
      return log.join(',');
    };
    expect(run()).toBe(run());
  });

  it('調子の履歴が最大7日分だけ保存される', () => {
    const rng = new Rng(9);
    const player = cloneState(state).players[0];
    player.ext.conditionHistory = [];
    for (let day = 0; day < 30; day++) updateCondition(rng, player);
    expect(player.ext.conditionHistory).toHaveLength(CONDITION_HISTORY_LENGTH);
    for (const condition of player.ext.conditionHistory) {
      expect(CONDITIONS).toContain(condition);
    }
  });

  it('シーズンを通した調子の分布が目標に近い', () => {
    let s = newGame(143, 5150);
    const counts: Record<ConditionId, number> = { worst: 0, bad: 0, normal: 0, good: 0, best: 0 };
    for (let day = 0; day < 120 && !s.seasonFinished; day++) {
      s = advanceDay(s).state;
      for (const p of s.players) counts[p.ext.condition] += 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const rate = (c: ConditionId) => counts[c] / total;
    // 普通が最も多く、両端が少ない山型になる
    expect(rate('normal')).toBeGreaterThan(rate('good'));
    expect(rate('normal')).toBeGreaterThan(rate('bad'));
    expect(rate('good')).toBeGreaterThan(rate('best'));
    expect(rate('bad')).toBeGreaterThan(rate('worst'));
    expect(rate('best')).toBeGreaterThan(0.02);
    expect(rate('worst')).toBeGreaterThan(0.02);
  }, 60000);
});

/* ---------------- 特殊能力との相互作用 ---------------- */

describe('PHASE2.5 調子と特殊能力', () => {
  it('好調ほど長所が出やすく、不調ほど出にくい', () => {
    const entries = [{ id: 'powerHitter' as const, level: 1 }];
    const best = abilityEffect(entries, 'batHomeRun', {}, conditionEventScale('best'));
    const normal = abilityEffect(entries, 'batHomeRun', {}, conditionEventScale('normal'));
    const worst = abilityEffect(entries, 'batHomeRun', {}, conditionEventScale('worst'));
    expect(best).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(worst);
  });

  it('好調ならマイナス特殊能力の影響が小さくなる', () => {
    const entries = [{ id: 'errorProne' as const, level: 1 }];
    const best = abilityEffect(entries, 'error', {}, conditionEventScale('best'));
    const normal = abilityEffect(entries, 'error', {}, conditionEventScale('normal'));
    const worst = abilityEffect(entries, 'error', {}, conditionEventScale('worst'));
    expect(best).toBeLessThan(normal);
    expect(worst).toBeGreaterThan(normal);
  });

  it('調子で補正しても効果キーごとの上限を超えない', () => {
    const stacked = [
      { id: 'powerHitter' as const, level: 3 },
      { id: 'grandSlam' as const, level: 3 },
      { id: 'clutch' as const, level: 3 },
    ];
    const value = abilityEffect(
      stacked,
      'batHomeRun',
      { basesLoaded: true, scoringPosition: true },
      conditionEventScale('best'),
    );
    expect(value).toBeLessThanOrEqual(1.9);

    const errors = abilityEffect(
      [
        { id: 'errorProne' as const, level: 3 },
        { id: 'throwingTrouble' as const, level: 3 },
      ],
      'error',
      {},
      conditionEventScale('worst'),
    );
    expect(errors).toBeLessThanOrEqual(2);
  });

  it('特殊能力を持たない選手は調子でイベント係数が変わらない', () => {
    expect(abilityEffect([], 'batHomeRun', {}, conditionEventScale('best'))).toBe(1);
  });
});

/* ---------------- 試合への反映 ---------------- */

describe('PHASE2.5 調子が試合結果に影響する', () => {
  function runSeries(condition: ConditionId) {
    const rng = new Rng(80808);
    const teamA = TEAM_SEEDS[0];
    const teamB = TEAM_SEEDS[1];
    const attackers = generateTeamPlayers(rng, { teamId: teamA.id, strength: 45 }).map((p) => ({
      ...p,
      ext: { ...p.ext, condition, fatigue: 0, motivation: 50, slump: null, personality: 'calm' as const },
    }));
    const defenders = generateTeamPlayers(rng, { teamId: teamB.id, strength: 45 }).map((p) => ({
      ...p,
      ext: {
        ...p.ext,
        condition: 'normal' as ConditionId,
        fatigue: 0,
        motivation: 50,
        slump: null,
        personality: 'calm' as const,
      },
    }));
    const aSetup = buildAutoSetup(teamA.id, attackers, true);
    const bSetup = buildAutoSetup(teamB.id, defenders, true);
    const simRng = new Rng(60606);
    let wins = 0;
    let runs = 0;
    let hits = 0;
    let atBats = 0;
    const games = 150;
    for (let i = 0; i < games; i++) {
      const result = simulateGame({
        rng: simRng,
        gameId: `c${i}`,
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
      if (result.winnerTeamId === teamA.id) wins += 1;
      runs += result.home.runs;
      for (const line of result.playerLines) {
        if (line.teamId === teamA.id && line.batting) {
          hits += line.batting.hits;
          atBats += line.batting.atBats;
        }
      }
    }
    return { winRate: wins / games, runs: runs / games, average: hits / atBats };
  }

  it('絶好調 > 普通 > 絶不調 の順に成績が良くなる', () => {
    const best = runSeries('best');
    const normal = runSeries('normal');
    const worst = runSeries('worst');

    expect(best.average).toBeGreaterThan(worst.average);
    expect(best.runs).toBeGreaterThan(worst.runs);
    expect(best.winRate).toBeGreaterThan(worst.winRate);
    expect(normal.average).toBeGreaterThan(worst.average);
    expect(best.average).toBeGreaterThan(normal.average);

    // ただし調子だけで勝敗が決まるほどではない
    expect(best.winRate).toBeLessThan(0.85);
    expect(worst.winRate).toBeGreaterThan(0.15);
    expect(best.average - worst.average).toBeLessThan(0.06);
  }, 60000);
});

/* ---------------- セーブ・ロード ---------------- */

describe('PHASE2.5 調子の保存', () => {
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

  it('調子と履歴が保存・復元される', () => {
    let state = newGame(30, 4545);
    for (let i = 0; i < 10; i++) state = advanceDay(state).state;
    const sample = state.players.find((p) => p.teamId === PLAYER_TEAM)!;
    sample.ext.condition = 'best';
    saveGame(state);

    const loaded = loadGame()!;
    const restored = loaded.players.find((p) => p.id === sample.id)!;
    expect(restored.ext.condition).toBe('best');
    expect(restored.ext.conditionHistory).toEqual(sample.ext.conditionHistory);
    expect(restored.ext.conditionHistory.length).toBeGreaterThan(0);
    expect(restored.ext.conditionHistory.length).toBeLessThanOrEqual(CONDITION_HISTORY_LENGTH);
    clearSave();
  });

  it('調子の履歴がない古いセーブ(v3)でもクラッシュしない', () => {
    const state = newGame(10, 6767);
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    legacy.version = 3;
    for (const player of legacy.players) {
      delete (player.ext as Partial<Player['ext']>).conditionHistory;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded.version).toBe(SAVE_VERSION);
    for (const player of loaded.players) {
      expect(Array.isArray(player.ext.conditionHistory)).toBe(true);
      expect(CONDITIONS).toContain(player.ext.condition);
    }
    // 読み込み後もそのまま試合を進められる
    const step = advanceDay(loaded);
    expect(step.results.length).toBeGreaterThan(0);
  });
});
