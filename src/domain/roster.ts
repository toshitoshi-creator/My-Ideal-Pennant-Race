import type { GameState, Player, RosterLevel } from './types';
import { FIRST_TEAM_LIMIT, ROSTER_CHANGE_LOCK_DAYS, ROSTER_LIMIT } from './types';
import { addDays, diffDays } from './dates';

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
  if (to === 'first') {
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
  return { ok: true, reason: null };
}

export function firstTeamCount(state: GameState, teamId: string): number {
  return state.players.filter((p) => p.teamId === teamId && p.roster === 'first').length;
}

export function teamPlayerCount(state: GameState, teamId: string): number {
  return state.players.filter((p) => p.teamId === teamId).length;
}

/** 保有選手上限に達していないか（PHASE 1 では選手が増える機能はまだない） */
export function canAddPlayer(state: GameState, teamId: string): boolean {
  return teamPlayerCount(state, teamId) < ROSTER_LIMIT;
}
