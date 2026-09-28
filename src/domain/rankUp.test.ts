import { describe, expect, it } from 'vitest';
import { createNewGame } from './newGame';
import { startOffseason } from './season';
import { overallRating } from './rating';
import { rankOf } from './rank';

describe('総合評価アップ（成長レポートの rankUps）', () => {
  it('B 以上に上がった自球団の選手だけが、上がった順に入る', () => {
    const order = ['G', 'F', 'E', 'D', 'C', 'B', 'A'];
    let found = 0;
    for (const seed of [1, 2, 3]) {
      const state = createNewGame('phoenix', 143, seed);
      // 成長しやすい若手を B の手前まで引き上げておく（ランクアップが起きる状況をつくる）
      for (const p of state.players.filter((x) => x.teamId === 'phoenix').slice(0, 12)) {
        p.age = 21;
        p.ext.potential = 95;
        if (p.pitching) {
          p.pitching.control = 61;
          p.pitching.stamina = 61;
          p.pitching.power = 61;
          p.pitching.movement = 61;
        } else {
          Object.assign(p.batting, { contact: 61, power: 61, speed: 61, arm: 61, fielding: 61, catching: 61 });
        }
      }
      const { report } = startOffseason(state);
      for (const up of report.rankUps ?? []) {
        const player = state.players.find((p) => p.id === up.playerId)!;
        expect(player.teamId).toBe('phoenix');
        expect(order.indexOf(up.rankAfter)).toBeGreaterThan(order.indexOf(up.rankBefore));
        expect(order.indexOf(up.rankAfter)).toBeGreaterThanOrEqual(order.indexOf('B'));
        expect(up.overallAfter).toBe(overallRating(player));
        expect(up.rankAfter).toBe(rankOf(up.overallAfter));
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
