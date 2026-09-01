import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startOffseason, completeOffseason } from './season';
import { Rng } from './rng';
import {
  availableProspects,
  beginDraftPicks,
  currentPick,
  evaluateProspect,
  evaluateProspectScouted,
  generateProspects,
  makePick,
} from './draft';
import {
  SCOUT_CATEGORIES,
  SCOUT_COST,
  SCOUT_POINTS_PER_YEAR,
  SCOUT_PROGRESS_STEP,
  abilityRangeText,
  buildInitialReport,
  confidenceLabel,
  createScoutAbilities,
  investigate,
  overallProgress,
  reportFor,
  runCpuScouting,
  scoutAccuracy,
  scoutedEvaluation,
  viewReport,
} from './scouting';
import { overallRating } from './rating';
import { potentialLabel, scoutedPotentialLabel } from './growth';
import { personalityDef } from './personality';
import { abilityEffect, specialAbilityDef } from './specialAbilities';
import { autoPick } from './draft';
import { clearSave, loadGame, saveGame, SAVE_KEY } from './save';
import { CONDITIONS } from './condition';
import { effectiveBreakdown, EFFECTIVE_MIN, EFFECTIVE_MAX } from './effective';
import type {
  DraftProspect,
  GameState,
  Player,
  ScoutCategory,
  ScoutingState,
  TeamScoutAbility,
} from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 10, seed = 320320): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/** ドラフト（スカウト期間）まで進めた状態を作る */
function toScoutingPhase(seed = 320320): GameState {
  let s = playSeason(newGame(10, seed));
  for (const p of s.players.slice(0, 30)) p.age = 41;
  s = cloneState(s);
  startOffseason(s);
  return s;
}

const LOW: TeamScoutAbility = { currentAbility: 30, potential: 30, personality: 30, skills: 30 };
const HIGH: TeamScoutAbility = { currentAbility: 85, potential: 85, personality: 85, skills: 85 };

function soloScouting(ability: TeamScoutAbility, points = 9999): ScoutingState {
  return { year: 2026, teams: { t: { ability, points, reports: {} } } };
}

/** 指定進行度まで調査したレポートを返す */
function reportAt(
  scouting: ScoutingState,
  prospect: DraftProspect,
  category: ScoutCategory,
  steps: number,
) {
  for (let i = 0; i < steps; i++) investigate(scouting, 't', prospect, category);
  return reportFor(scouting, 't', prospect, scouting.teams.t.ability);
}

/* ---------------- スカウト能力 ---------------- */

describe('PHASE3.2 スカウト能力', () => {
  it('球団ごとにスカウト能力を持つ', () => {
    const state = newGame();
    expect(state.scouting).toBeDefined();
    for (const team of state.teams) {
      const entry = state.scouting.teams[team.id];
      expect(entry).toBeDefined();
      for (const key of ['currentAbility', 'potential', 'personality', 'skills'] as const) {
        expect(entry.ability[key]).toBeGreaterThanOrEqual(20);
        expect(entry.ability[key]).toBeLessThanOrEqual(95);
      }
      expect(entry.points).toBe(SCOUT_POINTS_PER_YEAR);
    }
    // 全球団が同じ能力ではない
    const summaries = state.teams.map((t) => state.scouting.teams[t.id].ability.potential);
    expect(new Set(summaries).size).toBeGreaterThan(3);
  });

  it('初期格差が大きすぎない', () => {
    const rng = new Rng(4242);
    const teams = newGame().teams;
    const abilities = createScoutAbilities(teams, rng);
    const values = teams.map((t) => abilities[t.id].potential);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(55);
  });

  it('スカウト能力と調査進行度の両方が精度に影響する', () => {
    expect(scoutAccuracy(30, 100)).toBeLessThan(scoutAccuracy(85, 100));
    expect(scoutAccuracy(55, 30)).toBeLessThan(scoutAccuracy(55, 100));
    // 100%調査でも低スカウトは完全正確にならない
    expect(scoutAccuracy(30, 100)).toBeLessThan(0.75);
    expect(scoutAccuracy(85, 100)).toBeGreaterThan(0.85);
    expect(scoutAccuracy(100, 100)).toBeLessThanOrEqual(0.97);
  });

  it('高能力スカウトのほうが平均誤差が小さい', () => {
    const rng = new Rng(11);
    const prospects = generateProspects(rng, 2026, 12);
    const measure = (ability: TeamScoutAbility) => {
      const scouting = soloScouting(ability);
      let error = 0;
      for (const prospect of prospects.slice(0, 60)) {
        const report = reportAt(scouting, prospect, 'currentAbility', 3);
        const center = (report.estimate.abilityLow + report.estimate.abilityHigh) / 2;
        error += Math.abs(center - overallRating(prospect.player));
      }
      return error / 60;
    };
    expect(measure(HIGH)).toBeLessThan(measure(LOW));
  });
});

/* ---------------- 調査進行度とポイント ---------------- */

describe('PHASE3.2 調査進行度とポイント', () => {
  const rng = new Rng(77);
  const prospects = generateProspects(rng, 2026, 12);

  it('調査すると進行度が増える', () => {
    const scouting = soloScouting(LOW);
    const prospect = prospects[0];
    const before = viewReport(scouting, 't', prospect).progress.potential;
    expect(before).toBe(0);
    investigate(scouting, 't', prospect, 'potential');
    expect(scouting.teams.t.reports[prospect.id].progress.potential).toBe(SCOUT_PROGRESS_STEP);
  });

  it('進行度は100を超えない', () => {
    const scouting = soloScouting(LOW);
    const prospect = prospects[1];
    for (let i = 0; i < 10; i++) investigate(scouting, 't', prospect, 'skills');
    const report = scouting.teams.t.reports[prospect.id];
    expect(report.progress.skills).toBe(100);
    // 完了後はそれ以上調査できない
    expect(investigate(scouting, 't', prospect, 'skills').ok).toBe(false);
  });

  it('ポイントが正しく消費される', () => {
    const scouting = soloScouting(LOW, 20);
    const prospect = prospects[2];
    investigate(scouting, 't', prospect, 'currentAbility');
    expect(scouting.teams.t.points).toBe(20 - SCOUT_COST.currentAbility);
    investigate(scouting, 't', prospect, 'potential');
    expect(scouting.teams.t.points).toBe(20 - SCOUT_COST.currentAbility - SCOUT_COST.potential);
  });

  it('ポイント不足では調査できない', () => {
    const scouting = soloScouting(LOW, 1);
    const prospect = prospects[3];
    const result = investigate(scouting, 't', prospect, 'potential');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('使い切りました');
    expect(scouting.teams.t.points).toBe(1);
    expect(scouting.teams.t.reports[prospect.id]).toBeUndefined();
  });

  it('ドラフトのたびにポイントが回復し、前年の調査結果は片付けられる', () => {
    let s = toScoutingPhase(5150);
    const entry = s.scouting.teams[PLAYER_TEAM];
    const prospect = s.draft!.prospects[0];
    investigate(s.scouting, PLAYER_TEAM, prospect, 'potential');
    expect(entry.points).toBeLessThan(SCOUT_POINTS_PER_YEAR);
    expect(Object.keys(entry.reports).length).toBeGreaterThan(0);

    completeOffseason(s);
    s = playSeason(s);
    startOffseason(s);
    const next = s.scouting.teams[PLAYER_TEAM];
    expect(next.points).toBe(SCOUT_POINTS_PER_YEAR);
    // 前年の候補のレポートは残っていない
    expect(next.reports[prospect.id]).toBeUndefined();
  }, 60000);

  it('年間ポイントで全候補を完全調査はできない', () => {
    const fullCost = SCOUT_CATEGORIES.reduce((sum, c) => sum + SCOUT_COST[c] * 3, 0);
    expect(fullCost * 108).toBeGreaterThan(SCOUT_POINTS_PER_YEAR * 10);
    // 浅い調査なら20人以上見られる
    expect(Math.floor(SCOUT_POINTS_PER_YEAR / SCOUT_COST.currentAbility)).toBeGreaterThanOrEqual(20);
  });
});

/* ---------------- 現在能力の推定 ---------------- */

describe('PHASE3.2 現在能力の推定', () => {
  const rng = new Rng(31);
  const prospects = generateProspects(rng, 2026, 12);

  it('真の能力値を書き換えない', () => {
    const prospect = prospects[0];
    const before = JSON.stringify(prospect.player.batting);
    const beforePotential = prospect.player.ext.potential;
    const scouting = soloScouting(HIGH);
    reportAt(scouting, prospect, 'currentAbility', 3);
    reportAt(scouting, prospect, 'potential', 3);
    expect(JSON.stringify(prospect.player.batting)).toBe(before);
    expect(prospect.player.ext.potential).toBe(beforePotential);
  });

  it('進行度が低いほど評価の幅が広く、進むほど狭まる', () => {
    const scouting = soloScouting(LOW);
    const prospect = prospects[1];
    const initial = viewReport(scouting, 't', prospect);
    const initialWidth = initial.estimate.abilityHigh - initial.estimate.abilityLow;
    const later = reportAt(scouting, prospect, 'currentAbility', 3);
    const laterWidth = later.estimate.abilityHigh - later.estimate.abilityLow;
    expect(laterWidth).toBeLessThan(initialWidth);
    expect(laterWidth).toBeGreaterThan(0);
  });

  it('調査が進むほど真値へ近づく（別の値へ飛ばない）', () => {
    const scouting = soloScouting(HIGH);
    const prospect = prospects[2];
    const truth = overallRating(prospect.player);
    const errors: number[] = [];
    for (let step = 0; step <= 3; step++) {
      const report =
        step === 0
          ? viewReport(scouting, 't', prospect)
          : reportAt(scouting, prospect, 'currentAbility', 1);
      const center = (report.estimate.abilityLow + report.estimate.abilityHigh) / 2;
      errors.push(Math.abs(center - truth));
    }
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]).toBeLessThanOrEqual(errors[i - 1] + 0.6);
    }
    expect(errors[errors.length - 1]).toBeLessThan(errors[0]);
  });

  it('同じ調査状況なら何度読んでも同じ結果になる', () => {
    const scouting = soloScouting(LOW);
    const prospect = prospects[3];
    const report = reportAt(scouting, prospect, 'currentAbility', 2);
    const first = abilityRangeText(report);
    for (let i = 0; i < 5; i++) {
      expect(abilityRangeText(viewReport(scouting, 't', prospect))).toBe(first);
    }
  });

  it('未調査でも大まかな評価は見える（指名不能にならない）', () => {
    const scouting = soloScouting(LOW);
    for (const prospect of prospects.slice(0, 10)) {
      const report = viewReport(scouting, 't', prospect);
      expect(report.estimate.abilityLow).toBeGreaterThan(0);
      expect(report.estimate.abilityHigh).toBeGreaterThan(report.estimate.abilityLow);
      expect(abilityRangeText(report)).toMatch(/\d+〜\d+/);
    }
  });
});

/* ---------------- 将来性 ---------------- */

describe('PHASE3.2 将来性の推定', () => {
  const rng = new Rng(313);
  const prospects = generateProspects(rng, 2026, 12);

  it('既存の scoutedPotentialLabel が仕様どおり動く', () => {
    expect(scoutedPotentialLabel(85, 1, 1)).toBe('非常に高い');
    expect(scoutedPotentialLabel(20, 1, 1)).toBe('非常に低い');
    // 同じ引数なら常に同じ結果
    expect(scoutedPotentialLabel(60, 0.4, 12345)).toBe(scoutedPotentialLabel(60, 0.4, 12345));
  });

  it('未調査では将来性が表示されない', () => {
    const scouting = soloScouting(HIGH);
    const report = viewReport(scouting, 't', prospects[0]);
    expect(report.progress.potential).toBe(0);
    expect(report.estimate.potential).toBeNull();
  });

  it('高精度ほど真の将来性ラベルに近づく', () => {
    const order = ['非常に低い', '低い', '普通', '高い', '非常に高い'];
    const measure = (ability: TeamScoutAbility, steps: number) => {
      const scouting = soloScouting(ability);
      let error = 0;
      const sample = prospects.slice(0, 60);
      for (const prospect of sample) {
        const report = reportAt(scouting, prospect, 'potential', steps);
        const trueLabel = potentialLabel(prospect.player.ext.potential);
        error += Math.abs(
          order.indexOf(report.estimate.potential!) - order.indexOf(trueLabel),
        );
      }
      return error / sample.length;
    };
    const lowShallow = measure(LOW, 1);
    const lowFull = measure(LOW, 3);
    const highFull = measure(HIGH, 3);
    expect(lowFull).toBeLessThanOrEqual(lowShallow);
    expect(highFull).toBeLessThan(lowFull);
    expect(highFull).toBeLessThan(0.3);
  });

  it('低精度では誤判定が起こりうる', () => {
    const scouting = soloScouting(LOW);
    let wrong = 0;
    for (const prospect of prospects.slice(0, 60)) {
      const report = reportAt(scouting, prospect, 'potential', 1);
      if (report.estimate.potential !== potentialLabel(prospect.player.ext.potential)) wrong += 1;
    }
    expect(wrong).toBeGreaterThan(0);
  });

  it('信頼度が精度から決まる', () => {
    expect(confidenceLabel(0.9)).toBe('非常に高い');
    expect(confidenceLabel(0.7)).toBe('高');
    expect(confidenceLabel(0.5)).toBe('普通');
    expect(confidenceLabel(0.2)).toBe('低');
  });
});

/* ---------------- 性格・成長タイプ ---------------- */

describe('PHASE3.2 性格・成長タイプの推定', () => {
  const rng = new Rng(515);
  const prospects = generateProspects(rng, 2026, 12);

  it('未調査では性格・成長タイプを表示しない', () => {
    const scouting = soloScouting(HIGH);
    const report = viewReport(scouting, 't', prospects[0]);
    expect(report.estimate.personality).toBeNull();
    expect(report.estimate.growthType).toBeNull();
  });

  it('調査を進めると段階的に情報が解放される', () => {
    const scouting = soloScouting(HIGH);
    const prospect = prospects[1];
    const step1 = reportAt(scouting, prospect, 'personality', 1);
    expect(step1.estimate.personality).toContain('タイプの傾向');
    const step3 = reportAt(scouting, prospect, 'personality', 2);
    expect(step3.estimate.personality).not.toContain('タイプの傾向');
    expect(step3.estimate.growthType).not.toBeNull();
  });

  it('高精度では正確な性格・成長タイプを取得できる', () => {
    const scouting = soloScouting(HIGH);
    let correct = 0;
    const sample = prospects.slice(0, 60);
    for (const prospect of sample) {
      const report = reportAt(scouting, prospect, 'personality', 3);
      const trueName = personalityDef(prospect.player.ext.personality).name;
      if (report.estimate.personality === trueName) correct += 1;
    }
    expect(correct / sample.length).toBeGreaterThan(0.7);
  });

  it('低精度では誤認もあるが、正解が誤答に戻ることはない', () => {
    const scouting = soloScouting(LOW);
    const prospect = prospects[2];
    const trueName = personalityDef(prospect.player.ext.personality).name;
    let sawCorrect = false;
    for (let step = 1; step <= 3; step++) {
      const report = reportAt(scouting, prospect, 'personality', 1);
      const exact = report.estimate.personality === trueName;
      if (sawCorrect) {
        expect(report.estimate.personality).toContain(trueName);
      }
      if (exact) sawCorrect = true;
    }
  });
});

/* ---------------- 特殊能力 ---------------- */

describe('PHASE3.2 特殊能力の発見', () => {
  const rng = new Rng(717);
  const prospects = generateProspects(rng, 2026, 12);

  it('未調査では特殊能力が表示されない', () => {
    const scouting = soloScouting(HIGH);
    for (const prospect of prospects.slice(0, 20)) {
      expect(viewReport(scouting, 't', prospect).estimate.skills).toHaveLength(0);
    }
  });

  it('調査を進めると発見数が増え、詳細も分かる', () => {
    const scouting = soloScouting(HIGH);
    const prospect = prospects.find((p) => p.player.ext.specialAbilities.length >= 2)!;
    const step1 = reportAt(scouting, prospect, 'skills', 1).estimate.skills.length;
    const step3 = reportAt(scouting, prospect, 'skills', 2).estimate.skills;
    expect(step3.length).toBeGreaterThanOrEqual(step1);
    expect(step3.some((s) => s.detail === 'full' || s.detail === 'name')).toBe(true);
  });

  it('発見した能力は実在する能力のみで、真のデータと一致する', () => {
    const scouting = soloScouting(HIGH);
    for (const prospect of prospects.slice(0, 40)) {
      const report = reportAt(scouting, prospect, 'skills', 3);
      const truth = new Set(prospect.player.ext.specialAbilities.map((e) => e.id));
      for (const skill of report.estimate.skills) {
        expect(truth.has(skill.id as never)).toBe(true);
        expect(specialAbilityDef(skill.id as never)?.polarity).toBe(skill.polarity);
      }
    }
  });

  it('Lv情報は十分に調査したときだけ公開される', () => {
    const scouting = soloScouting(HIGH);
    const shallow = reportAt(scouting, prospects[3], 'skills', 1);
    for (const skill of shallow.estimate.skills) {
      if (skill.detail !== 'full') expect(skill.level).toBeUndefined();
    }
    const deep = reportAt(scouting, prospects[3], 'skills', 2);
    for (const skill of deep.estimate.skills) {
      if (skill.detail === 'full') expect(skill.level).toBeGreaterThanOrEqual(1);
    }
  });

  it('マイナス特殊能力も発見でき、プラスより見つけにくい', () => {
    const scouting = soloScouting(HIGH);
    let positiveFound = 0;
    let positiveTotal = 0;
    let negativeFound = 0;
    let negativeTotal = 0;
    let shallowNegative = 0;
    const shallowScouting = soloScouting(LOW);
    for (const prospect of prospects.slice(0, 80)) {
      const full = reportAt(scouting, prospect, 'skills', 3);
      const shallow = reportAt(shallowScouting, prospect, 'skills', 1);
      const found = new Set(full.estimate.skills.map((s) => s.id));
      const shallowFound = new Set(shallow.estimate.skills.map((s) => s.id));
      for (const entry of prospect.player.ext.specialAbilities) {
        const def = specialAbilityDef(entry.id)!;
        if (def.polarity === 'positive') {
          positiveTotal += 1;
          if (found.has(entry.id)) positiveFound += 1;
        } else {
          negativeTotal += 1;
          if (found.has(entry.id)) negativeFound += 1;
          if (shallowFound.has(entry.id)) shallowNegative += 1;
        }
      }
    }
    expect(negativeTotal).toBeGreaterThan(0);
    expect(negativeFound).toBeGreaterThan(0);
    // 完全調査ならマイナスもほぼ見抜ける
    expect(negativeFound / negativeTotal).toBeGreaterThan(0.7);
    // 浅い調査では見落としが多い
    expect(shallowNegative / negativeTotal).toBeLessThan(negativeFound / negativeTotal);
    expect(positiveFound / positiveTotal).toBeGreaterThan(0.8);
  });
});

/* ---------------- 球団ごとの独立性 ---------------- */

describe('PHASE3.2 球団ごとの情報', () => {
  it('A球団の調査結果をB球団は知らない', () => {
    const s = toScoutingPhase(2468);
    const prospect = s.draft!.prospects[0];
    investigate(s.scouting, PLAYER_TEAM, prospect, 'potential');
    investigate(s.scouting, PLAYER_TEAM, prospect, 'potential');

    const mine = s.scouting.teams[PLAYER_TEAM].reports[prospect.id];
    expect(mine.progress.potential).toBe(SCOUT_PROGRESS_STEP * 2);

    // 別球団の記録は完全に別物（同じオブジェクトを共有していない）
    const other = s.scouting.teams['whitefox'];
    const otherReport = other.reports[prospect.id];
    expect(otherReport).not.toBe(mine);
    const otherBefore = otherReport ? otherReport.progress.potential : null;

    // プレイヤー球団がさらに調査しても他球団の記録は変わらない
    investigate(s.scouting, PLAYER_TEAM, prospect, 'potential');
    expect(mine.progress.potential).toBe(100);
    expect(other.reports[prospect.id]?.progress.potential ?? null).toBe(otherBefore);
    // 推定内容も球団ごとに独立して保持される
    if (otherReport) {
      expect(otherReport.estimate).not.toBe(mine.estimate);
    }
  });

  it('球団ごとに推定結果が異なる', () => {
    const rng = new Rng(818);
    const prospects = generateProspects(rng, 2026, 12);
    const a = soloScouting(LOW);
    const b: ScoutingState = { year: 2026, teams: { t: { ability: HIGH, points: 9999, reports: {} } } };
    const labels = new Set<string>();
    for (const prospect of prospects.slice(0, 30)) {
      labels.add(
        `${reportAt(a, prospect, 'potential', 1).estimate.potential}|${
          reportAt(b, prospect, 'potential', 1).estimate.potential
        }`,
      );
    }
    // 同じ候補でも球団によって評価が割れるケースがある
    const differing = [...labels].filter((l) => {
      const [x, y] = l.split('|');
      return x !== y;
    });
    expect(differing.length).toBeGreaterThan(0);
  });

  it('球団ごとに調査ポイントが独立している', () => {
    const s = toScoutingPhase(1357);
    const before = s.scouting.teams['bluewave'].points;
    const prospect = s.draft!.prospects[1];
    investigate(s.scouting, PLAYER_TEAM, prospect, 'skills');
    expect(s.scouting.teams['bluewave'].points).toBe(before);
  });
});

/* ---------------- ドラフトとの接続 ---------------- */

describe('PHASE3.2 ドラフトとの接続', () => {
  it('ドラフトはスカウト期間から始まる', () => {
    const s = toScoutingPhase(9753);
    expect(s.draft!.phase).toBe('scouting');
    expect(s.draft!.picks).toHaveLength(0);
    // 指名を開始するとCPUが動く
    beginDraftPicks(s, new Rng(1));
    expect(s.draft!.phase).toBe('picking');
    expect(currentPick(s.draft!)).not.toBeNull();
  });

  it('CPUがスカウトを行い、その結果で指名する', () => {
    const s = toScoutingPhase(8642);
    const cpuTeam = s.teams.find((t) => t.id !== PLAYER_TEAM)!;
    const cpu = s.scouting.teams[cpuTeam.id];
    // startOffseason の中で CPU が調査済み
    expect(Object.keys(cpu.reports).length).toBeGreaterThanOrEqual(4);
    // ポイントをおおむね使い切っている
    expect(cpu.points).toBeLessThan(SCOUT_POINTS_PER_YEAR);
    expect(cpu.points).toBeLessThan(SCOUT_COST.potential + SCOUT_COST.currentAbility + 4);

    // 調査済みの候補は推定値で評価される
    const prospectId = Object.keys(cpu.reports)[0];
    const prospect = s.draft!.prospects.find((p) => p.id === prospectId)!;
    const roster = s.players.filter((p) => p.teamId === cpuTeam.id);
    const withReport = evaluateProspectScouted(prospect, roster, cpu.reports[prospectId]);
    const withoutReport = evaluateProspectScouted(prospect, roster, undefined);
    expect(Number.isFinite(withReport)).toBe(true);
    expect(withReport).not.toBe(withoutReport);
  });

  it('CPUは未調査の候補を真の潜在能力では評価しない', () => {
    const rng = new Rng(963);
    const prospects = generateProspects(rng, 2026, 12);
    const hidden = prospects.find((p) => p.player.ext.potential >= 60);
    if (!hidden) return;
    const value = scoutedEvaluation(undefined, hidden);
    expect(value.potential).toBe(45);
    expect(value.potential).not.toBe(hidden.player.ext.potential);
  });

  it('スカウト情報を参照してもドラフトが最後まで完了する', () => {
    const s = toScoutingPhase(1122);
    beginDraftPicks(s, new Rng(2));
    let guard = 0;
    while (currentPick(s.draft!) && guard++ < 200) {
      const slot = currentPick(s.draft!)!;
      if (slot.teamId === PLAYER_TEAM) {
        makePick(s.draft!, availableProspects(s.draft!)[0].id);
        // CPU の続きを進める
        const rng = new Rng(3);
        for (let i = 0; i < 20 && currentPick(s.draft!)?.teamId !== PLAYER_TEAM; i++) {
          if (!currentPick(s.draft!)) break;
          autoPick(s, s.draft!, rng);
        }
      } else {
        break;
      }
    }
    completeOffseason(s);
    expect(s.draft).toBeNull();
    expect(validateState(s)).toEqual([]);
  });

  it('真の評価関数（PHASE3.1）はそのまま残っている', () => {
    const rng = new Rng(1);
    const prospects = generateProspects(rng, 2026, 12);
    const roster: Player[] = [];
    const value = evaluateProspect(prospects[0], roster);
    expect(value).toBe(evaluateProspect(prospects[0], roster));
    expect(Number.isFinite(value)).toBe(true);
  });
});

/* ---------------- 再現性 ---------------- */

describe('PHASE3.2 再現性', () => {
  it('同じシード・同じ調査順なら同じ結果になる', () => {
    const run = () => {
      const rng = new Rng(2222);
      const prospects = generateProspects(rng, 2026, 12);
      const scouting = soloScouting(LOW);
      const lines: string[] = [];
      for (const prospect of prospects.slice(0, 10)) {
        for (const category of SCOUT_CATEGORIES) {
          investigate(scouting, 't', prospect, category);
        }
        const report = scouting.teams.t.reports[prospect.id];
        lines.push(
          `${abilityRangeText(report)}|${report.estimate.potential}|${report.estimate.personality}|${report.estimate.skills
            .map((s) => s.text)
            .join(',')}`,
        );
      }
      return lines.join('\n');
    };
    expect(run()).toBe(run());
  });
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.2 セーブ', () => {
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

  it('スカウト情報が保存・復元される', () => {
    const s = toScoutingPhase(3344);
    const prospect = s.draft!.prospects[2];
    investigate(s.scouting, PLAYER_TEAM, prospect, 'potential');
    investigate(s.scouting, PLAYER_TEAM, prospect, 'skills');
    investigate(s.scouting, PLAYER_TEAM, prospect, 'skills');
    const before = s.scouting.teams[PLAYER_TEAM];
    saveGame(s);

    const loaded = loadGame()!;
    const after = loaded.scouting.teams[PLAYER_TEAM];
    expect(after.points).toBe(before.points);
    expect(after.ability).toEqual(before.ability);
    const report = after.reports[prospect.id];
    expect(report.progress).toEqual(before.reports[prospect.id].progress);
    expect(report.estimate).toEqual(before.reports[prospect.id].estimate);
    expect(report.accuracy).toEqual(before.reports[prospect.id].accuracy);
    // ロード後も調査を続けられる
    const loadedProspect = loaded.draft!.prospects.find((p) => p.id === prospect.id)!;
    expect(investigate(loaded.scouting, PLAYER_TEAM, loadedProspect, 'potential').ok).toBe(true);
    clearSave();
  });

  it('PHASE3.1(v5)の古いセーブを移行できる', () => {
    const s = newGame(10, 5566);
    const legacy = JSON.parse(JSON.stringify(s)) as GameState;
    legacy.version = 5;
    delete (legacy as Partial<GameState>).scouting;
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.scouting).toBeDefined();
    for (const team of loaded.teams) {
      const entry = loaded.scouting.teams[team.id];
      expect(entry.points).toBe(SCOUT_POINTS_PER_YEAR);
      expect(entry.ability.potential).toBeGreaterThan(0);
      expect(entry.reports).toEqual({});
    }
    // 移行後もオフシーズンを実行できる
    const played = playSeason(loaded);
    startOffseason(played);
    expect(played.draft).not.toBeNull();
    completeOffseason(played);
    expect(validateState(played)).toEqual([]);
  }, 60000);
});

/* ---------------- 既存システム ---------------- */

describe('PHASE3.2 既存システムが壊れていない', () => {
  it('成長・引退・ドラフト・調子・実効能力が動く', () => {
    let s = playSeason(newGame(10, 7788));
    s = cloneState(s);
    const before = s.players.length;
    startOffseason(s);
    completeOffseason(s);

    expect(s.players.length).toBeGreaterThan(before - 40);
    expect(validateState(s)).toEqual([]);
    for (const p of s.players) {
      expect(CONDITIONS).toContain(p.ext.condition);
      const breakdown = effectiveBreakdown(p, { teamMorale: 50 });
      expect(breakdown.finalMultiplier).toBeGreaterThanOrEqual(EFFECTIVE_MIN);
      expect(breakdown.finalMultiplier).toBeLessThanOrEqual(EFFECTIVE_MAX);
    }
    const step = advanceDay(s);
    expect(step.results.length).toBeGreaterThan(0);
  });

  it('特殊能力の効果係数の上限が維持されている', () => {
    const stacked = abilityEffect(
      [
        { id: 'powerHitter' as const, level: 3 },
        { id: 'grandSlam' as const, level: 3 },
        { id: 'clutch' as const, level: 3 },
      ],
      'batHomeRun',
      { basesLoaded: true, scoringPosition: true },
      1.12,
    );
    expect(stacked).toBeLessThanOrEqual(1.9);
  });

  it('調査状況の集計が正しい', () => {
    const rng = new Rng(99);
    const prospects = generateProspects(rng, 2026, 12);
    const scouting = soloScouting(HIGH);
    const prospect = prospects[0];
    const initial = overallProgress(viewReport(scouting, 't', prospect));
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(30);
    for (const category of SCOUT_CATEGORIES) {
      reportAt(scouting, prospect, category, 3);
    }
    expect(overallProgress(scouting.teams.t.reports[prospect.id])).toBe(100);
  });

  it('CPUスカウトを走らせても状態が壊れない', () => {
    const s = toScoutingPhase(4321);
    runCpuScouting(s, new Rng(5));
    for (const team of s.teams) {
      const entry = s.scouting.teams[team.id];
      expect(entry.points).toBeGreaterThanOrEqual(0);
      for (const report of Object.values(entry.reports)) {
        for (const category of SCOUT_CATEGORIES) {
          expect(report.progress[category]).toBeLessThanOrEqual(100);
          expect(report.progress[category]).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(validateState(s)).toEqual([]);
  });

  it('初期レポートは保存されず、状態を書き換えない', () => {
    const s = toScoutingPhase(6543);
    const prospect = s.draft!.prospects.find(
      (p) => !s.scouting.teams[PLAYER_TEAM].reports[p.id],
    )!;
    const before = Object.keys(s.scouting.teams[PLAYER_TEAM].reports).length;
    viewReport(s.scouting, PLAYER_TEAM, prospect);
    viewReport(s.scouting, PLAYER_TEAM, prospect);
    expect(Object.keys(s.scouting.teams[PLAYER_TEAM].reports).length).toBe(before);
  });

  it('未調査でも buildInitialReport が有効なレポートを返す', () => {
    const rng = new Rng(246);
    const prospects = generateProspects(rng, 2026, 12);
    const report = buildInitialReport(prospects[0], LOW, 'x', 2026);
    expect(report.progress.currentAbility).toBeGreaterThan(0);
    expect(report.progress.potential).toBe(0);
    expect(report.estimate.potential).toBeNull();
    expect(report.estimate.skills).toEqual([]);
  });
});
