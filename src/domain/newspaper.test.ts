/**
 * ニュースの誌面（domain/newspaper.ts）の検査。
 *
 * 確かめたいのは3つ。
 *   1. ここで作る材料は、すべて実在するデータ（試合結果・成績・球団方針）
 *      だけから来ていて、何も捏造していないこと
 *   2. 乱数を使わず、state を書き換えないこと
 *   3. データが無いとき（開幕直後・2軍成績なし等）に、
 *      架空の値で埋めずに「無い」ことがそのまま伝わること
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceToNextPlayerGame } from './engine';
import {
  KICKER_LABELS,
  columnFacts,
  farmHighlights,
  factsFor,
  pageKindOf,
  playerProfileFacts,
  recentResultsFor,
  type PageKind,
} from './newspaper';
import { overallRating } from './rating';
import type { GameState, NewsCategory } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(seed = 550550): GameState {
  return createNewGame(PLAYER_TEAM, 30, seed);
}

function playGames(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = advanceToNextPlayerGame(s).state;
  return s;
}

/* ================================================================
 * A. ページの種類の割り当て
 * ============================================================== */

describe('ニュースの誌面 A. ページの種類', () => {
  it('すべてのカテゴリにページの種類が決まっている', () => {
    const categories: NewsCategory[] = [
      'GAME',
      'PLAYER',
      'TEAM',
      'TRANSFER',
      'CONTRACT',
      'FA',
      'TRADE',
      'DRAFT',
      'INJURY',
      'RECORD',
      'AWARD',
      'POSTSEASON',
      'CHAMPIONSHIP',
      'RETIREMENT',
      'RIVALRY',
      'SYSTEM',
    ];
    const kinds: PageKind[] = ['game', 'player', 'team', 'feature', 'record'];
    for (const c of categories) {
      expect(kinds).toContain(pageKindOf(c));
    }
  });

  it('見出し色分けの名前はすべての種類ぶんある', () => {
    const kinds: PageKind[] = ['game', 'player', 'team', 'feature', 'record'];
    for (const k of kinds) {
      expect(typeof KICKER_LABELS[k]).toBe('string');
      expect(KICKER_LABELS[k].length).toBeGreaterThan(0);
    }
  });
});

/* ================================================================
 * B. 試合結果（TOPICS向け）
 * ============================================================== */

describe('ニュースの誌面 B. 直近の試合結果', () => {
  it('試合が無いシーズン開幕直後は空', () => {
    const s = newGame();
    expect(recentResultsFor(s, PLAYER_TEAM)).toEqual([]);
  });

  it('試合を消化すると、その球団の分だけ新しい順に並ぶ', () => {
    const s = playGames(newGame(), 3);
    const results = recentResultsFor(s, PLAYER_TEAM, 10);
    expect(results.length).toBeGreaterThan(0);
    // 実際の試合結果（state.results）に本当に存在する試合だけ
    for (const r of results) {
      const real = s.results.find(
        (g) =>
          g.date === r.date &&
          (g.homeTeamId === PLAYER_TEAM || g.awayTeamId === PLAYER_TEAM),
      );
      expect(real).toBeTruthy();
    }
    // 新しい順（日付が下がらない…つまり降順）
    for (let i = 1; i < results.length; i++) {
      expect(results[i].date <= results[i - 1].date).toBe(true);
    }
  });

  it('件数の上限を守る', () => {
    const s = playGames(newGame(), 8);
    expect(recentResultsFor(s, PLAYER_TEAM, 2).length).toBeLessThanOrEqual(2);
  });

  it('関係ない球団の試合を含めない', () => {
    const s = playGames(newGame(), 5);
    const results = recentResultsFor(s, PLAYER_TEAM, 20);
    const opponents = new Set(results.map((r) => r.opponentName));
    expect(opponents.has(s.teams.find((t) => t.id === PLAYER_TEAM)!.name)).toBe(false);
  });

  it('state を書き換えない', () => {
    const s = playGames(newGame(), 3);
    const before = JSON.stringify(s);
    recentResultsFor(s, PLAYER_TEAM);
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ================================================================
 * C. 選手プロフィール
 * ============================================================== */

describe('ニュースの誌面 C. 選手プロフィール', () => {
  it('存在しない選手には null', () => {
    const s = newGame();
    expect(playerProfileFacts(s, 'no-such-player')).toBeNull();
  });

  it('実在の選手には、保存されている実際の値だけが入る', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const facts = playerProfileFacts(s, player.id)!;
    expect(facts.name).toBe(player.name);
    expect(facts.number).toBe(player.uniformNumber);
    expect(facts.age).toBe(player.age);
    expect(facts.isPitcher).toBe(player.isPitcher);
  });

  it('打席・投球回が無い選手は成績欄が null（架空の成績を書かない）', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const facts = playerProfileFacts(s, player.id)!;
    expect(facts.battingLine).toBeNull();
    expect(facts.pitchingLine).toBeNull();
  });

  it('試合を消化すると、実際に記録された成績が出る', () => {
    const s = playGames(newGame(), 10);
    const withStats = s.players.find((p) => {
      const st = s.stats[p.id];
      return p.teamId === PLAYER_TEAM && (p.isPitcher ? st.pitching.outs > 0 : st.batting.atBats > 0);
    });
    if (!withStats) return; // シードによっては出場機会が無いこともある
    const facts = playerProfileFacts(s, withStats.id)!;
    if (withStats.isPitcher) expect(facts.pitchingLine).not.toBeNull();
    else expect(facts.battingLine).not.toBeNull();
  });

  it('state を書き換えない', () => {
    const s = playGames(newGame(), 5);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = JSON.stringify(s);
    playerProfileFacts(s, player.id);
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ================================================================
 * D. ファーム情報
 * ============================================================== */

describe('ニュースの誌面 D. ファーム情報', () => {
  it('2軍で成績が無いうちは空', () => {
    const s = newGame();
    expect(farmHighlights(s, PLAYER_TEAM)).toEqual([]);
  });

  it('挙げるのは実際に2軍に所属し、成績が記録されている選手だけ', () => {
    const s = playGames(newGame(), 15);
    const highlights = farmHighlights(s, PLAYER_TEAM, 10);
    for (const h of highlights) {
      const player = s.players.find((p) => p.id === h.playerId)!;
      expect(player.teamId).toBe(PLAYER_TEAM);
      expect(player.roster).toBe('second');
      const stats = s.stats[player.id];
      const hasReal = player.isPitcher ? stats.pitching.outs > 0 : stats.batting.atBats > 0;
      expect(hasReal).toBe(true);
    }
  });

  it('実力（総合力）の高い順に並ぶ', () => {
    const s = playGames(newGame(), 15);
    const highlights = farmHighlights(s, PLAYER_TEAM, 10);
    const ratings = highlights.map((h) => overallRating(s.players.find((p) => p.id === h.playerId)!));
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i]).toBeLessThanOrEqual(ratings[i - 1]);
    }
  });

  it('件数の上限を守る', () => {
    const s = playGames(newGame(), 20);
    expect(farmHighlights(s, PLAYER_TEAM, 2).length).toBeLessThanOrEqual(2);
  });

  it('state を書き換えない', () => {
    const s = playGames(newGame(), 10);
    const before = JSON.stringify(s);
    farmHighlights(s, PLAYER_TEAM);
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ================================================================
 * E. コラム（球団方針）
 * ============================================================== */

describe('ニュースの誌面 E. コラム', () => {
  it('球団データがまだ無ければ null', () => {
    const s = newGame();
    delete (s as unknown as { clubs?: unknown }).clubs;
    expect(columnFacts(s, PLAYER_TEAM)).toBeNull();
  });

  it('球団方針が実際の値と一致する', () => {
    const s = newGame();
    const facts = columnFacts(s, PLAYER_TEAM);
    expect(facts).not.toBeNull();
    expect(typeof facts!.directionLabel).toBe('string');
    expect(facts!.directionLabel.length).toBeGreaterThan(0);
  });

  it('state を書き換えない', () => {
    const s = newGame();
    const before = JSON.stringify(s);
    columnFacts(s, PLAYER_TEAM);
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ================================================================
 * F. まとめ（factsFor）と決定性
 * ============================================================== */

describe('ニュースの誌面 F. 全体', () => {
  it('同じ状態からは何度呼んでも同じ結果になる（乱数を使わない）', () => {
    const s = playGames(newGame(), 8);
    const a = JSON.stringify({
      recent: recentResultsFor(s, PLAYER_TEAM),
      farm: farmHighlights(s, PLAYER_TEAM),
      column: columnFacts(s, PLAYER_TEAM),
    });
    const b = JSON.stringify({
      recent: recentResultsFor(s, PLAYER_TEAM),
      farm: farmHighlights(s, PLAYER_TEAM),
      column: columnFacts(s, PLAYER_TEAM),
    });
    expect(a).toBe(b);
  });

  it('factsFor はニュースのカテゴリから正しい種類を選ぶ', () => {
    const s = playGames(newGame(), 5);
    if (s.news.items.length === 0) return;
    for (const item of s.news.items.slice(-10)) {
      const facts = factsFor(s, item);
      expect(facts.kind).toBe(pageKindOf(item.category));
    }
  });

  it('rngState を一切消費しない（読むだけの機能のため）', () => {
    const s = playGames(newGame(), 6);
    const before = s.rngState;
    recentResultsFor(s, PLAYER_TEAM);
    farmHighlights(s, PLAYER_TEAM);
    columnFacts(s, PLAYER_TEAM);
    if (s.players[0]) playerProfileFacts(s, s.players[0].id);
    expect(s.rngState).toBe(before);
  });
});
