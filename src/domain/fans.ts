/**
 * 自球団のファンと決算。
 *
 * ファンは試合の勝敗・順位の上下・優勝・個人タイトルで増え、
 * 敗戦・順位の低下・主力のケガ・引退で減る。
 * ファンが多いほど入場料やグッズの収入が増え、年に1回の決算で球団資金に入る。
 *
 * ここは乱数を使わない（同じ出来事からは必ず同じ増減になる）。
 * CPU 球団の収入は従来どおり（ファンを持たない）。
 */
import type { GameResult, GameState, RetiredPlayerRecord, SeasonHistory } from './types';
import { rankOfTeam } from './standings';
import { overallRating } from './rating';

/** 球団の基本収入（放映権・スポンサーなど。ファンの数に関係なく入る） */
export const BASE_REVENUE = 700;
/** ファン1人あたりの年間収入（1 = 100万円） */
export const REVENUE_PER_FAN = 0.0012;
/** ゼロから始める球団の最初のファン */
export const EXPANSION_START_FANS = 100_000;
/** ファンの下限（どれだけ負けても0にはならない） */
export const MIN_FANS = 5_000;
const FAN_LOG_LIMIT = 40;

export function fanRevenue(fans: number): number {
  return Math.round(fans * REVENUE_PER_FAN);
}

export function totalRevenue(fans: number): number {
  return BASE_REVENUE + fanRevenue(fans);
}

/** その収入になるファンの人数（通常の開始・古いセーブで、収入を変えずにファンを決めるため） */
export function fansForRevenue(revenue: number): number {
  return Math.max(MIN_FANS, Math.round((revenue - BASE_REVENUE) / REVENUE_PER_FAN / 1000) * 1000);
}

/** ファンの入れ物を用意する（古いセーブ・通常の開始では、いまの年間収入に見合う人数から） */
export function ensureFans(state: GameState): void {
  if (typeof state.fans === 'number' && Number.isFinite(state.fans)) {
    if (!Array.isArray(state.fanLog)) state.fanLog = [];
    if (typeof state.fansBefore !== 'number') state.fansBefore = state.fans;
    return;
  }
  const finance = state.finances[state.playerTeamId];
  const revenue = finance ? Math.max(finance.annualRevenue, finance.budget) : BASE_REVENUE;
  state.fans = Math.max(200_000, fansForRevenue(revenue));
  state.fansBefore = state.fans;
  state.fanLog = [];
  if (state.lastSettlement === undefined) state.lastSettlement = null;
}

/**
 * ファンを増減させる。rate は今のファンに対する割合、flat は人数。
 * reason を渡したときだけ記録に残す（毎試合の小さな増減は残さない）。
 */
export function changeFans(state: GameState, rate: number, flat: number, reason?: string): number {
  if (typeof state.fans !== 'number') return 0;
  const before = state.fans;
  const after = Math.max(MIN_FANS, Math.round(before * (1 + rate) + flat));
  state.fans = after;
  const delta = after - before;
  if (reason && delta !== 0) {
    if (!state.fanLog) state.fanLog = [];
    state.fanLog.push({ date: state.date, delta, reason });
    if (state.fanLog.length > FAN_LOG_LIMIT) state.fanLog.splice(0, state.fanLog.length - FAN_LOG_LIMIT);
  }
  return delta;
}

/**
 * 1日ぶんの増減。試合の勝敗・順位の上下・新しいケガ。
 * prev は日付を進める前の state、next は進めた後（こちらを書き換える）。
 */
export function updateFansForDay(prev: GameState, next: GameState, results: GameResult[]): void {
  if (typeof next.fans !== 'number') return;
  next.fansBefore = next.fans;
  const teamId = next.playerTeamId;
  const game = results.find((r) => r.homeTeamId === teamId || r.awayTeamId === teamId);
  if (!game) return;

  // 勝てば増え、負ければ少し減る（記録には残さない）
  if (game.winnerTeamId === teamId) changeFans(next, 0.0035, 40);
  else if (game.winnerTeamId) changeFans(next, -0.0012, 0);

  // 順位の上下（序盤は順位がすぐ入れ替わるので、5試合を過ぎてから）
  const games = next.records[teamId]?.games ?? 0;
  if (games > 5) {
    const before = rankOfTeam(prev, teamId);
    const after = rankOfTeam(next, teamId);
    if (before > 0 && after > 0 && before !== after) {
      const diff = before - after;
      changeFans(
        next,
        diff > 0 ? 0.012 * diff : 0.01 * diff,
        0,
        diff > 0 ? `順位が${after}位に上がった` : `順位が${after}位に下がった`,
      );
    }
  }

  // 新しくケガをした選手（主力ほど大きく減る）
  for (const player of next.players) {
    if (player.teamId !== teamId || !player.ext.injury) continue;
    const was = prev.players.find((p) => p.id === player.id);
    if (was?.ext.injury) continue;
    const star = overallRating(player) >= 55;
    changeFans(next, star ? -0.015 : -0.005, 0, `${player.name}がケガで離脱`);
  }
}

/**
 * シーズンの締め。順位の上下（昨季と比べて）・優勝・個人タイトルと表彰。
 * finalizeSeason で今季の歴史を確定した直後に呼ぶ。
 */
export function applySeasonFans(state: GameState, season: SeasonHistory | null): void {
  if (typeof state.fans !== 'number' || !season) return;
  const teamId = state.playerTeamId;
  const row = season.teams.find((t) => t.teamId === teamId);
  if (!row) return;

  const seasons = state.history?.seasons ?? [];
  const previous = seasons.filter((s) => s.year < season.year).pop();
  const lastRank = previous?.teams.find((t) => t.teamId === teamId)?.rank;
  if (lastRank !== undefined && lastRank !== row.rank) {
    const diff = lastRank - row.rank;
    changeFans(
      state,
      diff > 0 ? 0.06 * diff : 0.05 * diff,
      0,
      diff > 0 ? `昨季${lastRank}位 → 今季${row.rank}位に躍進` : `昨季${lastRank}位 → 今季${row.rank}位に後退`,
    );
  }
  if (row.champion) changeFans(state, 0.15, 0, 'レギュラーシーズン1位（ペナント）');
  if (row.leagueChampion) changeFans(state, 0.1, 0, 'リーグ優勝');
  if (row.japanChampion) changeFans(state, 0.2, 0, '日本一');

  const league = season.leagues.find((l) => l.leagueId === row.leagueId);
  if (league) {
    const nameOf = (id: string | null) => state.players.find((p) => p.id === id)?.name ?? '';
    const isMine = (id: string | null) =>
      !!id && state.players.some((p) => p.id === id && p.teamId === teamId);
    for (const leader of Object.values(league.leaders)) {
      if (leader && leader.teamId === teamId) {
        changeFans(state, 0.02, 0, `${leader.name}がタイトル獲得`);
      }
    }
    if (isMine(league.mvpPlayerId)) changeFans(state, 0.04, 0, `${nameOf(league.mvpPlayerId)}がMVP`);
    if (isMine(league.bestPitcherPlayerId))
      changeFans(state, 0.03, 0, `${nameOf(league.bestPitcherPlayerId)}が最優秀投手`);
    if (isMine(league.rookiePlayerId)) changeFans(state, 0.03, 0, `${nameOf(league.rookiePlayerId)}が新人王`);
  }
}

/** 自球団の選手の引退（主力ほど大きく減る） */
export function applyRetirementFans(state: GameState, retirements: RetiredPlayerRecord[]): void {
  if (typeof state.fans !== 'number') return;
  for (const record of retirements) {
    if (record.teamId !== state.playerTeamId) continue;
    const star = record.finalOverall >= 55;
    changeFans(state, star ? -0.02 : -0.006, 0, `${record.name}が引退`);
  }
}
