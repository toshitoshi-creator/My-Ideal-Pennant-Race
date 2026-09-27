import { describe, expect, it } from 'vitest';
import { pitcherAptitude } from './pitcherAptitude';
import { createNewGame } from './newGame';
import type { PitcherAbilities } from './types';

const pitcher = (p: Partial<PitcherAbilities>) => ({
  isPitcher: true,
  pitching: { velocity: 140, control: 40, stamina: 40, power: 40, movement: 40, ...p } as PitcherAbilities,
});

describe('投手適性（先発・中継ぎ・抑え）', () => {
  it('野手には適性が無い', () => {
    expect(pitcherAptitude({ isPitcher: false, pitching: null })).toBeNull();
  });

  it('スタミナが高い投手は先発向き', () => {
    expect(pitcherAptitude(pitcher({ stamina: 65 }))!.best).toBe('starter');
  });

  it('スタミナが低く、球速・球威がある投手は抑え向き', () => {
    const apt = pitcherAptitude(pitcher({ stamina: 20, velocity: 152, power: 60, control: 38, movement: 30 }))!;
    expect(apt.best).toBe('closer');
    expect(apt.grades.starter).not.toBe('◎');
  });

  it('スタミナが低く、制球・変化球で勝負する投手は中継ぎ向き', () => {
    expect(
      pitcherAptitude(pitcher({ stamina: 25, velocity: 132, power: 30, control: 55, movement: 55 }))!.best,
    ).toBe('relief');
  });

  it('同じ能力なら必ず同じ結果になる', () => {
    const p = pitcher({ stamina: 33, velocity: 145 });
    expect(pitcherAptitude(p)).toEqual(pitcherAptitude(p));
  });

  it('各球団の先発ローテーションは、ほとんどが先発向きと判定される', () => {
    const state = createNewGame('phoenix', 143, 21);
    const rotation = Object.values(state.setups).flatMap((s) => s.rotation);
    const starters = rotation.filter(
      (id) => pitcherAptitude(state.players.find((p) => p.id === id)!)!.best === 'starter',
    );
    expect(starters.length / rotation.length).toBeGreaterThan(0.75);
  });
});
