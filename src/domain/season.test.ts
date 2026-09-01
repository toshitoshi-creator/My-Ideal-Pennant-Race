import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import {
  advanceDay,
  advanceToNextPlayerGame,
  cloneState,
  firstTeamOf,
  validateState,
} from './engine';
import { standingsForLeague } from './standings';
import { simulateGame } from './simulation';
import { Rng } from './rng';
import { PLAYER_TEAM_STRENGTH, TEAM_SEEDS } from './teams';
import { generateTeamPlayers } from './playerGen';
import { buildAutoSetup } from './setup';
import { diffDays } from './dates';
import type { GameState } from './types';

const PLAYER_TEAM = 'phoenix';

function playFullSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) {
    s = advanceDay(s).state;
  }
  return s;
}

describe('STEP9 試合シミュレーション', () => {
  const state = createNewGame(PLAYER_TEAM, 10, 777);

  it('試合結果の整合性が取れている', () => {
    let s = cloneState(state);
    for (let i = 0; i < 5; i++) {
      const step = advanceDay(s);
      s = step.state;
      for (const r of step.results) {
        expect(r.innings).toBeGreaterThanOrEqual(9);
        expect(r.innings).toBeLessThanOrEqual(12);
        // イニングごとの得点の合計 = 最終得点
        expect(r.home.inningRuns.reduce((a, b) => a + b, 0)).toBe(r.home.runs);
        expect(r.away.inningRuns.reduce((a, b) => a + b, 0)).toBe(r.away.runs);
        // 勝敗と得点が矛盾しない
        if (r.home.runs > r.away.runs) expect(r.winnerTeamId).toBe(r.homeTeamId);
        else if (r.away.runs > r.home.runs) expect(r.winnerTeamId).toBe(r.awayTeamId);
        else expect(r.winnerTeamId).toBeNull();
        // 勝ち投手・負け投手
        if (r.winnerTeamId) {
          expect(r.winningPitcherId).not.toBeNull();
          expect(r.losingPitcherId).not.toBeNull();
        }
        expect(r.home.errors).toBeGreaterThanOrEqual(0);
        expect(r.away.hits).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('9回表終了時点でホームがリードしていれば9回裏の攻撃はない', () => {
    let s = cloneState(state);
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const step = advanceDay(s);
      s = step.state;
      for (const r of step.results) {
        if (r.innings !== 9) continue;
        const homeThrough8 = r.home.inningRuns.slice(0, 8).reduce((a, b) => a + b, 0);
        if (homeThrough8 > r.away.runs) {
          expect(r.home.inningRuns[8]).toBe(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('簡易実況が生成される', () => {
    const step = advanceToNextPlayerGame(cloneState(state));
    expect(step.playerResult).not.toBeNull();
    expect(step.playerResult!.commentary.length).toBeGreaterThan(10);
    expect(step.playerResult!.commentary.join('\n')).toContain('回表');
  });

  it('強いチームは弱いチームに勝ち越すが100%ではない', () => {
    const rng = new Rng(2024);
    const strongTeam = TEAM_SEEDS[0];
    const weakTeam = TEAM_SEEDS[11];
    // ゲーム内で実際に起こりうる最大の戦力差（最強CPU球団 vs プレイヤー球団）
    const strongPlayers = generateTeamPlayers(rng, { teamId: strongTeam.id, strength: 41, starCount: 3 });
    const weakPlayers = generateTeamPlayers(rng, {
      teamId: weakTeam.id,
      strength: PLAYER_TEAM_STRENGTH,
      starCount: 2,
      starBonus: [7, 14],
    });
    const strongSetup = buildAutoSetup(strongTeam.id, strongPlayers, true);
    const weakSetup = buildAutoSetup(weakTeam.id, weakPlayers, true);

    let strongWins = 0;
    let weakWins = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const r = simulateGame({
        rng,
        gameId: `t${i}`,
        date: '2026-04-01',
        leagueId: 'ocean',
        useDH: true,
        homeTeam: strongTeam,
        awayTeam: weakTeam,
        homePlayers: strongPlayers,
        awayPlayers: weakPlayers,
        homeSetup: strongSetup,
        awaySetup: weakSetup,
      });
      if (r.winnerTeamId === strongTeam.id) strongWins++;
      else if (r.winnerTeamId === weakTeam.id) weakWins++;
    }
    expect(strongWins).toBeGreaterThan(weakWins);
    expect(strongWins / N).toBeGreaterThan(0.55);
    // 100% にはならない（弱いチームにも勝ちがある）
    expect(strongWins / N).toBeLessThan(0.9);
    expect(weakWins).toBeGreaterThan(0);
  });

  it('得点は現実的な範囲に収まる', () => {
    const rng = new Rng(99);
    const teamA = TEAM_SEEDS[0];
    const teamB = TEAM_SEEDS[1];
    const aPlayers = generateTeamPlayers(rng, { teamId: teamA.id, strength: 45 });
    const bPlayers = generateTeamPlayers(rng, { teamId: teamB.id, strength: 45 });
    const aSetup = buildAutoSetup(teamA.id, aPlayers, false);
    const bSetup = buildAutoSetup(teamB.id, bPlayers, false);
    let totalRuns = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      const r = simulateGame({
        rng, gameId: `x${i}`, date: '2026-04-01', leagueId: 'grand', useDH: false,
        homeTeam: teamA, awayTeam: teamB,
        homePlayers: aPlayers, awayPlayers: bPlayers,
        homeSetup: aSetup, awaySetup: bSetup,
      });
      totalRuns += r.home.runs + r.away.runs;
    }
    const avgPerTeam = totalRuns / N / 2;
    expect(avgPerTeam).toBeGreaterThan(1.5);
    expect(avgPerTeam).toBeLessThan(9);
  });
});

describe('STEP10/11/12 成績・順位・日付', () => {
  it('10試合シーズンを完走して整合性が保たれる', () => {
    const start = createNewGame(PLAYER_TEAM, 10, 555);
    const startDate = start.date;
    const end = playFullSeason(start);

    expect(end.seasonFinished).toBe(true);
    expect(diffDays(end.date, startDate)).toBeGreaterThan(0);
    expect(validateState(end)).toEqual([]);

    for (const team of end.teams) {
      const rec = end.records[team.id];
      expect(rec.games).toBe(10);
      expect(rec.wins + rec.losses + rec.draws).toBe(rec.games);
    }
    // リーグ全体で勝ち数と負け数は一致する
    for (const league of end.leagues) {
      const teams = end.teams.filter((t) => t.leagueId === league.id);
      const wins = teams.reduce((a, t) => a + end.records[t.id].wins, 0);
      const losses = teams.reduce((a, t) => a + end.records[t.id].losses, 0);
      expect(wins).toBe(losses);
      const scored = teams.reduce((a, t) => a + end.records[t.id].runsScored, 0);
      const allowed = teams.reduce((a, t) => a + end.records[t.id].runsAllowed, 0);
      expect(scored).toBe(allowed);
    }
  });

  it('個人成績がチーム成績と一致する', () => {
    const end = playFullSeason(createNewGame(PLAYER_TEAM, 10, 321));
    for (const team of end.teams) {
      const players = end.players.filter((p) => p.teamId === team.id);
      const hits = players.reduce((a, p) => a + end.stats[p.id].batting.hits, 0);
      const hr = players.reduce((a, p) => a + end.stats[p.id].batting.homeRuns, 0);
      const runs = players.reduce((a, p) => a + end.stats[p.id].batting.runs, 0);
      const outs = players.reduce((a, p) => a + end.stats[p.id].pitching.outs, 0);
      const wins = players.reduce((a, p) => a + end.stats[p.id].pitching.wins, 0);
      const losses = players.reduce((a, p) => a + end.stats[p.id].pitching.losses, 0);

      expect(runs).toBe(end.records[team.id].runsScored);
      expect(hits).toBeGreaterThanOrEqual(hr);
      expect(outs).toBeGreaterThan(0);
      expect(wins).toBe(end.records[team.id].wins);
      expect(losses).toBe(end.records[team.id].losses);
    }
  });

  it('順位表は勝率順に並ぶ', () => {
    const end = playFullSeason(createNewGame(PLAYER_TEAM, 30, 4242));
    for (const league of end.leagues) {
      const rows = standingsForLeague(end, league.id);
      expect(rows).toHaveLength(6);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1].winPct).toBeGreaterThanOrEqual(rows[i].winPct);
      }
      expect(rows[0].rank).toBe(1);
      expect(rows[0].gamesBehind).toBe(0);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].gamesBehind).toBeGreaterThanOrEqual(rows[i - 1].gamesBehind);
      }
    }
  });

  it('日付は必ず進み、戻らない', () => {
    let s = createNewGame(PLAYER_TEAM, 30, 88);
    let prev = s.date;
    for (let i = 0; i < 20; i++) {
      s = advanceDay(s).state;
      expect(diffDays(s.date, prev)).toBe(1);
      prev = s.date;
    }
  });

  it('「次の試合へ」でプレイヤー球団の試合が消化される', () => {
    let s = createNewGame(PLAYER_TEAM, 30, 606);
    for (let i = 0; i < 5; i++) {
      const before = s.records[PLAYER_TEAM].games;
      const step = advanceToNextPlayerGame(s);
      s = step.state;
      expect(step.playerResult).not.toBeNull();
      expect(s.records[PLAYER_TEAM].games).toBe(before + 1);
    }
  });

  it('143試合シーズンも完走できる', () => {
    const end = playFullSeason(createNewGame(PLAYER_TEAM, 143, 1010));
    expect(end.seasonFinished).toBe(true);
    for (const team of end.teams) {
      expect(end.records[team.id].games).toBe(143);
    }
    expect(validateState(end)).toEqual([]);
    // 打率が現実的な範囲に収まっている
    const regulars = end.players.filter((p) => end.stats[p.id].batting.atBats >= 300);
    expect(regulars.length).toBeGreaterThan(20);
    for (const p of regulars) {
      const avg = end.stats[p.id].batting.hits / end.stats[p.id].batting.atBats;
      expect(avg).toBeGreaterThan(0.12);
      expect(avg).toBeLessThan(0.45);
    }
  }, 60000);

  it('1軍の選手だけが試合に出場する', () => {
    let s = createNewGame(PLAYER_TEAM, 10, 4649);
    const secondTeamIds = new Set(
      s.players.filter((p) => p.roster === 'second').map((p) => p.id),
    );
    s = playFullSeason(s);
    for (const id of secondTeamIds) {
      const st = s.stats[id];
      expect(st.batting.plateAppearances).toBe(0);
      expect(st.pitching.outs).toBe(0);
    }
    // 1軍の主力は出場している
    const first = firstTeamOf(s, PLAYER_TEAM).filter((p) => !p.isPitcher);
    expect(first.some((p) => s.stats[p.id].batting.atBats > 0)).toBe(true);
  });
});
