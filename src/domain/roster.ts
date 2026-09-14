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

/**
 * checkRosterChange が拒否した理由の種類（PHASE 4.9-A）。
 *
 * 'capacity' と 'min-fielders' / 'min-pitchers' は、誰か1人を入れ替えれば
 * 解消できる（＝atomicなswapを提案してよい）。それ以外はswapでも解決しない
 * ので、そのまま理由を見せるだけにする。
 */
export type RosterChangeReasonCode =
  | 'ok'
  | 'not-found'
  | 'already'
  | 'locked'
  | 'injured'
  | 'min-fielders'
  | 'min-pitchers'
  | 'capacity';

export interface RosterChangeCheck {
  allowed: boolean;
  daysLeft: number;
  reason: string | null;
  code: RosterChangeReasonCode;
}

export function checkRosterChange(
  state: GameState,
  playerId: string,
  to: RosterLevel,
): RosterChangeCheck {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { allowed: false, daysLeft: 0, reason: '選手が見つかりません', code: 'not-found' };
  if (player.roster === to) {
    return { allowed: false, daysLeft: 0, reason: 'すでにその登録です', code: 'already' };
  }
  const daysLeft = daysUntilChangeable(player, state.date);
  if (daysLeft > 0) {
    return { allowed: false, daysLeft, reason: `登録変更まであと${daysLeft}日`, code: 'locked' };
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
        code: 'min-fielders',
      };
    }
    if (player.isPitcher && first.filter((p) => p.isPitcher).length < MIN_FIRST_TEAM_PITCHERS) {
      return {
        allowed: false,
        daysLeft: 0,
        reason: `1軍には投手が${MIN_FIRST_TEAM_PITCHERS}人以上必要です`,
        code: 'min-pitchers',
      };
    }
  }
  if (to === 'first') {
    if (player.ext.injury) {
      return { allowed: false, daysLeft: 0, reason: '怪我のため登録できません', code: 'injured' };
    }
    const count = state.players.filter(
      (p) => p.teamId === player.teamId && p.roster === 'first',
    ).length;
    if (count >= FIRST_TEAM_LIMIT) {
      return {
        allowed: false,
        daysLeft: 0,
        reason: `1軍は${FIRST_TEAM_LIMIT}人までです`,
        code: 'capacity',
      };
    }
  }
  return { allowed: true, daysLeft: 0, reason: null, code: 'ok' };
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

export interface RosterSwapCheck {
  allowed: boolean;
  reason: string | null;
}

/**
 * 1軍がすでに定員（もしくは最低人数ぎりぎり）で片方だけの変更が拒否されるとき、
 * 「誰かと入れ替える」ことで解決できるかを調べる（PHASE 4.9-A §9）。
 *
 * promoteId を1軍へ、demoteId を2軍へ、同時に入れ替えることだけを許す。
 * 2人ぶんの変更を1回の判定でまとめて確かめるので、
 * 「Aを落としてからBを上げる」のように途中状態を経由しない。
 */
export function checkRosterSwap(
  state: GameState,
  promoteId: string,
  demoteId: string,
): RosterSwapCheck {
  if (promoteId === demoteId) {
    return { allowed: false, reason: '同じ選手です' };
  }
  const promote = state.players.find((p) => p.id === promoteId);
  const demote = state.players.find((p) => p.id === demoteId);
  if (!promote || !demote) {
    return { allowed: false, reason: '選手が見つかりません' };
  }
  if (promote.teamId !== demote.teamId) {
    return { allowed: false, reason: '同じ球団の選手同士でのみ入れ替えられます' };
  }
  if (promote.roster !== 'second') {
    return { allowed: false, reason: `${promote.name} はすでに1軍です` };
  }
  if (demote.roster !== 'first') {
    return { allowed: false, reason: `${demote.name} はすでに2軍です` };
  }
  const promoteLock = daysUntilChangeable(promote, state.date);
  if (promoteLock > 0) {
    return { allowed: false, reason: `${promote.name} は登録変更まであと${promoteLock}日` };
  }
  const demoteLock = daysUntilChangeable(demote, state.date);
  if (demoteLock > 0) {
    return { allowed: false, reason: `${demote.name} は登録変更まであと${demoteLock}日` };
  }
  if (promote.ext.injury) {
    return { allowed: false, reason: `${promote.name} は怪我のため登録できません` };
  }
  // 入れ替え後の1軍（demoteId を外し、promoteId を加える）で最低人数を満たすか確かめる
  const after = state.players.filter(
    (p) =>
      p.teamId === promote.teamId &&
      p.ext.injury === null &&
      ((p.roster === 'first' && p.id !== demote.id) || p.id === promote.id),
  );
  const fielders = after.filter((p) => !p.isPitcher).length;
  if (fielders < MIN_FIRST_TEAM_FIELDERS) {
    return { allowed: false, reason: `1軍には野手が${MIN_FIRST_TEAM_FIELDERS}人以上必要です` };
  }
  const pitchers = after.filter((p) => p.isPitcher).length;
  if (pitchers < MIN_FIRST_TEAM_PITCHERS) {
    return { allowed: false, reason: `1軍には投手が${MIN_FIRST_TEAM_PITCHERS}人以上必要です` };
  }
  return { allowed: true, reason: null };
}

/**
 * checkRosterSwap が許可した入れ替えを1回でまとめて反映する（原子的）。
 * 呼び出し側で複製済みの state を渡すこと。
 */
export function applyRosterSwap(
  state: GameState,
  promoteId: string,
  demoteId: string,
): { ok: boolean; reason: string | null } {
  const check = checkRosterSwap(state, promoteId, demoteId);
  if (!check.allowed) return { ok: false, reason: check.reason };
  const promote = state.players.find((p) => p.id === promoteId)!;
  const demote = state.players.find((p) => p.id === demoteId)!;
  promote.roster = 'first';
  promote.lastRosterChangeDate = state.date;
  promote.ext.injuryDemotion = false;
  demote.roster = 'second';
  demote.lastRosterChangeDate = state.date;
  return { ok: true, reason: null };
}

/**
 * 候補として選べる（入れ替え相手になれる）1軍選手の一覧。
 * 登録できない理由がある選手も除外せず、理由つきで返す（§11）。
 */
export interface RosterSwapCandidate {
  player: Player;
  allowed: boolean;
  reason: string | null;
}

export function rosterSwapCandidates(
  state: GameState,
  promoteId: string,
): RosterSwapCandidate[] {
  const promote = state.players.find((p) => p.id === promoteId);
  if (!promote) return [];
  return state.players
    .filter((p) => p.teamId === promote.teamId && p.roster === 'first')
    .sort((a, b) => overallRating(b) - overallRating(a))
    .map((demote) => {
      const check = checkRosterSwap(state, promoteId, demote.id);
      return { player: demote, allowed: check.allowed, reason: check.reason };
    });
}

/**
 * 逆方向：1軍の選手を2軍へ落としたいが、最低人数を割るため単独ではできないとき、
 * 代わりに1軍へ上げる2軍選手の候補一覧。
 */
export function rosterSwapCandidatesForDemote(
  state: GameState,
  demoteId: string,
): RosterSwapCandidate[] {
  const demote = state.players.find((p) => p.id === demoteId);
  if (!demote) return [];
  return state.players
    .filter((p) => p.teamId === demote.teamId && p.roster === 'second')
    .sort((a, b) => overallRating(b) - overallRating(a))
    .map((promote) => {
      const check = checkRosterSwap(state, promote.id, demoteId);
      return { player: promote, allowed: check.allowed, reason: check.reason };
    });
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
