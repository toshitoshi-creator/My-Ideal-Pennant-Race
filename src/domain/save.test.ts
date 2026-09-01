import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame } from './newGame';
import { advanceToNextPlayerGame, repairAllSetups, validateState } from './engine';
import { clearSave, hasSave, loadGame, saveGame, SAVE_KEY } from './save';
import { SAVE_VERSION } from './newGame';
import type { GameState } from './types';
import { applyRosterChange, daysUntilChangeable } from './roster';
import { standingsForLeague } from './standings';

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

describe('STEP13 セーブ・ロード', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('保存していないときは null', () => {
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('アプリを閉じて再起動してもデータが残る（保存→読込で同じ状態）', () => {
    let state = createNewGame('phoenix', 30, 4649);
    // 試合を消化し、登録変更もしておく
    state = advanceToNextPlayerGame(state).state;
    state = advanceToNextPlayerGame(state).state;
    const demoted = state.players.find((p) => p.teamId === 'phoenix' && p.roster === 'first')!;
    applyRosterChange(state, demoted.id, 'second');
    repairAllSetups(state);

    expect(saveGame(state)).toBe(true);
    expect(hasSave()).toBe(true);

    const loaded = loadGame()!;
    expect(loaded).not.toBeNull();
    expect(loaded.date).toBe(state.date);
    expect(loaded.playerTeamId).toBe(state.playerTeamId);
    expect(loaded.players).toHaveLength(state.players.length);
    expect(loaded.results).toHaveLength(state.results.length);
    expect(loaded.records['phoenix']).toEqual(state.records['phoenix']);
    expect(loaded.setups['phoenix'].lineup).toEqual(state.setups['phoenix'].lineup);
    expect(loaded.setups['phoenix'].rotation).toEqual(state.setups['phoenix'].rotation);

    // 選手成績も残る
    const withStats = state.players.find((p) => state.stats[p.id].batting.atBats > 0)!;
    expect(loaded.stats[withStats.id]).toEqual(state.stats[withStats.id]);

    // 7日制限も残る
    const loadedDemoted = loaded.players.find((p) => p.id === demoted.id)!;
    expect(loadedDemoted.roster).toBe('second');
    expect(loadedDemoted.lastRosterChangeDate).toBe(demoted.lastRosterChangeDate);
    expect(daysUntilChangeable(loadedDemoted, loaded.date)).toBe(
      daysUntilChangeable(demoted, state.date),
    );

    // 順位表も再現される
    expect(standingsForLeague(loaded, 'grand')).toEqual(standingsForLeague(state, 'grand'));
    expect(validateState(loaded)).toEqual([]);
  });

  it('ロード後も続きから試合を進められる', () => {
    let state = createNewGame('phoenix', 30, 55);
    state = advanceToNextPlayerGame(state).state;
    saveGame(state);
    const loaded = loadGame()!;
    const before = loaded.records['phoenix'].games;
    const next = advanceToNextPlayerGame(loaded);
    expect(next.playerResult).not.toBeNull();
    expect(next.state.records['phoenix'].games).toBe(before + 1);
    expect(validateState(next.state)).toEqual([]);
  });

  it('旧バージョン(v1)のセーブデータは弾道を1〜100に移行して読み込める', () => {
    const state = createNewGame('phoenix', 10, 4242);
    // v1 相当のセーブデータを作る（弾道は 1〜4）
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    legacy.version = 1;
    const expected = new Map<string, number>();
    legacy.players.forEach((p, i) => {
      const band = (i % 4) + 1;
      p.batting.trajectory = band;
      expected.set(p.id, band * 25);
    });
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded).not.toBeNull();
    expect(loaded.version).toBe(SAVE_VERSION);
    for (const player of loaded.players) {
      expect(player.batting.trajectory).toBe(expected.get(player.id));
    }
    // 移行後もそのまま試合を進められる
    const next = advanceToNextPlayerGame(loaded);
    expect(next.playerResult).not.toBeNull();
    expect(validateState(next.state)).toEqual([]);
  });

  it('PHASE2のデータ（性格・潜在能力・特殊能力・疲労・怪我）が保存・復元される', () => {
    let state = createNewGame('phoenix', 30, 8888);
    for (let i = 0; i < 12; i++) state = advanceToNextPlayerGame(state).state;
    const sample = state.players.find((p) => p.teamId === 'phoenix')!;
    sample.ext.injury = {
      level: 'moderate',
      name: '肉離れ',
      startDate: state.date,
      returnDate: '2026-05-30',
    };
    sample.ext.fatigue = 43;
    sample.ext.condition = 'best';
    sample.ext.motivation = 77;
    saveGame(state);

    const loaded = loadGame()!;
    const restored = loaded.players.find((p) => p.id === sample.id)!;
    expect(restored.ext.personality).toBe(sample.ext.personality);
    expect(restored.ext.potential).toBe(sample.ext.potential);
    expect(restored.ext.growthType).toBe(sample.ext.growthType);
    expect(restored.ext.growthTendency).toBe(sample.ext.growthTendency);
    expect(restored.ext.specialAbilities).toEqual(sample.ext.specialAbilities);
    expect(restored.ext.fatigue).toBe(43);
    expect(restored.ext.condition).toBe('best');
    expect(restored.ext.motivation).toBe(77);
    expect(restored.ext.injury).toEqual(sample.ext.injury);
    expect(loaded.teamMorale['phoenix']).toBe(state.teamMorale['phoenix']);
    expect(validateState(loaded)).toEqual([]);
  });

  it('PHASE1(v2)のセーブデータにPHASE2のデータを補完して読み込める', () => {
    const state = createNewGame('phoenix', 10, 1357);
    // v2 相当（PHASE 2 のフィールドがない）セーブデータを作る
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    legacy.version = 2;
    delete (legacy as Partial<GameState>).teamMorale;
    delete (legacy as Partial<GameState>).notices;
    delete (legacy as Partial<GameState>).lastGrowthReport;
    for (const player of legacy.players) {
      player.ext = {
        personality: null,
        specialSkills: [],
        potential: null,
        popularity: null,
        growthRate: null,
        fatigue: 0,
        condition: 3,
        injury: null,
        contract: null,
        faStatus: null,
      } as unknown as GameState['players'][number]['ext'];
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded).not.toBeNull();
    expect(loaded.version).toBe(SAVE_VERSION);
    for (const player of loaded.players) {
      expect(typeof player.ext.personality).toBe('string');
      expect(player.ext.potential).toBeGreaterThanOrEqual(1);
      expect(player.ext.potential).toBeLessThanOrEqual(100);
      expect(typeof player.ext.growthType).toBe('string');
      expect(Array.isArray(player.ext.specialAbilities)).toBe(true);
      expect(player.ext.condition).toBe('normal');
      expect(player.ext.injury).toBeNull();
    }
    expect(loaded.teamMorale['phoenix']).toBe(50);
    expect(Array.isArray(loaded.notices)).toBe(true);
    // 補完後もそのまま試合を進められる
    const next = advanceToNextPlayerGame(loaded);
    expect(next.playerResult).not.toBeNull();
    expect(validateState(next.state)).toEqual([]);
  });

  it('壊れたセーブデータは読み込まない', () => {
    localStorage.setItem(SAVE_KEY, '{ broken json');
    expect(loadGame()).toBeNull();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 999, players: [], teams: [] }));
    expect(loadGame()).toBeNull();
  });

  it('セーブを削除できる', () => {
    saveGame(createNewGame('phoenix', 10, 1));
    expect(hasSave()).toBe(true);
    clearSave();
    expect(hasSave()).toBe(false);
  });

  it('保存サイズが localStorage に収まる（143試合設定）', () => {
    let state = createNewGame('phoenix', 143, 7);
    for (let i = 0; i < 20; i++) state = advanceToNextPlayerGame(state).state;
    const size = JSON.stringify(state).length;
    expect(size).toBeLessThan(3_000_000);
  });
});
