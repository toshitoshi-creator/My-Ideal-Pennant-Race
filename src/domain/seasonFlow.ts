/**
 * PHASE 4.4 一日の流れとシーズンの記録（§18・§19）。
 *
 * ここでは新しい事実を作らない。既存の news / results / history / decisions に
 * 実際に残っているものだけを、時系列に並べ替える（§19：過去データを捏造しない）。
 *
 * 乱数・現在時刻は使わない。
 */
import type { GameState, NewsItem } from './types';
import { newsOfYear } from './news';
import { formatDateJa } from './dates';
import { decisionsOfDate, decisionsOfYear, DECISION_KIND_LABELS } from './decisions';

/* ================= 一日の流れ（§18） ================= */

export type DayEntryKind = 'NEWS' | 'GAME' | 'DECISION';

export interface DayEntry {
  /** 並べる順（同じ日のなかでの相対的な時刻。実時刻ではない） */
  order: number;
  kind: DayEntryKind;
  /** 欄名（英字） */
  en: string;
  /** 見出し（日本語） */
  ja: string;
  text: string;
}

/**
 * 「今日この球団で何が起きたか」を、起きた順に並べる。
 *
 * 実時刻は存在しないので、時計の数字は出さない。
 * 出すのは「試合の前か後か」という順序だけ。
 */
export function dayFlow(state: GameState, date: string): DayEntry[] {
  const teamId = state.playerTeamId;
  const entries: DayEntry[] = [];

  // 判断（試合の前に行われたものとして扱う）
  for (const record of decisionsOfDate(state, date)) {
    entries.push({
      order: 1,
      kind: 'DECISION',
      en: 'GM DECISION',
      ja: DECISION_KIND_LABELS[record.kind],
      text: `${record.title}：${record.choice}`,
    });
  }

  // 試合
  const game = state.results.find(
    (r) => r.date === date && (r.homeTeamId === teamId || r.awayTeamId === teamId),
  );
  if (game) {
    const home = state.teams.find((t) => t.id === game.homeTeamId);
    const away = state.teams.find((t) => t.id === game.awayTeamId);
    const mark = !game.winnerTeamId ? '△' : game.winnerTeamId === teamId ? '○' : '●';
    entries.push({
      order: 2,
      kind: 'GAME',
      en: 'GAME',
      ja: '試合',
      text: `${mark} ${away?.shortName ?? '－'} ${game.away.runs} - ${game.home.runs} ${
        home?.shortName ?? '－'
      }`,
    });
  }

  // ニュース（試合の後に届いたものとして扱う）
  const news = (state.news?.items ?? []).filter((item) => item.date === date);
  for (const item of news) {
    entries.push({
      order: item.category === 'GAME' ? 3 : 4,
      kind: 'NEWS',
      en: item.priority === 'BREAKING' ? 'BREAKING' : 'CLUB NEWS',
      ja: item.title,
      text: item.body,
    });
  }

  return entries.sort((a, b) => a.order - b.order);
}

/* ================= シーズンの記録（§19） ================= */

export interface TimelineEntry {
  date: string;
  dateLabel: string;
  month: number;
  /** APR / MAY ... */
  monthLabel: string;
  /** 欄名（英字） */
  en: string;
  /** 見出し（日本語） */
  ja: string;
  text: string;
}

const MONTH_LABELS: Record<number, string> = {
  1: 'JAN',
  2: 'FEB',
  3: 'MAR',
  4: 'APR',
  5: 'MAY',
  6: 'JUN',
  7: 'JUL',
  8: 'AUG',
  9: 'SEP',
  10: 'OCT',
  11: 'NOV',
  12: 'DEC',
};

export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

export function monthLabel(month: number): string {
  return MONTH_LABELS[month] ?? '';
}

/** ニュースの重さ。月ごとに1件だけ残すときの選別に使う */
function newsWeight(item: NewsItem): number {
  const base =
    item.priority === 'BREAKING' ? 40 : item.priority === 'HIGH' ? 24 : item.priority === 'NORMAL' ? 10 : 4;
  const category =
    item.category === 'CHAMPIONSHIP'
      ? 30
      : item.category === 'POSTSEASON'
        ? 24
        : item.category === 'RECORD' || item.category === 'AWARD'
          ? 18
          : item.category === 'TRADE' || item.category === 'FA' || item.category === 'DRAFT'
            ? 14
            : item.category === 'INJURY' || item.category === 'RETIREMENT'
              ? 12
              : 0;
  return base + category;
}

/**
 * その年の物語を、月ごとに並べる（§19）。
 *
 * 使うのは実際に残っているニュースと、実際に記録された判断だけ。
 * 何も起きていない月は出さない（無理に埋めない）。
 */
export function seasonTimeline(state: GameState, year: number): TimelineEntry[] {
  const teamId = state.playerTeamId;
  const entries: TimelineEntry[] = [];

  // 月ごとに、自球団に関係するいちばん重いニュースを1件
  const byMonth = new Map<number, NewsItem>();
  for (const item of newsOfYear(state, year)) {
    const related =
      item.teamId === teamId ||
      (item.relatedTeamIds ?? []).includes(teamId) ||
      item.category === 'CHAMPIONSHIP' ||
      item.category === 'POSTSEASON';
    if (!related) continue;
    const month = monthOf(item.date);
    const current = byMonth.get(month);
    if (!current || newsWeight(item) > newsWeight(current)) byMonth.set(month, item);
  }
  for (const [month, item] of byMonth) {
    entries.push({
      date: item.date,
      dateLabel: formatDateJa(item.date),
      month,
      monthLabel: monthLabel(month),
      en: item.priority === 'BREAKING' ? 'BREAKING' : 'CLUB NEWS',
      ja: item.title,
      text: item.body,
    });
  }

  // その年に記録した判断（月ごとに最初の1件だけ。全部並べると流れが読めなくなる）
  const seenMonths = new Set<number>();
  for (const record of [...decisionsOfYear(state, year)].reverse()) {
    const month = monthOf(record.date);
    if (seenMonths.has(month)) continue;
    seenMonths.add(month);
    entries.push({
      date: record.date,
      dateLabel: formatDateJa(record.date),
      month,
      monthLabel: monthLabel(month),
      en: 'GM DECISION',
      ja: record.title,
      text: record.choice,
    });
  }

  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.en < b.en ? -1 : 1));
}

/** 記録が残っている年（新しい順）。ニュースか判断のどちらかがある年 */
export function timelineYears(state: GameState): number[] {
  const years = new Set<number>();
  for (const item of state.news?.items ?? []) years.add(item.year);
  for (const record of state.decisions ?? []) years.add(record.year);
  return [...years].sort((a, b) => b - a);
}
