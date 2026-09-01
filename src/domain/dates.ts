/** ゲーム内日付はタイムゾーンに依存しない YYYY-MM-DD 文字列で扱う */

export function toDateString(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const dt = parseDate(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** a - b の日数 */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);
}

/** 0=日曜 ... 6=土曜 */
export function dayOfWeek(date: string): number {
  return parseDate(date).getUTCDay();
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDateJa(date: string): string {
  const dt = parseDate(date);
  return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日(${WEEKDAY_JA[dt.getUTCDay()]})`;
}

export function formatDateFull(date: string): string {
  const dt = parseDate(date);
  return `${dt.getUTCFullYear()}年${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日(${
    WEEKDAY_JA[dt.getUTCDay()]
  })`;
}
