import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame } from './newGame';
import { TEAM_SEEDS, LEAGUES } from './teams';
import { rankOf } from './rank';
import {
  extraBaseFactor,
  groundBallRate,
  homeRunFactor,
  migrateLegacyTrajectory,
} from './trajectory';
import { Rng } from './rng';
import { generateTeamPlayers } from './playerGen';
import { simulateGame } from './simulation';
import { positionPenalty, effectiveDefense, FIELD_POSITIONS } from './positions';
import { advanceToNextPlayerGame, validateState, firstTeamOf, cloneState, repairAllSetups } from './engine';
import { applyRosterChange, checkRosterChange, daysUntilChangeable, firstTeamCount } from './roster';
import { addDays } from './dates';
import { generateSchedule } from './schedule';
import { buildAutoSetup, validateLineup, nextStarterId } from './setup';
import type { GameState, Player } from './types';
import { FIRST_TEAM_LIMIT, ROSTER_LIMIT } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(seasonLength: 10 | 30 | 143 = 10, seed = 12345): GameState {
  return createNewGame(PLAYER_TEAM, seasonLength, seed);
}

describe('STEP2 球団データ', () => {
  it('12球団・2リーグ・1リーグ6球団', () => {
    expect(TEAM_SEEDS).toHaveLength(12);
    expect(LEAGUES).toHaveLength(2);
    for (const league of LEAGUES) {
      expect(TEAM_SEEDS.filter((t) => t.leagueId === league.id)).toHaveLength(6);
    }
  });

  it('球団IDは一意', () => {
    const ids = new Set(TEAM_SEEDS.map((t) => t.id));
    expect(ids.size).toBe(12);
  });
});

describe('STEP3 選手データ', () => {
  const state = newGame();
  const playerTeam = state.players.filter((p) => p.teamId === PLAYER_TEAM);

  it('プレイヤー球団は25人', () => {
    expect(playerTeam).toHaveLength(25);
  });

  it('投手10・捕手3・内野7・外野5の構成', () => {
    const count = (pred: (p: Player) => boolean) => playerTeam.filter(pred).length;
    expect(count((p) => p.mainPosition === 'P')).toBe(10);
    expect(count((p) => p.mainPosition === 'C')).toBe(3);
    expect(count((p) => ['1B', '2B', '3B', 'SS'].includes(p.mainPosition))).toBe(7);
    expect(count((p) => ['LF', 'CF', 'RF'].includes(p.mainPosition))).toBe(5);
  });

  it('全選手のIDが一意（同姓同名でも別ID）', () => {
    const ids = new Set(state.players.map((p) => p.id));
    expect(ids.size).toBe(state.players.length);
    expect(state.players.length).toBe(12 * 25);
  });

  it('選手は1つの球団にしか所属しない', () => {
    const byId = new Map<string, string>();
    for (const p of state.players) {
      expect(byId.has(p.id)).toBe(false);
      byId.set(p.id, p.teamId);
    }
  });

  it('能力値は1〜100に収まる', () => {
    for (const p of state.players) {
      const b = p.batting;
      for (const v of [b.trajectory, b.contact, b.power, b.speed, b.arm, b.fielding, b.catching]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(100);
        expect(Number.isInteger(v)).toBe(true);
      }
      if (p.isPitcher) {
        expect(p.pitching).not.toBeNull();
        expect(p.pitching!.velocity).toBeGreaterThanOrEqual(125);
        expect(p.pitching!.velocity).toBeLessThanOrEqual(162);
      }
    }
  });

  it('プレイヤー球団は弱小（Aランクだらけにならない）', () => {
    const aRank = playerTeam.filter((p) => {
      const values = p.isPitcher
        ? [p.pitching!.control, p.pitching!.stamina, p.pitching!.power]
        : [p.batting.contact, p.batting.power, p.batting.speed];
      return values.some((v) => rankOf(v) === 'A');
    });
    expect(aRank.length).toBeLessThanOrEqual(3);
  });

  it('PHASE2の個性フィールドと、PHASE3以降の拡張用フィールドを持つ', () => {
    const p = playerTeam[0];
    // PHASE 2 で実装済み
    for (const key of [
      'personality', 'potential', 'growthType', 'growthTendency', 'growthRate',
      'specialAbilities', 'fatigue', 'condition', 'motivation', 'morale', 'injury',
      'slump', 'birthDate', 'hiddenAttributes',
    ]) {
      expect(p.ext).toHaveProperty(key);
    }
    // PHASE 3 以降のための器
    expect(p.ext).toHaveProperty('contract');
    expect(p.ext).toHaveProperty('faStatus');
    expect(p.ext).toHaveProperty('popularity');
  });
});

describe('能力ランク', () => {
  it('境界値が仕様どおり', () => {
    expect(rankOf(1)).toBe('G');
    expect(rankOf(19)).toBe('G');
    expect(rankOf(20)).toBe('F');
    expect(rankOf(29)).toBe('F');
    expect(rankOf(30)).toBe('E');
    expect(rankOf(39)).toBe('E');
    expect(rankOf(40)).toBe('D');
    expect(rankOf(49)).toBe('D');
    expect(rankOf(50)).toBe('C');
    expect(rankOf(59)).toBe('C');
    expect(rankOf(60)).toBe('B');
    expect(rankOf(69)).toBe('B');
    expect(rankOf(70)).toBe('A');
    expect(rankOf(100)).toBe('A');
  });
});

describe('STEP11 守備適性ペナルティ', () => {
  const state = newGame();
  const ss = state.players.find((p) => p.mainPosition === 'SS' && !p.subPositions.includes('2B'))!;
  const catcher = state.players.find((p) => p.mainPosition === 'C')!;

  it('本職ならペナルティなし', () => {
    expect(positionPenalty(ss, 'SS')).toBe(0);
  });

  it('本職遊撃手を二塁は軽いペナルティ', () => {
    const p = positionPenalty(ss, '2B');
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.2);
  });

  it('本職捕手を遊撃は大きなペナルティ', () => {
    expect(positionPenalty(catcher, 'SS')).toBeGreaterThan(positionPenalty(ss, '2B') * 2);
  });

  it('一塁・左翼は負担が軽い', () => {
    expect(positionPenalty(ss, '1B')).toBeLessThan(positionPenalty(ss, '2B'));
    expect(positionPenalty(catcher, '1B')).toBeLessThan(positionPenalty(catcher, 'SS'));
  });

  it('ペナルティが大きいほど守備力が下がる', () => {
    const own = effectiveDefense(catcher, 'C');
    const away = effectiveDefense(catcher, 'SS');
    expect(away).toBeLessThan(own);
  });
});

describe('STEP6/STEP14 1軍・2軍と7日間制限', () => {
  let state: GameState;
  beforeEach(() => {
    state = newGame();
  });

  it('初期状態で1軍は31人以下', () => {
    for (const team of state.teams) {
      expect(firstTeamCount(state, team.id)).toBeLessThanOrEqual(FIRST_TEAM_LIMIT);
    }
  });

  it('球団の保有選手は70人以下', () => {
    for (const team of state.teams) {
      expect(state.players.filter((p) => p.teamId === team.id).length).toBeLessThanOrEqual(
        ROSTER_LIMIT,
      );
    }
  });

  it('1軍→2軍、2軍→1軍に変更できる', () => {
    const demote = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    expect(applyRosterChange(state, demote.id, 'second').ok).toBe(true);
    expect(demote.roster).toBe('second');

    const promote = state.players.find(
      (p) => p.teamId === PLAYER_TEAM && p.roster === 'second' && p.id !== demote.id,
    )!;
    expect(applyRosterChange(state, promote.id, 'first').ok).toBe(true);
    expect(promote.roster).toBe('first');
  });

  it('変更後7日間は再変更できず、7日後に変更できる', () => {
    const player = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    const start = state.date;
    expect(applyRosterChange(state, player.id, 'second').ok).toBe(true);
    expect(player.lastRosterChangeDate).toBe(start);

    for (let d = 0; d < 7; d++) {
      state.date = addDays(start, d);
      expect(daysUntilChangeable(player, state.date)).toBe(7 - d);
      expect(checkRosterChange(state, player.id, 'first').allowed).toBe(false);
    }
    state.date = addDays(start, 7);
    expect(daysUntilChangeable(player, state.date)).toBe(0);
    expect(checkRosterChange(state, player.id, 'first').allowed).toBe(true);
    expect(applyRosterChange(state, player.id, 'first').ok).toBe(true);
  });

  it('4月1日に変更したら次は4月8日', () => {
    const player = state.players.find((p) => p.teamId === PLAYER_TEAM && p.roster === 'first')!;
    state.date = '2026-04-01';
    applyRosterChange(state, player.id, 'second');
    expect(addDays(player.lastRosterChangeDate!, 7)).toBe('2026-04-08');
  });

  it('1軍は31人まで。32人目は登録できない', () => {
    // まず全員2軍に落としてから、制限を無視して1軍を31人にする
    for (const p of state.players.filter((p) => p.teamId === PLAYER_TEAM)) {
      p.roster = 'second';
      p.lastRosterChangeDate = null;
    }
    const roster = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    // 25人しかいないので上限まで登録できることを確認しつつ、上限判定をテスト
    for (const p of roster) {
      expect(checkRosterChange(state, p.id, 'first').allowed).toBe(true);
      applyRosterChange(state, p.id, 'first');
      p.lastRosterChangeDate = null;
    }
    expect(firstTeamCount(state, PLAYER_TEAM)).toBe(25);

    // 31人まで埋めた状態を作る（他球団の選手を移籍させずに複製せず、直接ロスターを操作）
    const extra = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    while (firstTeamCount(state, PLAYER_TEAM) < FIRST_TEAM_LIMIT) {
      const clone: Player = { ...extra[0], id: `${extra[0].id}-x${firstTeamCount(state, PLAYER_TEAM)}`, roster: 'first' };
      state.players.push(clone);
    }
    expect(firstTeamCount(state, PLAYER_TEAM)).toBe(FIRST_TEAM_LIMIT);

    const bench: Player = { ...extra[0], id: 'bench-extra', roster: 'second', lastRosterChangeDate: null };
    state.players.push(bench);
    const check = checkRosterChange(state, bench.id, 'first');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('31');
  });

  it('2軍に落とした選手はオーダーから自動的に外れる', () => {
    const setup = state.setups[PLAYER_TEAM];
    const starter = setup.lineup.find((s) => s.position !== 'P')!;
    applyRosterChange(state, starter.playerId, 'second');
    repairAllSetups(state);
    const after = state.setups[PLAYER_TEAM];
    expect(after.lineup.some((s) => s.playerId === starter.playerId)).toBe(false);
    expect(validateState(state)).toEqual([]);
  });
});

describe('STEP7/STEP8 オーダーと先発', () => {
  const state = newGame();

  it('全球団のオーダーは9人で守備位置が揃っている', () => {
    for (const team of state.teams) {
      const league = state.leagues.find((l) => l.id === team.leagueId)!;
      const setup = state.setups[team.id];
      expect(setup.lineup).toHaveLength(9);
      const positions = setup.lineup.map((s) => s.position);
      for (const pos of FIELD_POSITIONS) {
        expect(positions).toContain(pos);
      }
      if (league.useDH) {
        expect(positions).toContain('DH');
        expect(positions).not.toContain('P');
      } else {
        expect(positions).toContain('P');
        expect(positions).not.toContain('DH');
      }
      expect(validateLineup(setup, firstTeamOf(state, team.id), league.useDH)).toEqual([]);
    }
  });

  it('先発ローテーションは5人の1軍投手', () => {
    for (const team of state.teams) {
      const setup = state.setups[team.id];
      expect(setup.rotation).toHaveLength(5);
      for (const id of setup.rotation) {
        const p = state.players.find((x) => x.id === id)!;
        expect(p.isPitcher).toBe(true);
        expect(p.roster).toBe('first');
        expect(p.teamId).toBe(team.id);
      }
    }
  });

  it('試合ごとに先発が順番に回る', () => {
    let s = cloneState(state);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(nextStarterId(s.setups[PLAYER_TEAM])!);
      s = advanceToNextPlayerGame(s).state;
    }
    expect(new Set(seen).size).toBe(5);
  });
});

describe('STEP12 日程', () => {
  it('各球団がシーズン試合数ちょうど組まれている', () => {
    for (const length of [10, 30, 143] as const) {
      const schedule = generateSchedule(2026, length, LEAGUES, TEAM_SEEDS);
      for (const team of TEAM_SEEDS) {
        const games = schedule.filter(
          (g) => g.homeTeamId === team.id || g.awayTeamId === team.id,
        );
        expect(games).toHaveLength(length);
      }
    }
  });

  it('同じ日に同じ球団が2試合しない', () => {
    const schedule = generateSchedule(2026, 30, LEAGUES, TEAM_SEEDS);
    const byDate = new Map<string, Set<string>>();
    for (const g of schedule) {
      const set = byDate.get(g.date) ?? new Set<string>();
      expect(set.has(g.homeTeamId)).toBe(false);
      expect(set.has(g.awayTeamId)).toBe(false);
      set.add(g.homeTeamId);
      set.add(g.awayTeamId);
      byDate.set(g.date, set);
    }
  });

  it('同一リーグ内の対戦のみ', () => {
    const schedule = generateSchedule(2026, 30, LEAGUES, TEAM_SEEDS);
    for (const g of schedule) {
      const home = TEAM_SEEDS.find((t) => t.id === g.homeTeamId)!;
      const away = TEAM_SEEDS.find((t) => t.id === g.awayTeamId)!;
      expect(home.leagueId).toBe(away.leagueId);
    }
  });
});

describe('試合が成立しなくなる降格は禁止', () => {
  it('1軍の野手が9人未満・投手が5人未満になる降格はできない', () => {
    const state = newGame();
    const roster = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    // 1軍の野手をぎりぎりまで減らす
    const fielders = roster.filter((p) => !p.isPitcher && p.roster === 'first');
    for (const p of fielders.slice(0, fielders.length - 9)) {
      p.roster = 'second';
    }
    const remaining = roster.filter((p) => !p.isPitcher && p.roster === 'first');
    expect(remaining).toHaveLength(9);
    const check = checkRosterChange(state, remaining[0].id, 'second');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('野手');

    const pitchers = roster.filter((p) => p.isPitcher && p.roster === 'first');
    for (const p of pitchers.slice(0, pitchers.length - 5)) {
      p.roster = 'second';
    }
    const remainingPitchers = roster.filter((p) => p.isPitcher && p.roster === 'first');
    expect(remainingPitchers).toHaveLength(5);
    const pitcherCheck = checkRosterChange(state, remainingPitchers[0].id, 'second');
    expect(pitcherCheck.allowed).toBe(false);
    expect(pitcherCheck.reason).toContain('投手');

    // この状態でもオーダーは9人揃い、試合を行える
    repairAllSetups(state);
    expect(state.setups[PLAYER_TEAM].lineup).toHaveLength(9);
    expect(validateState(state)).toEqual([]);
  });
});

describe('弾道（1〜100）', () => {
  const state = newGame();
  const fielders = state.players.filter((p) => !p.isPitcher);

  it('他の能力値と同じ 1〜100 スケールで G〜A のランクがつく', () => {
    const ranks = new Set(fielders.map((p) => rankOf(p.batting.trajectory)));
    // 弱小〜強豪まで揃うので複数のランクが出る
    expect(ranks.size).toBeGreaterThan(2);
    for (const p of fielders) {
      expect(['G', 'F', 'E', 'D', 'C', 'B', 'A']).toContain(rankOf(p.batting.trajectory));
    }
  });

  it('旧仕様（1〜4）の弾道は 25 / 50 / 75 / 100 に移行される', () => {
    expect(migrateLegacyTrajectory(1)).toBe(25);
    expect(migrateLegacyTrajectory(2)).toBe(50);
    expect(migrateLegacyTrajectory(3)).toBe(75);
    expect(migrateLegacyTrajectory(4)).toBe(100);
  });

  it('本塁打係数は弾道が高いほど大きくなる（旧4段階と同じ値を通る）', () => {
    expect(homeRunFactor(25)).toBeCloseTo(0.55, 5);
    expect(homeRunFactor(50)).toBeCloseTo(0.85, 5);
    expect(homeRunFactor(75)).toBeCloseTo(1.15, 5);
    expect(homeRunFactor(100)).toBeCloseTo(1.45, 5);
    expect(homeRunFactor(1)).toBeLessThan(homeRunFactor(100));
  });

  it('長打係数とゴロ率も弾道の独立した係数として働く', () => {
    expect(extraBaseFactor(50)).toBeCloseTo(1, 5);
    expect(extraBaseFactor(100)).toBeGreaterThan(extraBaseFactor(1));
    // 弾道が高いほどゴロが減る
    expect(groundBallRate(100)).toBeLessThan(groundBallRate(25));
    expect(groundBallRate(50)).toBeCloseTo(0.56, 5);
  });

  it('弾道が高い打者ほど本塁打が出やすい（試合シミュレーションで確認）', () => {
    const rng = new Rng(20260901);
    const teamA = TEAM_SEEDS[0];
    const teamB = TEAM_SEEDS[1];
    const lowPlayers = generateTeamPlayers(rng, { teamId: teamA.id, strength: 45 });
    const highPlayers = generateTeamPlayers(rng, { teamId: teamB.id, strength: 45 }).map((p) => ({
      ...p,
      batting: { ...p.batting },
    }));
    // 弾道だけを変えて比較する
    for (const p of lowPlayers) p.batting.trajectory = 20;
    for (const p of highPlayers) p.batting.trajectory = 90;
    const lowSetup = buildAutoSetup(teamA.id, lowPlayers, true);
    const highSetup = buildAutoSetup(teamB.id, highPlayers, true);

    let lowHr = 0;
    let highHr = 0;
    for (let i = 0; i < 60; i++) {
      const result = simulateGame({
        rng,
        gameId: `traj${i}`,
        date: '2026-04-01',
        leagueId: 'ocean',
        useDH: true,
        homeTeam: teamA,
        awayTeam: teamB,
        homePlayers: lowPlayers,
        awayPlayers: highPlayers,
        homeSetup: lowSetup,
        awaySetup: highSetup,
      });
      for (const line of result.playerLines) {
        if (!line.batting) continue;
        if (line.teamId === teamA.id) lowHr += line.batting.homeRuns;
        else highHr += line.batting.homeRuns;
      }
    }
    expect(highHr).toBeGreaterThan(lowHr);
  });
});
