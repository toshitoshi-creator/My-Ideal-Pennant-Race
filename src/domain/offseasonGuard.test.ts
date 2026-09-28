import { describe, expect, it } from 'vitest';
import { createNewGame } from './newGame';
import { offseasonStarted, startOffseason } from './season';
import { finishDraft } from './draft';

describe('オフシーズンは1年に1回だけ', () => {
  it('二度目の startOffseason では歳を取らず、引退もしない', () => {
    const state = createNewGame('phoenix', 143, 5);
    state.seasonFinished = true;
    expect(offseasonStarted(state)).toBe(false);
    startOffseason(state);
    expect(offseasonStarted(state)).toBe(true);
    const ages = new Map(state.players.map((p) => [p.id, p.age]));
    const count = state.players.length;
    const retired = state.retiredPlayers.length;
    for (let i = 0; i < 5; i++) {
      const again = startOffseason(state);
      expect(again.retirements).toHaveLength(0);
    }
    expect(state.players.length).toBe(count);
    expect(state.retiredPlayers.length).toBe(retired);
    expect(state.players.every((p) => p.age === ages.get(p.id))).toBe(true);
  });

  it('ドラフトを終えて FA 市場を閉じた後（draft が無い）でも二度目は走らない', () => {
    const state = createNewGame('phoenix', 143, 6);
    state.seasonFinished = true;
    startOffseason(state);
    finishDraft(state, state.teams);
    state.draft = null;
    // 古いセーブ（lastOffseasonYear が無い）でも、ドラフトを終えていれば始まっているとみなす
    delete state.lastOffseasonYear;
    expect(offseasonStarted(state)).toBe(true);
    const count = state.players.length;
    startOffseason(state);
    expect(state.players.length).toBe(count);
  });
});
