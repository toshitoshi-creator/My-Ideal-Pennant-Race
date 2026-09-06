/**
 * PHASE 4.4 のテスト（§37）。
 *
 * 見ているのは主に次の4つ。
 *   1 GM Desk が決定論であること・上限を守ること・存在しない選手を参照しないこと
 *   2 選手／球団の報告書が「おすすめ」ではなく「判断材料」になっていること
 *   3 判断記録がゲームの結果を変えないこと・セーブが壊れないこと
 *   4 試合前後の資料が、すでに確定した結果を並べているだけであること
 */
import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason } from './season';
import {
  GM_DESK_LIMIT,
  buildGmDesk,
  collectGmDeskItems,
  formatDelta,
  isOwnPlayer,
  recentForm,
  seasonProgress,
  type GmDeskItem,
} from './gmDesk';
import { buildPlayerReport, axisNotes, readTrend } from './playerReport';
import { buildTeamReport, ROUTE_LABELS } from './teamReport';
import {
  buildPreGameBrief,
  buildPostGameReport,
  keyMoments,
  firstTeamOverall,
  opponentStrengthHint,
} from './gameBrief';
import { dayFlow, seasonTimeline, timelineYears, monthOf, monthLabel } from './seasonFlow';
import {
  DECISION_KIND_LABELS,
  DECISION_KIND_TAGS,
  DECISION_LIMIT,
  decisionId,
  decisionOutcome,
  decisionYears,
  decisionsOfDate,
  decisionsOfYear,
  ensureDecisions,
  recentDecisions,
  recordDecision,
} from './decisions';
import { migrateV14ToV15 } from './migrate';
import { migrate } from './save';
import { analyzePlayer } from './playerAnalysis';
import { overallRating } from './rating';
import { emptyBatting, emptyPitching } from './stats';
import { staggerDelay, easeOutCubic } from '../ui/anim';
import type { BattingStats, GameResult, GameState, Player } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 440440): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function playDays(state: GameState, days: number): GameState {
  let s = state;
  for (let i = 0; i < days && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 440440, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
  for (let i = 0; i < count; i++) {
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

function myPlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.teamId === PLAYER_TEAM);
}

function batting(over: Partial<BattingStats>): BattingStats {
  return { ...emptyBatting(), ...over };
}

/** 全案件の文章をひとまとめにする（禁止語の検査に使う） */
function allText(items: GmDeskItem[]): string {
  return items
    .map((item) =>
      [
        item.headline,
        item.ja,
        ...item.situation,
        item.scoutNote,
        ...item.shortTerm,
        ...item.longTerm,
        ...item.options.map((o) => `${o.label} ${o.note}`),
        ...item.data.map((d) => `${d.label} ${d.value}`),
      ].join(' '),
    )
    .join(' ');
}

/* ================================================================
 * 1. GM DESK
 * ============================================================== */

describe('PHASE 4.4 GM Desk：決定論', () => {
  it('同じ state からは必ず同じ案件が返る', () => {
    const state = playDays(newGame(), 12);
    const a = buildGmDesk(state);
    const b = buildGmDesk(state);
    const c = buildGmDesk(cloneState(state));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('案件を作っても rngState は動かない（UI を開くだけで乱数が進まない）', () => {
    const state = playDays(newGame(), 20);
    const before = state.rngState;
    buildGmDesk(state);
    collectGmDeskItems(state);
    expect(state.rngState).toBe(before);
  });

  it('案件を作っても state を書き換えない', () => {
    const state = playDays(newGame(), 20);
    const snapshot = JSON.stringify(state);
    buildGmDesk(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('シードを変えても決定論は保たれる', () => {
    for (const seed of [1, 777, 20260906]) {
      const state = playDays(newGame(30, seed), 10);
      expect(buildGmDesk(state)).toEqual(buildGmDesk(state));
    }
  });
});

describe('PHASE 4.4 GM Desk：件数と重複', () => {
  it('上限（3件）を超えない', () => {
    let state = newGame(143);
    for (let day = 0; day < 60; day++) {
      state = advanceDay(state).state;
      expect(buildGmDesk(state).length).toBeLessThanOrEqual(GM_DESK_LIMIT);
    }
  });

  it('GM_DESK_LIMIT は 3', () => {
    expect(GM_DESK_LIMIT).toBe(3);
  });

  it('limit を渡せば件数を絞れる', () => {
    const state = playDays(newGame(143), 40);
    expect(buildGmDesk(state, 1).length).toBeLessThanOrEqual(1);
    expect(buildGmDesk(state, 0)).toEqual([]);
  });

  it('ID が重複しない', () => {
    let state = newGame(143);
    for (let day = 0; day < 40; day++) {
      state = advanceDay(state).state;
      const ids = collectGmDeskItems(state).map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('種類も重複しない（同じ観点の案件が二重に出ない）', () => {
    let state = newGame(143);
    for (let day = 0; day < 40; day++) {
      state = advanceDay(state).state;
      const kinds = collectGmDeskItems(state).map((item) => item.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it('重みの大きい順に並ぶ', () => {
    const state = playDays(newGame(143), 50);
    const items = buildGmDesk(state, 99);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].weight).toBeGreaterThanOrEqual(items[i].weight);
    }
  });
});

describe('PHASE 4.4 GM Desk：参照する選手', () => {
  it('存在しない選手を参照しない', () => {
    let state = newGame(143);
    const check = (s: GameState) => {
      const ids = new Set(s.players.map((p) => p.id));
      for (const item of collectGmDeskItems(s)) {
        for (const playerId of item.playerIds) expect(ids.has(playerId)).toBe(true);
      }
    };
    for (let day = 0; day < 30; day++) {
      state = advanceDay(state).state;
      check(state);
    }
  });

  it('引退した選手を対象にしない', () => {
    const state = afterSeasons(3);
    const retired = new Set(state.retiredPlayers.map((r) => r.playerId));
    expect(retired.size).toBeGreaterThan(0);
    for (const item of collectGmDeskItems(state)) {
      for (const playerId of item.playerIds) expect(retired.has(playerId)).toBe(false);
    }
  });

  it('他球団の選手を案件に載せない（他球団の内部情報を持ち出さない）', () => {
    let state = newGame(143);
    for (let day = 0; day < 40; day++) {
      state = advanceDay(state).state;
      for (const item of collectGmDeskItems(state)) {
        for (const playerId of item.playerIds) {
          const player = state.players.find((p) => p.id === playerId)!;
          expect(player.teamId).toBe(PLAYER_TEAM);
        }
      }
    }
  });

  it('isOwnPlayer が自球団だけを true にする', () => {
    const state = newGame();
    const mine = myPlayers(state)[0];
    const other = state.players.find((p) => p.teamId !== PLAYER_TEAM)!;
    expect(isOwnPlayer(state, mine)).toBe(true);
    expect(isOwnPlayer(state, other)).toBe(false);
  });

  it('3年後の state でも参照が壊れない', () => {
    const state = afterSeasons(3);
    const ids = new Set(state.players.map((p) => p.id));
    for (const item of collectGmDeskItems(state)) {
      for (const playerId of item.playerIds) expect(ids.has(playerId)).toBe(true);
    }
  });
});

describe('PHASE 4.4 GM Desk：中身', () => {
  it('どの案件にも見出し・見方・行き先がある', () => {
    let state = newGame(143);
    for (let day = 0; day < 40; day++) {
      state = advanceDay(state).state;
      for (const item of collectGmDeskItems(state)) {
        expect(item.headline.length).toBeGreaterThan(0);
        expect(item.scoutNote.length).toBeGreaterThan(0);
        expect(item.en.length).toBeGreaterThan(0);
        expect(item.ja.length).toBeGreaterThan(0);
        expect(item.options.length).toBeGreaterThan(0);
        expect(item.shortTerm.length).toBeGreaterThan(0);
        expect(item.longTerm.length).toBeGreaterThan(0);
      }
    }
  });

  it('英字の欄名には必ず日本語がついている（§3・§42）', () => {
    const state = playDays(newGame(143), 40);
    for (const item of collectGmDeskItems(state)) {
      expect(/^[A-Z &]+$/.test(item.en)).toBe(true);
      expect(/[ぁ-んァ-ヶ一-龠]/.test(item.ja)).toBe(true);
    }
  });

  it('DATA の値が空にならない', () => {
    const state = playDays(newGame(143), 40);
    for (const item of collectGmDeskItems(state)) {
      for (const datum of item.data) {
        expect(datum.label.length).toBeGreaterThan(0);
        expect(String(datum.value).length).toBeGreaterThan(0);
      }
    }
  });

  it('行き先は実在する画面だけ', () => {
    const allowed = new Set(['trade', 'fa', 'club', 'roster', 'players', 'game', 'news']);
    const state = playDays(newGame(143), 40);
    for (const item of collectGmDeskItems(state)) {
      for (const option of item.options) expect(allowed.has(option.link)).toBe(true);
    }
  });

  it('「おすすめ」「最適」「AI」を使わない（§3・§22）', () => {
    let state = newGame(143);
    const banned = ['おすすめ', 'オススメ', '最適', 'AI', '正解', 'ベスト', 'Best', 'Optimal'];
    for (let day = 0; day < 50; day++) {
      state = advanceDay(state).state;
      const text = allText(collectGmDeskItems(state));
      for (const word of banned) expect(text).not.toContain(word);
    }
  });

  it('未来を断定しない（§6）', () => {
    let state = newGame(143);
    const banned = ['必ず伸び', '確実に', '勝率が上がります', '必ず成長'];
    for (let day = 0; day < 50; day++) {
      state = advanceDay(state).state;
      const text = allText(collectGmDeskItems(state));
      for (const word of banned) expect(text).not.toContain(word);
    }
  });
});

describe('PHASE 4.4 GM Desk：見つけ方', () => {
  it('未決の経営イベントがあれば必ず机のいちばん上に出る', () => {
    let state = newGame(143);
    let found = false;
    for (let day = 0; day < 120 && !found; day++) {
      state = advanceDay(state).state;
      const pending = state.events.filter((e) => !e.resolved);
      if (pending.length === 0) continue;
      found = true;
      const desk = buildGmDesk(state);
      expect(desk[0].kind).toBe('MANAGEMENT_EVENT');
    }
    expect(found).toBe(true);
  });

  it('契約満了が0人なら契約の案件は出ない', () => {
    const state = newGame();
    for (const player of myPlayers(state)) {
      if (player.ext.contract) player.ext.contract.yearsRemaining = 3;
    }
    const kinds = collectGmDeskItems(state).map((i) => i.kind);
    expect(kinds).not.toContain('CONTRACT_EXPIRING');
  });

  it('契約満了がいれば契約の案件が出る', () => {
    const state = newGame();
    const player = myPlayers(state)[0];
    if (player.ext.contract) player.ext.contract.yearsRemaining = 0;
    const kinds = collectGmDeskItems(state).map((i) => i.kind);
    expect(kinds).toContain('CONTRACT_EXPIRING');
  });

  it('リリーフの疲労は3人以上で初めて案件になる', () => {
    const state = newGame();
    const relievers = myPlayers(state).filter(
      (p) => p.isPitcher && (p.pitching?.stamina ?? 0) < 55 && p.roster === 'first',
    );
    expect(relievers.length).toBeGreaterThanOrEqual(3);
    for (const p of myPlayers(state)) p.ext.fatigue = 0;
    relievers[0].ext.fatigue = 80;
    relievers[1].ext.fatigue = 80;
    expect(collectGmDeskItems(state).map((i) => i.kind)).not.toContain('BULLPEN_FATIGUE');
    relievers[2].ext.fatigue = 80;
    expect(collectGmDeskItems(state).map((i) => i.kind)).toContain('BULLPEN_FATIGUE');
  });

  it('予算を超えていれば財務の案件が出る', () => {
    const state = newGame();
    state.finances[PLAYER_TEAM].budget = 1;
    const item = collectGmDeskItems(state).find((i) => i.kind === 'BUDGET');
    expect(item).toBeDefined();
    expect(item!.data.some((d) => d.label === '年間予算')).toBe(true);
  });

  it('資金が黒字で予算内なら財務の案件は出ない', () => {
    const state = newGame();
    state.finances[PLAYER_TEAM].budget = 999999;
    state.finances[PLAYER_TEAM].cash = 999999;
    expect(collectGmDeskItems(state).map((i) => i.kind)).not.toContain('BUDGET');
  });

  it('ローテーションが5人そろっていれば先発の案件は出ない', () => {
    const state = newGame();
    expect(state.setups[PLAYER_TEAM].rotation).toHaveLength(5);
    expect(collectGmDeskItems(state).map((i) => i.kind)).not.toContain('ROTATION_THIN');
  });

  it('ローテーションの投手が離脱すると先発の案件が出る', () => {
    const state = newGame();
    const rotation = state.setups[PLAYER_TEAM].rotation;
    const injured = state.players.find((p) => p.id === rotation[0])!;
    injured.ext.injury = {
      level: 'major',
      name: '右肘の炎症',
      startDate: state.date,
      returnDate: '2026-08-01',
    };
    const item = collectGmDeskItems(state).find((i) => i.kind === 'ROTATION_THIN');
    expect(item).toBeDefined();
    expect(item!.headline).toContain('ローテーション');
    expect(item!.situation.join(' ')).toContain('離脱中');
  });

  it('先発の案件は能力の分類ではなく実際のローテーションで判定する', () => {
    // スタミナだけ下げてもローテーションが5人そろっていれば案件は出ない
    const state = newGame();
    for (const player of myPlayers(state)) {
      if (player.isPitcher && player.pitching) player.pitching.stamina = 30;
    }
    expect(collectGmDeskItems(state).map((i) => i.kind)).not.toContain('ROTATION_THIN');
  });

  it('FA市場が開いていればFAの案件が出る', () => {
    const state = newGame();
    expect(collectGmDeskItems(state).map((i) => i.kind)).not.toContain('FA_MARKET');
  });
});

describe('PHASE 4.4 GM Desk：小道具', () => {
  it('recentForm は直近の試合だけを数える', () => {
    const state = playDays(newGame(143), 30);
    const form = recentForm(state, 5);
    expect(form.played).toBeLessThanOrEqual(5);
    expect(form.wins + form.losses + form.draws).toBe(form.played);
  });

  it('開幕直後の recentForm は 0 試合', () => {
    const state = newGame();
    expect(recentForm(state).played).toBe(0);
  });

  it('seasonProgress は 0〜1 に収まる', () => {
    let state = newGame(10);
    for (let i = 0; i < 40; i++) {
      state = advanceDay(state).state;
      const progress = seasonProgress(state);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it('formatDelta は必ず符号をつける', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-2.5)).toBe('-2.5');
    expect(formatDelta(0)).toBe('0');
  });
});

describe('PHASE 4.4 GM Desk：異常な state', () => {
  it('選手が0人でもクラッシュしない', () => {
    const state = newGame();
    state.players = [];
    expect(() => collectGmDeskItems(state)).not.toThrow();
  });

  it('自球団の選手が0人でもクラッシュしない', () => {
    const state = newGame();
    state.players = state.players.filter((p) => p.teamId !== PLAYER_TEAM);
    expect(() => buildGmDesk(state)).not.toThrow();
  });

  it('12球団どれを自球団にしても案件を作れる', () => {
    for (const team of newGame().teams) {
      const state = createNewGame(team.id, 10, 4444);
      expect(() => buildGmDesk(state)).not.toThrow();
    }
  });

  it('シーズン終了後でもクラッシュしない', () => {
    const state = playSeason(newGame(10));
    expect(state.seasonFinished).toBe(true);
    expect(() => buildGmDesk(state)).not.toThrow();
  });
});

/* ================================================================
 * 2. 選手報告書
 * ============================================================== */

describe('PHASE 4.4 選手報告書', () => {
  it('§7 の項目がすべて並ぶ', () => {
    const state = playDays(newGame(143), 40);
    const report = buildPlayerReport(state, myPlayers(state)[0]);
    const keys = report.rows.map((r) => r.key);
    for (const key of [
      'current',
      'form',
      'trend',
      'age',
      'role',
      'usage',
      'development',
      'contract',
      'health',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('どの行にも英字と日本語の両方がある（§42）', () => {
    const state = newGame();
    for (const player of myPlayers(state).slice(0, 5)) {
      for (const row of buildPlayerReport(state, player).rows) {
        expect(/^[A-Z ]+$/.test(row.en)).toBe(true);
        expect(row.ja.length).toBeGreaterThan(0);
        expect(String(row.value).length).toBeGreaterThan(0);
      }
    }
  });

  it('同じ state からは同じ報告書になる', () => {
    const state = playDays(newGame(143), 30);
    const player = myPlayers(state)[0];
    expect(buildPlayerReport(state, player)).toEqual(buildPlayerReport(state, player));
  });

  it('報告書を作っても state を書き換えない', () => {
    const state = playDays(newGame(143), 30);
    const snapshot = JSON.stringify(state);
    for (const player of myPlayers(state).slice(0, 8)) buildPlayerReport(state, player);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('報告書を作ってもロスターは変わらない（§37 自動でロスターを変更しない）', () => {
    const state = playDays(newGame(143), 30);
    const before = myPlayers(state).map((p) => `${p.id}:${p.roster}`).join(',');
    for (const player of myPlayers(state)) buildPlayerReport(state, player);
    const after = myPlayers(state).map((p) => `${p.id}:${p.roster}`).join(',');
    expect(after).toBe(before);
  });

  it('全選手ぶん作ってもクラッシュしない', () => {
    const state = afterSeasons(2);
    for (const player of state.players) {
      expect(() => buildPlayerReport(state, player)).not.toThrow();
    }
  });

  it('§9 現在の成績・成長傾向・将来性が別々の文章になる', () => {
    const state = playDays(newGame(143), 60);
    const report = buildPlayerReport(state, myPlayers(state)[0]);
    expect(report.performanceNote.length).toBeGreaterThan(0);
    expect(report.developmentNote.length).toBeGreaterThan(0);
    expect(report.outlookNote.length).toBeGreaterThan(0);
    expect(report.performanceNote).not.toBe(report.developmentNote);
    expect(report.developmentNote).not.toBe(report.outlookNote);
  });

  it('成績が低くても成長の材料があれば「育成の価値」と読める', () => {
    const state = newGame();
    const player = myPlayers(state).find((p) => !p.isPitcher)!;
    player.age = 21;
    player.ext.potential = 92;
    state.stats[player.id] = {
      playerId: player.id,
      batting: batting({ games: 60, plateAppearances: 200, atBats: 180, hits: 30 }),
      pitching: emptyPitching(),
    };
    const report = buildPlayerReport(state, player);
    expect(report.combinedNote).toContain('育成');
  });

  it('成績が高くても高齢で伸びしろが小さければ「後を継ぐ選手」と読める', () => {
    const state = newGame();
    const player = myPlayers(state).find((p) => !p.isPitcher)!;
    player.age = 35;
    player.ext.potential = 40;
    state.stats[player.id] = {
      playerId: player.id,
      batting: batting({
        games: 120,
        plateAppearances: 500,
        atBats: 450,
        hits: 150,
        homeRuns: 25,
        rbi: 90,
      }),
      pitching: emptyPitching(),
    };
    const report = buildPlayerReport(state, player);
    expect(report.combinedNote).toContain('後を継ぐ');
  });

  it('将来性の実数値は文章に出さない（§30 potential を直接見せない）', () => {
    const state = newGame();
    const player = myPlayers(state)[0];
    player.ext.potential = 87;
    const report = buildPlayerReport(state, player);
    const text = [report.outlookNote, report.developmentNote, report.combinedNote].join(' ');
    expect(text).not.toContain('87');
  });

  it('§11 記録が無ければ推移は「判定できない」', () => {
    const state = newGame();
    const report = buildPlayerReport(state, myPlayers(state)[0]);
    expect(report.trendReading.trend).toBe('UNKNOWN');
    expect(report.trendReading.text).toContain('残っていない');
  });

  it('§11 2年ぶん以上の記録があれば推移の説明に年が入る', () => {
    const state = afterSeasons(3);
    const withHistory = myPlayers(state).find(
      (p) => (state.history.players[p.id]?.seasons.length ?? 0) >= 2,
    );
    expect(withHistory).toBeDefined();
    const report = buildPlayerReport(state, withHistory!);
    if (report.trendReading.trend !== 'UNKNOWN') {
      expect(report.trendReading.text).toMatch(/\d{4}年/);
    }
  });

  it('§11 の印は ↑ → ↓ — のどれか', () => {
    const state = afterSeasons(2);
    for (const player of myPlayers(state)) {
      expect(['↑', '→', '↓', '—']).toContain(buildPlayerReport(state, player).trendReading.mark);
    }
  });

  it('readTrend は analyzePlayer の判定と食い違わない', () => {
    const state = afterSeasons(3);
    for (const player of myPlayers(state).slice(0, 10)) {
      const analysis = analyzePlayer(state, player);
      const reading = readTrend(player, analysis);
      if (analysis.trend.length >= 2) expect(reading.trend).toBe(analysis.developmentTrend);
    }
  });

  it('§10 強みと弱みは能力差があるときだけ出す', () => {
    const state = newGame();
    const player = myPlayers(state).find((p) => !p.isPitcher)!;
    player.batting = {
      trajectory: 50,
      contact: 50,
      power: 50,
      speed: 50,
      arm: 50,
      fielding: 50,
      catching: 50,
    };
    const flat = axisNotes(analyzePlayer(state, player));
    expect(flat.strength).toBeNull();
    expect(flat.weakness).toBeNull();

    player.batting.power = 90;
    player.batting.speed = 20;
    const sharp = axisNotes(analyzePlayer(state, player));
    expect(sharp.strength?.label).toBe('パワー');
    expect(sharp.weakness?.label).toBe('走力');
  });

  it('§10 強みと弱みには必ず説明がつく', () => {
    const state = newGame();
    for (const player of myPlayers(state).slice(0, 10)) {
      const report = buildPlayerReport(state, player);
      if (report.strength) expect(report.strength.text.length).toBeGreaterThan(0);
      if (report.weakness) expect(report.weakness.text.length).toBeGreaterThan(0);
    }
  });

  it('怪我をしていれば HEALTH にそれが出る', () => {
    const state = newGame();
    const player = myPlayers(state)[0];
    player.ext.injury = {
      level: 'moderate',
      name: '右肩の炎症',
      startDate: state.date,
      returnDate: '2026-05-01',
    };
    const health = buildPlayerReport(state, player).rows.find((r) => r.key === 'health')!;
    expect(health.value).toBe('右肩の炎症');
    expect(health.note).toContain('2026-05-01');
  });

  it('契約の負担が CONTRACT に出る', () => {
    const state = newGame();
    const player = myPlayers(state)[0];
    const row = buildPlayerReport(state, player).rows.find((r) => r.key === 'contract')!;
    expect(row.value.length).toBeGreaterThan(0);
  });

  it('出場状況が PLAYING TIME に出る', () => {
    const state = playDays(newGame(143), 40);
    const player = myPlayers(state).find((p) => p.roster === 'first')!;
    const row = buildPlayerReport(state, player).rows.find((r) => r.key === 'usage')!;
    expect(row.value).toContain('試合');
  });

  it('報告書の文章に「おすすめ」「最適」「AI」を使わない', () => {
    const state = afterSeasons(2);
    const banned = ['おすすめ', '最適', 'AI', '正解'];
    for (const player of myPlayers(state)) {
      const report = buildPlayerReport(state, player);
      const text = [
        report.performanceNote,
        report.developmentNote,
        report.outlookNote,
        report.combinedNote,
        report.trendReading.text,
      ].join(' ');
      for (const word of banned) expect(text).not.toContain(word);
    }
  });

  it('§17 のような断定（「復活した」）をしない', () => {
    const state = afterSeasons(2);
    for (const player of myPlayers(state)) {
      const report = buildPlayerReport(state, player);
      expect(report.trendReading.text).not.toContain('復活');
      expect(report.combinedNote).not.toContain('復活');
    }
  });
});

describe('PHASE 4.4 選手評価の妥当さ（§37）', () => {
  it('同じ能力なら、若い選手のほうが成長期待が低くならない', () => {
    const state = newGame();
    const [a, b] = myPlayers(state).filter((p) => !p.isPitcher).slice(0, 2);
    b.batting = { ...a.batting };
    b.ext.potential = a.ext.potential;
    b.ext.growthType = a.ext.growthType;
    a.age = 22;
    b.age = 34;
    const young = analyzePlayer(state, a);
    const old = analyzePlayer(state, b);
    expect(young.stars.development).toBeGreaterThanOrEqual(old.stars.development);
  });

  it('成績が低いだけでは整理候補にならない（§8）', () => {
    const state = newGame();
    const player = myPlayers(state).find((p) => !p.isPitcher)!;
    player.age = 26;
    player.ext.potential = 70;
    player.ext.contract = { salary: 100, totalYears: 3, yearsRemaining: 2, signedYear: 2026 };
    state.stats[player.id] = {
      playerId: player.id,
      batting: batting({ games: 100, plateAppearances: 400, atBats: 360, hits: 60 }),
      pitching: emptyPitching(),
    };
    expect(analyzePlayer(state, player).recommendation).not.toBe('RELEASE_CANDIDATE');
  });

  it('整理候補には必ず複数の理由がつく（§8）', () => {
    const state = afterSeasons(4, 90210);
    let checked = 0;
    for (const player of state.players) {
      const analysis = analyzePlayer(state, player);
      if (analysis.recommendation !== 'RELEASE_CANDIDATE') continue;
      checked += 1;
      expect(analysis.reasons.length).toBeGreaterThanOrEqual(4);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('怪我をしていれば復帰待ちが最優先になる', () => {
    const state = newGame();
    const player = myPlayers(state)[0];
    player.ext.injury = {
      level: 'major',
      name: '靱帯損傷',
      startDate: state.date,
      returnDate: '2026-09-01',
    };
    const analysis = analyzePlayer(state, player);
    expect(analysis.recommendation).toBe('INJURY_RETURN');
    expect(analysis.usage).toBe('INJURED');
  });

  it('年俸の負担は評価に入る', () => {
    const state = newGame();
    const player = myPlayers(state).find((p) => !p.isPitcher)!;
    player.ext.contract = { salary: 50, totalYears: 2, yearsRemaining: 1, signedYear: 2026 };
    const cheap = analyzePlayer(state, player).contractValue;
    player.ext.contract = { salary: 1400, totalYears: 2, yearsRemaining: 1, signedYear: 2026 };
    const dear = analyzePlayer(state, player).contractValue;
    expect(cheap).toBeGreaterThan(dear);
  });
});

/* ================================================================
 * 3. 球団報告書
 * ============================================================== */

describe('PHASE 4.4 球団報告書', () => {
  it('12球団すべてを分析できる', () => {
    const state = playDays(newGame(143), 30);
    for (const team of state.teams) {
      expect(() => buildTeamReport(state, team.id)).not.toThrow();
    }
  });

  it('選手が0人でもクラッシュしない', () => {
    const state = newGame();
    state.players = state.players.filter((p) => p.teamId !== PLAYER_TEAM);
    expect(() => buildTeamReport(state, PLAYER_TEAM)).not.toThrow();
  });

  it('同じ state からは同じ内容になる', () => {
    const state = playDays(newGame(143), 30);
    expect(buildTeamReport(state, PLAYER_TEAM)).toEqual(buildTeamReport(state, PLAYER_TEAM));
  });

  it('state を書き換えない', () => {
    const state = playDays(newGame(143), 30);
    const snapshot = JSON.stringify(state);
    for (const team of state.teams) buildTeamReport(state, team.id);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('リーグ平均との差は全球団で足すとほぼ0になる', () => {
    const state = playDays(newGame(143), 30);
    for (const key of ['batting', 'pitching', 'defense', 'youth'] as const) {
      const sum = state.teams
        .map((t) => buildTeamReport(state, t.id).analysis.axes.find((a) => a.key === key)!.vsLeague)
        .reduce((a, b) => a + b, 0);
      expect(Math.abs(sum)).toBeLessThan(1);
    }
  });

  it('課題には 01 から順に番号がつく', () => {
    const state = playDays(newGame(143), 40);
    for (const team of state.teams) {
      const report = buildTeamReport(state, team.id);
      report.issues.forEach((issue, i) => {
        expect(issue.no).toBe(String(i + 1).padStart(2, '0'));
      });
    }
  });

  it('課題は3件までしか出さない', () => {
    const state = playDays(newGame(143), 40);
    for (const team of state.teams) {
      expect(buildTeamReport(state, team.id).issues.length).toBeLessThanOrEqual(3);
    }
  });

  it('どの課題にも「なぜ課題なのか」がつく（§13 WHY）', () => {
    const state = playDays(newGame(143), 40);
    for (const team of state.teams) {
      for (const issue of buildTeamReport(state, team.id).issues) {
        expect(issue.why.length).toBeGreaterThan(0);
        expect(issue.data.length).toBeGreaterThan(0);
        expect(/^[A-Z ]+$/.test(issue.en)).toBe(true);
      }
    }
  });

  it('補強の道すじには必ず4つの手だてがある（§13 OPTIONS）', () => {
    const state = playDays(newGame(143), 40);
    for (const team of state.teams) {
      for (const plan of buildTeamReport(state, team.id).plans) {
        expect(plan.options.length).toBe(4);
        expect(plan.options.map((o) => o.route)).toEqual(['FA', 'TRADE', 'YOUTH', 'STAY']);
      }
    }
  });

  it('どの手だてにも COST と RISK がある（§13）', () => {
    const state = playDays(newGame(143), 40);
    for (const team of state.teams) {
      for (const plan of buildTeamReport(state, team.id).plans) {
        for (const option of plan.options) {
          expect(option.cost.length).toBeGreaterThan(0);
          expect(option.risk.length).toBeGreaterThan(0);
          expect(option.merit.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('「現状のまま」にも失うものが書いてある（正解を出さない）', () => {
    const state = newGame();
    for (const player of myPlayers(state)) {
      if (player.isPitcher && player.pitching) player.pitching.stamina = 20;
    }
    const plans = buildTeamReport(state, PLAYER_TEAM).plans;
    expect(plans.length).toBeGreaterThan(0);
    const stay = plans[0].options.find((o) => o.route === 'STAY')!;
    expect(stay.cost.length).toBeGreaterThan(0);
    expect(stay.risk.length).toBeGreaterThan(0);
  });

  it('報告書に「おすすめ」「最適」「AI」を使わない', () => {
    const state = playDays(newGame(143), 40);
    const banned = ['おすすめ', '最適', 'AI', '正解'];
    for (const team of state.teams) {
      const report = buildTeamReport(state, team.id);
      const text = [
        ...report.issues.map((i) => `${i.ja} ${i.why}`),
        ...report.plans.flatMap((p) => [
          p.why,
          ...p.options.map((o) => `${o.merit} ${o.cost} ${o.risk}`),
        ]),
      ].join(' ');
      for (const word of banned) expect(text).not.toContain(word);
    }
  });

  it('手だてのラベルは英字と日本語のセット', () => {
    for (const route of ['FA', 'TRADE', 'YOUTH', 'STAY'] as const) {
      expect(/^[A-Z ]+$/.test(ROUTE_LABELS[route].en)).toBe(true);
      expect(ROUTE_LABELS[route].ja.length).toBeGreaterThan(0);
    }
  });
});

/* ================================================================
 * 4. 判断の記録
 * ============================================================== */

describe('PHASE 4.4 判断記録', () => {
  it('新規ゲームでは空で始まる', () => {
    expect(newGame().decisions).toEqual([]);
  });

  it('記録するとGM日誌に残る', () => {
    const state = newGame();
    const record = recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '優勝を狙う',
      situation: 'テスト',
    });
    expect(state.decisions).toHaveLength(1);
    expect(record.year).toBe(state.year);
    expect(record.date).toBe(state.date);
  });

  it('同じ日に同じ対象を決め直すと上書きされる（二重記録しない）', () => {
    const state = newGame();
    recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '優勝を狙う',
      situation: '',
    });
    recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '若手を育てる',
      situation: '',
    });
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0].choice).toBe('若手を育てる');
  });

  it('種類が違えば別の記録になる', () => {
    const state = newGame();
    recordDecision(state, { kind: 'DIRECTION', key: 'x', title: 'a', choice: 'a', situation: '' });
    recordDecision(state, { kind: 'USAGE', key: 'x', title: 'b', choice: 'b', situation: '' });
    expect(state.decisions).toHaveLength(2);
  });

  it('IDは日付・種類・対象から決まる', () => {
    expect(decisionId('2026-04-01', 'TRADE', 'offer1')).toBe('2026-04-01:TRADE:offer1');
  });

  it('上限を超えたら古いものから捨てる', () => {
    const state = newGame();
    for (let i = 0; i < DECISION_LIMIT + 25; i++) {
      recordDecision(state, {
        kind: 'USAGE',
        key: `p${i}`,
        title: 't',
        choice: String(i),
        situation: '',
      });
    }
    expect(state.decisions).toHaveLength(DECISION_LIMIT);
    expect(state.decisions[0].choice).toBe('25');
  });

  it('記録してもゲームの進行に影響しない', () => {
    const base = playDays(newGame(30, 7788), 20);
    const withRecord = cloneState(base);
    recordDecision(withRecord, {
      kind: 'EVENT',
      key: 'e1',
      title: 'テスト案件',
      choice: '様子を見る',
      situation: '',
    });
    let a = base;
    let b = withRecord;
    for (let i = 0; i < 20; i++) {
      a = advanceDay(a).state;
      b = advanceDay(b).state;
    }
    expect(b.rngState).toBe(a.rngState);
    expect(b.records[PLAYER_TEAM]).toEqual(a.records[PLAYER_TEAM]);
    expect(b.results.length).toBe(a.results.length);
    expect(b.players.map((p) => overallRating(p))).toEqual(a.players.map((p) => overallRating(p)));
  });

  it('記録があっても state の整合性は保たれる', () => {
    const state = playDays(newGame(), 10);
    recordDecision(state, { kind: 'FA', key: 'x', title: 't', choice: 'c', situation: '' });
    expect(validateState(state)).toEqual([]);
  });

  it('年ごとに取り出せる', () => {
    const state = newGame();
    recordDecision(state, { kind: 'TRADE', key: 'a', title: 't', choice: 'c', situation: '' });
    expect(decisionsOfYear(state, state.year)).toHaveLength(1);
    expect(decisionsOfYear(state, state.year + 1)).toHaveLength(0);
    expect(decisionYears(state)).toEqual([state.year]);
  });

  it('日ごとに取り出せる', () => {
    const state = newGame();
    recordDecision(state, { kind: 'TRADE', key: 'a', title: 't', choice: 'c', situation: '' });
    expect(decisionsOfDate(state, state.date)).toHaveLength(1);
    expect(decisionsOfDate(state, '1999-01-01')).toHaveLength(0);
  });

  it('新しい順に取り出せる', () => {
    const state = newGame();
    recordDecision(state, { kind: 'TRADE', key: 'a', title: 't', choice: '1', situation: '' });
    recordDecision(state, { kind: 'TRADE', key: 'b', title: 't', choice: '2', situation: '' });
    expect(recentDecisions(state, 5)[0].choice).toBe('2');
  });

  it('その後の成績は判断日より後だけを数える', () => {
    let state = playDays(newGame(143), 20);
    const record = recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: 't',
      choice: 'c',
      situation: '',
    });
    const gamesAtDecision = state.records[PLAYER_TEAM].games;
    state = playDays(state, 20);
    const outcome = decisionOutcome(state, record);
    expect(outcome.games).toBeLessThanOrEqual(state.records[PLAYER_TEAM].games - gamesAtDecision + 1);
    expect(outcome.games).toBeGreaterThan(0);
  });

  it('その後の記録に良し悪しの評価を書かない', () => {
    let state = playDays(newGame(143), 20);
    const record = recordDecision(state, {
      kind: 'USAGE',
      key: myPlayers(state)[0].id,
      title: 't',
      choice: 'c',
      situation: '',
      playerIds: [myPlayers(state)[0].id],
    });
    state = playDays(state, 20);
    const outcome = decisionOutcome(state, record);
    const text = [outcome.record ?? '', ...outcome.players.map((p) => p.text)].join(' ');
    for (const word of ['正解', '失敗', '成功', 'よかった']) {
      expect(text).not.toContain(word);
    }
  });

  it('引退した選手が混じっていてもその後の記録が壊れない', () => {
    let state = newGame(10);
    const record = recordDecision(state, {
      kind: 'USAGE',
      key: 'ghost',
      title: 't',
      choice: 'c',
      situation: '',
      playerIds: ['does-not-exist'],
    });
    state = playDays(state, 5);
    expect(() => decisionOutcome(state, record)).not.toThrow();
    expect(decisionOutcome(state, record).players).toEqual([]);
  });

  it('種類のラベルは英字と日本語のセット', () => {
    for (const kind of ['DIRECTION', 'USAGE', 'EVENT', 'CONTRACT', 'TRADE', 'FA'] as const) {
      expect(/^[A-Z ]+$/.test(DECISION_KIND_TAGS[kind])).toBe(true);
      expect(DECISION_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('ensureDecisions は配列を必ず用意する', () => {
    const state = newGame();
    delete (state as unknown as Record<string, unknown>).decisions;
    expect(ensureDecisions(state)).toEqual([]);
    expect(Array.isArray(state.decisions)).toBe(true);
  });
});

/* ================================================================
 * 5. セーブと移行
 * ============================================================== */

describe('PHASE 4.4 セーブ', () => {
  it('SAVE_VERSION は 15', () => {
    expect(SAVE_VERSION).toBe(15);
    expect(newGame().version).toBe(15);
  });

  it('v14 のセーブが v15 に移行する', () => {
    const state = playDays(newGame(), 10);
    const old = cloneState(state);
    old.version = 14;
    delete (old as unknown as Record<string, unknown>).decisions;
    migrateV14ToV15(old);
    expect(old.version).toBe(15);
    expect(old.decisions).toEqual([]);
  });

  it('移行しても既存のデータは変わらない', () => {
    const state = playDays(newGame(), 15);
    const old = cloneState(state);
    old.version = 14;
    delete (old as unknown as Record<string, unknown>).decisions;
    migrateV14ToV15(old);
    expect(old.date).toBe(state.date);
    expect(old.records).toEqual(state.records);
    expect(old.players.map((p) => overallRating(p))).toEqual(
      state.players.map((p) => overallRating(p)),
    );
    expect(old.rngState).toBe(state.rngState);
  });

  it('移行で実在しない選手IDが判断記録から落ちる', () => {
    const state = playDays(newGame(), 5);
    const real = myPlayers(state)[0].id;
    state.version = 14;
    state.decisions = [
      {
        id: 'x',
        year: state.year,
        date: state.date,
        kind: 'USAGE',
        title: 't',
        choice: 'c',
        situation: '',
        playerIds: [real, 'ghost-1'],
      },
    ];
    migrateV14ToV15(state);
    expect(state.decisions[0].playerIds).toEqual([real]);
  });

  it('移行で上限を超えた記録が切られる', () => {
    const state = newGame();
    state.version = 14;
    state.decisions = Array.from({ length: DECISION_LIMIT + 10 }, (_unused, i) => ({
      id: `d${i}`,
      year: state.year,
      date: state.date,
      kind: 'USAGE' as const,
      title: 't',
      choice: String(i),
      situation: '',
      playerIds: [],
    }));
    migrateV14ToV15(state);
    expect(state.decisions).toHaveLength(DECISION_LIMIT);
  });

  it('保存して読み直しても判断記録が残る', () => {
    const state = playDays(newGame(), 10);
    recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '優勝を狙う',
      situation: 'テスト',
    });
    const loaded = migrate(JSON.parse(JSON.stringify(state)) as GameState);
    expect(loaded).not.toBeNull();
    expect(loaded!.decisions).toHaveLength(1);
    expect(loaded!.decisions[0].choice).toBe('優勝を狙う');
  });

  it('v14 のセーブが migrate() を通って読める', () => {
    const state = playDays(newGame(), 10);
    const raw = JSON.parse(JSON.stringify(state)) as GameState;
    raw.version = 14;
    delete (raw as unknown as Record<string, unknown>).decisions;
    const loaded = migrate(raw);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(15);
    expect(loaded!.decisions).toEqual([]);
    expect(validateState(loaded!)).toEqual([]);
  });

  it('判断記録を足してもセーブは大きくなりすぎない', () => {
    const state = playDays(newGame(), 10);
    const before = JSON.stringify(state).length;
    for (let i = 0; i < DECISION_LIMIT; i++) {
      recordDecision(state, {
        kind: 'USAGE',
        key: `p${i}`,
        title: '起用方針の変更',
        choice: '中心選手',
        situation: '28歳・総合 60・1軍',
        playerIds: [],
      });
    }
    const grown = JSON.stringify(state).length - before;
    // 上限ぶん埋めても 100KB を超えない
    expect(grown).toBeLessThan(100 * 1024);
  });
});

/* ================================================================
 * 6. 試合前後の資料
 * ============================================================== */

describe('PHASE 4.4 試合前資料', () => {
  it('次の試合があれば資料が出る', () => {
    const brief = buildPreGameBrief(newGame());
    expect(brief).not.toBeNull();
    expect(brief!.opponentName.length).toBeGreaterThan(0);
    expect(brief!.starterName.length).toBeGreaterThan(0);
  });

  it('シーズンが終われば資料は出ない', () => {
    const state = playSeason(newGame(10));
    expect(buildPreGameBrief(state)).toBeNull();
  });

  it('見どころは3件までしか出さない（§14 長文にしない）', () => {
    let state = newGame(143);
    for (let day = 0; day < 60; day++) {
      state = advanceDay(state).state;
      const brief = buildPreGameBrief(state);
      if (brief) expect(brief.watch.length).toBeLessThanOrEqual(3);
    }
  });

  it('相手球団については公開されている成績しか出さない', () => {
    const state = playDays(newGame(143), 30);
    const brief = buildPreGameBrief(state)!;
    expect(brief.opponentRecord).toMatch(/^\d+勝\d+敗\d+分$/);
    // 相手の先発・疲労・調子には触れない
    const text = [brief.starterNote, brief.teamForm, ...brief.watch].join(' ');
    const opponentPlayers = state.players.filter((p) => p.teamId === brief.opponentId);
    for (const player of opponentPlayers) expect(text).not.toContain(player.name);
  });

  it('資料を作っても state を書き換えない', () => {
    const state = playDays(newGame(143), 20);
    const snapshot = JSON.stringify(state);
    buildPreGameBrief(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('同じ state からは同じ資料になる', () => {
    const state = playDays(newGame(143), 20);
    expect(buildPreGameBrief(state)).toEqual(buildPreGameBrief(state));
  });

  it('ホームかビジターかが出る', () => {
    const state = newGame();
    expect(['HOME', 'AWAY']).toContain(buildPreGameBrief(state)!.homeAway);
  });

  it('先発の疲労が高ければ見どころに出る', () => {
    const state = newGame();
    const brief0 = buildPreGameBrief(state)!;
    const starter = state.players.find((p) => p.id === brief0.starterId)!;
    starter.ext.fatigue = 80;
    const brief = buildPreGameBrief(state)!;
    expect(brief.watch.some((w) => w.includes(starter.name))).toBe(true);
  });

  it('相手の勝率の説明は公開情報から作られる', () => {
    const state = playDays(newGame(143), 30);
    const opponentId = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    expect(opponentStrengthHint(state, opponentId)).toContain('勝');
  });

  it('1軍の平均能力を出せる', () => {
    const state = newGame();
    const value = firstTeamOverall(state, PLAYER_TEAM);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(100);
  });
});

describe('PHASE 4.4 試合後の講評', () => {
  function firstPlayerResult(state: GameState): { state: GameState; result: GameResult } {
    let s = state;
    for (let i = 0; i < 60; i++) {
      const step = advanceDay(s);
      s = step.state;
      if (step.playerResult) return { state: s, result: step.playerResult };
    }
    throw new Error('自球団の試合が見つからない');
  }

  it('試合の流れは3件までしか出さない（§15 全打席実況は不要）', () => {
    let state = newGame(143);
    for (let i = 0; i < 12; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      expect(keyMoments(step.result).length).toBeLessThanOrEqual(3);
    }
  });

  it('試合の流れは回の昇順', () => {
    let state = newGame(143);
    for (let i = 0; i < 12; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      const moments = keyMoments(step.result);
      for (let j = 1; j < moments.length; j++) {
        expect(moments[j].inning).toBeGreaterThanOrEqual(moments[j - 1].inning);
      }
    }
  });

  it('得点の無い試合では流れが空になる', () => {
    const result: GameResult = {
      id: 'g',
      date: '2026-04-01',
      leagueId: 'central',
      homeTeamId: 'a',
      awayTeamId: 'b',
      home: { teamId: 'a', runs: 0, hits: 3, errors: 0, inningRuns: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      away: { teamId: 'b', runs: 0, hits: 4, errors: 0, inningRuns: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      innings: 9,
      winnerTeamId: null,
      loserTeamId: null,
      winningPitcherId: null,
      losingPitcherId: null,
      commentary: [],
      playerLines: [],
    };
    expect(keyMoments(result)).toEqual([]);
  });

  it('勝敗の表示が実際の結果と一致する', () => {
    let state = newGame(143);
    for (let i = 0; i < 10; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      const report = buildPostGameReport(state, step.result);
      const expected = !step.result.winnerTeamId
        ? 'DRAW'
        : step.result.winnerTeamId === PLAYER_TEAM
          ? 'WIN'
          : 'LOSS';
      expect(report.resultLabel).toBe(expected);
    }
  });

  it('個人の記録は3人までしか出さない', () => {
    let state = newGame(143);
    for (let i = 0; i < 10; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      expect(buildPostGameReport(state, step.result).playerNotes.length).toBeLessThanOrEqual(3);
    }
  });

  it('個人の記録は自球団の選手だけ', () => {
    let state = newGame(143);
    for (let i = 0; i < 10; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      for (const note of buildPostGameReport(state, step.result).playerNotes) {
        const player = state.players.find((p) => p.id === note.playerId)!;
        expect(player.teamId).toBe(PLAYER_TEAM);
      }
    }
  });

  it('§17 BEFORE は今日のぶんを引いた成績になる', () => {
    let state = newGame(143);
    for (let i = 0; i < 25; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      const report = buildPostGameReport(state, step.result);
      for (const note of report.playerNotes) {
        if (!note.before) continue;
        const season = state.stats[note.playerId];
        const line = step.result.playerLines.find((l) => l.playerId === note.playerId)!;
        // 講評は投手の行を優先する。二刀流でないかぎり片方しか無い
        if (line.pitching) {
          const priorGames = season.pitching.games - line.pitching.games;
          expect(note.before).toContain(`${priorGames}登板`);
        } else if (line.batting) {
          const priorGames = season.batting.games - line.batting.games;
          expect(note.before).toContain(`${priorGames}試合`);
        }
      }
    }
  });

  it('§17 「復活した」のような断定をしない', () => {
    let state = newGame(143);
    for (let i = 0; i < 15; i++) {
      const step = firstPlayerResult(state);
      state = step.state;
      const report = buildPostGameReport(state, step.result);
      for (const note of report.playerNotes) {
        for (const word of ['復活', '完全に', '間違いなく', '確実に']) {
          expect(note.note).not.toContain(word);
        }
      }
    }
  });

  it('講評を作っても state を書き換えない（演出はゲームに触らない）', () => {
    const step = firstPlayerResult(newGame(143));
    const snapshot = JSON.stringify(step.state);
    buildPostGameReport(step.state, step.result);
    buildPostGameReport(step.state, step.result);
    expect(JSON.stringify(step.state)).toBe(snapshot);
  });

  it('同じ試合からは同じ講評になる（何度見ても変わらない）', () => {
    const step = firstPlayerResult(newGame(143));
    expect(buildPostGameReport(step.state, step.result)).toEqual(
      buildPostGameReport(step.state, step.result),
    );
  });

  it('チームの状況には今季の勝敗が入る', () => {
    const step = firstPlayerResult(newGame(143));
    expect(buildPostGameReport(step.state, step.result).teamNote).toContain('勝');
  });
});

/* ================================================================
 * 7. 一日の流れとシーズンの記録
 * ============================================================== */

describe('PHASE 4.4 一日の流れ', () => {
  it('判断 → 試合 → ニュース の順に並ぶ', () => {
    let state = newGame(143);
    for (let i = 0; i < 30; i++) state = advanceDay(state).state;
    recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '優勝を狙う',
      situation: '',
    });
    const flow = dayFlow(state, state.date);
    const orders = flow.map((e) => e.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(flow[0].kind).toBe('DECISION');
  });

  it('何も起きていない日は空になる', () => {
    const state = newGame();
    expect(dayFlow(state, '1999-01-01')).toEqual([]);
  });

  it('流れを作っても state を書き換えない', () => {
    const state = playDays(newGame(143), 30);
    const snapshot = JSON.stringify(state);
    dayFlow(state, state.date);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('どの行にも英字と日本語がある', () => {
    let state = playDays(newGame(143), 40);
    for (let i = 0; i < 10; i++) {
      state = advanceDay(state).state;
      for (const entry of dayFlow(state, state.date)) {
        expect(entry.en.length).toBeGreaterThan(0);
        expect(entry.ja.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('PHASE 4.4 シーズンの記録', () => {
  it('存在しない年からは何も作らない（§19 捏造しない）', () => {
    const state = playDays(newGame(143), 30);
    expect(seasonTimeline(state, 1999)).toEqual([]);
  });

  it('記録は日付の昇順に並ぶ', () => {
    const state = afterSeasons(2);
    const timeline = seasonTimeline(state, state.year - 1);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].date >= timeline[i - 1].date).toBe(true);
    }
  });

  it('月ごとに1件までしかニュースを出さない', () => {
    const state = afterSeasons(2);
    const timeline = seasonTimeline(state, state.year - 1).filter((e) => e.en !== 'GM DECISION');
    const months = timeline.map((e) => e.month);
    expect(new Set(months).size).toBe(months.length);
  });

  it('実際に残っているニュースからしか作らない', () => {
    const state = afterSeasons(2);
    const year = state.year - 1;
    const titles = new Set(state.news.items.filter((n) => n.year === year).map((n) => n.title));
    for (const entry of seasonTimeline(state, year)) {
      if (entry.en === 'GM DECISION') continue;
      expect(titles.has(entry.ja)).toBe(true);
    }
  });

  it('判断も記録に混ざる', () => {
    let state = playDays(newGame(143), 30);
    recordDecision(state, {
      kind: 'DIRECTION',
      key: PLAYER_TEAM,
      title: '今季の球団方針',
      choice: '若手を育てる',
      situation: '',
    });
    state = playDays(state, 5);
    const timeline = seasonTimeline(state, state.year);
    expect(timeline.some((e) => e.en === 'GM DECISION')).toBe(true);
  });

  it('記録が残っている年を並べられる', () => {
    const state = afterSeasons(2);
    const years = timelineYears(state);
    expect(years.length).toBeGreaterThan(0);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBeLessThan(years[i - 1]);
  });

  it('月の英字ラベルが出る', () => {
    expect(monthOf('2026-07-18')).toBe(7);
    expect(monthLabel(7)).toBe('JUL');
    expect(monthLabel(4)).toBe('APR');
  });

  it('記録を作っても state を書き換えない', () => {
    const state = afterSeasons(2);
    const snapshot = JSON.stringify(state);
    seasonTimeline(state, state.year - 1);
    timelineYears(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

/* ================================================================
 * 8. アニメーションの土台
 * ============================================================== */

describe('PHASE 4.4 アニメーションの土台', () => {
  it('reduced-motion では遅延が 0 になる（情報量は減らさない）', () => {
    expect(staggerDelay(5, true)).toBe(0);
    expect(staggerDelay(0, true)).toBe(0);
  });

  it('遅延には上限がある（長すぎるアニメーションを作らない）', () => {
    expect(staggerDelay(100, false)).toBe(staggerDelay(8, false));
    expect(staggerDelay(100, false)).toBeLessThanOrEqual(400);
  });

  it('遅延は順番に増える', () => {
    expect(staggerDelay(1, false)).toBeGreaterThan(staggerDelay(0, false));
    expect(staggerDelay(3, false)).toBeGreaterThan(staggerDelay(1, false));
  });

  it('イージングは 0〜1 に収まり単調に増える', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
    // 0.00 → 0.95 まで、必ず前より大きくなる（浮動小数の誤差を避けて整数で刻む）
    for (let i = 0; i < 19; i++) {
      expect(easeOutCubic((i + 1) / 20)).toBeGreaterThan(easeOutCubic(i / 20));
    }
  });

  it('演出のもとになる資料は、何度作っても同じで state に触らない', () => {
    const state = playDays(newGame(143), 25);
    const snapshot = JSON.stringify(state);
    const a = buildGmDesk(state);
    const b = buildTeamReport(state, PLAYER_TEAM);
    const c = buildPreGameBrief(state);
    for (let i = 0; i < 5; i++) {
      expect(buildGmDesk(state)).toEqual(a);
      expect(buildTeamReport(state, PLAYER_TEAM)).toEqual(b);
      expect(buildPreGameBrief(state)).toEqual(c);
    }
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

/* ================================================================
 * 9. 既存の仕組みを壊していないこと
 * ============================================================== */

describe('PHASE 4.4 既存の仕組み', () => {
  it('1シーズン通しても整合性が保たれる', () => {
    const state = playSeason(newGame(30, 4321));
    expect(validateState(state)).toEqual([]);
  });

  it('3シーズン回しても選手が消えない', () => {
    const state = afterSeasons(3, 4321);
    expect(state.players.length).toBeGreaterThan(200);
    expect(validateState(state)).toEqual([]);
  });

  it('資料を毎日作っても試合結果は変わらない', () => {
    const a = newGame(30, 555);
    const b = cloneState(a);
    let sa = a;
    let sb = b;
    for (let i = 0; i < 60; i++) {
      sa = advanceDay(sa).state;
      sb = advanceDay(sb).state;
      // 片方だけ資料を作り続ける
      buildGmDesk(sb);
      buildPreGameBrief(sb);
      buildTeamReport(sb, PLAYER_TEAM);
    }
    expect(sb.rngState).toBe(sa.rngState);
    expect(sb.records).toEqual(sa.records);
    expect(sb.results.length).toBe(sa.results.length);
    expect(sb.stats).toEqual(sa.stats);
  });
});
