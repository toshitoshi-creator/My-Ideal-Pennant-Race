import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import {
  HOUR_MS,
  MANUAL_MAX,
  canAutoPlay,
  consumeManualCharge,
  ensureRealtime,
  msUntilNextCharge,
  purchaseCharges,
  recoverCharges,
  syncRealtime,
} from './realtime';

const T0 = 1_800_000_000_000;

function game() {
  const s = createNewGame('phoenix', 10 as never, 7);
  ensureRealtime(s, T0);
  return s;
}

describe('手動試合の回数', () => {
  it('最初は20回。使うと減り、1時間ごとに1回回復して20回で止まる', () => {
    const s = game();
    expect(s.realtime!.manualCharges).toBe(MANUAL_MAX);
    for (let i = 0; i < 3; i++) expect(consumeManualCharge(s, T0)).toBe(true);
    expect(s.realtime!.manualCharges).toBe(17);
    recoverCharges(s, T0 + HOUR_MS * 2 + 5);
    expect(s.realtime!.manualCharges).toBe(19);
    expect(msUntilNextCharge(s, T0 + HOUR_MS * 2 + 5)).toBe(HOUR_MS - 5);
    recoverCharges(s, T0 + HOUR_MS * 50);
    expect(s.realtime!.manualCharges).toBe(MANUAL_MAX);
  });

  it('0回では使えない。購入すると上限を超えて持てる', () => {
    const s = game();
    for (let i = 0; i < MANUAL_MAX; i++) consumeManualCharge(s, T0);
    expect(consumeManualCharge(s, T0)).toBe(false);
    expect(purchaseCharges(s, 'big', T0)).toBe(true);
    expect(s.realtime!.manualCharges).toBe(50);
    expect(s.realtime!.purchases).toBe(1);
  });

  it('満タンのあいだは時間を貯めない', () => {
    const s = game();
    recoverCharges(s, T0 + HOUR_MS * 10);
    consumeManualCharge(s, T0 + HOUR_MS * 10);
    recoverCharges(s, T0 + HOUR_MS * 10 + 1000);
    expect(s.realtime!.manualCharges).toBe(MANUAL_MAX - 1);
  });
});

describe('自動試合', () => {
  it('1時間に1試合進み、まとめが残る。元の state は変わらない', () => {
    const s = game();
    const before = s.results.length;
    const r = syncRealtime(s, T0 + HOUR_MS * 3 + 10);
    expect(r.played.length).toBe(3);
    expect(s.results.length).toBe(before);
    const rep = r.state.realtime!.pendingReport!;
    expect(rep.games.length).toBe(3);
    expect(rep.hours).toBe(3);
    const w = rep.recordAfter.wins + rep.recordAfter.losses + rep.recordAfter.draws;
    expect(w).toBe(3);
    // 1時間たっていなければ進まない
    const again = syncRealtime(r.state, T0 + HOUR_MS * 3 + 20);
    expect(again.played.length).toBe(0);
  });

  it('まだ見ていないまとめには、次のぶんが重なる', () => {
    const s = game();
    const a = syncRealtime(s, T0 + HOUR_MS * 2);
    const b = syncRealtime(a.state, T0 + HOUR_MS * 4);
    const rep = b.state.realtime!.pendingReport!;
    expect(rep.games.length).toBe(4);
    expect(rep.hours).toBe(4);
    expect(rep.recordBefore).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it('シーズン（とポストシーズン）が終わったら止まり、オフでは時間を貯めない', () => {
    const s = game();
    const r = syncRealtime(s, T0 + HOUR_MS * 300);
    expect(r.state.seasonFinished).toBe(true);
    expect(canAutoPlay(r.state)).toBe(false);
    expect(r.state.realtime!.autoAt).toBe(T0 + HOUR_MS * 300);
    expect(r.played.length).toBeGreaterThanOrEqual(10);
  });
});
