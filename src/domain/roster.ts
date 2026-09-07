import type { GameState, Player, PositionId, RosterLevel } from './types';
import {
  FIRST_TEAM_LIMIT,
  OPENING_FIRST_TEAM,
  ROSTER_CHANGE_LOCK_DAYS,
  ROSTER_LIMIT,
} from './types';
import { addDays, diffDays } from './dates';
import { overallRating } from './rating';

/** 次に 1軍／2軍 を変更できる日（null なら制限なし） */
export function nextChangeDate(player: Player): string | null {
  if (!player.lastRosterChangeDate) return null;
  return addDays(player.lastRosterChangeDate, ROSTER_CHANGE_LOCK_DAYS);
}

/** 変更可能になるまでの残り日数（0 なら今すぐ変更可能） */
export function daysUntilChangeable(player: Player, today: string): number {
  const next = nextChangeDate(player);
  if (!next) return 0;
  return Math.max(0, diffDays(next, today));
}

/** 1軍に残しておかなければならない野手の人数（スタメン 8 + DH） */
export const MIN_FIRST_TEAM_FIELDERS = 9;
/** 1軍に残しておかなければならない投手の人数（先発ローテーション分） */
export const MIN_FIRST_TEAM_PITCHERS = 5;

export interface RosterChangeCheck {
  allowed: boolean;
  daysLeft: number;
  reason: string | null;
}

export function checkRosterChange(
  state: GameState,
  playerId: string,
  to: RosterLevel,
): RosterChangeCheck {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { allowed: false, daysLeft: 0, reason: '選手が見つかりません' };
  if (player.roster === to) {
    return { allowed: false, daysLeft: 0, reason: 'すでにその登録です' };
  }
  const daysLeft = daysUntilChangeable(player, state.date);
  if (daysLeft > 0) {
    return { allowed: false, daysLeft, reason: `登録変更まであと${daysLeft}日` };
  }
  if (to === 'second') {
    // 試合が組めなくなる降格は禁止（オーダーに穴が開くのを防ぐ）
    const first = state.players.filter(
      (p) =>
        p.teamId === player.teamId &&
        p.roster === 'first' &&
        p.id !== player.id &&
        p.ext.injury === null,
    );
    if (!player.isPitcher && first.filter((p) => !p.isPitcher).length < MIN_FIRST_TEAM_FIELDERS) {
      return {
        allowed: false,
        daysLeft: 0,
        reason: `1軍には野手が${MIN_FIRST_TEAM_FIELDERS}人以上必要です`,
      };
    }
    if (player.isPitcher && first.filter((p) => p.isPitcher).length < MIN_FIRST_TEAM_PITCHERS) {
      return {
        allowed: false,
        daysLeft: 0,
        reason: `1軍には投手が${MIN_FIRST_TEAM_PITCHERS}人以上必要です`,
      };
    }
  }
  if (to === 'first') {
    if (player.ext.injury) {
      return { allowed: false, daysLeft: 0, reason: '怪我のため登録できません' };
    }
    const count = state.players.filter(
      (p) => p.teamId === player.teamId && p.roster === 'first',
    ).length;
    if (count >= FIRST_TEAM_LIMIT) {
      return {
        allowed: false,
        daysLeft: 0,
        reason: `1軍は${FIRST_TEAM_LIMIT}人までです`,
      };
    }
  }
  return { allowed: true, daysLeft: 0, reason: null };
}

/**
 * 1軍／2軍 を変更する（state を直接更新する。呼び出し側で複製済みの state を渡すこと）。
 * 成功したら true。
 */
export function applyRosterChange(
  state: GameState,
  playerId: string,
  to: RosterLevel,
): { ok: boolean; reason: string | null } {
  const check = checkRosterChange(state, playerId, to);
  if (!check.allowed) return { ok: false, reason: check.reason };
  const player = state.players.find((p) => p.id === playerId)!;
  player.roster = to;
  player.lastRosterChangeDate = state.date;
  player.ext.injuryDemotion = false;
  return { ok: true, reason: null };
}

export function firstTeamCount(state: GameState, teamId: string): number {
  return state.players.filter((p) => p.teamId === teamId && p.roster === 'first').length;
}

export function teamPlayerCount(state: GameState, teamId: string): number {
  return state.players.filter((p) => p.teamId === teamId).length;
}

/**
 * 支配下70人枠（ROSTER_LIMIT）に空きがあるか。
 * ドラフト・FA・トレードの獲得はすべてここを通す。
 */
export function canAddPlayer(state: GameState, teamId: string): boolean {
  return teamPlayerCount(state, teamId) < ROSTER_LIMIT;
}

/**
 * 開幕時に必ず1軍へ置くポジションと人数。
 * 投手はローテーション＋救援ぶん、捕手は正・控えの2人、
 * 野手は各ポジションに1人ずつ。ここを満たしてから、残りを能力順に埋める。
 */
const OPENING_QUOTA: ReadonlyArray<{ position: PositionId; count: number }> = [
  { position: 'P', count: 12 },
  { position: 'C', count: 2 },
  { position: '1B', count: 1 },
  { position: '2B', count: 1 },
  { position: '3B', count: 1 },
  { position: 'SS', count: 1 },
  { position: 'LF', count: 1 },
  { position: 'CF', count: 1 },
  { position: 'RF', count: 1 },
];

/**
 * 開幕1軍を組み直す（支配下70人枠に合わせた開幕登録）。
 *
 * 支配下が70人ある球団では、登録を放っておくと開幕1軍が引退・移籍のぶんだけ
 * 痩せていき、伸びた若手がいつまでも2軍に埋もれてしまう。
 * オフシーズンの終わりに、その時点の能力でポジションを満たしながら組み直す。
 *
 * 怪我人は1軍に入れない（シーズン中に復帰したら ensureFirstTeamViable / 昇格で戻る）。
 * 乱数は使わないので、同じ状態からは常に同じ1軍になる。
 */
export function rebuildFirstTeam(state: GameState, teamId: string): void {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const healthy = roster
    .filter((p) => p.ext.injury === null)
    .sort((a, b) => overallRating(b) - overallRating(a) || (a.id < b.id ? -1 : 1));
  const target = Math.min(OPENING_FIRST_TEAM, FIRST_TEAM_LIMIT, healthy.length);

  const selected = new Set<string>();
  // まずポジションの穴を埋める
  for (const quota of OPENING_QUOTA) {
    let taken = 0;
    for (const player of healthy) {
      if (taken >= quota.count || selected.size >= target) break;
      if (selected.has(player.id)) continue;
      if (player.mainPosition !== quota.position) continue;
      selected.add(player.id);
      taken += 1;
    }
  }
  // 残りは能力順
  for (const player of healthy) {
    if (selected.size >= target) break;
    selected.add(player.id);
  }

  for (const player of roster) {
    const to: RosterLevel = selected.has(player.id) ? 'first' : 'second';
    if (player.roster !== to) {
      player.roster = to;
      // 開幕前の登録なので、7日間の変更制限は持ち越さない
      player.lastRosterChangeDate = null;
    }
    if (to === 'first') player.ext.injuryDemotion = false;
  }
}
