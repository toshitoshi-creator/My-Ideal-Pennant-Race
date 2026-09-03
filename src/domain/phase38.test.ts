import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import {
  FINAL_STAGE_ADVANTAGE,
  FINAL_STAGE_WINS,
  FIRST_STAGE_BEST_OF,
  FIRST_STAGE_WINS,
  JAPAN_SERIES_WINS,
  MAX_EXTRA_GAMES,
  POSTSEASON_TEAMS,
  STAGE_LABELS,
  autoCompletePostseason,
  canPlayGame,
  currentSeries,
  ensurePostseason,
  homePattern,
  isParticipant,
  isPostseasonComplete,
  isSeriesComplete,
  maxGames,
  pickSeriesMvp,
  playNextPostseasonGame,
  postseasonParticipants,
  postseasonRng,
  seriesMvpScore,
  seriesOfStage,
  settleSeries,
  stageRngKind,
  winsRemaining,
} from './postseason';
import {
  japanChampionOf,
  japanChampionshipCount,
  japanSeriesAppearanceCount,
  leagueChampionshipCount,
  postseasonAppearanceCount,
  championshipCount,
} from './history';
import { standingsForLeague } from './standings';
import { emptySeasonStats } from './stats';
import { clearSave, loadGame, migrate, saveGame } from './save';
import type { GameState, PlayerSeasonStats, SeriesState } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 380380): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

/** レギュラーシーズンだけを終わらせる（ポストシーズンは未消化） */
function playRegularSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 380380, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
  for (let i = 0; i < count; i++) {
    s = playRegularSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

/** ポストシーズンだけを終わらせた状態 */
function afterPostseason(seed = 380380, length: 10 | 30 | 143 = 30): GameState {
  const s = cloneState(playRegularSeason(newGame(length, seed)));
  autoCompletePostseason(s);
  return s;
}

function series(state: GameState, stage: 'FIRST' | 'FINAL' | 'JAPAN_SERIES'): SeriesState[] {
  return seriesOfStage(state.postseason!, stage);
}

/** テスト用のシリーズ */
function makeSeries(overrides: Partial<SeriesState> = {}): SeriesState {
  return {
    id: 'test',
    stage: 'FIRST',
    leagueId: 'grand',
    bestOf: FIRST_STAGE_BEST_OF,
    winsRequired: FIRST_STAGE_WINS,
    teamAId: 'phoenix',
    teamBId: 'bluewave',
    advantageA: 0,
    teamAWins: 0,
    teamBWins: 0,
    games: [],
    winnerTeamId: null,
    loserTeamId: null,
    ...overrides,
  };
}

function statsWith(overrides: {
  hits?: number;
  homeRuns?: number;
  rbi?: number;
  wins?: number;
  strikeouts?: number;
  outs?: number;
  earnedRuns?: number;
}): PlayerSeasonStats {
  const stats = emptySeasonStats('x');
  stats.batting.hits = overrides.hits ?? 0;
  stats.batting.homeRuns = overrides.homeRuns ?? 0;
  stats.batting.rbi = overrides.rbi ?? 0;
  stats.pitching.wins = overrides.wins ?? 0;
  stats.pitching.strikeouts = overrides.strikeouts ?? 0;
  stats.pitching.outs = overrides.outs ?? 0;
  stats.pitching.earnedRuns = overrides.earnedRuns ?? 0;
  return stats;
}

/* ================= 進出球団 ================= */

describe('PHASE3.8 進出球団', () => {
  it('各リーグ上位3球団が進出する', () => {
    const s = playRegularSeason(newGame(10, 3801));
    for (const league of s.leagues) {
      const ids = postseasonParticipants(s, league.id);
      expect(ids).toHaveLength(POSTSEASON_TEAMS);
      const table = standingsForLeague(s, league.id);
      expect(ids).toEqual([table[0].teamId, table[1].teamId, table[2].teamId]);
    }
  });

  it('進出球団は順位順に並ぶ', () => {
    const s = playRegularSeason(newGame(10, 3802));
    for (const league of s.leagues) {
      const ids = postseasonParticipants(s, league.id);
      const table = standingsForLeague(s, league.id);
      const ranks = ids.map((id) => table.find((r) => r.teamId === id)!.rank);
      expect(ranks).toEqual([1, 2, 3]);
    }
  });

  it('4位以下は進出しない', () => {
    const s = afterPostseason(3803, 10);
    for (const league of s.leagues) {
      const table = standingsForLeague(s, league.id);
      for (const row of table.slice(POSTSEASON_TEAMS)) {
        expect(isParticipant(s, row.teamId)).toBe(false);
      }
    }
  });

  it('進出球団の判定ができる', () => {
    const s = afterPostseason(3804, 10);
    for (const league of s.leagues) {
      for (const id of s.postseason!.participants[league.id]) {
        expect(isParticipant(s, id)).toBe(true);
      }
    }
  });

  it('ポストシーズン前は進出判定がfalse', () => {
    const s = newGame(10, 3805);
    expect(isParticipant(s, PLAYER_TEAM)).toBe(false);
  });

  it('12球団のうち6球団が進出する', () => {
    const s = afterPostseason(3806, 10);
    const all = Object.values(s.postseason!.participants).flat();
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
  });
});

/* ================= ポストシーズンの生成 ================= */

describe('PHASE3.8 ポストシーズンの生成', () => {
  it('シーズン中はポストシーズンが無い', () => {
    let s = newGame(10, 3901);
    for (let i = 0; i < 3; i++) s = advanceDay(s).state;
    expect(s.seasonFinished).toBe(false);
    expect(s.postseason).toBeNull();
  });

  it('レギュラーシーズンが終わると自動で用意される', () => {
    const s = playRegularSeason(newGame(10, 3902));
    expect(s.seasonFinished).toBe(true);
    expect(s.postseason).not.toBeNull();
    expect(s.postseason!.year).toBe(s.year);
    expect(s.postseason!.phase).toBe('FIRST_STAGE');
  });

  it('二度用意しても作り直されない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 3903)));
    const before = s.postseason;
    ensurePostseason(s);
    expect(s.postseason).toBe(before);
  });

  it('シーズン中は用意されない', () => {
    let s = newGame(10, 3904);
    s = cloneState(advanceDay(s).state);
    expect(ensurePostseason(s)).toBeNull();
    expect(s.postseason).toBeNull();
  });

  it('ファーストステージが2つ（各リーグ1つ）作られる', () => {
    const s = playRegularSeason(newGame(10, 3905));
    const first = series(s, 'FIRST');
    expect(first).toHaveLength(2);
    expect(new Set(first.map((x) => x.leagueId)).size).toBe(2);
  });

  it('ファーストステージは2位対3位', () => {
    const s = playRegularSeason(newGame(10, 3906));
    for (const league of s.leagues) {
      const [, second, third] = s.postseason!.participants[league.id];
      const target = series(s, 'FIRST').find((x) => x.leagueId === league.id)!;
      expect(target.teamAId).toBe(second);
      expect(target.teamBId).toBe(third);
    }
  });

  it('最初はファイナルステージも日本シリーズも無い', () => {
    const s = playRegularSeason(newGame(10, 3907));
    expect(series(s, 'FINAL')).toHaveLength(0);
    expect(series(s, 'JAPAN_SERIES')).toHaveLength(0);
  });

  it('翌シーズンに入るとポストシーズンはクリアされる', () => {
    let s = playRegularSeason(newGame(10, 3908));
    s = cloneState(s);
    startNextSeason(s);
    expect(s.postseason).toBeNull();
  });
});

/* ================= シリーズの不変条件 ================= */

describe('PHASE3.8 シリーズの不変条件', () => {
  it('同じ球団が両側に来ない', () => {
    const s = afterPostseason(4001, 10);
    for (const x of s.postseason!.series) {
      expect(x.teamAId).not.toBe(x.teamBId);
    }
  });

  it('勝利数がマイナスにならない', () => {
    const s = afterPostseason(4002, 10);
    for (const x of s.postseason!.series) {
      expect(x.teamAWins).toBeGreaterThanOrEqual(0);
      expect(x.teamBWins).toBeGreaterThanOrEqual(0);
    }
  });

  it('必要勝利数を超える勝利がない', () => {
    const s = afterPostseason(4003, 10);
    for (const x of s.postseason!.series) {
      expect(x.teamAWins).toBeLessThanOrEqual(x.winsRequired);
      expect(x.teamBWins).toBeLessThanOrEqual(x.winsRequired);
    }
  });

  it('試合数が上限を超えない', () => {
    const s = afterPostseason(4004, 10);
    for (const x of s.postseason!.series) {
      expect(x.games.length).toBeLessThanOrEqual(maxGames(x));
    }
  });

  it('終了したシリーズでは試合ができない', () => {
    const done = makeSeries({ teamAWins: 2, winnerTeamId: 'phoenix', loserTeamId: 'bluewave' });
    expect(isSeriesComplete(done)).toBe(true);
    expect(canPlayGame(done)).toBe(false);
  });

  it('勝者が決まったらシリーズが終わる', () => {
    const x = makeSeries({ teamAWins: 2 });
    settleSeries(x);
    expect(x.winnerTeamId).toBe('phoenix');
    expect(x.loserTeamId).toBe('bluewave');
  });

  it('決着していないシリーズは確定しない', () => {
    const x = makeSeries({ teamAWins: 1, teamBWins: 1, games: [] });
    settleSeries(x);
    expect(x.winnerTeamId).toBeNull();
  });

  it('確定済みのシリーズを二度確定しても変わらない', () => {
    const x = makeSeries({ teamAWins: 2 });
    settleSeries(x);
    const winner = x.winnerTeamId;
    x.teamBWins = 5;
    settleSeries(x);
    expect(x.winnerTeamId).toBe(winner);
  });

  it('勝者と敗者が入れ替わらない', () => {
    const x = makeSeries({ teamBWins: 2 });
    settleSeries(x);
    expect(x.winnerTeamId).toBe('bluewave');
    expect(x.loserTeamId).toBe('phoenix');
  });

  it('あと何勝かを計算できる', () => {
    const x = makeSeries({ teamAWins: 1 });
    expect(winsRemaining(x, 'phoenix')).toBe(1);
    expect(winsRemaining(x, 'bluewave')).toBe(2);
  });

  it('勝ち抜け済みなら残り0勝', () => {
    const x = makeSeries({ teamAWins: 2 });
    expect(winsRemaining(x, 'phoenix')).toBe(0);
  });

  it('終わったシリーズには必ず勝者がいる', () => {
    const s = afterPostseason(4005, 10);
    for (const x of s.postseason!.series) {
      if (!isSeriesComplete(x)) continue;
      expect(x.winnerTeamId).not.toBeNull();
      expect(x.loserTeamId).not.toBeNull();
      expect([x.teamAId, x.teamBId]).toContain(x.winnerTeamId);
      expect(x.winnerTeamId).not.toBe(x.loserTeamId);
    }
  });
});

/* ================= ファーストステージ ================= */

describe('PHASE3.8 ファーストステージ', () => {
  it('3戦2勝制', () => {
    const s = playRegularSeason(newGame(10, 4101));
    for (const x of series(s, 'FIRST')) {
      expect(x.bestOf).toBe(FIRST_STAGE_BEST_OF);
      expect(x.winsRequired).toBe(FIRST_STAGE_WINS);
    }
  });

  it('アドバンテージはない', () => {
    const s = playRegularSeason(newGame(10, 4102));
    for (const x of series(s, 'FIRST')) {
      expect(x.advantageA).toBe(0);
      expect(x.teamAWins).toBe(0);
    }
  });

  it('2勝0敗で終わる場合は2試合', () => {
    const x = makeSeries();
    x.teamAWins = 2;
    x.games = [
      { gameNumber: 1, date: '', homeTeamId: 'phoenix', awayTeamId: 'bluewave', homeRuns: 3, awayRuns: 1, winnerTeamId: 'phoenix' },
      { gameNumber: 2, date: '', homeTeamId: 'phoenix', awayTeamId: 'bluewave', homeRuns: 4, awayRuns: 2, winnerTeamId: 'phoenix' },
    ];
    settleSeries(x);
    expect(x.winnerTeamId).toBe('phoenix');
    expect(x.games).toHaveLength(2);
  });

  it('2勝1敗でも決着する', () => {
    const x = makeSeries({ teamAWins: 2, teamBWins: 1 });
    settleSeries(x);
    expect(x.winnerTeamId).toBe('phoenix');
  });

  it('最大3試合（引き分けが無ければ）', () => {
    const s = afterPostseason(4103, 10);
    for (const x of series(s, 'FIRST')) {
      const draws = x.games.filter((g) => g.winnerTeamId === null).length;
      expect(x.games.length).toBeLessThanOrEqual(FIRST_STAGE_BEST_OF + draws);
    }
  });

  it('ホーム開催は上位が2試合・下位が1試合', () => {
    expect(homePattern(FIRST_STAGE_BEST_OF)).toEqual(['A', 'A', 'B']);
  });

  it('勝者がファイナルステージに進む', () => {
    const s = afterPostseason(4104, 10);
    for (const league of s.leagues) {
      const first = series(s, 'FIRST').find((x) => x.leagueId === league.id)!;
      const final = series(s, 'FINAL').find((x) => x.leagueId === league.id)!;
      expect(final.teamBId).toBe(first.winnerTeamId);
    }
  });

  it('敗者はポストシーズンから外れる', () => {
    const s = afterPostseason(4105, 10);
    for (const first of series(s, 'FIRST')) {
      const loser = first.loserTeamId!;
      const later = s.postseason!.series.filter(
        (x) => x.stage !== 'FIRST' && (x.teamAId === loser || x.teamBId === loser),
      );
      expect(later).toHaveLength(0);
    }
  });
});

/* ================= ファイナルステージ ================= */

describe('PHASE3.8 ファイナルステージ', () => {
  it('リーグ1位が参加する', () => {
    const s = afterPostseason(4201, 10);
    for (const league of s.leagues) {
      const top = s.postseason!.participants[league.id][0];
      const final = series(s, 'FINAL').find((x) => x.leagueId === league.id)!;
      expect(final.teamAId).toBe(top);
    }
  });

  it('リーグ1位に1勝のアドバンテージがある', () => {
    const s = afterPostseason(4202, 10);
    for (const x of series(s, 'FINAL')) {
      expect(x.advantageA).toBe(FINAL_STAGE_ADVANTAGE);
    }
  });

  it('4勝先取', () => {
    const s = afterPostseason(4203, 10);
    for (const x of series(s, 'FINAL')) {
      expect(x.winsRequired).toBe(FINAL_STAGE_WINS);
    }
  });

  it('アドバンテージのぶん最大6試合', () => {
    const s = afterPostseason(4204, 10);
    for (const x of series(s, 'FINAL')) {
      expect(x.bestOf).toBe(6);
    }
  });

  it('アドバンテージを含めて4勝でリーグ優勝', () => {
    const x = makeSeries({
      stage: 'FINAL',
      bestOf: 6,
      winsRequired: FINAL_STAGE_WINS,
      advantageA: 1,
      teamAWins: 4,
    });
    settleSeries(x);
    expect(x.winnerTeamId).toBe('phoenix');
  });

  it('挑戦側は4勝が必要', () => {
    const x = makeSeries({
      stage: 'FINAL',
      bestOf: 6,
      winsRequired: FINAL_STAGE_WINS,
      advantageA: 1,
      teamAWins: 1,
      teamBWins: 3,
    });
    settleSeries(x);
    expect(x.winnerTeamId).toBeNull();
    x.teamBWins = 4;
    settleSeries(x);
    expect(x.winnerTeamId).toBe('bluewave');
  });

  it('アドバンテージ1勝ぶんが最初から入っている', () => {
    const s = playRegularSeason(newGame(10, 4205));
    const next = cloneState(s);
    // ファーストステージを終わらせてファイナルステージを作る
    for (let i = 0; i < 12 && series(next, 'FINAL').length === 0; i++) {
      playNextPostseasonGame(next);
    }
    for (const x of series(next, 'FINAL')) {
      expect(x.teamAWins).toBeGreaterThanOrEqual(FINAL_STAGE_ADVANTAGE);
    }
  });

  it('ホーム開催が片側に寄らない', () => {
    const pattern = homePattern(6);
    expect(pattern.filter((x) => x === 'A').length).toBe(4);
    expect(pattern.filter((x) => x === 'B').length).toBe(2);
  });

  it('勝者がリーグ優勝になる', () => {
    const s = afterPostseason(4206, 10);
    for (const league of s.leagues) {
      const final = series(s, 'FINAL').find((x) => x.leagueId === league.id)!;
      expect(s.postseason!.leagueChampions[league.id]).toBe(final.winnerTeamId);
    }
  });

  it('リーグ優勝は各リーグ1球団だけ', () => {
    const s = afterPostseason(4207, 10);
    expect(Object.keys(s.postseason!.leagueChampions)).toHaveLength(2);
  });
});

/* ================= 日本シリーズ ================= */

describe('PHASE3.8 日本シリーズ', () => {
  it('両リーグ優勝球団が対戦する', () => {
    const s = afterPostseason(4301, 10);
    const japan = series(s, 'JAPAN_SERIES');
    expect(japan).toHaveLength(1);
    const champions = Object.values(s.postseason!.leagueChampions);
    expect(champions).toContain(japan[0].teamAId);
    expect(champions).toContain(japan[0].teamBId);
  });

  it('4勝先取・最大7試合', () => {
    const s = afterPostseason(4302, 10);
    const japan = series(s, 'JAPAN_SERIES')[0];
    expect(japan.winsRequired).toBe(JAPAN_SERIES_WINS);
    expect(japan.bestOf).toBe(7);
  });

  it('アドバンテージはない', () => {
    const s = afterPostseason(4303, 10);
    expect(series(s, 'JAPAN_SERIES')[0].advantageA).toBe(0);
  });

  it('ホーム開催は2-3-2で偏らない', () => {
    const pattern = homePattern(7);
    expect(pattern).toEqual(['A', 'A', 'B', 'B', 'B', 'A', 'A']);
    expect(pattern.filter((x) => x === 'A').length).toBe(4);
    expect(pattern.filter((x) => x === 'B').length).toBe(3);
  });

  it('リーグが違う球団同士が対戦する', () => {
    const s = afterPostseason(4304, 10);
    const japan = series(s, 'JAPAN_SERIES')[0];
    const leagueOf = (id: string) => s.teams.find((t) => t.id === id)!.leagueId;
    expect(leagueOf(japan.teamAId)).not.toBe(leagueOf(japan.teamBId));
  });

  it('4勝0敗で決着する', () => {
    const x = makeSeries({
      stage: 'JAPAN_SERIES',
      leagueId: null,
      bestOf: 7,
      winsRequired: 4,
      teamAWins: 4,
    });
    settleSeries(x);
    expect(x.winnerTeamId).toBe('phoenix');
  });

  it('4勝3敗でも決着する', () => {
    const x = makeSeries({
      stage: 'JAPAN_SERIES',
      leagueId: null,
      bestOf: 7,
      winsRequired: 4,
      teamAWins: 3,
      teamBWins: 3,
    });
    settleSeries(x);
    expect(x.winnerTeamId).toBeNull();
    x.teamBWins = 4;
    settleSeries(x);
    expect(x.winnerTeamId).toBe('bluewave');
  });

  it('勝者が日本一になる', () => {
    const s = afterPostseason(4305, 10);
    const japan = series(s, 'JAPAN_SERIES')[0];
    expect(s.postseason!.championTeamId).toBe(japan.winnerTeamId);
  });

  it('引き分けが出ても最後は決着する', () => {
    for (const seed of [4306, 4307, 4308]) {
      const s = afterPostseason(seed, 10);
      expect(s.postseason!.championTeamId).not.toBeNull();
      for (const x of s.postseason!.series) {
        expect(x.winnerTeamId).not.toBeNull();
      }
    }
  });

  it('引き分けのぶんだけ試合を足せる', () => {
    const x = makeSeries({ stage: 'JAPAN_SERIES', leagueId: null, bestOf: 7, winsRequired: 4 });
    expect(maxGames(x)).toBe(7 + MAX_EXTRA_GAMES);
  });
});

/* ================= 日本一 ================= */

describe('PHASE3.8 日本一の決定', () => {
  it('ポストシーズンを進めると必ず完了する', () => {
    for (const seed of [4401, 4402, 4403, 4404]) {
      const s = afterPostseason(seed, 10);
      expect(isPostseasonComplete(s)).toBe(true);
      expect(s.postseason!.phase).toBe('COMPLETE');
      expect(s.postseason!.championTeamId).not.toBeNull();
    }
  });

  it('日本一は1球団だけ', () => {
    const s = afterPostseason(4405, 10);
    const champion = s.postseason!.championTeamId;
    expect(typeof champion).toBe('string');
    expect(s.teams.some((t) => t.id === champion)).toBe(true);
  });

  it('日本一はリーグ優勝球団のどちらか', () => {
    const s = afterPostseason(4406, 10);
    const champions = Object.values(s.postseason!.leagueChampions);
    expect(champions).toContain(s.postseason!.championTeamId);
  });

  it('日本一は進出球団の中から出る', () => {
    const s = afterPostseason(4407, 10);
    expect(isParticipant(s, s.postseason!.championTeamId!)).toBe(true);
  });

  it('段階が順番に進む', () => {
    let s = cloneState(playRegularSeason(newGame(10, 4408)));
    const phases: string[] = [s.postseason!.phase];
    for (let i = 0; i < 40 && !isPostseasonComplete(s); i++) {
      playNextPostseasonGame(s);
      const phase = s.postseason!.phase;
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    }
    expect(phases).toEqual(['FIRST_STAGE', 'FINAL_STAGE', 'JAPAN_SERIES', 'COMPLETE']);
  });

  it('完了後は進める試合がない', () => {
    const s = afterPostseason(4409, 10);
    expect(currentSeries(s)).toBeNull();
    expect(playNextPostseasonGame(s)).toBeNull();
  });

  it('完了後に進めても結果が変わらない', () => {
    const s = afterPostseason(4410, 10);
    const before = structuredClone(s.postseason);
    autoCompletePostseason(s);
    playNextPostseasonGame(s);
    expect(s.postseason).toEqual(before);
  });
});

/* ================= レギュラーシーズンへの影響 ================= */

describe('PHASE3.8 レギュラーシーズンを汚さない', () => {
  it('ポストシーズンで順位表が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4501)));
    const before = s.leagues.map((l) => standingsForLeague(s, l.id));
    autoCompletePostseason(s);
    const after = s.leagues.map((l) => standingsForLeague(s, l.id));
    expect(after).toEqual(before);
  });

  it('ポストシーズンで勝敗記録が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4502)));
    const before = structuredClone(s.records);
    autoCompletePostseason(s);
    expect(s.records).toEqual(before);
  });

  it('ポストシーズンでレギュラーシーズンの個人成績が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4503)));
    const before = structuredClone(s.stats);
    autoCompletePostseason(s);
    expect(s.stats).toEqual(before);
  });

  it('ポストシーズンで球団別成績が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4504)));
    const before = structuredClone(s.teamStats);
    autoCompletePostseason(s);
    expect(s.teamStats).toEqual(before);
  });

  it('ポストシーズンの成績は別に積まれる', () => {
    const s = afterPostseason(4505, 10);
    const stats = s.postseason!.stats;
    expect(Object.keys(stats).length).toBeGreaterThan(0);
    const totalGames = Object.values(stats).reduce(
      (sum, x) => sum + x.batting.games + x.pitching.games,
      0,
    );
    expect(totalGames).toBeGreaterThan(0);
  });

  it('ポストシーズン成績は進出球団の選手だけ', () => {
    const s = afterPostseason(4506, 10);
    for (const playerId of Object.keys(s.postseason!.stats)) {
      const player = s.players.find((p) => p.id === playerId)!;
      expect(isParticipant(s, player.teamId)).toBe(true);
    }
  });

  it('日本シリーズの成績が別に積まれる', () => {
    const s = afterPostseason(4507, 10);
    const japan = s.postseason!.japanSeriesStats;
    expect(Object.keys(japan).length).toBeGreaterThan(0);
    for (const [playerId, line] of Object.entries(japan)) {
      const total = s.postseason!.stats[playerId];
      expect(total.batting.games).toBeGreaterThanOrEqual(line.batting.games);
      expect(total.pitching.games).toBeGreaterThanOrEqual(line.pitching.games);
    }
  });

  it('レギュラーシーズンの試合数が変わっていない', () => {
    const s = playRegularSeason(newGame(143, 4508));
    for (const team of s.teams) {
      expect(s.records[team.id].games).toBe(143);
    }
  });

  it('レギュラーシーズンの日程はポストシーズンで増えない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4509)));
    const before = s.schedule.length;
    autoCompletePostseason(s);
    expect(s.schedule.length).toBe(before);
  });
});

/* ================= ポストシーズン中の禁止事項 ================= */

describe('PHASE3.8 ポストシーズン中に起きないこと', () => {
  it('引退が起きない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4601)));
    const before = s.players.length;
    const retiredBefore = s.retiredPlayers.length;
    autoCompletePostseason(s);
    expect(s.players.length).toBe(before);
    expect(s.retiredPlayers.length).toBe(retiredBefore);
  });

  it('契約年数が減らない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4602)));
    const before = new Map(
      s.players.map((p) => [p.id, p.ext.contract?.yearsRemaining ?? -1]),
    );
    autoCompletePostseason(s);
    for (const player of s.players) {
      expect(player.ext.contract?.yearsRemaining ?? -1).toBe(before.get(player.id));
    }
  });

  it('FA市場が始まらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4603)));
    const before = s.freeAgents.length;
    autoCompletePostseason(s);
    expect(s.fa).toBeNull();
    expect(s.freeAgents.length).toBe(before);
  });

  it('トレードが起きない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4604)));
    const before = s.trade.history.length;
    autoCompletePostseason(s);
    expect(s.trade.history.length).toBe(before);
  });

  it('ドラフトが始まらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4605)));
    autoCompletePostseason(s);
    expect(s.draft).toBeNull();
  });

  it('選手が球団を移らない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4606)));
    const before = new Map(s.players.map((p) => [p.id, p.teamId]));
    autoCompletePostseason(s);
    for (const player of s.players) {
      expect(player.teamId).toBe(before.get(player.id));
    }
  });

  it('引退した選手がポストシーズンに出場しない', () => {
    const s = afterPostseason(4607, 10);
    const retired = new Set(s.retiredPlayers.map((r) => r.playerId));
    for (const playerId of Object.keys(s.postseason!.stats)) {
      expect(retired.has(playerId)).toBe(false);
    }
  });

  it('未所属（FA）選手がポストシーズンに出場しない', () => {
    const s = afterPostseason(4608, 10);
    const freeAgents = new Set(s.freeAgents.map((p) => p.id));
    for (const playerId of Object.keys(s.postseason!.stats)) {
      expect(freeAgents.has(playerId)).toBe(false);
    }
  });

  it('出場したのは在籍している選手だけ', () => {
    const s = afterPostseason(4609, 10);
    const ids = new Set(s.players.map((p) => p.id));
    for (const playerId of Object.keys(s.postseason!.stats)) {
      expect(ids.has(playerId)).toBe(true);
    }
  });

  it('年齢が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4610)));
    const before = new Map(s.players.map((p) => [p.id, p.age]));
    autoCompletePostseason(s);
    for (const player of s.players) {
      expect(player.age).toBe(before.get(player.id));
    }
  });

  it('能力値が成長・衰退しない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4611)));
    const before = new Map(
      s.players.map((p) => [p.id, p.batting.contact + p.batting.power]),
    );
    autoCompletePostseason(s);
    for (const player of s.players) {
      expect(player.batting.contact + player.batting.power).toBe(before.get(player.id));
    }
  });
});

/* ================= MVP ================= */

describe('PHASE3.8 MVP', () => {
  it('活躍した選手ほど点が高い', () => {
    const weak = statsWith({ hits: 2 });
    const strong = statsWith({ hits: 12, homeRuns: 4, rbi: 10 });
    expect(seriesMvpScore(strong)).toBeGreaterThan(seriesMvpScore(weak));
  });

  it('投手も点が付く', () => {
    const pitcher = statsWith({ wins: 3, strikeouts: 20, outs: 60, earnedRuns: 3 });
    expect(seriesMvpScore(pitcher)).toBeGreaterThan(0);
  });

  it('失点が多いと点が下がる', () => {
    const good = statsWith({ wins: 2, outs: 60, earnedRuns: 2 });
    const bad = statsWith({ wins: 2, outs: 60, earnedRuns: 20 });
    expect(seriesMvpScore(good)).toBeGreaterThan(seriesMvpScore(bad));
  });

  it('成績が無い選手は選ばれない', () => {
    const s = afterPostseason(4701, 10);
    expect(pickSeriesMvp(s, {}, PLAYER_TEAM)).toBeNull();
  });

  it('MVPは指定した球団の選手', () => {
    const s = afterPostseason(4702, 10);
    const champion = s.postseason!.championTeamId!;
    const mvp = s.postseason!.japanSeriesMvpPlayerId;
    expect(mvp).not.toBeNull();
    const player = s.players.find((p) => p.id === mvp)!;
    expect(player.teamId).toBe(champion);
  });

  it('日本シリーズMVPが決まる', () => {
    for (const seed of [4703, 4704, 4705]) {
      const s = afterPostseason(seed, 10);
      expect(s.postseason!.japanSeriesMvpPlayerId).not.toBeNull();
    }
  });

  it('クライマックスシリーズMVPが各リーグで決まる', () => {
    const s = afterPostseason(4706, 10);
    for (const league of s.leagues) {
      const mvp = s.postseason!.csMvp[league.id];
      expect(mvp).toBeTruthy();
      const player = s.players.find((p) => p.id === mvp)!;
      expect(player.teamId).toBe(s.postseason!.leagueChampions[league.id]);
    }
  });

  it('MVPの選考は実行するたびに変わらない', () => {
    const s = afterPostseason(4707, 10);
    const first = pickSeriesMvp(s, s.postseason!.japanSeriesStats, s.postseason!.championTeamId!);
    const second = pickSeriesMvp(s, s.postseason!.japanSeriesStats, s.postseason!.championTeamId!);
    expect(first).toBe(second);
  });
});

/* ================= 乱数 ================= */

describe('PHASE3.8 乱数', () => {
  it('段階ごとに専用の系列を使う', () => {
    expect(stageRngKind('FIRST')).toBe('postseasonFirstStage');
    expect(stageRngKind('FINAL')).toBe('postseasonFinalStage');
    expect(stageRngKind('JAPAN_SERIES')).toBe('japanSeries');
  });

  it('同じ条件なら同じ乱数になる', () => {
    const s = newGame(10, 4801);
    const a = postseasonRng(s, 'japanSeries', 'x', 1).next();
    const b = postseasonRng(s, 'japanSeries', 'x', 1).next();
    expect(a).toBe(b);
  });

  it('段階が違えば別の乱数になる', () => {
    const s = newGame(10, 4802);
    const a = postseasonRng(s, 'postseasonFirstStage', 'x', 1).next();
    const b = postseasonRng(s, 'postseasonFinalStage', 'x', 1).next();
    expect(a).not.toBe(b);
  });

  it('ポストシーズンで共有の乱数状態が変わらない', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4803)));
    const before = s.rngState;
    autoCompletePostseason(s);
    expect(s.rngState).toBe(before);
  });

  it('同じシードなら同じポストシーズンになる', () => {
    const a = afterPostseason(4804, 10);
    const b = afterPostseason(4804, 10);
    expect(a.postseason!.championTeamId).toBe(b.postseason!.championTeamId);
    expect(a.postseason!.series.map((x) => x.winnerTeamId)).toEqual(
      b.postseason!.series.map((x) => x.winnerTeamId),
    );
  });

  it('同じシードならレギュラーシーズンの結果も同じ', () => {
    const a = playRegularSeason(newGame(30, 4805));
    const b = playRegularSeason(newGame(30, 4805));
    expect(a.records).toEqual(b.records);
  });
});

/* ================= 途中セーブ・再開 ================= */

describe('PHASE3.8 途中セーブと再開', () => {
  beforeEach(() => {
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
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
      new MemoryStorage();
    clearSave();
  });

  it('ポストシーズンが保存・復元される', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4901)));
    playNextPostseasonGame(s);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.postseason).toEqual(s.postseason);
  });

  it('ファーストステージ途中から再開できる', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4902)));
    playNextPostseasonGame(s);
    expect(s.postseason!.phase).toBe('FIRST_STAGE');
    saveGame(s);
    const loaded = loadGame()!;
    autoCompletePostseason(loaded);
    expect(loaded.postseason!.championTeamId).not.toBeNull();
  });

  it('ファイナルステージ途中から再開できる', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4903)));
    for (let i = 0; i < 40 && s.postseason!.phase !== 'FINAL_STAGE'; i++) {
      playNextPostseasonGame(s);
    }
    playNextPostseasonGame(s);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.postseason!.phase).toBe('FINAL_STAGE');
    autoCompletePostseason(loaded);
    expect(loaded.postseason!.championTeamId).not.toBeNull();
  });

  it('日本シリーズ第3戦のあとから第4戦を始められる', () => {
    const s = cloneState(playRegularSeason(newGame(10, 4904)));
    for (let i = 0; i < 40 && s.postseason!.phase !== 'JAPAN_SERIES'; i++) {
      playNextPostseasonGame(s);
    }
    for (let i = 0; i < 3; i++) playNextPostseasonGame(s);
    const japan = series(s, 'JAPAN_SERIES')[0];
    const played = japan.games.length;
    expect(played).toBeGreaterThanOrEqual(1);
    saveGame(s);

    const loaded = loadGame()!;
    const before = series(loaded, 'JAPAN_SERIES')[0].games.length;
    expect(before).toBe(played);
    if (!isPostseasonComplete(loaded)) {
      playNextPostseasonGame(loaded);
      expect(series(loaded, 'JAPAN_SERIES')[0].games.length).toBe(before + 1);
    }
  });

  it('再開しても同じ結果になる', () => {
    const base = cloneState(playRegularSeason(newGame(10, 4905)));
    const straight = cloneState(base);
    autoCompletePostseason(straight);

    const viaSave = cloneState(base);
    playNextPostseasonGame(viaSave);
    saveGame(viaSave);
    const loaded = loadGame()!;
    autoCompletePostseason(loaded);

    expect(loaded.postseason!.championTeamId).toBe(straight.postseason!.championTeamId);
    expect(loaded.postseason!.series.map((x) => `${x.teamAWins}-${x.teamBWins}`)).toEqual(
      straight.postseason!.series.map((x) => `${x.teamAWins}-${x.teamBWins}`),
    );
  });

  it('ポストシーズン完了後に保存・復元できる', () => {
    const s = afterPostseason(4906, 10);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.postseason!.phase).toBe('COMPLETE');
    expect(loaded.postseason!.championTeamId).toBe(s.postseason!.championTeamId);
  });
});

/* ================= セーブ・マイグレーション ================= */

describe('PHASE3.8 セーブ', () => {
  beforeEach(() => {
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
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
      new MemoryStorage();
    clearSave();
  });

  it('セーブバージョンが12になっている', () => {
    expect(SAVE_VERSION).toBe(12);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('v11のセーブを読み込める（ポストシーズンなしから始まる）', () => {
    const s = newGame(10, 5001);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 11;
    delete old.postseason;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.postseason).toBeNull();
  });

  it('v11の過去履歴は作り直さない', () => {
    const s = afterSeasons(2, 5002);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 11;
    delete old.postseason;
    const migrated = migrate(old as unknown as GameState)!;
    expect(migrated.history.seasons.map((x) => x.year)).toEqual(
      s.history.seasons.map((x) => x.year),
    );
  });

  it('v1のセーブも最新バージョンまで移行できる', () => {
    const s = newGame(10, 5003);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 1;
    delete old.postseason;
    delete old.history;
    delete old.teamStats;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.postseason).toBeNull();
  });

  it('別の年のポストシーズンが残っていたら捨てる', () => {
    const s = afterPostseason(5004, 10);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 11;
    (old.postseason as { year: number }).year = 1900;
    const migrated = migrate(old as unknown as GameState)!;
    expect(migrated.postseason).toBeNull();
  });
});

/* ================= 歴史との統合 ================= */

describe('PHASE3.8 歴史との統合', () => {
  it('日本一が歴史に残る', () => {
    const s = afterSeasons(1, 5101);
    const season = s.history.seasons[0];
    expect(season.postseason).toBeDefined();
    expect(season.postseason!.japanSeriesChampionTeamId).not.toBeNull();
  });

  it('リーグ優勝が歴史に残る', () => {
    const s = afterSeasons(1, 5102);
    for (const league of s.history.seasons[0].leagues) {
      expect(league.leagueChampionTeamId).toBeTruthy();
    }
  });

  it('レギュラーシーズン1位とリーグ優勝を区別する', () => {
    const s = afterSeasons(6, 5103);
    let differed = 0;
    for (const season of s.history.seasons) {
      for (const league of season.leagues) {
        if (league.leagueChampionTeamId !== league.championTeamId) differed += 1;
      }
    }
    // 6シーズンあれば、1位以外がリーグ優勝する年が出る
    expect(differed).toBeGreaterThan(0);
  });

  it('日本シリーズMVPが歴史に残る', () => {
    const s = afterSeasons(2, 5104);
    for (const season of s.history.seasons) {
      expect(season.postseason!.japanSeriesMvpPlayerId).not.toBeNull();
    }
  });

  it('MVPの表彰が選手の歴史に残る', () => {
    const s = afterSeasons(2, 5105);
    const mvpId = s.history.seasons[0].postseason!.japanSeriesMvpPlayerId!;
    const history = s.history.players[mvpId];
    expect(history.awards.some((a) => a.kind === 'JAPAN_SERIES_MVP')).toBe(true);
  });

  it('CS MVPの表彰が選手の歴史に残る', () => {
    const s = afterSeasons(2, 5106);
    for (const league of s.history.seasons[0].leagues) {
      const mvpId = league.csMvpPlayerId;
      if (!mvpId) continue;
      expect(s.history.players[mvpId].awards.some((a) => a.kind === 'CS_MVP')).toBe(true);
    }
  });

  it('シリーズの結果が歴史に残る', () => {
    const s = afterSeasons(1, 5107);
    const ps = s.history.seasons[0].postseason!;
    expect(ps.series.length).toBe(5);
    for (const x of ps.series) {
      expect(x.winnerTeamId).not.toBeNull();
      expect(x.games).toBeGreaterThan(0);
    }
  });

  it('進出球団が歴史に残る', () => {
    const s = afterSeasons(1, 5108);
    const ps = s.history.seasons[0].postseason!;
    expect(Object.values(ps.participants).flat()).toHaveLength(6);
  });

  it('球団の年度成績にリーグ優勝・日本一の印が付く', () => {
    const s = afterSeasons(1, 5109);
    const season = s.history.seasons[0];
    expect(season.teams.filter((t) => t.japanChampion)).toHaveLength(1);
    expect(season.teams.filter((t) => t.leagueChampion)).toHaveLength(2);
    expect(season.teams.filter((t) => t.postseason)).toHaveLength(6);
  });

  it('日本一は毎年1球団だけ', () => {
    const s = afterSeasons(8, 5110);
    for (const season of s.history.seasons) {
      expect(season.teams.filter((t) => t.japanChampion)).toHaveLength(1);
    }
  });

  it('球団の優勝回数を数えられる', () => {
    const s = afterSeasons(8, 5111);
    let league = 0;
    let japan = 0;
    let cs = 0;
    let js = 0;
    for (const team of s.teams) {
      league += leagueChampionshipCount(s.history, team.id);
      japan += japanChampionshipCount(s.history, team.id);
      cs += postseasonAppearanceCount(s.history, team.id);
      js += japanSeriesAppearanceCount(s.history, team.id);
    }
    expect(league).toBe(8 * 2);
    expect(japan).toBe(8);
    expect(cs).toBe(8 * 6);
    expect(js).toBe(8 * 2);
  });

  it('レギュラーシーズン1位の回数は従来どおり数えられる', () => {
    const s = afterSeasons(6, 5112);
    let total = 0;
    for (const team of s.teams) total += championshipCount(s.history, team.id);
    expect(total).toBe(6 * 2);
  });

  it('年から日本一を引ける', () => {
    const s = afterSeasons(3, 5113);
    for (const season of s.history.seasons) {
      expect(japanChampionOf(s.history, season.year)).toBe(
        season.postseason!.japanSeriesChampionTeamId,
      );
    }
    expect(japanChampionOf(s.history, 1900)).toBeNull();
  });

  it('選手の歴史に優勝回数が残る', () => {
    const s = afterSeasons(6, 5114);
    const withTitles = Object.values(s.history.players).filter(
      (p) => (p.japanChampionships ?? 0) > 0,
    );
    expect(withTitles.length).toBeGreaterThan(0);
    for (const player of Object.values(s.history.players)) {
      expect(player.japanChampionships ?? 0).toBeLessThanOrEqual(
        player.leagueChampionships ?? 0,
      );
      expect(player.leagueChampionships ?? 0).toBeLessThanOrEqual(
        player.postseasonAppearances ?? 0,
      );
    }
  });

  it('選手のポストシーズン通算成績が残る', () => {
    const s = afterSeasons(4, 5115);
    const withStats = Object.values(s.history.players).filter((p) => p.postseasonCareer);
    expect(withStats.length).toBeGreaterThan(0);
    for (const player of withStats) {
      expect(player.postseasonCareer!.batting.games).toBeGreaterThanOrEqual(0);
    }
  });

  it('ポストシーズン成績とレギュラーシーズン成績を混ぜない', () => {
    const s = afterSeasons(3, 5116);
    for (const player of Object.values(s.history.players)) {
      if (!player.postseasonCareer) continue;
      // 年度別成績（レギュラーシーズン）にはポストシーズンぶんが入らない
      let regular = 0;
      for (const entry of player.seasons) regular += entry.b?.[0] ?? 0;
      expect(player.career.batting.games).toBe(regular);
    }
  });

  it('同じ年を二度確定してもポストシーズンの記録が二重にならない', () => {
    let s = playRegularSeason(newGame(10, 5117));
    s = cloneState(s);
    startOffseason(s);
    const seasons = s.history.seasons.length;
    const champion = s.history.seasons[0].postseason!.japanSeriesChampionTeamId;
    startOffseason(s);
    expect(s.history.seasons.length).toBe(seasons);
    expect(s.history.seasons[0].postseason!.japanSeriesChampionTeamId).toBe(champion);
  });

  it('優勝回数が二重に加算されない', () => {
    let s = playRegularSeason(newGame(10, 5118));
    s = cloneState(s);
    startOffseason(s);
    const counts = new Map(
      Object.values(s.history.players).map((p) => [p.playerId, p.japanChampionships ?? 0]),
    );
    startOffseason(s);
    for (const [id, count] of counts) {
      expect(s.history.players[id].japanChampionships ?? 0).toBe(count);
    }
  });
});

/* ================= シーズンの流れ ================= */

describe('PHASE3.8 シーズンの流れ', () => {
  it('オフシーズンに入る前にポストシーズンが終わる', () => {
    let s = playRegularSeason(newGame(10, 5201));
    expect(s.postseason!.phase).toBe('FIRST_STAGE');
    s = cloneState(s);
    startOffseason(s);
    // 歴史には日本一が残り、ポストシーズンは完了している
    expect(s.postseason!.phase).toBe('COMPLETE');
    expect(s.history.seasons[0].postseason!.japanSeriesChampionTeamId).not.toBeNull();
  });

  it('ポストシーズンを手で進めてからオフシーズンに入れる', () => {
    const s = afterPostseason(5202, 10);
    const champion = s.postseason!.championTeamId;
    const next = cloneState(s);
    startOffseason(next);
    expect(next.history.seasons[0].postseason!.japanSeriesChampionTeamId).toBe(champion);
  });

  it('引退はオフシーズンで起きる', () => {
    let s = playRegularSeason(newGame(10, 5203));
    s = cloneState(s);
    const before = s.players.length;
    startOffseason(s);
    expect(s.players.length).toBeLessThanOrEqual(before);
  });

  it('翌シーズンが正常に開幕する', () => {
    let s = playRegularSeason(newGame(10, 5204));
    const year = s.year;
    s = cloneState(s);
    startNextSeason(s);
    expect(s.year).toBe(year + 1);
    expect(s.seasonFinished).toBe(false);
    expect(s.postseason).toBeNull();
    expect(validateState(s)).toEqual([]);
  });

  it('10シーズン続けても止まらない', () => {
    const s = afterSeasons(10, 5205, 10);
    expect(s.history.seasons).toHaveLength(10);
    for (const season of s.history.seasons) {
      expect(season.postseason!.japanSeriesChampionTeamId).not.toBeNull();
    }
    expect(validateState(s)).toEqual([]);
  });

  it('プレイヤー球団が4位以下でもシーズンを終えられる', () => {
    let found = false;
    for (const seed of [5206, 5207, 5208, 5209, 5210]) {
      const s = afterPostseason(seed, 10);
      if (!isParticipant(s, PLAYER_TEAM)) {
        found = true;
        const next = cloneState(s);
        startNextSeason(next);
        expect(next.year).toBe(s.year + 1);
        expect(validateState(next)).toEqual([]);
      }
    }
    expect(found).toBe(true);
  });

  it('ポストシーズンの日付がシーズン終了後に進む', () => {
    const s = cloneState(playRegularSeason(newGame(10, 5211)));
    const before = s.date;
    autoCompletePostseason(s);
    expect(s.date > before).toBe(true);
  });

  it('段階の表示名がすべて用意されている', () => {
    for (const stage of ['FIRST', 'FINAL', 'JAPAN_SERIES'] as const) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});

/* ================= 既存システムが壊れていない ================= */

describe('PHASE3.8 既存システムが壊れていない', () => {
  it('順位表が従来どおり動く', () => {
    const s = afterSeasons(3, 5301);
    for (const league of s.leagues) {
      const table = standingsForLeague(s, league.id);
      expect(table).toHaveLength(6);
      expect(table[0].rank).toBe(1);
    }
  });

  it('経営プランが引き続き作られる', () => {
    const s = afterSeasons(2, 5302);
    expect(Object.keys(s.teamPlans).length).toBe(12);
  });

  it('ドラフト・FA・契約が引き続き動く', () => {
    const s = afterSeasons(3, 5303);
    expect(s.players.length).toBeGreaterThan(280);
    for (const team of s.teams) {
      const roster = s.players.filter((p) => p.teamId === team.id);
      expect(roster.length).toBeGreaterThanOrEqual(24);
    }
  });

  it('トレードが引き続き動く', () => {
    const s = afterSeasons(4, 5304);
    expect(s.trade.history.length).toBeGreaterThan(0);
  });

  it('殿堂入りが引き続き動く', () => {
    const s = afterSeasons(14, 5305, 10);
    expect(Object.keys(s.history.players).length).toBeGreaterThan(s.players.length);
  });

  it('歴史の整合性が保たれる', () => {
    const s = afterSeasons(8, 5306, 10);
    const years = s.history.seasons.map((x) => x.year);
    expect(new Set(years).size).toBe(years.length);
    for (const player of Object.values(s.history.players)) {
      const seen = new Set<string>();
      for (const entry of player.seasons) {
        const key = `${entry.year}:${entry.teamId}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});
