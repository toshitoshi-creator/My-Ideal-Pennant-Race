import { describe, expect, it } from 'vitest';
import { createNewGame } from './newGame';
import { availableProspects, createDraft, currentPick } from './draft';
import {
  attemptLabel,
  autoFinishFirstRound,
  awaitingLottery,
  beginLotteryDraft,
  canNominate,
  drawLotteryPaper,
  nominateFirstRound,
  remainingPapers,
} from './draftLottery';
import { Rng } from './rng';
import type { GameState } from './types';

function setup(seed: number): { state: GameState; rng: Rng } {
  const state = createNewGame('phoenix', 143);
  // 2巡目以降も指名が続くよう、各球団の2軍を少し減らしておく
  for (const team of state.teams) {
    let n = 0;
    state.players = state.players.filter(
      (p) => !(p.teamId === team.id && p.roster === 'second' && n++ < 5),
    );
  }
  const rng = new Rng(seed);
  state.draft = createDraft(state, rng)!;
  beginLotteryDraft(state, rng);
  return { state, rng };
}

/** プレイヤーはいつも下馬評の最上位に入札し、くじは指定した方法で引く */
function playFirstRound(state: GameState, rng: Rng, choosePaper: (left: number[], winning: number) => number) {
  let guard = 0;
  while (state.draft!.firstRound && !state.draft!.firstRound.done && guard++ < 50) {
    const lottery = awaitingLottery(state);
    if (lottery) {
      drawLotteryPaper(state, choosePaper(remainingPapers(lottery), lottery.winningPaper), rng);
      continue;
    }
    if (!canNominate(state)) break;
    const top = availableProspects(state.draft!).sort((a, b) => a.draftRank - b.draftRank)[0];
    nominateFirstRound(state, top.id, rng);
  }
}

describe('ドラフト1巡目の入札・抽選', () => {
  it('呼び名は 1位 → 外れ1位 → 外れ外れ1位', () => {
    expect(attemptLabel(1)).toBe('1位');
    expect(attemptLabel(2)).toBe('外れ1位');
    expect(attemptLabel(3)).toBe('外れ外れ1位');
  });

  it('全球団の1巡目がちょうど1人ずつ決まり、重複しない', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state, rng } = setup(seed);
      playFirstRound(state, rng, (left) => left[0]);
      const draft = state.draft!;
      expect(draft.firstRound!.done).toBe(true);
      const firstRound = draft.picks.filter((p) => p.round === 1);
      expect(new Set(firstRound.map((p) => p.teamId)).size).toBe(draft.order.length);
      expect(firstRound).toHaveLength(draft.order.length);
      const ids = draft.picks.map((p) => p.prospectId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('抽選は当たりの紙を引いた球団が交渉権を得る', () => {
    for (const seed of [11, 12, 13]) {
      const { state, rng } = setup(seed);
      playFirstRound(state, rng, (left) => left[left.length - 1]);
      for (const attempt of state.draft!.firstRound!.attempts) {
        for (const lottery of attempt.lotteries) {
          expect(lottery.teams.length).toBeGreaterThan(1);
          expect(lottery.winner).not.toBeNull();
          expect(lottery.drawn[lottery.winner!]).toBe(lottery.winningPaper);
          // 全員が別々の紙を1枚ずつ引いている
          expect(new Set(Object.values(lottery.drawn)).size).toBe(lottery.teams.length);
        }
      }
    }
  });

  it('プレイヤーが選んだ紙で結果が決まる（当たりを選べば必ず獲得）', () => {
    let lotteries = 0;
    for (let seed = 20; seed < 40 && lotteries < 3; seed++) {
      const { state, rng } = setup(seed);
      // 最初の入札で、CPU がいちばん多く入札する候補を狙う（競合させるため）
      const probe = setup(seed);
      const top = availableProspects(probe.state.draft!).sort((a, b) => a.draftRank - b.draftRank)[0];
      nominateFirstRound(probe.state, top.id, probe.rng);
      const counts = new Map<string, number>();
      for (const [teamId, id] of Object.entries(probe.state.draft!.firstRound!.attempts[0].nominations)) {
        if (teamId !== state.playerTeamId) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

      nominateFirstRound(state, target, rng);
      const lottery = awaitingLottery(state);
      if (!lottery) continue;
      lotteries++;
      const winning = lottery.winningPaper;
      // 当たりの紙がまだ残っていれば、それを選ぶと必ず獲得できる
      if (remainingPapers(lottery).includes(winning)) {
        drawLotteryPaper(state, winning, rng);
        const mine = state.draft!.picks.find((p) => p.round === 1 && p.teamId === state.playerTeamId);
        expect(mine?.prospectId).toBe(target);
      } else {
        // 先に引いた球団が当たりを持っていったなら、何を選んでも外れる
        drawLotteryPaper(state, remainingPapers(lottery)[0], rng);
        const mine = state.draft!.picks.find((p) => p.round === 1 && p.teamId === state.playerTeamId);
        expect(mine).toBeUndefined();
        expect(canNominate(state)).toBe(true);
      }
    }
    expect(lotteries).toBeGreaterThan(0);
  });

  it('引ける紙は残っているものだけ。引き終わるまで順番の指名は始まらない', () => {
    for (let seed = 40; seed < 60; seed++) {
      const { state, rng } = setup(seed);
      const probe = setup(seed);
      const top = availableProspects(probe.state.draft!).sort((a, b) => a.draftRank - b.draftRank)[0];
      nominateFirstRound(probe.state, top.id, probe.rng);
      const nominations = probe.state.draft!.firstRound!.attempts[0].nominations;
      const target = Object.entries(nominations).find(([t]) => t !== state.playerTeamId)![1];
      nominateFirstRound(state, target, rng);
      const lottery = awaitingLottery(state);
      if (!lottery) continue;
      const taken = Object.values(lottery.drawn);
      for (const paper of taken) expect(drawLotteryPaper(state, paper, rng)).toBe(false);
      // 抽選待ちの間は2巡目に進まない
      expect(state.draft!.picks.every((p) => p.round === 1)).toBe(true);
      return;
    }
  });

  it('1巡目のあとは2巡目から順番の指名に戻る', () => {
    const { state, rng } = setup(7);
    playFirstRound(state, rng, (left) => left[0]);
    const slot = currentPick(state.draft!);
    if (slot) expect(slot.round).toBeGreaterThanOrEqual(2);
    expect(state.draft!.picks.some((p) => p.round >= 2) || !slot || slot.teamId === state.playerTeamId).toBe(true);
  });

  it('自動で最後まで進められる（ドラフトを飛ばすとき）', () => {
    const { state, rng } = setup(9);
    autoFinishFirstRound(state, rng);
    const draft = state.draft!;
    expect(draft.firstRound!.done).toBe(true);
    expect(new Set(draft.picks.filter((p) => p.round === 1).map((p) => p.teamId)).size).toBe(draft.order.length);
  });
});
