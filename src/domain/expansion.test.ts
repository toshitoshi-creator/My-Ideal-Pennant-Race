import { describe, expect, it } from 'vitest';
import {
  EXPANSION_START_CASH,
  autoSignExpansion,
  canFinishExpansion,
  createExpansionGame,
  finishExpansion,
  releaseExpansionPlayer,
  signExpansionPlayer,
  signedCounts,
} from './expansion';
import {
  BASE_REVENUE,
  EXPANSION_START_FANS,
  MIN_FANS,
  applySeasonFans,
  changeFans,
  ensureFans,
  totalRevenue,
} from './fans';
import { createNewGame } from './newGame';
import { advanceDay } from './engine';
import { applySeasonFinance } from './contract';
import { overallRating } from './rating';
import type { GameState, SeasonHistory } from './types';

const OPTIONS = { teamName: '湘南シーホークス', shortName: '湘南' };

function mine(state: GameState) {
  return state.players.filter((p) => p.teamId === state.playerTeamId);
}

describe('ゼロからの球団づくり', () => {
  it('選手0人・決まった資金・変更した球団名で始まる', () => {
    const state = createExpansionGame('phoenix', 143, OPTIONS, 1);
    expect(mine(state)).toHaveLength(0);
    expect(state.finances.phoenix.cash).toBe(EXPANSION_START_CASH);
    expect(state.teams.find((t) => t.id === 'phoenix')!.name).toBe('湘南シーホークス');
    expect(state.teams.find((t) => t.id === 'phoenix')!.shortName).toBe('湘南');
    // 他球団の名前は変わらない
    expect(state.teams.filter((t) => t.id !== 'phoenix').every((t) => t.name.length > 0)).toBe(true);
    expect(state.fans).toBe(EXPANSION_START_FANS);
    expect(canFinishExpansion(state).ok).toBe(false);
  });

  it('候補は他球団の1軍より能力が低い（契約金が安い）', () => {
    const state = createExpansionGame('phoenix', 143, OPTIONS, 2);
    const pool = state.expansion!.pool;
    const avgPool = pool.reduce((a, c) => a + overallRating(c.player), 0) / pool.length;
    const cpu = state.players.filter((p) => p.teamId === 'bluewave' && p.roster === 'first');
    const avgCpu = cpu.reduce((a, p) => a + overallRating(p), 0) / cpu.length;
    expect(avgPool).toBeLessThan(avgCpu);
    // 能力が高いほど契約金も高い（おおむね）
    const sorted = [...pool].sort((a, b) => overallRating(a.player) - overallRating(b.player));
    const low = sorted.slice(0, 10).reduce((a, c) => a + c.bonus, 0);
    const high = sorted.slice(-10).reduce((a, c) => a + c.bonus, 0);
    expect(high).toBeGreaterThan(low);
  });

  it('契約金は球団資金から引かれ、足りなければ契約できない。取り消せば戻る', () => {
    const state = createExpansionGame('phoenix', 143, OPTIONS, 3);
    const exp = state.expansion!;
    const first = exp.pool[0];
    expect(signExpansionPlayer(state, first.id).ok).toBe(true);
    expect(state.finances.phoenix.cash).toBe(EXPANSION_START_CASH - first.bonus);
    expect(signExpansionPlayer(state, first.id).ok).toBe(false);
    expect(releaseExpansionPlayer(state, first.id).ok).toBe(true);
    expect(state.finances.phoenix.cash).toBe(EXPANSION_START_CASH);

    state.finances.phoenix.cash = 5;
    expect(signExpansionPlayer(state, first.id).ok).toBe(false);
  });

  it('資金の範囲で、野手15人・投手6人ほどと契約できる', () => {
    for (const seed of [4, 5, 6, 7, 8]) {
      const state = createExpansionGame('phoenix', 143, OPTIONS, seed);
      autoSignExpansion(state);
      const { fielders, pitchers } = signedCounts(state);
      expect(fielders).toBeGreaterThanOrEqual(15);
      expect(pitchers).toBeGreaterThanOrEqual(6);
      expect(state.finances.phoenix.cash).toBeGreaterThanOrEqual(0);
      // 高い選手ばかりは取れない：候補全員と契約できるほどの資金は無い
      const all = state.expansion!.pool.reduce((a, c) => a + c.bonus, 0);
      expect(all).toBeGreaterThan(EXPANSION_START_CASH);
    }
  });

  it('開幕すると契約した選手が1軍に入り、試合ができる', () => {
    let state = createExpansionGame('phoenix', 30, OPTIONS, 9);
    autoSignExpansion(state);
    const count = state.expansion!.signed.length;
    expect(finishExpansion(state).ok).toBe(true);
    expect(state.expansion).toBeNull();
    expect(mine(state)).toHaveLength(count);
    expect(mine(state).every((p) => p.ext.contract && p.ext.contract.salary > 0)).toBe(true);
    expect(state.setups.phoenix.lineup.length).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < 10; i++) state = advanceDay(state).state;
    expect(state.records.phoenix.games).toBeGreaterThan(0);
    expect(Number.isFinite(state.fans)).toBe(true);
  });
});

describe('ファンと決算', () => {
  it('通常の開始では、いまの年間収入に見合う人数から始まる', () => {
    const state = createNewGame('phoenix', 143, 11);
    expect(state.fans).toBeGreaterThan(0);
    expect(Math.abs(totalRevenue(state.fans!) - state.finances.phoenix.annualRevenue)).toBeLessThan(
      state.finances.phoenix.annualRevenue * 0.2,
    );
  });

  it('古いセーブ（ファンが無い）でも補える', () => {
    const state = createNewGame('phoenix', 143, 12);
    delete state.fans;
    delete state.fanLog;
    ensureFans(state);
    expect(state.fans).toBeGreaterThan(0);
    expect(state.fanLog).toEqual([]);
  });

  it('ファンは下限より減らない。理由があれば記録に残る', () => {
    const state = createNewGame('phoenix', 143, 13);
    state.fans = MIN_FANS + 10;
    changeFans(state, -0.9, 0, 'テスト');
    expect(state.fans).toBe(MIN_FANS);
    expect(state.fanLog![state.fanLog!.length - 1].reason).toBe('テスト');
  });

  it('優勝・タイトルでファンが増え、順位が下がると減る', () => {
    const base = createNewGame('phoenix', 143, 14);
    const leagueId = base.teams.find((t) => t.id === 'phoenix')!.leagueId;
    const season = (rank: number, champion: boolean, year: number): SeasonHistory =>
      ({
        year,
        seasonLength: 143,
        teams: [{ teamId: 'phoenix', leagueId, rank, champion, japanChampion: champion } as never],
        leagues: [
          {
            leagueId,
            championTeamId: 'phoenix',
            leaders: { homeRuns: { playerId: 'x', name: '誰か', teamId: 'phoenix', value: 40 } },
            mvpPlayerId: null,
            bestPitcherPlayerId: null,
            rookiePlayerId: null,
          },
        ],
      }) as SeasonHistory;

    const up = structuredClone(base);
    const before = up.fans!;
    applySeasonFans(up, season(1, true, 2026));
    expect(up.fans!).toBeGreaterThan(before);

    const down = structuredClone(base);
    down.history.seasons = [season(1, false, 2025)];
    const d0 = down.fans!;
    applySeasonFans(down, { ...season(6, false, 2026), leagues: [] });
    expect(down.fans!).toBeLessThan(d0);
  });

  it('決算では ファンから決まる収入 − 年俸 が球団資金に入る', () => {
    const state = createNewGame('phoenix', 143, 15);
    state.fans = 500_000;
    const cash = state.finances.phoenix.cash;
    applySeasonFinance(state);
    const settlement = state.lastSettlement!;
    expect(settlement.revenue).toBe(BASE_REVENUE + Math.round(500_000 * 0.0012));
    expect(settlement.result).toBe(settlement.revenue - settlement.payroll);
    expect(state.finances.phoenix.cash).toBe(cash + settlement.result);
  });
});
