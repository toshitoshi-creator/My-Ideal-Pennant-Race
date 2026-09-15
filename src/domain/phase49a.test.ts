/**
 * PHASE 4.9-A 検査。
 *
 * 選手詳細の全画面共通化・1軍/2軍の原子的な入れ替え・選手チェック
 * （不調・打撃不振・投手不振）の3本柱について、ドメイン側だけを確かめる。
 *
 * 確かめたいのは4つ。
 *   1. 1軍/2軍の入れ替えが、既存のロスター制約（最低人数・70人枠・怪我・
 *      7日ロック）を守ったまま、2人ぶんを1回でまとめて反映すること
 *   2. 不調・打撃不振・投手不振の判定が、既存の condition / battingScore /
 *      pitchingScore をそのまま使い、サンプルが少ない選手を誤判定しないこと
 *   3. 選手チェック・選手詳細を開く・閲覧するだけの操作がRNGを一切消費せず、
 *      試合結果にも影響しないこと
 *   4. SAVE_VERSION を変えていないこと
 */
import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay } from './engine';
import {
  MIN_FIRST_TEAM_FIELDERS,
  applyRosterSwap,
  checkRosterChange,
  checkRosterSwap,
  rosterSwapCandidates,
  rosterSwapCandidatesForDemote,
} from './roster';
import { FIRST_TEAM_LIMIT } from './types';
import {
  battingSlumpCheck,
  checkTeamPlayers,
  conditionCheckOf,
  pitchingSlumpCheck,
  playerCheckStatus,
  sampleScale,
  SLUMP_SCORE_THRESHOLD,
} from './playerEvaluation';
import { emptyBatting, emptyPitching } from './stats';

const PLAYER_TEAM = 'phoenix';

function freshState(seed = 20260913) {
  return createNewGame(PLAYER_TEAM, 143, seed);
}

/* ================================================================
 * A. 1軍/2軍の原子的な入れ替え
 * ============================================================== */

describe('PHASE4.9-A A. 1軍/2軍の入れ替え', () => {
  it('1軍が定員のとき、単独の昇格は拒否され、code が capacity になる', () => {
    const state = freshState();
    const roster = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    // このテストでは決して1軍へ動かさない、留保しておく1人
    const second = roster.find((p) => p.roster === 'second' && p.ext.injury === null)!;
    // 1軍をちょうど定員まで埋める（second は含めない）
    for (const p of roster) {
      if (p.id === second.id) continue;
      if (p.roster === 'first') continue;
      if (state.players.filter((q) => q.teamId === PLAYER_TEAM && q.roster === 'first').length >= FIRST_TEAM_LIMIT) break;
      p.roster = 'first';
      p.lastRosterChangeDate = null;
    }
    expect(state.players.filter((q) => q.teamId === PLAYER_TEAM && q.roster === 'first').length).toBe(
      FIRST_TEAM_LIMIT,
    );
    expect(second.roster).toBe('second');
    const check = checkRosterChange(state, second.id, 'first');
    expect(check.allowed).toBe(false);
    expect(check.code).toBe('capacity');
  });

  it('入れ替え候補を使って1軍が定員でも昇格できる（原子的）', () => {
    const state = freshState();
    // 1軍をちょうど定員まで埋める
    for (const p of state.players) {
      if (p.teamId !== PLAYER_TEAM) continue;
      if (state.players.filter((q) => q.teamId === PLAYER_TEAM && q.roster === 'first').length >= FIRST_TEAM_LIMIT) break;
      if (p.roster === 'second') {
        p.roster = 'first';
        p.lastRosterChangeDate = null;
      }
    }
    const secondPlayer = state.players.find(
      (p) => p.teamId === PLAYER_TEAM && p.roster === 'second' && p.ext.injury === null,
    )!;
    const candidates = rosterSwapCandidates(state, secondPlayer.id);
    expect(candidates.length).toBeGreaterThan(0);
    const pick = candidates.find((c) => c.allowed)!;
    expect(pick).toBeTruthy();

    const before = state.rngState;
    const result = applyRosterSwap(state, secondPlayer.id, pick.player.id);
    expect(result.ok).toBe(true);
    expect(secondPlayer.roster).toBe('first');
    expect(pick.player.roster).toBe('second');
    // 人数は変わらない（入れ替えなので）
    expect(state.players.filter((q) => q.teamId === PLAYER_TEAM && q.roster === 'first').length).toBe(
      FIRST_TEAM_LIMIT,
    );
    expect(state.rngState).toBe(before);
  });

  it('降格すると野手が最低人数を割るとき、単独の降格は拒否され、code が min-fielders になる', () => {
    const state = freshState();
    const first = state.players.filter((p) => p.teamId === PLAYER_TEAM && p.roster === 'first');
    const fielders = first.filter((p) => !p.isPitcher);
    // 野手をちょうど最低人数まで減らす（残りは2軍へ）
    for (const p of fielders.slice(MIN_FIRST_TEAM_FIELDERS)) {
      p.roster = 'second';
      p.lastRosterChangeDate = null;
    }
    const target = fielders[0];
    const check = checkRosterChange(state, target.id, 'second');
    expect(check.allowed).toBe(false);
    expect(check.code).toBe('min-fielders');
  });

  it('降格の入れ替え候補（代わりに昇格する選手）で解決できる', () => {
    const state = freshState();
    const first = state.players.filter((p) => p.teamId === PLAYER_TEAM && p.roster === 'first');
    const fielders = first.filter((p) => !p.isPitcher);
    for (const p of fielders.slice(MIN_FIRST_TEAM_FIELDERS)) {
      p.roster = 'second';
      p.lastRosterChangeDate = null;
    }
    const target = fielders[0];
    const candidates = rosterSwapCandidatesForDemote(state, target.id);
    const pick = candidates.find((c) => c.allowed && !c.player.isPitcher);
    expect(pick).toBeTruthy();
    const result = applyRosterSwap(state, pick!.player.id, target.id);
    expect(result.ok).toBe(true);
    expect(target.roster).toBe('second');
    expect(pick!.player.roster).toBe('first');
  });

  it('怪我をしている選手は入れ替えでも1軍へ昇格できない', () => {
    const state = freshState();
    const promote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'second')!;
    promote.ext.injury = { level: 'minor', name: 'テスト負傷', startDate: state.date, returnDate: state.date };
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    const check = checkRosterSwap(state, promote.id, demote.id);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('怪我');
  });

  it('登録変更ロック中の選手は入れ替えの対象にならない', () => {
    const state = freshState();
    const promote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'second' && p.ext.injury === null)!;
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    demote.lastRosterChangeDate = state.date; // たった今変更したばかり = ロック中
    const check = checkRosterSwap(state, promote.id, demote.id);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('日');
  });

  it('他球団の選手同士は入れ替えられない', () => {
    const state = freshState();
    const mine = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'second')!;
    const other = state.players.find((p) => p.teamId !== PLAYER_TEAM && p.roster === 'first')!;
    const check = checkRosterSwap(state, mine.id, other.id);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('同じ球団');
  });

  it('存在しない選手IDは拒否される', () => {
    const state = freshState();
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    const check = checkRosterSwap(state, 'no-such-player', demote.id);
    expect(check.allowed).toBe(false);
  });

  it('FA（無所属）選手は入れ替えの対象にならない（teamIdが一致しない）', () => {
    const state = freshState();
    if (state.freeAgents.length === 0) return; // 開幕直後はFAがいないことがある
    const fa = state.freeAgents[0];
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    const check = checkRosterSwap(state, fa.id, demote.id);
    expect(check.allowed).toBe(false);
  });
});

/* ================================================================
 * B. 選手チェックの判定（不調・打撃不振・投手不振）
 * ============================================================== */

describe('PHASE4.9-A B. 選手チェックの判定', () => {
  it('不調・絶不調は condition.ts の既存状態をそのまま使う', () => {
    const state = freshState();
    const player = state.players[0];
    player.ext.condition = 'bad';
    expect(conditionCheckOf(player)).toEqual({ bad: true, worst: false });
    player.ext.condition = 'worst';
    expect(conditionCheckOf(player)).toEqual({ bad: true, worst: true });
    player.ext.condition = 'normal';
    expect(conditionCheckOf(player)).toEqual({ bad: false, worst: false });
  });

  it('打席が少ない選手は打率が悪くても打撃不振にしない', () => {
    const state = freshState();
    const batter = state.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    state.stats[batter.id] = {
      playerId: batter.id,
      batting: { ...emptyBatting(), plateAppearances: 3, atBats: 3, hits: 0 },
      pitching: emptyPitching(),
    };
    expect(battingSlumpCheck(state, batter)).toBeNull();
  });

  it('打席が十分あり打率が低い選手は打撃不振として検出される', () => {
    const state = freshState();
    const batter = state.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    state.stats[batter.id] = {
      playerId: batter.id,
      batting: { ...emptyBatting(), plateAppearances: 100, atBats: 90, hits: 10, strikeouts: 40 },
      pitching: emptyPitching(),
    };
    const info = battingSlumpCheck(state, batter);
    expect(info).not.toBeNull();
    expect(info!.score).toBeLessThan(SLUMP_SCORE_THRESHOLD);
    expect(info!.atBats).toBe(90);
  });

  it('投球回が少ない投手は防御率が悪くても投手不振にしない', () => {
    const state = freshState();
    const pitcher = state.players.find((p) => p.teamId === PLAYER_TEAM && p.isPitcher)!;
    state.stats[pitcher.id] = {
      playerId: pitcher.id,
      batting: emptyBatting(),
      pitching: { ...emptyPitching(), outs: 3, earnedRuns: 5, games: 1 },
    };
    expect(pitchingSlumpCheck(state, pitcher)).toBeNull();
  });

  it('投球回が十分あり防御率が悪い投手は投手不振として検出される', () => {
    const state = freshState();
    const pitcher = state.players.find((p) => p.teamId === PLAYER_TEAM && p.isPitcher)!;
    state.stats[pitcher.id] = {
      playerId: pitcher.id,
      batting: emptyBatting(),
      pitching: {
        ...emptyPitching(),
        outs: 180,
        earnedRuns: 55,
        games: 20,
        hitsAllowed: 80,
        walks: 40,
      },
    };
    const info = pitchingSlumpCheck(state, pitcher);
    expect(info).not.toBeNull();
    expect(info!.score).toBeLessThan(SLUMP_SCORE_THRESHOLD);
    expect(info!.outs).toBe(180);
  });

  it('野手は投手不振に、投手は打撃不振にならない', () => {
    const state = freshState();
    const batter = state.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    const pitcher = state.players.find((p) => p.teamId === PLAYER_TEAM && p.isPitcher)!;
    expect(pitchingSlumpCheck(state, batter)).toBeNull();
    expect(battingSlumpCheck(state, pitcher)).toBeNull();
  });

  it('シーズンが短いほど、判定に必要な打席・投球回のしきい値が下がる', () => {
    const short = freshState();
    short.seasonLength = 10;
    const long = freshState();
    long.seasonLength = 143;
    expect(sampleScale(short)).toBeLessThan(sampleScale(long));
  });

  it('何も問題のない選手は checkTeamPlayers に出てこない', () => {
    const state = freshState();
    const player = state.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.condition = 'normal';
    const status = playerCheckStatus(state, player);
    expect(status.conditionBad).toBe(false);
    expect(status.battingSlump).toBeNull();
    expect(status.pitchingSlump).toBeNull();
    const list = checkTeamPlayers(state, PLAYER_TEAM);
    expect(list.find((s) => s.playerId === player.id)).toBeUndefined();
  });

  it('不調な選手は checkTeamPlayers に含まれる', () => {
    const state = freshState();
    const player = state.players.find((p) => p.teamId === PLAYER_TEAM)!;
    player.ext.condition = 'worst';
    const list = checkTeamPlayers(state, PLAYER_TEAM);
    expect(list.find((s) => s.playerId === player.id)?.conditionWorst).toBe(true);
  });
});

/* ================================================================
 * C. RNG非干渉・ゲームに触らない
 * ============================================================== */

describe('PHASE4.9-A C. RNGに触らない', () => {
  it('選手チェック・判定の読み取りだけではrngStateが変わらない', () => {
    const state = freshState();
    const before = state.rngState;
    for (const player of state.players) {
      playerCheckStatus(state, player);
    }
    checkTeamPlayers(state, PLAYER_TEAM);
    expect(state.rngState).toBe(before);
  });

  it('入れ替えチェック（許可・拒否のどちらでも）はrngStateを変えない', () => {
    const state = freshState();
    const before = state.rngState;
    const roster = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    for (const player of roster.slice(0, 10)) {
      checkRosterChange(state, player.id, player.roster === 'first' ? 'second' : 'first');
    }
    const promote = roster.find((p) => p.roster === 'second')!;
    const demote = roster.find((p) => p.roster === 'first')!;
    checkRosterSwap(state, promote.id, demote.id);
    rosterSwapCandidates(state, promote.id);
    rosterSwapCandidatesForDemote(state, demote.id);
    expect(state.rngState).toBe(before);
  });

  it('実際に入れ替えを反映してもrngStateは変わらない（日付・成績・疲労・コンディションも同様）', () => {
    const state = freshState();
    const beforeRng = state.rngState;
    const beforeDate = state.date;
    const promote = state.players.find(
      (p) => p.teamId === PLAYER_TEAM && p.roster === 'second' && p.ext.injury === null,
    )!;
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first' && !p.isPitcher)!;
    const beforeFatigue = demote.ext.fatigue;
    const beforeCondition = demote.ext.condition;
    const result = applyRosterSwap(state, promote.id, demote.id);
    expect(result.ok).toBe(true);
    expect(state.rngState).toBe(beforeRng);
    expect(state.date).toBe(beforeDate);
    expect(demote.ext.fatigue).toBe(beforeFatigue);
    expect(demote.ext.condition).toBe(beforeCondition);
  });

  it('同じシードで、選手チェック・詳細閲覧を挟んでも挟まなくてもシミュレーション結果が一致する', () => {
    const run = (withChecks: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 20260913);
      for (let day = 0; day < 10; day++) {
        if (withChecks) {
          checkTeamPlayers(state, PLAYER_TEAM);
          for (const player of state.players) {
            playerCheckStatus(state, player);
          }
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = run(false);
    const checked = run(true);
    expect(checked.rngState).toBe(plain.rngState);
    expect(checked.records).toEqual(plain.records);
    expect(checked.date).toBe(plain.date);
  });

  it('SAVE_VERSION を変えていない', () => {
    expect(SAVE_VERSION).toBe(16);
  });
});
