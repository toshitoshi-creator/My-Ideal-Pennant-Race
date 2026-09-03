import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import {
  AWARD_LABELS,
  CAREER_RECORD_LABELS,
  LEADER_KEYS,
  LEADER_LABELS,
  battingScore,
  careerTeamSpans,
  championshipCount,
  collectLeaguePlayers,
  createHistoryState,
  emptyCareer,
  ensureHistory,
  finalizeSeason,
  hasSeason,
  higherIsBetter,
  onBasePercentage,
  pickAwards,
  pickLeaders,
  pitchingScore,
  playerHistoryOf,
  qualifiedAtBats,
  qualifiedOuts,
  retiredHistories,
  activeHistories,
  seasonTotalOf,
  sluggingPercentage,
  statsOfEntry,
  teamSeasonStats,
  teamSeasons,
  whip,
} from './history';
import {
  HALL_OF_FAME_THRESHOLD,
  TIER_LABELS,
  awardValue,
  careerValue,
  hallOfFameScore,
  isHallOfFameEligible,
  isInHallOfFame,
  judgeHallOfFame,
  longevity,
  peakValue,
  playerTier,
} from './hallOfFame';
import {
  BATTING_FIELDS,
  PITCHING_FIELDS,
  average,
  emptyBatting,
  emptyPitching,
  era,
  packBatting,
  packPitching,
  unpackBatting,
  unpackPitching,
} from './stats';
import { createTradeOffer, executeTrade } from './trade';
import { clearSave, loadGame, migrate, saveGame } from './save';
import type { BattingStats, GameState, PitchingStats, PlayerHistory } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 370370): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 370370, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
  for (let i = 0; i < count; i++) {
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

function sampleBatting(overrides: Partial<BattingStats> = {}): BattingStats {
  return {
    ...emptyBatting(),
    games: 100,
    plateAppearances: 420,
    atBats: 380,
    hits: 114,
    doubles: 20,
    triples: 2,
    homeRuns: 18,
    rbi: 62,
    runs: 55,
    steals: 9,
    strikeouts: 70,
    walks: 38,
    ...overrides,
  };
}

function samplePitching(overrides: Partial<PitchingStats> = {}): PitchingStats {
  return {
    ...emptyPitching(),
    games: 26,
    starts: 26,
    outs: 480,
    wins: 12,
    losses: 8,
    holds: 0,
    saves: 0,
    strikeouts: 130,
    walks: 45,
    hitsAllowed: 150,
    homeRunsAllowed: 14,
    runsAllowed: 62,
    earnedRuns: 56,
    ...overrides,
  };
}

/* ================= 成績の計算 ================= */

describe('PHASE3.7 成績の計算', () => {
  it('打率が計算できる', () => {
    expect(average(sampleBatting())).toBeCloseTo(114 / 380, 6);
  });

  it('打数0なら打率は0', () => {
    expect(average(emptyBatting())).toBe(0);
  });

  it('出塁率は (安打+四球)/(打数+四球)', () => {
    const b = sampleBatting();
    expect(onBasePercentage(b)).toBeCloseTo((114 + 38) / (380 + 38), 6);
  });

  it('出塁率は打席がなければ0', () => {
    expect(onBasePercentage(emptyBatting())).toBe(0);
  });

  it('長打率は塁打数 / 打数', () => {
    const b = sampleBatting();
    const singles = 114 - 20 - 2 - 18;
    const bases = singles + 20 * 2 + 2 * 3 + 18 * 4;
    expect(sluggingPercentage(b)).toBeCloseTo(bases / 380, 6);
  });

  it('長打率は打率以上になる', () => {
    const b = sampleBatting();
    expect(sluggingPercentage(b)).toBeGreaterThanOrEqual(average(b));
  });

  it('本塁打だけの打者は長打率が打率の4倍', () => {
    const b = sampleBatting({ hits: 10, doubles: 0, triples: 0, homeRuns: 10, atBats: 100 });
    expect(sluggingPercentage(b)).toBeCloseTo(average(b) * 4, 6);
  });

  it('防御率は自責点×27/アウト数', () => {
    const p = samplePitching();
    expect(era(p)).toBeCloseTo((56 * 27) / 480, 6);
  });

  it('投球回0なら防御率は0', () => {
    expect(era(emptyPitching())).toBe(0);
  });

  it('WHIPは(被安打+与四球)/投球回', () => {
    const p = samplePitching();
    expect(whip(p)).toBeCloseTo((150 + 45) / (480 / 3), 6);
  });

  it('投球回0ならWHIPは0', () => {
    expect(whip(emptyPitching())).toBe(0);
  });
});

/* ================= 圧縮形式 ================= */

describe('PHASE3.7 履歴の保存形式', () => {
  it('打撃成績を配列にして元に戻せる', () => {
    const b = sampleBatting();
    expect(unpackBatting(packBatting(b))).toEqual(b);
  });

  it('投手成績を配列にして元に戻せる', () => {
    const p = samplePitching();
    expect(unpackPitching(packPitching(p))).toEqual(p);
  });

  it('配列の長さが項目数と一致する', () => {
    expect(packBatting(sampleBatting())).toHaveLength(BATTING_FIELDS.length);
    expect(packPitching(samplePitching())).toHaveLength(PITCHING_FIELDS.length);
  });

  it('項目の並びに重複がない', () => {
    expect(new Set(BATTING_FIELDS).size).toBe(BATTING_FIELDS.length);
    expect(new Set(PITCHING_FIELDS).size).toBe(PITCHING_FIELDS.length);
  });

  it('未定義を戻すと空の成績になる', () => {
    expect(unpackBatting(undefined)).toEqual(emptyBatting());
    expect(unpackPitching(undefined)).toEqual(emptyPitching());
  });

  it('短い配列でも壊れずに0で埋まる', () => {
    const b = unpackBatting([5, 10]);
    expect(b.games).toBe(5);
    expect(b.plateAppearances).toBe(10);
    expect(b.walks).toBe(0);
  });
});

/* ================= 球団別の成績 ================= */

describe('PHASE3.7 球団別の今季成績', () => {
  it('試合をすると球団別の成績が積まれる', () => {
    let s = newGame(10, 1001);
    for (let i = 0; i < 12 && !s.seasonFinished; i++) s = advanceDay(s).state;
    const withStats = Object.entries(s.teamStats).filter(([, byTeam]) =>
      Object.values(byTeam).some((v) => v.batting.games > 0 || v.pitching.games > 0),
    );
    expect(withStats.length).toBeGreaterThan(0);
  });

  it('球団別の合計は選手のシーズン成績と一致する', () => {
    const s = playSeason(newGame(10, 1002));
    for (const [playerId, byTeam] of Object.entries(s.teamStats)) {
      const total = emptyCareer();
      for (const stats of Object.values(byTeam)) {
        for (const key of BATTING_FIELDS) total.batting[key] += stats.batting[key];
        for (const key of PITCHING_FIELDS) total.pitching[key] += stats.pitching[key];
      }
      const season = s.stats[playerId];
      if (!season) continue;
      expect(total.batting).toEqual(season.batting);
      expect(total.pitching).toEqual(season.pitching);
    }
  });

  it('移籍していない選手は1球団ぶんしか成績を持たない', () => {
    const s = playSeason(newGame(10, 1003));
    const traded = new Set(s.trade.tradedThisSeason);
    for (const [playerId, byTeam] of Object.entries(s.teamStats)) {
      if (traded.has(playerId)) continue;
      expect(Object.keys(byTeam).length).toBeLessThanOrEqual(1);
    }
  });

  it('新シーズンが始まると球団別成績はリセットされる', () => {
    let s = playSeason(newGame(10, 1004));
    s = cloneState(s);
    startNextSeason(s);
    for (const byTeam of Object.values(s.teamStats)) {
      for (const stats of Object.values(byTeam)) {
        expect(stats.batting.games).toBe(0);
        expect(stats.pitching.games).toBe(0);
      }
    }
  });
});

/* ================= シーズンの確定 ================= */

describe('PHASE3.7 シーズンの確定', () => {
  it('新規ゲームでは歴史が空', () => {
    const s = newGame();
    expect(s.history.seasons).toHaveLength(0);
    expect(Object.keys(s.history.players)).toHaveLength(0);
    expect(s.history.hallOfFame).toHaveLength(0);
  });

  it('1シーズン終えると歴史にその年が残る', () => {
    const s = afterSeasons(1, 1101);
    expect(s.history.seasons.map((x) => x.year)).toEqual([2026]);
  });

  it('確定した年には12球団ぶんの順位が入る', () => {
    const s = afterSeasons(1, 1102);
    expect(s.history.seasons[0].teams).toHaveLength(12);
  });

  it('各リーグに優勝球団が1つ決まる', () => {
    const s = afterSeasons(1, 1103);
    const season = s.history.seasons[0];
    expect(season.leagues).toHaveLength(2);
    for (const league of season.leagues) {
      expect(league.championTeamId).not.toBe('');
      const champions = season.teams.filter(
        (t) => t.leagueId === league.leagueId && t.champion,
      );
      expect(champions).toHaveLength(1);
      expect(champions[0].teamId).toBe(league.championTeamId);
    }
  });

  it('優勝球団は同じリーグで1位', () => {
    const s = afterSeasons(2, 1104);
    for (const season of s.history.seasons) {
      for (const league of season.leagues) {
        const row = season.teams.find((t) => t.teamId === league.championTeamId)!;
        expect(row.rank).toBe(1);
      }
    }
  });

  it('球団のシーズン成績が勝敗と噛み合う', () => {
    const s = afterSeasons(1, 1105);
    for (const row of s.history.seasons[0].teams) {
      expect(row.wins + row.losses + row.draws).toBe(row.games);
      expect(row.games).toBeGreaterThan(0);
    }
  });

  it('球団のチーム成績を読める形に戻せる', () => {
    const s = afterSeasons(1, 1106);
    const row = s.history.seasons[0].teams[0];
    const stats = teamSeasonStats(row);
    expect(stats.batting.atBats).toBeGreaterThan(0);
    expect(stats.pitching.outs).toBeGreaterThan(0);
  });

  it('全選手に歴史ができる', () => {
    const s = afterSeasons(1, 1107);
    const count = Object.keys(s.history.players).length;
    expect(count).toBeGreaterThanOrEqual(300);
  });

  it('年ごとの記録は昇順に並ぶ', () => {
    const s = afterSeasons(4, 1108);
    const years = s.history.seasons.map((x) => x.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it('シーズンの試合数も記録される', () => {
    const s = afterSeasons(1, 1109, 10);
    expect(s.history.seasons[0].seasonLength).toBe(10);
  });
});

/* ================= 二重実行の防止 ================= */

describe('PHASE3.7 二重実行の防止', () => {
  it('同じ年を二度確定しても成績が2倍にならない', () => {
    const s = playSeason(newGame(10, 1201));
    const first = cloneState(s);
    finalizeSeason(first);
    const before = structuredClone(first.history);
    finalizeSeason(first);
    expect(first.history.seasons).toHaveLength(1);
    expect(first.history).toEqual(before);
  });

  it('確定済みの年はhasSeasonがtrueになる', () => {
    const s = playSeason(newGame(10, 1202));
    const next = cloneState(s);
    expect(hasSeason(next.history, next.year)).toBe(false);
    finalizeSeason(next);
    expect(hasSeason(next.history, next.year)).toBe(true);
  });

  it('二度確定しても通算成績が増えない', () => {
    const s = playSeason(newGame(10, 1203));
    const next = cloneState(s);
    finalizeSeason(next);
    const player = Object.values(next.history.players).find((p) => p.career.batting.atBats > 0)!;
    const hits = player.career.batting.hits;
    finalizeSeason(next);
    expect(next.history.players[player.playerId].career.batting.hits).toBe(hits);
  });

  it('二度確定しても年度別の行が増えない', () => {
    const s = playSeason(newGame(10, 1204));
    const next = cloneState(s);
    finalizeSeason(next);
    const counts = Object.fromEntries(
      Object.values(next.history.players).map((p) => [p.playerId, p.seasons.length]),
    );
    finalizeSeason(next);
    for (const [id, count] of Object.entries(counts)) {
      expect(next.history.players[id].seasons.length).toBe(count);
    }
  });

  it('startOffseasonを二度呼んでも歴史が二重にならない', () => {
    let s = playSeason(newGame(10, 1205));
    s = cloneState(s);
    startOffseason(s);
    const seasons = s.history.seasons.length;
    startOffseason(s);
    expect(s.history.seasons.length).toBe(seasons);
  });

  it('二度確定しても記録の更新が二重に記録されない', () => {
    let s = afterSeasons(3, 1206);
    s = playSeason(s);
    s = cloneState(s);
    finalizeSeason(s);
    const events = s.history.events.length;
    finalizeSeason(s);
    expect(s.history.events.length).toBe(events);
  });
});

/* ================= 年度別・通算成績 ================= */

describe('PHASE3.7 年度別・通算成績', () => {
  it('通算成績は年度別の合計と一致する', () => {
    const s = afterSeasons(5, 1301);
    for (const history of Object.values(s.history.players)) {
      const total = emptyCareer();
      for (const entry of history.seasons) {
        const stats = statsOfEntry(entry);
        for (const key of BATTING_FIELDS) total.batting[key] += stats.batting[key];
        for (const key of PITCHING_FIELDS) total.pitching[key] += stats.pitching[key];
      }
      expect(history.career.batting).toEqual(total.batting);
      expect(history.career.pitching).toEqual(total.pitching);
    }
  });

  it('通算成績は各シーズンの成績以上になる', () => {
    const s = afterSeasons(5, 1302);
    for (const history of Object.values(s.history.players)) {
      const years = [...new Set(history.seasons.map((x) => x.year))];
      for (const year of years) {
        const season = seasonTotalOf(history, year);
        expect(history.career.batting.hits).toBeGreaterThanOrEqual(season.batting.hits);
        expect(history.career.batting.homeRuns).toBeGreaterThanOrEqual(season.batting.homeRuns);
        expect(history.career.pitching.wins).toBeGreaterThanOrEqual(season.pitching.wins);
        expect(history.career.pitching.outs).toBeGreaterThanOrEqual(season.pitching.outs);
      }
    }
  });

  it('通算成績はシーズンを重ねると減らない', () => {
    let s = afterSeasons(2, 1303);
    const before = new Map(
      Object.values(s.history.players).map((p) => [p.playerId, p.career.batting.hits]),
    );
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
    for (const [id, hits] of before) {
      const after = s.history.players[id];
      if (!after) continue;
      expect(after.career.batting.hits).toBeGreaterThanOrEqual(hits);
    }
  });

  it('年度別成績は年の重複を許す（シーズン途中の移籍）', () => {
    const s = afterSeasons(6, 1304);
    const multi = Object.values(s.history.players).find((p) => {
      const years = p.seasons.map((x) => x.year);
      return new Set(years).size < years.length;
    });
    if (multi) {
      const year = multi.seasons.find(
        (e, _i, arr) => arr.filter((x) => x.year === e.year).length > 1,
      )!.year;
      const rows = multi.seasons.filter((x) => x.year === year);
      expect(new Set(rows.map((r) => r.teamId)).size).toBe(rows.length);
    }
  });

  it('同じ年の合計は球団別の行の合計になる', () => {
    const s = afterSeasons(6, 1305);
    for (const history of Object.values(s.history.players)) {
      const years = [...new Set(history.seasons.map((x) => x.year))];
      for (const year of years) {
        const rows = history.seasons.filter((x) => x.year === year);
        const manual = emptyCareer();
        for (const row of rows) {
          const stats = statsOfEntry(row);
          for (const key of BATTING_FIELDS) manual.batting[key] += stats.batting[key];
          for (const key of PITCHING_FIELDS) manual.pitching[key] += stats.pitching[key];
        }
        expect(seasonTotalOf(history, year)).toEqual(manual);
      }
    }
  });

  it('デビュー年より前の成績は存在しない', () => {
    const s = afterSeasons(6, 1306);
    for (const history of Object.values(s.history.players)) {
      for (const entry of history.seasons) {
        expect(entry.year).toBeGreaterThanOrEqual(2026);
      }
    }
  });

  it('年度が逆転していない', () => {
    const s = afterSeasons(6, 1307);
    for (const history of Object.values(s.history.players)) {
      const years = history.seasons.map((x) => x.year);
      expect([...years].sort((a, b) => a - b)).toEqual(years);
    }
  });

  it('playerHistoryOf で選手の歴史を引ける', () => {
    const s = afterSeasons(1, 1308);
    const player = s.players[0];
    expect(playerHistoryOf(s.history, player.id)?.playerId).toBe(player.id);
    expect(playerHistoryOf(s.history, 'no-such-player')).toBeUndefined();
  });
});

/* ================= 所属球団の履歴 ================= */

describe('PHASE3.7 所属球団の履歴', () => {
  it('在籍期間をまとめて出せる', () => {
    const s = afterSeasons(5, 1401);
    const history = Object.values(s.history.players).find((p) => p.seasons.length >= 3)!;
    const spans = careerTeamSpans(history);
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(span.from).toBeLessThanOrEqual(span.to);
  });

  it('同じ球団に居続けたなら1つにまとまる', () => {
    const s = afterSeasons(4, 1402);
    const stayed = Object.values(s.history.players).find((p) => {
      const teams = new Set(p.seasons.map((x) => x.teamId));
      return teams.size === 1 && p.seasons.length >= 3;
    });
    if (stayed) expect(careerTeamSpans(stayed)).toHaveLength(1);
  });

  it('移籍すると期間が分かれる', () => {
    const s = afterSeasons(8, 1403);
    const moved = Object.values(s.history.players).find(
      (p) => new Set(p.seasons.map((x) => x.teamId)).size >= 2,
    );
    expect(moved).toBeDefined();
    if (moved) expect(careerTeamSpans(moved).length).toBeGreaterThanOrEqual(2);
  });

  it('同じ球団に戻った場合も別の期間として残る', () => {
    const s = afterSeasons(12, 1404);
    const returned = Object.values(s.history.players).find((p) => {
      const spans = careerTeamSpans(p);
      return spans.some((span, i) => spans.findIndex((x) => x.teamId === span.teamId) !== i);
    });
    if (returned) {
      const spans = careerTeamSpans(returned);
      const ids = spans.map((x) => x.teamId);
      expect(new Set(ids).size).toBeLessThan(ids.length);
    }
  });

  it('在籍期間は年代順に並ぶ', () => {
    const s = afterSeasons(8, 1405);
    for (const history of Object.values(s.history.players)) {
      const spans = careerTeamSpans(history);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].from);
      }
    }
  });
});

/* ================= トレードとの整合 ================= */

describe('PHASE3.7 トレードとの成績の分離', () => {
  it('トレード前の成績は移籍先に加算されない', () => {
    let s = newGame(143, 1501);
    for (let i = 0; i < 60 && !s.seasonFinished; i++) s = advanceDay(s).state;
    s = cloneState(s);

    const from = s.teams.find((t) => t.id !== PLAYER_TEAM)!;
    const to = s.teams.find((t) => t.id !== from.id && t.leagueId === from.leagueId)!;
    const mover = s.players.find(
      (p) => p.teamId === from.id && (s.teamStats[p.id]?.[from.id]?.batting.atBats ?? 0) > 20,
    )!;
    expect(mover).toBeDefined();
    const before = structuredClone(s.teamStats[mover.id][from.id]);

    const back = s.players.find((p) => p.teamId === to.id && !p.isPitcher && p.id !== mover.id)!;
    const offer = createTradeOffer(s, from.id, to.id, [mover.id], [back.id]);
    const result = executeTrade(s, offer);
    expect(result.ok).toBe(true);

    for (let i = 0; i < 40 && !s.seasonFinished; i++) s = advanceDay(s).state;

    // 旧球団の成績はトレード時点のまま
    expect(s.teamStats[mover.id][from.id]).toEqual(before);
    // 新球団の成績は別枠になる
    const after = s.teamStats[mover.id][to.id];
    if (after) {
      expect(after.batting.atBats).toBeLessThanOrEqual(s.stats[mover.id].batting.atBats);
      expect(after.batting.atBats + before.batting.atBats).toBe(
        s.stats[mover.id].batting.atBats,
      );
    }
  });

  it('トレードした選手のシーズン合計は前後の合計と一致する', () => {
    const s = afterSeasons(6, 1502);
    for (const history of Object.values(s.history.players)) {
      const years = [...new Set(history.seasons.map((x) => x.year))];
      for (const year of years) {
        const rows = history.seasons.filter((x) => x.year === year);
        if (rows.length < 2) continue;
        const total = seasonTotalOf(history, year);
        let hits = 0;
        for (const row of rows) hits += statsOfEntry(row).batting.hits;
        expect(total.batting.hits).toBe(hits);
      }
    }
  });

  it('球団の年度別成績にはその球団で挙げた成績だけが入る', () => {
    const s = afterSeasons(4, 1503);
    for (const season of s.history.seasons) {
      for (const row of season.teams) {
        let hits = 0;
        for (const history of Object.values(s.history.players)) {
          for (const entry of history.seasons) {
            if (entry.year !== season.year || entry.teamId !== row.teamId) continue;
            hits += statsOfEntry(entry).batting.hits;
          }
        }
        expect(teamSeasonStats(row).batting.hits).toBe(hits);
      }
    }
  });

  it('同じ選手が同じ年に同じ球団で2行にならない', () => {
    const s = afterSeasons(8, 1504);
    for (const history of Object.values(s.history.players)) {
      const seen = new Set<string>();
      for (const entry of history.seasons) {
        const key = `${entry.year}:${entry.teamId}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

/* ================= FAとの整合 ================= */

describe('PHASE3.7 FA移籍との成績の分離', () => {
  it('FAで移籍しても前年までの成績は前の球団に残る', () => {
    const s = afterSeasons(8, 1601);
    const moved = Object.values(s.history.players).find(
      (p) => new Set(p.seasons.map((x) => x.teamId)).size >= 2 && p.seasons.length >= 4,
    );
    expect(moved).toBeDefined();
    if (!moved) return;
    // 各行は必ず1つの球団に紐づく
    for (const entry of moved.seasons) {
      expect(typeof entry.teamId).toBe('string');
      expect(entry.teamId.length).toBeGreaterThan(0);
    }
    // 前の球団の成績が後の球団に足されていない
    const byTeam = new Map<string, number>();
    for (const entry of moved.seasons) {
      byTeam.set(
        entry.teamId,
        (byTeam.get(entry.teamId) ?? 0) + statsOfEntry(entry).batting.hits,
      );
    }
    let sum = 0;
    for (const v of byTeam.values()) sum += v;
    expect(sum).toBe(moved.career.batting.hits);
  });

  it('球団を移った年の成績は移った先の球団に記録される', () => {
    const s = afterSeasons(6, 1602);
    for (const history of Object.values(s.history.players)) {
      for (const entry of history.seasons) {
        const season = s.history.seasons.find((x) => x.year === entry.year);
        if (!season) continue;
        expect(season.teams.some((t) => t.teamId === entry.teamId)).toBe(true);
      }
    }
  });

  it('未所属期間の成績は残らない', () => {
    const s = afterSeasons(6, 1603);
    for (const history of Object.values(s.history.players)) {
      for (const entry of history.seasons) {
        expect(entry.teamId).not.toBe('');
      }
    }
  });
});

/* ================= 引退 ================= */

describe('PHASE3.7 引退した選手', () => {
  it('引退してもロスターから消えるだけで歴史は残る', () => {
    const s = afterSeasons(6, 1701);
    const retired = retiredHistories(s.history);
    expect(retired.length).toBeGreaterThan(0);
    for (const history of retired) {
      expect(s.players.some((p) => p.id === history.playerId)).toBe(false);
      expect(history.seasons.length).toBeGreaterThan(0);
    }
  });

  it('引退年が記録される', () => {
    const s = afterSeasons(6, 1702);
    for (const history of retiredHistories(s.history)) {
      expect(history.retiredAt).not.toBeNull();
      expect(history.retiredAt!).toBeGreaterThanOrEqual(history.debutYear);
    }
  });

  it('引退後は成績が増えない', () => {
    let s = afterSeasons(5, 1703);
    const retired = retiredHistories(s.history).map((h) => ({
      id: h.playerId,
      hits: h.career.batting.hits,
      wins: h.career.pitching.wins,
      rows: h.seasons.length,
    }));
    expect(retired.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
    }
    for (const before of retired) {
      const after = s.history.players[before.id];
      expect(after.career.batting.hits).toBe(before.hits);
      expect(after.career.pitching.wins).toBe(before.wins);
      expect(after.seasons.length).toBe(before.rows);
    }
  });

  it('引退時の総合力が残る', () => {
    const s = afterSeasons(6, 1704);
    for (const history of retiredHistories(s.history)) {
      expect(history.finalOverall).not.toBeNull();
      expect(history.finalOverall!).toBeGreaterThan(0);
    }
  });

  it('現役の選手は引退年を持たない', () => {
    const s = afterSeasons(4, 1705);
    for (const player of s.players) {
      const history = s.history.players[player.id];
      if (!history) continue;
      expect(history.retiredAt).toBeNull();
    }
  });

  it('現役と引退で歴史が二重にならない', () => {
    const s = afterSeasons(6, 1706);
    const active = new Set(activeHistories(s.history).map((h) => h.playerId));
    for (const history of retiredHistories(s.history)) {
      expect(active.has(history.playerId)).toBe(false);
    }
  });

  it('引退記録の上限を超えても歴史は残る', () => {
    const s = afterSeasons(14, 1707);
    // state.retiredPlayers は500件で打ち切られるが、歴史は打ち切らない
    expect(retiredHistories(s.history).length).toBeGreaterThan(0);
    expect(Object.keys(s.history.players).length).toBeGreaterThan(s.players.length);
  });
});

/* ================= タイトル・表彰 ================= */

describe('PHASE3.7 タイトル・表彰', () => {
  it('規定打席・規定投球回は試合数に比例する', () => {
    expect(qualifiedAtBats(143)).toBeGreaterThan(qualifiedAtBats(30));
    expect(qualifiedOuts(143)).toBeGreaterThan(qualifiedOuts(30));
    expect(qualifiedAtBats(0)).toBeGreaterThanOrEqual(1);
  });

  it('防御率だけは小さいほうが良い', () => {
    for (const key of LEADER_KEYS) {
      expect(higherIsBetter(key)).toBe(key !== 'era');
    }
  });

  it('タイトルの表示名がすべて用意されている', () => {
    for (const key of LEADER_KEYS) {
      expect(LEADER_LABELS[key]).toBeTruthy();
    }
  });

  it('各リーグでMVPが決まる', () => {
    const s = afterSeasons(1, 1801);
    for (const league of s.history.seasons[0].leagues) {
      expect(league.mvpPlayerId).not.toBeNull();
    }
  });

  it('MVPは実在する選手', () => {
    const s = afterSeasons(3, 1802);
    for (const season of s.history.seasons) {
      for (const league of season.leagues) {
        if (!league.mvpPlayerId) continue;
        expect(s.history.players[league.mvpPlayerId]).toBeDefined();
      }
    }
  });

  it('タイトル獲得者は表彰として選手に残る', () => {
    const s = afterSeasons(2, 1803);
    const season = s.history.seasons[0];
    for (const league of season.leagues) {
      const leader = league.leaders.homeRuns;
      if (!leader) continue;
      const history = s.history.players[leader.playerId];
      expect(
        history.awards.some((a) => a.year === season.year && a.kind === 'HOME_RUN_KING'),
      ).toBe(true);
    }
  });

  it('本塁打王はそのリーグで一番本塁打が多い', () => {
    const s = afterSeasons(1, 1804);
    const before = playSeason(newGame(30, 1804));
    for (const league of before.leagues) {
      const players = collectLeaguePlayers(before, league.id);
      const max = Math.max(0, ...players.map((p) => p.batting.homeRuns));
      const row = s.history.seasons[0].leagues.find((l) => l.leagueId === league.id)!;
      if (row.leaders.homeRuns) expect(row.leaders.homeRuns.value).toBe(max);
    }
  });

  it('新人王はその年にデビューした選手', () => {
    const s = afterSeasons(4, 1805);
    for (const season of s.history.seasons) {
      for (const league of season.leagues) {
        if (!league.rookiePlayerId) continue;
        const history = s.history.players[league.rookiePlayerId];
        expect(history.debutYear).toBe(season.year);
      }
    }
  });

  it('表彰の表示名がすべて用意されている', () => {
    const s = afterSeasons(3, 1806);
    for (const history of Object.values(s.history.players)) {
      for (const award of history.awards) {
        expect(AWARD_LABELS[award.kind]).toBeTruthy();
      }
    }
  });

  it('同じ年・同じ表彰を同じ選手が二重に受け取らない', () => {
    const s = afterSeasons(5, 1807);
    for (const history of Object.values(s.history.players)) {
      const seen = new Set<string>();
      for (const award of history.awards) {
        const key = `${award.year}:${award.kind}:${award.leagueId}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('打者の貢献度は成績が良いほど高い', () => {
    const weak = sampleBatting({ hits: 40, homeRuns: 1, rbi: 10 });
    const strong = sampleBatting({ hits: 160, homeRuns: 40, rbi: 110 });
    expect(battingScore(strong)).toBeGreaterThan(battingScore(weak));
  });

  it('投手の貢献度は勝ち星が多いほど高い', () => {
    const weak = samplePitching({ wins: 2, losses: 14, earnedRuns: 90 });
    const strong = samplePitching({ wins: 18, losses: 3, earnedRuns: 35 });
    expect(pitchingScore(strong)).toBeGreaterThan(pitchingScore(weak));
  });

  it('成績のない選手はタイトルに選ばれない', () => {
    const leaders = pickLeaders([], 143);
    expect(Object.keys(leaders)).toHaveLength(0);
  });

  it('候補がいなければ表彰は決まらない', () => {
    const awards = pickAwards([], 'phoenix', 2030);
    expect(awards.mvp).toBeNull();
    expect(awards.bestPitcher).toBeNull();
    expect(awards.rookie).toBeNull();
  });
});

/* ================= 記録 ================= */

describe('PHASE3.7 球団記録・リーグ記録', () => {
  it('1シーズン終えるとリーグ記録が載る', () => {
    const s = afterSeasons(1, 1901);
    for (const league of s.leagues) {
      const book = s.history.leagueRecords[league.id];
      expect(book).toBeDefined();
      expect(book.season.homeRuns).toBeDefined();
    }
  });

  it('球団記録も載る', () => {
    const s = afterSeasons(1, 1902);
    const book = s.history.teamRecords[PLAYER_TEAM];
    expect(book).toBeDefined();
    expect(book.season.hits).toBeDefined();
  });

  it('記録は破られるまで維持される', () => {
    let s = afterSeasons(3, 1903);
    const before = structuredClone(s.history.leagueRecords);
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
    for (const [leagueId, book] of Object.entries(before)) {
      const after = s.history.leagueRecords[leagueId];
      for (const key of LEADER_KEYS) {
        const old = book.season[key];
        const now = after.season[key];
        if (!old) continue;
        expect(now).toBeDefined();
        if (higherIsBetter(key)) expect(now!.value).toBeGreaterThanOrEqual(old.value);
        else expect(now!.value).toBeLessThanOrEqual(old.value);
      }
    }
  });

  it('シーズン記録は歴代のシーズン最高と一致する', () => {
    const s = afterSeasons(6, 1904);
    for (const league of s.leagues) {
      const book = s.history.leagueRecords[league.id];
      for (const key of LEADER_KEYS) {
        const values: number[] = [];
        for (const season of s.history.seasons) {
          const row = season.leagues.find((l) => l.leagueId === league.id);
          const leader = row?.leaders[key];
          if (leader) values.push(leader.value);
        }
        if (values.length === 0) continue;
        const best = higherIsBetter(key) ? Math.max(...values) : Math.min(...values);
        expect(book.season[key]!.value).toBeCloseTo(best, 6);
      }
    }
  });

  it('通算記録は通算成績のトップと一致する', () => {
    const s = afterSeasons(6, 1905);
    const best = Math.max(
      0,
      ...Object.values(s.history.players).map((p) => p.career.batting.homeRuns),
    );
    const league = Object.values(s.history.leagueRecords)
      .map((b) => b.career.homeRuns?.value ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    expect(league).toBeLessThanOrEqual(best);
  });

  it('記録更新の出来事が積まれる', () => {
    const s = afterSeasons(6, 1906);
    expect(s.history.events.length).toBeGreaterThan(0);
    for (const event of s.history.events) {
      expect(event.previous).not.toBeNull();
      expect(s.history.players[event.playerId]).toBeDefined();
    }
  });

  it('記録更新は前の記録を上回っている', () => {
    const s = afterSeasons(8, 1907);
    for (const event of s.history.events) {
      if (event.previous === null) continue;
      if (event.key === 'era') expect(event.value).toBeLessThan(event.previous);
      else expect(event.value).toBeGreaterThan(event.previous);
    }
  });

  it('記録更新の年は確定済みのシーズンに含まれる', () => {
    const s = afterSeasons(5, 1908);
    const years = new Set(s.history.seasons.map((x) => x.year));
    for (const event of s.history.events) expect(years.has(event.year)).toBe(true);
  });

  it('通算記録の表示名がすべて用意されている', () => {
    const s = afterSeasons(2, 1909);
    for (const book of Object.values(s.history.leagueRecords)) {
      for (const key of Object.keys(book.career) as Array<keyof typeof book.career>) {
        expect(CAREER_RECORD_LABELS[key]).toBeTruthy();
      }
    }
  });

  it('記録保持者は歴史に存在する選手', () => {
    const s = afterSeasons(6, 1910);
    const books = [
      ...Object.values(s.history.leagueRecords),
      ...Object.values(s.history.teamRecords),
    ];
    for (const book of books) {
      for (const holder of Object.values(book.season)) {
        expect(s.history.players[holder.playerId]).toBeDefined();
      }
      for (const holder of Object.values(book.career)) {
        expect(s.history.players[holder.playerId]).toBeDefined();
      }
    }
  });
});

/* ================= 殿堂 ================= */

describe('PHASE3.7 殿堂入り', () => {
  const heavy = (): PlayerHistory => ({
    playerId: 'legend',
    name: '伝説 太郎',
    mainPosition: 'LF',
    isPitcher: false,
    birthYear: 2000,
    debutYear: 2020,
    retiredAt: 2040,
    seasons: Array.from({ length: 20 }, (_, i) => ({
      year: 2020 + i,
      teamId: PLAYER_TEAM,
      b: packBatting(sampleBatting({ hits: 180, homeRuns: 40, rbi: 110, atBats: 550 })),
    })),
    career: {
      batting: sampleBatting({ hits: 3600, homeRuns: 800, rbi: 2200, atBats: 11000 }),
      pitching: emptyPitching(),
    },
    awards: Array.from({ length: 8 }, (_unused, i) => ({
      year: 2022 + i,
      kind: 'MVP' as const,
      leagueId: 'grand',
    })),
    records: 10,
    championships: 6,
    finalOverall: 80,
  });

  const light = (): PlayerHistory => ({
    ...heavy(),
    playerId: 'plain',
    name: '普通 次郎',
    seasons: [{ year: 2020, teamId: PLAYER_TEAM, b: packBatting(sampleBatting()) }],
    career: { batting: sampleBatting(), pitching: emptyPitching() },
    awards: [],
    records: 0,
    championships: 0,
  });

  it('積み上げた選手のほうが点数が高い', () => {
    expect(hallOfFameScore(heavy())).toBeGreaterThan(hallOfFameScore(light()));
  });

  it('通算の価値は成績が増えると上がる', () => {
    expect(careerValue(heavy())).toBeGreaterThan(careerValue(light()));
  });

  it('ピークの高さも見る', () => {
    expect(peakValue(heavy())).toBeGreaterThan(0);
  });

  it('在籍年数を数えられる', () => {
    expect(longevity(heavy())).toBe(20);
    expect(longevity(light())).toBe(1);
  });

  it('表彰の重みはMVPが一番大きい', () => {
    const mvp: PlayerHistory = { ...light(), awards: [{ year: 2020, kind: 'MVP', leagueId: 'g' }] };
    const title: PlayerHistory = {
      ...light(),
      awards: [{ year: 2020, kind: 'HOME_RUN_KING', leagueId: 'g' }],
    };
    expect(awardValue(mvp)).toBeGreaterThan(awardValue(title));
  });

  it('引退していない選手は殿堂の資格がない', () => {
    const active: PlayerHistory = { ...heavy(), retiredAt: null };
    expect(isHallOfFameEligible(active)).toBe(false);
    expect(judgeHallOfFame(active, 2041)).toBeNull();
  });

  it('短いキャリアでは殿堂の資格がない', () => {
    expect(isHallOfFameEligible(light())).toBe(false);
  });

  it('突出した選手は殿堂入りする', () => {
    const entry = judgeHallOfFame(heavy(), 2041);
    expect(entry).not.toBeNull();
    expect(entry!.score).toBeGreaterThanOrEqual(HALL_OF_FAME_THRESHOLD);
  });

  it('短いシーズン設定でも同じ物差しで測る', () => {
    const short = hallOfFameScore(heavy(), 30);
    const long = hallOfFameScore(heavy(), 143);
    expect(short).toBeGreaterThan(long);
  });

  it('格付けは積み上げで決まる', () => {
    expect(playerTier(heavy())).toBe('LEGEND');
    expect(playerTier(light())).toBe('ROOKIE');
  });

  it('格付けの表示名がすべて用意されている', () => {
    for (const tier of ['ROOKIE', 'REGULAR', 'STAR', 'SUPERSTAR', 'LEGEND'] as const) {
      expect(TIER_LABELS[tier]).toBeTruthy();
    }
  });

  it('殿堂入りは引退した選手だけ', () => {
    const s = afterSeasons(16, 2001, 143);
    for (const entry of s.history.hallOfFame) {
      const history = s.history.players[entry.playerId];
      expect(history.retiredAt).not.toBeNull();
      expect(isInHallOfFame(s.history, entry.playerId)).toBe(true);
    }
  });

  it('殿堂入りが大量発生しない', () => {
    const s = afterSeasons(16, 2002, 143);
    const retired = retiredHistories(s.history).length;
    expect(s.history.hallOfFame.length).toBeLessThan(Math.max(3, retired * 0.1));
  });

  it('同じ選手が二度殿堂入りしない', () => {
    const s = afterSeasons(16, 2003, 143);
    const ids = s.history.hallOfFame.map((e) => e.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ================= 長期の整合性 ================= */

describe('PHASE3.7 長期の整合性', () => {
  it('10シーズン続けても歴史が壊れない', () => {
    const s = afterSeasons(10, 2101);
    expect(s.history.seasons).toHaveLength(10);
    expect(validateState(s)).toEqual([]);
  });

  it('確定した年が重複しない', () => {
    const s = afterSeasons(12, 2102);
    const years = s.history.seasons.map((x) => x.year);
    expect(new Set(years).size).toBe(years.length);
  });

  it('選手の歴史が重複しない', () => {
    const s = afterSeasons(12, 2103);
    const ids = Object.values(s.history.players).map((p) => p.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, history] of Object.entries(s.history.players)) {
      expect(history.playerId).toBe(key);
    }
  });

  it('30シーズン続けても整合性が保たれる', () => {
    const s = afterSeasons(30, 2104, 10);
    expect(s.history.seasons).toHaveLength(30);
    const years = s.history.seasons.map((x) => x.year);
    expect(new Set(years).size).toBe(30);
    expect(validateState(s)).toEqual([]);
    for (const history of Object.values(s.history.players)) {
      const total = emptyCareer();
      for (const entry of history.seasons) {
        const stats = statsOfEntry(entry);
        for (const key of BATTING_FIELDS) total.batting[key] += stats.batting[key];
        for (const key of PITCHING_FIELDS) total.pitching[key] += stats.pitching[key];
      }
      expect(history.career.batting.hits).toBe(total.batting.hits);
    }
  }, 120000);

  it('球団の年表がシーズン数と噛み合う', () => {
    const s = afterSeasons(10, 2105);
    for (const team of s.teams) {
      expect(teamSeasons(s.history, team.id)).toHaveLength(10);
    }
  });

  it('優勝回数の合計はシーズン数×リーグ数と一致する', () => {
    const s = afterSeasons(8, 2106);
    let total = 0;
    for (const team of s.teams) total += championshipCount(s.history, team.id);
    expect(total).toBe(8 * s.leagues.length);
  });

  it('同じシードなら同じ歴史になる', () => {
    const a = afterSeasons(5, 2107);
    const b = afterSeasons(5, 2107);
    expect(a.history.seasons.map((x) => x.year)).toEqual(b.history.seasons.map((x) => x.year));
    expect(a.history.hallOfFame.length).toBe(b.history.hallOfFame.length);
    expect(a.history.events.length).toBe(b.history.events.length);
  });

  it('歴史の選手数は現役より多くなる', () => {
    const s = afterSeasons(10, 2108);
    expect(Object.keys(s.history.players).length).toBeGreaterThan(s.players.length);
  });

  it('保存サイズが実用的な範囲に収まる', () => {
    const s = afterSeasons(20, 2109, 30);
    const size = JSON.stringify(s).length;
    expect(size).toBeLessThan(4_000_000);
  }, 120000);
});

/* ================= セーブ ================= */

/** Node では localStorage が無いので、テスト用の入れ物を差し込む */
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

describe('PHASE3.7 セーブ', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
      new MemoryStorage();
    clearSave();
  });

  it('セーブバージョンが11になっている', () => {
    expect(SAVE_VERSION).toBe(11);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('歴史が保存・復元される', () => {
    const s = afterSeasons(3, 2201);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.history.seasons.map((x) => x.year)).toEqual(
      s.history.seasons.map((x) => x.year),
    );
    expect(Object.keys(loaded.history.players).length).toBe(
      Object.keys(s.history.players).length,
    );
  });

  it('球団別の今季成績も保存・復元される', () => {
    let s = newGame(10, 2202);
    for (let i = 0; i < 12 && !s.seasonFinished; i++) s = advanceDay(s).state;
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.teamStats).toEqual(s.teamStats);
  });

  it('v10のセーブを読み込める（歴史は空から始まる）', () => {
    const s = afterSeasons(1, 2203);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 10;
    delete old.history;
    delete old.teamStats;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(11);
    expect(migrated!.history.seasons).toHaveLength(0);
    expect(migrated!.history.players).toEqual({});
  });

  it('v10からの移行で今季成績が現球団の成績として引き継がれる', () => {
    let s = newGame(10, 2204);
    for (let i = 0; i < 12 && !s.seasonFinished; i++) s = advanceDay(s).state;
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 10;
    delete old.history;
    delete old.teamStats;
    const migrated = migrate(old as unknown as GameState)!;
    for (const player of migrated.players) {
      const season = migrated.stats[player.id];
      if (!season) continue;
      const byTeam = migrated.teamStats[player.id];
      expect(byTeam).toBeDefined();
      expect(byTeam[player.teamId].batting).toEqual(season.batting);
    }
  });

  it('v1のセーブもv11まで移行できる', () => {
    const s = newGame(10, 2205);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 1;
    delete old.history;
    delete old.teamStats;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(11);
    expect(migrated!.history).toBeDefined();
    expect(Array.isArray(migrated!.history.seasons)).toBe(true);
  });

  it('歴史が壊れていても読み込める', () => {
    const s = afterSeasons(1, 2206);
    const broken = structuredClone(s) as unknown as Record<string, unknown>;
    broken.version = 10;
    broken.history = { seasons: null, players: null } as unknown;
    const migrated = migrate(broken as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(Array.isArray(migrated!.history.seasons)).toBe(true);
    expect(migrated!.history.players).toEqual({});
  });

  it('ensureHistoryは欠けている入れ物を作る', () => {
    const s = newGame(10, 2207);
    (s as unknown as Record<string, unknown>).history = undefined;
    const history = ensureHistory(s);
    expect(history.seasons).toEqual([]);
    expect(history.hallOfFame).toEqual([]);
  });

  it('createHistoryStateは空の歴史を作る', () => {
    const history = createHistoryState();
    expect(history.seasons).toHaveLength(0);
    expect(history.events).toHaveLength(0);
    expect(Object.keys(history.players)).toHaveLength(0);
  });

  it('保存・復元しても記録が変わらない', () => {
    const s = afterSeasons(4, 2208);
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.history.leagueRecords).toEqual(s.history.leagueRecords);
    expect(loaded.history.teamRecords).toEqual(s.history.teamRecords);
  });
});

/* ================= 既存システムを壊していない ================= */

describe('PHASE3.7 既存システムが壊れていない', () => {
  it('シーズンの流れが変わっていない', () => {
    let s = playSeason(newGame(10, 2301));
    const year = s.year;
    s = cloneState(s);
    startNextSeason(s);
    expect(s.year).toBe(year + 1);
    expect(s.seasonFinished).toBe(false);
    expect(validateState(s)).toEqual([]);
  });

  it('球団経営プランが引き続き作られる', () => {
    const s = afterSeasons(2, 2302);
    expect(Object.keys(s.teamPlans).length).toBe(12);
  });

  it('トレード履歴が残る', () => {
    const s = afterSeasons(4, 2303);
    expect(s.trade.history.length).toBeGreaterThan(0);
  });

  it('過去シーズンのトレードは成績の控えを持たない', () => {
    const s = afterSeasons(4, 2304);
    for (const record of s.trade.history) {
      if (record.year >= s.year) continue;
      expect(Object.keys(record.statsAtTrade)).toHaveLength(0);
    }
  });

  it('今季のトレードは成績の控えを持つ', () => {
    let s = newGame(143, 2305);
    for (let i = 0; i < 80 && !s.seasonFinished; i++) s = advanceDay(s).state;
    const thisYear = s.trade.history.filter((r) => r.year === s.year);
    if (thisYear.length > 0) {
      expect(
        thisYear.some((r) => Object.keys(r.statsAtTrade).length > 0),
      ).toBe(true);
    }
  });

  it('FA・ドラフト・契約が引き続き動く', () => {
    const s = afterSeasons(3, 2306);
    expect(s.players.length).toBeGreaterThan(280);
    for (const team of s.teams) {
      const roster = s.players.filter((p) => p.teamId === team.id);
      expect(roster.length).toBeGreaterThanOrEqual(24);
    }
  });
});
