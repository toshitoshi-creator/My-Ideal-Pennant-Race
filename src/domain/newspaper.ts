/**
 * ニュースの「誌面」表示（新聞紙面ふうの1ページ）。
 *
 * ここでやるのは「既存のニュース・成績・球団情報を、1ページぶんの
 * 材料として並べ替えるだけ」。新しい事実は一切作らない。
 *   - 乱数を使わない
 *   - ゲームの結果・能力・成績には一切触れない（読むだけ）
 *   - 存在しないデータ（出身地・ドラフト順位など、保存していない項目）は
 *     捏造せず、単に出さない
 */
import type { GameState, NewsCategory, NewsItem } from './types';
import { POSITION_LABELS } from './positions';
import { average, era, formatAverage, formatInnings } from './stats';
import { overallRating } from './rating';
import { DIRECTION_LABELS, objectiveText } from './club';
import { decisionsOfYear } from './decisions';

/** ページの見せ方の種類。カテゴリごとに置く材料が変わる */
export type PageKind = 'game' | 'player' | 'team' | 'feature' | 'record';

/** 見出しの上に付く小さな分類（紙面の「アイキャッチ」） */
export const KICKER_LABELS: Record<PageKind, string> = {
  game: 'TOPICS',
  player: '選手特集',
  team: 'チーム情報',
  feature: '特集',
  record: '記録',
};

const CATEGORY_TO_KIND: Record<NewsCategory, PageKind> = {
  GAME: 'game',
  PLAYER: 'player',
  TEAM: 'team',
  TRANSFER: 'team',
  CONTRACT: 'team',
  FA: 'team',
  TRADE: 'team',
  DRAFT: 'player',
  INJURY: 'player',
  RECORD: 'record',
  AWARD: 'record',
  POSTSEASON: 'feature',
  CHAMPIONSHIP: 'feature',
  RETIREMENT: 'player',
  RIVALRY: 'feature',
  SYSTEM: 'team',
};

export function pageKindOf(category: NewsCategory): PageKind {
  return CATEGORY_TO_KIND[category];
}

function teamNameOf(state: GameState, teamId: string | null | undefined): string | null {
  if (!teamId) return null;
  return state.teams.find((t) => t.id === teamId)?.name ?? null;
}

/* ---------------- 試合結果（TOPICS向け） ---------------- */

export interface RecentResult {
  date: string;
  opponentName: string;
  home: boolean;
  runsFor: number;
  runsAgainst: number;
  outcome: 'W' | 'L' | 'D';
}

/**
 * 指定した球団の、直近の試合結果（今シーズンぶん、新しい順）。
 * state.results は現在のシーズンぶんしか持たないので、
 * シーズン開幕直後は空になる（過去シーズンの結果を混ぜて捏造しない）。
 */
export function recentResultsFor(state: GameState, teamId: string, limit = 3): RecentResult[] {
  const out: RecentResult[] = [];
  for (let i = state.results.length - 1; i >= 0 && out.length < limit; i--) {
    const r = state.results[i];
    if (r.homeTeamId !== teamId && r.awayTeamId !== teamId) continue;
    const home = r.homeTeamId === teamId;
    const runsFor = home ? r.home.runs : r.away.runs;
    const runsAgainst = home ? r.away.runs : r.home.runs;
    const opponentId = home ? r.awayTeamId : r.homeTeamId;
    const outcome: RecentResult['outcome'] =
      r.winnerTeamId === null ? 'D' : r.winnerTeamId === teamId ? 'W' : 'L';
    out.push({
      date: r.date,
      opponentName: teamNameOf(state, opponentId) ?? '相手',
      home,
      runsFor,
      runsAgainst,
      outcome,
    });
  }
  return out;
}

/* ---------------- 選手プロフィール（選手特集向け） ---------------- */

export interface PlayerProfileFacts {
  name: string;
  number: number;
  age: number;
  positionLabel: string;
  isPitcher: boolean;
  /** 打者としての今季成績（投手は打席が少ないため出さない） */
  battingLine: string | null;
  /** 投手としての今季成績 */
  pitchingLine: string | null;
}

/** 保存されている実際の成績・プロフィールだけを使う（架空の出身地・経歴は作らない） */
export function playerProfileFacts(state: GameState, playerId: string): PlayerProfileFacts | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;
  const stats = state.stats[playerId];
  const battingLine =
    !player.isPitcher && stats && stats.batting.atBats > 0
      ? `${formatAverage(average(stats.batting))} ${stats.batting.homeRuns}本 ${stats.batting.rbi}打点`
      : null;
  const pitchingLine =
    player.isPitcher && stats && stats.pitching.outs > 0
      ? `${stats.pitching.wins}勝${stats.pitching.losses}敗 防御率${era(stats.pitching).toFixed(2)} ${formatInnings(stats.pitching.outs)}回`
      : null;
  return {
    name: player.name,
    number: player.uniformNumber,
    age: player.age,
    positionLabel: player.isPitcher ? '投手' : POSITION_LABELS[player.mainPosition],
    isPitcher: player.isPitcher,
    battingLine,
    pitchingLine,
  };
}

/* ---------------- ファーム情報（2軍ページ） ---------------- */

export interface FarmHighlight {
  playerId: string;
  name: string;
  positionLabel: string;
  battingLine: string | null;
  pitchingLine: string | null;
}

/**
 * 2軍で実際に成績を残している選手を実力順（総合力）に並べる。
 * 「今日抜擢された」等の演出は付けない（起きていないことを書かない）。
 */
export function farmHighlights(state: GameState, teamId: string, limit = 4): FarmHighlight[] {
  const roster = state.players.filter((p) => p.teamId === teamId && p.roster === 'second');
  const withStats = roster.filter((p) => {
    const s = state.stats[p.id];
    if (!s) return false;
    return p.isPitcher ? s.pitching.outs > 0 : s.batting.atBats > 0;
  });
  const sorted = [...withStats].sort((a, b) => overallRating(b) - overallRating(a));
  return sorted.slice(0, limit).map((p) => {
    const stats = state.stats[p.id];
    return {
      playerId: p.id,
      name: p.name,
      positionLabel: p.isPitcher ? '投手' : POSITION_LABELS[p.mainPosition],
      battingLine:
        !p.isPitcher && stats.batting.atBats > 0
          ? `${formatAverage(average(stats.batting))} ${stats.batting.homeRuns}本`
          : null,
      pitchingLine:
        p.isPitcher && stats.pitching.outs > 0
          ? `${stats.pitching.wins}勝${stats.pitching.losses}敗 防御率${era(stats.pitching).toFixed(2)}`
          : null,
    };
  });
}

/* ---------------- コラム（監督のひとこと相当） ---------------- */

export interface ColumnFacts {
  directionLabel: string;
  objectiveLine: string | null;
  /** 直近の判断記録（GM日誌）から1件。無ければ null */
  latestDecisionTitle: string | null;
  latestDecisionChoice: string | null;
}

/** 球団方針と直近の判断記録から材料を作る。発言そのものを捏造しない */
export function columnFacts(state: GameState, teamId: string): ColumnFacts | null {
  const club = state.clubs?.[teamId];
  if (!club) return null;
  const decisions = decisionsOfYear(state, state.year);
  const latest = decisions.length > 0 ? decisions[decisions.length - 1] : null;
  return {
    directionLabel: DIRECTION_LABELS[club.direction],
    objectiveLine: club.objectives.length > 0 ? objectiveText(club.objectives[0]) : null,
    latestDecisionTitle: latest?.title ?? null,
    latestDecisionChoice: latest?.choice ?? null,
  };
}

/** 選手・チームどちらのニュースかを見て、関連する player/team facts をまとめて返す */
export function factsFor(state: GameState, item: NewsItem) {
  const kind = pageKindOf(item.category);
  const player = item.playerId ? playerProfileFacts(state, item.playerId) : null;
  const recent = item.teamId ? recentResultsFor(state, item.teamId) : [];
  return { kind, player, recent };
}
