/**
 * 選手チェック（PHASE 4.9-A）の判定ロジック。
 *
 * 「不調」「打撃不振」「投手不振」を、ここだけで決める。
 * UI 側は if (avg < 0.250) のような判定を直接書かず、必ずこの関数を通す。
 *
 * 不調は condition.ts の既存の状態（'bad' / 'worst'）をそのまま使う。
 * 独自の「なんとなく不調」は作らない。
 *
 * 打撃不振・投手不振は playerAnalysis.ts の battingScore / pitchingScore
 * （0〜100点、出場が少なければ null を返す既存の評価基準）をそのまま使う。
 * サンプルサイズの足切り（打席数・投球回）もそちらの既存ロジックに任せる。
 * ここで決めるのは「その点数がいくつ未満なら不振と呼ぶか」という一線だけ。
 */
import type { GameState, Player } from './types';
import { battingScore, pitchingScore } from './playerAnalysis';
import { average, era } from './stats';

/**
 * 不振と呼ぶ点数のしきい値（0〜100点、rank.ts の E〜F の境目あたり）。
 * C（50〜59）を「並」とすれば、そこから明確に落ちる水準。
 */
export const SLUMP_SCORE_THRESHOLD = 35;

/** 基準になる打席数・投球回を、シーズンの長さに合わせて縮める。フルシーズン(143試合)なら1倍 */
export function sampleScale(state: GameState): number {
  return state.seasonLength / 143;
}

export interface BattingSlumpInfo {
  score: number;
  average: number;
  atBats: number;
  plateAppearances: number;
}

export interface PitchingSlumpInfo {
  score: number;
  era: number;
  outs: number;
  games: number;
}

export interface PlayerCheckStatus {
  playerId: string;
  /** 'bad' または 'worst' のとき true（condition.ts の既存の状態そのまま） */
  conditionBad: boolean;
  /** 'worst'（絶不調）のときだけ true */
  conditionWorst: boolean;
  /** 打撃不振（出場が少ない選手は null） */
  battingSlump: BattingSlumpInfo | null;
  /** 投手不振（登板が少ない選手は null） */
  pitchingSlump: PitchingSlumpInfo | null;
}

/** 選手の今季成績。state.stats に無ければ何も判定しない */
function statsOf(state: GameState, player: Player) {
  return state.stats[player.id];
}

export function battingSlumpCheck(state: GameState, player: Player): BattingSlumpInfo | null {
  if (player.isPitcher) return null;
  const stats = statsOf(state, player);
  if (!stats) return null;
  const scale = sampleScale(state);
  const score = battingScore(stats.batting, Math.max(8, Math.round(40 * scale)));
  if (score === null || score >= SLUMP_SCORE_THRESHOLD) return null;
  return {
    score,
    average: average(stats.batting),
    atBats: stats.batting.atBats,
    plateAppearances: stats.batting.plateAppearances,
  };
}

export function pitchingSlumpCheck(state: GameState, player: Player): PitchingSlumpInfo | null {
  if (!player.isPitcher) return null;
  const stats = statsOf(state, player);
  if (!stats) return null;
  const scale = sampleScale(state);
  const score = pitchingScore(stats.pitching, Math.max(9, Math.round(60 * scale)));
  if (score === null || score >= SLUMP_SCORE_THRESHOLD) return null;
  return {
    score,
    era: era(stats.pitching),
    outs: stats.pitching.outs,
    games: stats.pitching.games,
  };
}

export function conditionCheckOf(player: Player): { bad: boolean; worst: boolean } {
  const condition = player.ext.condition;
  return { bad: condition === 'bad' || condition === 'worst', worst: condition === 'worst' };
}

/** 選手1人ぶんの選手チェック結果。ゲームの状態は一切変更しない（読むだけ） */
export function playerCheckStatus(state: GameState, player: Player): PlayerCheckStatus {
  const condition = conditionCheckOf(player);
  return {
    playerId: player.id,
    conditionBad: condition.bad,
    conditionWorst: condition.worst,
    battingSlump: battingSlumpCheck(state, player),
    pitchingSlump: pitchingSlumpCheck(state, player),
  };
}

/** 何かしらの注意点がある（不調・打撃不振・投手不振のいずれか）かどうか */
export function hasPlayerCheckFlag(status: PlayerCheckStatus): boolean {
  return status.conditionBad || status.battingSlump !== null || status.pitchingSlump !== null;
}

/** 球団の全選手ぶんの選手チェック結果（フラグが立っている選手だけ） */
export function checkTeamPlayers(state: GameState, teamId: string): PlayerCheckStatus[] {
  return state.players
    .filter((p) => p.teamId === teamId)
    .map((p) => playerCheckStatus(state, p))
    .filter(hasPlayerCheckFlag);
}
