import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startOffseason, completeOffseason, startNextSeason } from './season';
import { Rng } from './rng';
import {
  baseRetirementRate,
  playingTimeOf,
  retirementChance,
  rollRetirement,
} from './retirement';
import {
  autoPick,
  availableProspects,
  beginDraftPicks,
  createDraft,
  currentPick,
  draftOrder,
  evaluateProspect,
  generateProspects,
  makePick,
  rosterCount,
  PROSPECTS_PER_TEAM,
  TARGET_ROSTER_SIZE,
} from './draft';
import { overallRating } from './rating';
import { PERSONALITY_IDS } from './personality';
import { GROWTH_TYPE_IDS } from './growth';
import { effectiveBreakdown, EFFECTIVE_MIN, EFFECTIVE_MAX } from './effective';
import { CONDITIONS } from './condition';
import { clearSave, loadGame, saveGame, SAVE_KEY } from './save';
import type { GameState, Player } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 10, seed = 310310): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

/** 年齢だけを変えた選手を作る */
function aged(base: Player, age: number, overrides: Partial<Player> = {}): Player {
  return { ...base, age, ...overrides };
}

/* ---------------- 引退 ---------------- */

describe('PHASE3.1 引退', () => {
  const state = newGame();
  const sample = state.players.find((p) => !p.isPitcher)!;
  const ctx = { playingTime: 0.6, seriouslyInjured: false };

  it('若手は通常引退しない', () => {
    for (const age of [18, 20, 22, 25]) {
      expect(retirementChance(aged(sample, age), ctx)).toBe(0);
    }
    const rng = new Rng(1);
    let retired = 0;
    for (let i = 0; i < 2000; i++) {
      if (rollRetirement(rng, aged(sample, 23), ctx)) retired += 1;
    }
    expect(retired).toBe(0);
  });

  it('高齢になるほど引退率が上がる', () => {
    const ages = [30, 33, 35, 37, 39, 41];
    const rates = ages.map((age) => retirementChance(aged(sample, age), ctx));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
    expect(baseRetirementRate(25)).toBe(0);
    expect(baseRetirementRate(41)).toBeGreaterThan(0.9);
  });

  it('同じ年齢でも高能力は引退しにくく、低能力は引退しやすい', () => {
    const strong: Player = {
      ...aged(sample, 36),
      batting: { ...sample.batting, contact: 85, power: 85, speed: 80, fielding: 80, catching: 80, arm: 80, trajectory: 70 },
    };
    const weak: Player = {
      ...aged(sample, 36),
      batting: { ...sample.batting, contact: 20, power: 20, speed: 20, fielding: 20, catching: 20, arm: 20, trajectory: 20 },
    };
    expect(retirementChance(strong, ctx)).toBeLessThan(retirementChance(weak, ctx));
    // ただし年齢が最重要：高能力でも40歳の方が36歳より引退しやすい
    expect(retirementChance(aged(strong, 40), ctx)).toBeGreaterThan(retirementChance(strong, ctx));
  });

  it('出場機会が少ないベテランは引退しやすい', () => {
    const veteran = aged(sample, 35);
    expect(retirementChance(veteran, { playingTime: 0, seriouslyInjured: false })).toBeGreaterThan(
      retirementChance(veteran, { playingTime: 1, seriouslyInjured: false }),
    );
  });

  it('怪我だけで即引退はしない', () => {
    const young = aged(sample, 24);
    expect(retirementChance(young, { playingTime: 0, seriouslyInjured: true })).toBe(0);
    const veteran = aged(sample, 34);
    const injured = retirementChance(veteran, { playingTime: 0.5, seriouslyInjured: true });
    expect(injured).toBeLessThan(0.5);
    expect(injured).toBeGreaterThan(
      retirementChance(veteran, { playingTime: 0.5, seriouslyInjured: false }),
    );
  });

  it('引退した選手はロスターから消え、記録が残る', () => {
    let s = playSeason(newGame(10, 4321));
    // 確実に引退者が出るよう、一部の選手を高齢にする
    const veterans = s.players.filter((p) => p.teamId === PLAYER_TEAM).slice(0, 5);
    for (const v of veterans) v.age = 41;
    const veteranIds = new Set(veterans.map((v) => v.id));
    const before = s.players.length;

    s = cloneState(s);
    const { retirements } = startOffseason(s);
    expect(retirements.length).toBeGreaterThan(0);
    expect(s.players.length).toBe(before - retirements.length);
    for (const record of retirements) {
      expect(s.players.some((p) => p.id === record.playerId)).toBe(false);
      expect(s.stats[record.playerId]).toBeUndefined();
      expect(record.name.length).toBeGreaterThan(0);
      expect(record.years).toBeGreaterThanOrEqual(1);
      expect(record.finalOverall).toBeGreaterThan(0);
    }
    expect(s.retiredPlayers.length).toBe(retirements.length);
    // 41歳の選手はほぼ全員引退している
    const remainingVeterans = s.players.filter((p) => veteranIds.has(p.id));
    expect(remainingVeterans.length).toBeLessThanOrEqual(1);
  });

  it('引退した選手は試合に出場しない', () => {
    let s = playSeason(newGame(10, 999));
    for (const p of s.players.slice(0, 30)) p.age = 42;
    s = cloneState(s);
    const { retirements } = startOffseason(s);
    completeOffseason(s);
    const retiredIds = new Set(retirements.map((r) => r.playerId));
    expect(retiredIds.size).toBeGreaterThan(0);
    expect(validateState(s)).toEqual([]);

    for (let day = 0; day < 12 && !s.seasonFinished; day++) {
      const step = advanceDay(s);
      for (const result of step.results) {
        for (const line of result.playerLines) {
          expect(retiredIds.has(line.playerId)).toBe(false);
        }
      }
      s = step.state;
    }
  });
});

/* ---------------- ドラフト候補の生成 ---------------- */

describe('PHASE3.1 ドラフト候補の生成', () => {
  const rng = new Rng(555);
  const prospects = generateProspects(rng, 2026, 12);

  it('十分な人数の候補が生成される', () => {
    expect(prospects).toHaveLength(12 * PROSPECTS_PER_TEAM);
    expect(prospects.length).toBeGreaterThanOrEqual(96);
    expect(prospects.length).toBeLessThanOrEqual(144);
    expect(new Set(prospects.map((p) => p.id)).size).toBe(prospects.length);
  });

  it('新人の年齢は18〜22歳に収まり、固定ではない', () => {
    const ages = new Set<number>();
    for (const prospect of prospects) {
      expect(prospect.player.age).toBeGreaterThanOrEqual(18);
      expect(prospect.player.age).toBeLessThanOrEqual(22);
      ages.add(prospect.player.age);
    }
    expect(ages.size).toBeGreaterThanOrEqual(4);
  });

  it('新人にも性格・成長タイプ・潜在能力・調子がある', () => {
    const personalities = new Set<string>();
    const growthTypes = new Set<string>();
    for (const prospect of prospects) {
      const ext = prospect.player.ext;
      expect(PERSONALITY_IDS).toContain(ext.personality);
      expect(GROWTH_TYPE_IDS).toContain(ext.growthType);
      expect(ext.potential).toBeGreaterThanOrEqual(1);
      expect(ext.potential).toBeLessThanOrEqual(100);
      // 潜在能力は現在能力より高い（伸びしろがある）
      expect(ext.potential).toBeGreaterThan(overallRating(prospect.player));
      expect(CONDITIONS).toContain(ext.condition);
      expect(ext.fatigue).toBe(0);
      expect(ext.injury).toBeNull();
      expect(ext.slump).toBeNull();
      expect(ext.motivation).toBeGreaterThanOrEqual(50);
      personalities.add(ext.personality);
      growthTypes.add(ext.growthType);
    }
    // 性格・成長タイプが極端に偏らない
    expect(personalities.size).toBeGreaterThanOrEqual(8);
    expect(growthTypes.size).toBeGreaterThanOrEqual(5);
  });

  it('新人の特殊能力は既存ルールで付与される', () => {
    const withAbility = prospects.filter((p) => p.player.ext.specialAbilities.length > 0);
    expect(withAbility.length).toBeGreaterThan(prospects.length * 0.3);
    for (const prospect of prospects) {
      for (const entry of prospect.player.ext.specialAbilities) {
        expect(entry.level).toBeGreaterThanOrEqual(1);
        expect(entry.level).toBeLessThanOrEqual(3);
      }
      // 大量に持つことはない
      expect(prospect.player.ext.specialAbilities.length).toBeLessThanOrEqual(5);
    }
  });

  it('能力分布が極端に偏らず、全員が強いわけでもない', () => {
    const overalls = prospects.map((p) => overallRating(p.player)).sort((a, b) => a - b);
    const average = overalls.reduce((a, b) => a + b, 0) / overalls.length;
    expect(average).toBeGreaterThan(15);
    expect(average).toBeLessThan(40);
    // 上位と下位に差がある
    expect(overalls[overalls.length - 1] - overalls[0]).toBeGreaterThan(15);
    // トップ級はごく一部
    const elite = overalls.filter((v) => v >= 50).length;
    expect(elite).toBeLessThan(prospects.length * 0.15);
  });

  it('ポジションが偏りすぎない', () => {
    const pitchers = prospects.filter((p) => p.player.isPitcher).length;
    const ratio = pitchers / prospects.length;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.55);
    const positions = new Set(prospects.map((p) => p.player.mainPosition));
    expect(positions.size).toBeGreaterThanOrEqual(8);
  });

  it('同じシードなら同じ候補が生成される', () => {
    const a = generateProspects(new Rng(77), 2026, 12);
    const b = generateProspects(new Rng(77), 2026, 12);
    expect(a.map((p) => `${p.player.name}:${overallRating(p.player)}`)).toEqual(
      b.map((p) => `${p.player.name}:${overallRating(p.player)}`),
    );
  });
});

/* ---------------- ドラフト ---------------- */

describe('PHASE3.1 ドラフト', () => {
  let state: GameState;
  beforeEach(() => {
    state = playSeason(newGame(10, 246));
    // 引退で枠を空けておく
    for (const p of state.players.slice(0, 40)) p.age = 41;
    state = cloneState(state);
    startOffseason(state);
    // PHASE 3.2 でドラフト前にスカウト期間が入ったため、指名を開始しておく
    beginDraftPicks(state, new Rng(1));
  });

  it('前年成績が悪い球団から指名順が決まる', () => {
    const order = draftOrder(state, new Rng(1));
    expect(order).toHaveLength(12);
    expect(new Set(order)).toHaveLength(12);
    const records = order.map((teamId) => {
      const record = state.records[teamId];
      const denom = record.wins + record.losses;
      return denom === 0 ? 0 : record.wins / denom;
    });
    for (let i = 1; i < records.length; i++) {
      expect(records[i]).toBeGreaterThanOrEqual(records[i - 1]);
    }
  });

  it('ドラフトが準備され、1巡目から順に指名が進む', () => {
    const draft = state.draft!;
    expect(draft).not.toBeNull();
    expect(draft.year).toBe(state.year);
    expect(draft.rounds).toBeGreaterThanOrEqual(1);
    const slot = currentPick(draft);
    expect(slot).not.toBeNull();
    expect(slot!.round).toBe(1);
    // CPU の指名はプレイヤー球団の手番まで進んでいる
    expect(slot!.teamId).toBe(PLAYER_TEAM);
    expect(draft.picks.length).toBeGreaterThan(0);
    for (const pick of draft.picks) {
      expect(pick.round).toBeGreaterThanOrEqual(1);
      expect(pick.prospectId).not.toBeNull();
    }
  });

  it('指名済みの選手は再指名できない', () => {
    const draft = state.draft!;
    const taken = draft.prospects.find((p) => p.selectedBy)!;
    expect(makePick(draft, taken.id)).toBe(false);
    expect(makePick(draft, 'not-exist')).toBe(false);
    const available = availableProspects(draft)[0];
    expect(makePick(draft, available.id)).toBe(true);
    expect(makePick(draft, available.id)).toBe(false);
  });

  it('CPUは能力・将来性・ロスター不足を見て指名する', () => {
    const draft = state.draft!;
    const roster = state.players.filter((p) => p.teamId === 'bluewave');
    const candidates = availableProspects(draft).slice(0, 30);
    const scored = candidates
      .map((p) => ({ p, score: evaluateProspect(p, roster) }))
      .sort((a, b) => b.score - a.score);
    // 上位評価の選手は下位より能力か将来性が高い
    const top = scored[0].p.player;
    const bottom = scored[scored.length - 1].p.player;
    expect(overallRating(top) + top.ext.potential).toBeGreaterThan(
      overallRating(bottom) + bottom.ext.potential,
    );
    // 完全ランダムではない（同じ条件なら同じ評価）
    expect(evaluateProspect(scored[0].p, roster)).toBe(evaluateProspect(scored[0].p, roster));
  });

  it('指名した選手が球団に加入し、ロスターが補充される', () => {
    const draft = state.draft!;
    const before = rosterCount(state, PLAYER_TEAM);
    const slot = currentPick(draft)!;
    const target = availableProspects(draft)[0];
    expect(slot.teamId).toBe(PLAYER_TEAM);
    makePick(draft, target.id);

    const rookies = completeOffseason(state);
    expect(rookies.length).toBeGreaterThan(0);
    const joined = state.players.find((p) => p.id === target.player.id);
    expect(joined).toBeDefined();
    expect(joined!.teamId).toBe(PLAYER_TEAM);
    // 新人は2軍スタート。ただし1軍の人数が足りない場合は既存ルールで繰り上がる
    expect(['first', 'second']).toContain(joined!.roster);
    expect(state.stats[joined!.id]).toBeDefined();
    expect(rosterCount(state, PLAYER_TEAM)).toBeGreaterThan(before);
    expect(validateState(state)).toEqual([]);
  });

  it('同じ年にドラフトが二重に実行されない', () => {
    completeOffseason(state);
    expect(state.draft).toBeNull();
    const year = state.year;
    // 直前のオフシーズンと同じ年でドラフトを作ろうとしても作られない
    state.year = state.lastDraftYear!;
    expect(createDraft(state, new Rng(1))).toBeNull();
    state.year = year;
  });

  it('通常は新人が2軍スタートになる', () => {
    let s = playSeason(newGame(10, 7373));
    for (const p of s.players.slice(0, 24)) p.age = 41;
    s = cloneState(s);
    startOffseason(s);
    const rookies = completeOffseason(s);
    expect(rookies.length).toBeGreaterThan(0);
    const secondTeamRookies = rookies.filter(
      (r) => s.players.find((p) => p.id === r.id)?.roster === 'second',
    );
    expect(secondTeamRookies.length).toBeGreaterThan(0);
  });

  it('必要人数を満たした球団は指名しない', () => {
    let s = playSeason(newGame(10, 5150));
    s = cloneState(s);
    startOffseason(s);
    beginDraftPicks(s, new Rng(3));
    const draft = s.draft;
    if (!draft) return; // 引退者がいなければドラフトなし
    for (const pick of draft.picks) {
      expect(rosterCount(s, pick.teamId)).toBeLessThan(TARGET_ROSTER_SIZE + draft.rounds);
    }
  });
});

/* ---------------- シーズンとの接続 ---------------- */

describe('PHASE3.1 シーズンとの接続', () => {
  it('シーズン終了→引退→ドラフト→新人加入→開幕が成立する', () => {
    let s = playSeason(newGame(10, 2468));
    const beforePlayers = s.players.length;
    s = cloneState(s);

    const { retirements } = startOffseason(s);
    expect(s.seasonFinished).toBe(true);
    const rookies = completeOffseason(s);

    expect(s.seasonFinished).toBe(false);
    expect(s.draft).toBeNull();
    expect(s.players.length).toBe(beforePlayers - retirements.length + rookies.length);
    expect(validateState(s)).toEqual([]);

    // 新シーズンが普通に進む
    const step = advanceDay(s);
    expect(step.results.length).toBeGreaterThan(0);
  });

  it('年齢は1シーズンに1回だけ増える', () => {
    let s = playSeason(newGame(10, 13579));
    const before = new Map(s.players.map((p) => [p.id, p.age]));
    s = cloneState(s);
    startOffseason(s);
    completeOffseason(s);
    for (const p of s.players) {
      const previous = before.get(p.id);
      if (previous === undefined) continue; // 新人
      expect(p.age).toBe(previous + 1);
    }
  });

  it('新人は通常の選手として扱われる（調子・成長・実効能力）', () => {
    let s = playSeason(newGame(10, 8642));
    s = cloneState(s);
    startNextSeason(s);
    const rookies = s.players.filter((p) => p.ext.debutYear === s.year);
    expect(rookies.length).toBeGreaterThan(0);
    for (const rookie of rookies) {
      // 実効能力が通常どおり計算できる
      const breakdown = effectiveBreakdown(rookie, { teamMorale: 50 });
      expect(breakdown.finalMultiplier).toBeGreaterThanOrEqual(EFFECTIVE_MIN);
      expect(breakdown.finalMultiplier).toBeLessThanOrEqual(EFFECTIVE_MAX);
      expect(Object.keys(breakdown.byCategory).length).toBe(8);
      expect(CONDITIONS).toContain(rookie.ext.condition);
      expect(rookie.ext.conditionHistory.length).toBeGreaterThan(0);
    }
    // 新人も成長処理の対象になる
    const before = new Map(rookies.map((p) => [p.id, p.batting.contact + p.batting.power]));
    const next = cloneState(playSeason(s));
    startNextSeason(next);
    const grown = next.players.filter(
      (p) => before.has(p.id) && p.batting.contact + p.batting.power !== before.get(p.id),
    );
    expect(grown.length).toBeGreaterThan(0);
  }, 60000);

  it('10シーズン連続でエラーなく進行し、高齢化しない', () => {
    let s = newGame(10, 31415);
    for (let season = 0; season < 10; season++) {
      s = playSeason(s);
      startOffseason(s);
      completeOffseason(s);
      expect(validateState(s)).toEqual([]);
      expect(s.players.length).toBeGreaterThan(250);
    }
    const averageAge = s.players.reduce((a, p) => a + p.age, 0) / s.players.length;
    expect(averageAge).toBeGreaterThan(24);
    expect(averageAge).toBeLessThan(32);
    // 若手が供給され続けている
    expect(s.players.filter((p) => p.age <= 22).length).toBeGreaterThan(10);
    // 各球団が試合を組める人数を保っている
    for (const team of s.teams) {
      expect(rosterCount(s, team.id)).toBeGreaterThanOrEqual(20);
    }
  }, 120000);
});

/* ---------------- セーブ ---------------- */

describe('PHASE3.1 セーブ', () => {
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

  it('ドラフト中の状態が保存・復元される', () => {
    let s = playSeason(newGame(10, 1122));
    for (const p of s.players.slice(0, 30)) p.age = 41;
    s = cloneState(s);
    startOffseason(s);
    beginDraftPicks(s, new Rng(4));
    expect(s.draft).not.toBeNull();
    saveGame(s);

    const loaded = loadGame()!;
    expect(loaded.draft).not.toBeNull();
    expect(loaded.draft!.year).toBe(s.draft!.year);
    expect(loaded.draft!.prospects).toHaveLength(s.draft!.prospects.length);
    expect(loaded.draft!.picks).toEqual(s.draft!.picks);
    expect(loaded.retiredPlayers.length).toBe(s.retiredPlayers.length);
    // ロード後もドラフトを続けられる
    const slot = currentPick(loaded.draft!)!;
    expect(slot.teamId).toBe(PLAYER_TEAM);
    const target = availableProspects(loaded.draft!)[0];
    expect(makePick(loaded.draft!, target.id)).toBe(true);
    completeOffseason(loaded);
    expect(validateState(loaded)).toEqual([]);
    clearSave();
  });

  it('引退記録が保存される', () => {
    let s = playSeason(newGame(10, 3344));
    for (const p of s.players.slice(0, 20)) p.age = 42;
    s = cloneState(s);
    startOffseason(s);
    completeOffseason(s);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.retiredPlayers.length).toBe(s.retiredPlayers.length);
    expect(loaded.retiredPlayers[0].name).toBe(s.retiredPlayers[0].name);
    expect(loaded.lastDraftYear).toBe(s.lastDraftYear);
  });

  it('PHASE2.5(v4)の古いセーブデータを読み込める', () => {
    const s = newGame(10, 5566);
    const legacy = JSON.parse(JSON.stringify(s)) as GameState;
    legacy.version = 4;
    delete (legacy as Partial<GameState>).retiredPlayers;
    delete (legacy as Partial<GameState>).draft;
    delete (legacy as Partial<GameState>).lastDraftYear;
    for (const player of legacy.players) {
      delete (player.ext as Partial<Player['ext']>).debutYear;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(Array.isArray(loaded.retiredPlayers)).toBe(true);
    expect(loaded.draft).toBeNull();
    expect(loaded.lastDraftYear).toBeNull();
    for (const player of loaded.players) {
      expect(typeof player.ext.debutYear).toBe('number');
    }
    // 補完後もオフシーズンを実行できる
    const played = playSeason(loaded);
    startOffseason(played);
    completeOffseason(played);
    expect(validateState(played)).toEqual([]);
  }, 60000);
});

/* ---------------- 既存システムへの影響 ---------------- */

describe('PHASE3.1 既存システムが壊れていない', () => {
  it('PHASE2の成長・PHASE2.5の調子・怪我・実効能力が新シーズンでも動く', () => {
    let s = playSeason(newGame(30, 90909));
    s = cloneState(s);
    startNextSeason(s);

    // 調子が5段階のまま
    for (const p of s.players) {
      expect(CONDITIONS).toContain(p.ext.condition);
      expect(p.ext.fatigue).toBe(0);
      expect(p.ext.slump).toBeNull();
    }
    // 新シーズンを進めると調子・疲労・怪我が動く
    const conditionsBefore = s.players.map((p) => p.ext.condition).join(',');
    for (let day = 0; day < 20 && !s.seasonFinished; day++) s = advanceDay(s).state;
    expect(s.players.map((p) => p.ext.condition).join(',')).not.toBe(conditionsBefore);
    expect(s.players.some((p) => p.ext.fatigue > 0)).toBe(true);
    // 怪我人はオーダーに入らない
    for (const team of s.teams) {
      for (const slot of s.setups[team.id].lineup) {
        const player = s.players.find((p) => p.id === slot.playerId);
        if (player) expect(player.ext.injury).toBeNull();
      }
    }
    expect(validateState(s)).toEqual([]);
  }, 60000);

  it('出場時間から引退判定用の出場度合いが計算できる', () => {
    const s = playSeason(newGame(10, 1357));
    const regular = s.players
      .filter((p) => !p.isPitcher && p.roster === 'first')
      .sort((a, b) => s.stats[b.id].batting.plateAppearances - s.stats[a.id].batting.plateAppearances)[0];
    const benched = s.players.find((p) => s.stats[p.id].batting.plateAppearances === 0)!;
    expect(playingTimeOf(regular, s.stats[regular.id], s.seasonLength)).toBeGreaterThan(
      playingTimeOf(benched, s.stats[benched.id], s.seasonLength),
    );
  });

  it('CPUの自動指名だけでもドラフトが完了する', () => {
    let s = playSeason(newGame(10, 8080));
    for (const p of s.players.slice(0, 30)) p.age = 41;
    s = cloneState(s);
    startOffseason(s);
    const draft = s.draft!;
    const rng = new Rng(2);
    beginDraftPicks(s, rng);
    let guard = 0;
    while (currentPick(draft) && guard++ < 200) autoPick(s, draft, rng);
    expect(draft.completed).toBe(true);
    expect(currentPick(draft)).toBeNull();
    const rookies = completeOffseason(s);
    expect(rookies.length).toBe(draft.picks.length);
    expect(validateState(s)).toEqual([]);
  });
});
