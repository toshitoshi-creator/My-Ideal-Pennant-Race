/**
 * ポストシーズン（PHASE 3.8）。
 *
 *   レギュラーシーズン終了
 *     → 上位3球団がクライマックスシリーズへ
 *     → ファーストステージ（2位 vs 3位・3戦2勝）
 *     → ファイナルステージ（1位 vs 勝者・1位に1勝のアドバンテージ・4勝先取）
 *     → リーグ優勝
 *     → 日本シリーズ（4勝先取）
 *     → 日本一
 *
 * 設計上の約束：
 *  - 既存の試合エンジンをそのまま使う。ポストシーズン専用の能力補正は入れない。
 *  - 乱数はポストシーズン専用の系列を使い、レギュラーシーズンや
 *    オフシーズンの乱数列をずらさない（同じシードなら従来と同じ結果になる）。
 *  - レギュラーシーズンの順位・成績には一切加算しない（成績は別に持つ）。
 *  - 同じ試合・同じシリーズを二度確定しない。
 */
import type {
  GameResult,
  GameState,
  PostseasonGame,
  PostseasonState,
  PlayerSeasonStats,
  SeriesStage,
  SeriesState,
} from './types';
import { Rng, seedFrom } from './rng';
import { simulateGame } from './simulation';
import { availableFirstTeam, repairAllSetups } from './engine';
import { applyDailyUpdates } from './daily';
import { addBatting, addPitching, emptySeasonStats } from './stats';
import { standingsForLeague } from './standings';
import { addDays } from './dates';

/** ポストシーズンに進出する球団数（リーグごと） */
export const POSTSEASON_TEAMS = 3;
/** ファーストステージ：3戦2勝 */
export const FIRST_STAGE_BEST_OF = 3;
export const FIRST_STAGE_WINS = 2;
/** ファイナルステージ・日本シリーズ：4勝先取 */
export const FINAL_STAGE_WINS = 4;
export const JAPAN_SERIES_WINS = 4;
/** ファイナルステージでリーグ1位に与えるアドバンテージ */
export const FINAL_STAGE_ADVANTAGE = 1;

export const STAGE_LABELS: Record<SeriesStage, string> = {
  FIRST: 'ファーストステージ',
  FINAL: 'ファイナルステージ',
  JAPAN_SERIES: '日本シリーズ',
};

/* ---------------- 乱数（ポストシーズン専用の系列） ---------------- */

export type PostseasonRngKind =
  | 'postseasonFirstStage'
  | 'postseasonFinalStage'
  | 'japanSeries';

export function stageRngKind(stage: SeriesStage): PostseasonRngKind {
  if (stage === 'FIRST') return 'postseasonFirstStage';
  if (stage === 'FINAL') return 'postseasonFinalStage';
  return 'japanSeries';
}

/**
 * ポストシーズン用の乱数。
 * 試合ごとに独立した種を作るので、途中で保存して再開しても同じ結果になる。
 */
export function postseasonRng(
  state: GameState,
  kind: PostseasonRngKind,
  ...parts: Array<string | number>
): Rng {
  return new Rng(seedFrom(`${kind}:${state.seed}:${state.year}:${parts.join(':')}`));
}

/* ---------------- 進出球団 ---------------- */

/** そのリーグの進出球団（1位→3位） */
export function postseasonParticipants(state: GameState, leagueId: string): string[] {
  return standingsForLeague(state, leagueId)
    .slice(0, POSTSEASON_TEAMS)
    .map((row) => row.teamId);
}

/** その球団がポストシーズンに進出しているか */
export function isParticipant(state: GameState, teamId: string): boolean {
  const postseason = state.postseason;
  if (!postseason) return false;
  return Object.values(postseason.participants).some((ids) => ids.includes(teamId));
}

/* ---------------- シリーズ ---------------- */

/**
 * ホーム開催の並び。
 * 上位球団のホームを多めにするが、片側に寄りすぎないようにする。
 *   3戦：A A B
 *   6戦：A A B B A A
 *   7戦：A A B B B A A
 */
export function homePattern(bestOf: number): Array<'A' | 'B'> {
  if (bestOf <= 3) return ['A', 'A', 'B'];
  if (bestOf <= 6) return ['A', 'A', 'B', 'B', 'A', 'A'];
  return ['A', 'A', 'B', 'B', 'B', 'A', 'A'];
}

function createSeries(
  stage: SeriesStage,
  leagueId: string | null,
  teamAId: string,
  teamBId: string,
  year: number,
): SeriesState {
  const first = stage === 'FIRST';
  const advantage = stage === 'FINAL' ? FINAL_STAGE_ADVANTAGE : 0;
  const winsRequired = first
    ? FIRST_STAGE_WINS
    : stage === 'FINAL'
      ? FINAL_STAGE_WINS
      : JAPAN_SERIES_WINS;
  // アドバンテージがあるぶん、必要な試合数は減る
  const bestOf = first ? FIRST_STAGE_BEST_OF : winsRequired * 2 - 1 - advantage;
  return {
    id: `${year}:${stage}:${leagueId ?? 'japan'}`,
    stage,
    leagueId,
    bestOf,
    winsRequired,
    teamAId,
    teamBId,
    advantageA: advantage,
    teamAWins: advantage,
    teamBWins: 0,
    games: [],
    winnerTeamId: null,
    loserTeamId: null,
  };
}

/** シリーズが終わっているか */
export function isSeriesComplete(series: SeriesState): boolean {
  return series.winnerTeamId !== null;
}

/** あと何勝で勝ち抜けか */
export function winsRemaining(series: SeriesState, teamId: string): number {
  const wins = teamId === series.teamAId ? series.teamAWins : series.teamBWins;
  return Math.max(0, series.winsRequired - wins);
}

/**
 * 引き分けが出たときに追加できる試合数。
 * 引き分けはどちらの勝利にもならないので、規定試合数だけでは
 * 決着しないことがある。そのぶんだけ試合を足せるようにする。
 */
export const MAX_EXTRA_GAMES = 3;

/** そのシリーズで行える最大試合数 */
export function maxGames(series: SeriesState): number {
  return series.bestOf + MAX_EXTRA_GAMES;
}

/** そのシリーズでこれ以上試合ができるか */
export function canPlayGame(series: SeriesState): boolean {
  if (isSeriesComplete(series)) return false;
  return series.games.length < maxGames(series);
}

/** シリーズの勝敗を判定して確定する（決まっていなければ何もしない） */
export function settleSeries(series: SeriesState): void {
  if (isSeriesComplete(series)) return;
  if (series.teamAWins >= series.winsRequired) {
    series.winnerTeamId = series.teamAId;
    series.loserTeamId = series.teamBId;
    return;
  }
  if (series.teamBWins >= series.winsRequired) {
    series.winnerTeamId = series.teamBId;
    series.loserTeamId = series.teamAId;
    return;
  }
  // 引き分けが続いて追加分も使い切った場合は、勝利数が多いほうが勝ち抜け。
  // 同数なら上位球団（teamA）が勝ち抜ける。
  if (series.games.length >= maxGames(series)) {
    if (series.teamBWins > series.teamAWins) {
      series.winnerTeamId = series.teamBId;
      series.loserTeamId = series.teamAId;
    } else {
      series.winnerTeamId = series.teamAId;
      series.loserTeamId = series.teamBId;
    }
  }
}

/* ---------------- ポストシーズンの開始 ---------------- */

function emptyPostseason(state: GameState): PostseasonState {
  const participants: Record<string, string[]> = {};
  for (const league of state.leagues) {
    participants[league.id] = postseasonParticipants(state, league.id);
  }
  const series: SeriesState[] = [];
  for (const league of state.leagues) {
    const [, second, third] = participants[league.id];
    if (!second || !third) continue;
    series.push(createSeries('FIRST', league.id, second, third, state.year));
  }
  return {
    year: state.year,
    phase: 'FIRST_STAGE',
    participants,
    series,
    leagueChampions: {},
    championTeamId: null,
    stats: {},
    japanSeriesStats: {},
    csMvp: {},
    japanSeriesMvpPlayerId: null,
  };
}

/**
 * レギュラーシーズンが終わっていればポストシーズンを用意する。
 * すでに始まっていれば何もしない（二重生成しない）。
 */
export function ensurePostseason(state: GameState): PostseasonState | null {
  if (!state.seasonFinished) return null;
  if (state.postseason && state.postseason.year === state.year) return state.postseason;
  if (state.postseason && state.postseason.year !== state.year) state.postseason = null;
  state.postseason = emptyPostseason(state);
  return state.postseason;
}

/** いま試合をするシリーズ（無ければ null） */
export function currentSeries(state: GameState): SeriesState | null {
  const postseason = state.postseason;
  if (!postseason || postseason.phase === 'COMPLETE') return null;
  return postseason.series.find((s) => canPlayGame(s)) ?? null;
}

/** 段階ごとのシリーズ */
export function seriesOfStage(postseason: PostseasonState, stage: SeriesStage): SeriesState[] {
  return postseason.series.filter((s) => s.stage === stage);
}

/* ---------------- 成績 ---------------- */

function ensureStats(map: Record<string, PlayerSeasonStats>, playerId: string) {
  let stats = map[playerId];
  if (!stats) {
    stats = emptySeasonStats(playerId);
    map[playerId] = stats;
  }
  return stats;
}

/** ポストシーズンの成績を積む（レギュラーシーズンの成績には触れない） */
function applyPostseasonStats(
  postseason: PostseasonState,
  result: GameResult,
  stage: SeriesStage,
): void {
  for (const line of result.playerLines) {
    const total = ensureStats(postseason.stats, line.playerId);
    if (line.batting) addBatting(total.batting, line.batting);
    if (line.pitching) addPitching(total.pitching, line.pitching);
    if (stage !== 'JAPAN_SERIES') continue;
    const japan = ensureStats(postseason.japanSeriesStats, line.playerId);
    if (line.batting) addBatting(japan.batting, line.batting);
    if (line.pitching) addPitching(japan.pitching, line.pitching);
  }
}

/* ---------------- 試合を進める ---------------- */

/**
 * いま進行中のシリーズの次の1試合を消化する。
 * 試合ができなければ null（段階の切り替えだけ行う）。
 */
export function playNextPostseasonGame(state: GameState): PostseasonGame | null {
  const postseason = state.postseason;
  if (!postseason) return null;
  const series = currentSeries(state);
  if (!series) {
    advancePhase(state);
    return null;
  }

  const gameNumber = series.games.length + 1;
  const pattern = homePattern(series.bestOf);
  const side = pattern[(gameNumber - 1) % pattern.length];
  const homeTeamId = side === 'A' ? series.teamAId : series.teamBId;
  const awayTeamId = side === 'A' ? series.teamBId : series.teamAId;

  const homeTeam = state.teams.find((t) => t.id === homeTeamId)!;
  const awayTeam = state.teams.find((t) => t.id === awayTeamId)!;
  // 日本シリーズはホーム球団のリーグのルール（DHの有無）で行う
  const league = state.leagues.find((l) => l.id === homeTeam.leagueId)!;

  repairAllSetups(state);
  const rng = postseasonRng(state, stageRngKind(series.stage), series.id, gameNumber);
  const gameId = `${series.id}:${gameNumber}`;
  const result = simulateGame({
    rng,
    gameId,
    date: state.date,
    leagueId: league.id,
    useDH: league.useDH,
    homeTeam,
    awayTeam,
    homePlayers: availableFirstTeam(state, homeTeamId),
    awayPlayers: availableFirstTeam(state, awayTeamId),
    homeSetup: state.setups[homeTeamId],
    awaySetup: state.setups[awayTeamId],
    homeMorale: state.teamMorale[homeTeamId] ?? 50,
    awayMorale: state.teamMorale[awayTeamId] ?? 50,
  });

  // 先発ローテーションを進める（レギュラーシーズンと同じ扱い）
  for (const teamId of [homeTeamId, awayTeamId]) {
    const setup = state.setups[teamId];
    if (setup.rotation.length > 0) {
      setup.rotationIndex = (setup.rotationIndex + 1) % setup.rotation.length;
    }
  }

  const game: PostseasonGame = {
    gameNumber,
    date: state.date,
    homeTeamId,
    awayTeamId,
    homeRuns: result.home.runs,
    awayRuns: result.away.runs,
    winnerTeamId: result.winnerTeamId,
  };
  series.games.push(game);
  if (result.winnerTeamId === series.teamAId) series.teamAWins += 1;
  else if (result.winnerTeamId === series.teamBId) series.teamBWins += 1;

  applyPostseasonStats(postseason, result, series.stage);
  // 疲労・調子・怪我は通常どおり進む（ポストシーズン用の補正は入れない）
  applyDailyUpdates(state, rng, [result]);
  repairAllSetups(state);
  state.date = addDays(state.date, 1);

  settleSeries(series);
  advancePhase(state);
  return game;
}

/* ---------------- 段階の進行 ---------------- */

/** いまの段階が終わっていれば次の段階へ進む */
function advancePhase(state: GameState): void {
  const postseason = state.postseason;
  if (!postseason || postseason.phase === 'COMPLETE') return;

  if (postseason.phase === 'FIRST_STAGE') {
    const first = seriesOfStage(postseason, 'FIRST');
    if (!first.every(isSeriesComplete)) return;
    for (const league of state.leagues) {
      const participants = postseason.participants[league.id] ?? [];
      const top = participants[0];
      if (!top) continue;
      const firstSeries = first.find((s) => s.leagueId === league.id);
      // 進出が2球団以下なら、そのまま1位が相手を待たずに勝ち上がる
      const challenger = firstSeries?.winnerTeamId ?? participants[1];
      if (!challenger) {
        postseason.leagueChampions[league.id] = top;
        continue;
      }
      postseason.series.push(
        createSeries('FINAL', league.id, top, challenger, postseason.year),
      );
    }
    postseason.phase = 'FINAL_STAGE';
    advancePhase(state);
    return;
  }

  if (postseason.phase === 'FINAL_STAGE') {
    const finals = seriesOfStage(postseason, 'FINAL');
    if (!finals.every(isSeriesComplete)) return;
    for (const series of finals) {
      if (series.leagueId && series.winnerTeamId) {
        postseason.leagueChampions[series.leagueId] = series.winnerTeamId;
      }
    }
    // クライマックスシリーズMVP（ここまでの成績で決める）
    for (const league of state.leagues) {
      const championId = postseason.leagueChampions[league.id];
      if (!championId) continue;
      const mvp = pickSeriesMvp(state, postseason.stats, championId);
      if (mvp) postseason.csMvp[league.id] = mvp;
    }
    const champions = state.leagues
      .map((l) => postseason.leagueChampions[l.id])
      .filter((id): id is string => Boolean(id));
    if (champions.length >= 2) {
      // 日本シリーズのホームは、レギュラーシーズンの勝率が高いほう
      const [a, b] = champions;
      const better = betterRecord(state, a, b) ? a : b;
      const other = better === a ? b : a;
      postseason.series.push(
        createSeries('JAPAN_SERIES', null, better, other, postseason.year),
      );
      postseason.phase = 'JAPAN_SERIES';
      return;
    }
    // リーグが1つしかない構成では、そのままリーグ優勝が日本一になる
    postseason.championTeamId = champions[0] ?? null;
    postseason.phase = 'COMPLETE';
    return;
  }

  const japan = seriesOfStage(postseason, 'JAPAN_SERIES');
  if (japan.length === 0 || !japan.every(isSeriesComplete)) return;
  postseason.championTeamId = japan[0].winnerTeamId;
  if (postseason.championTeamId) {
    const mvp = pickSeriesMvp(state, postseason.japanSeriesStats, postseason.championTeamId);
    postseason.japanSeriesMvpPlayerId = mvp;
  }
  postseason.phase = 'COMPLETE';
}

/** レギュラーシーズンの成績が良いほう */
function betterRecord(state: GameState, a: string, b: string): boolean {
  const ra = state.records[a];
  const rb = state.records[b];
  const pct = (r: typeof ra) => (r.wins + r.losses === 0 ? 0 : r.wins / (r.wins + r.losses));
  if (pct(ra) !== pct(rb)) return pct(ra) > pct(rb);
  if (ra.wins !== rb.wins) return ra.wins > rb.wins;
  return a < b;
}

/* ---------------- MVP ---------------- */

/** シリーズMVPの素点（取得できる成績だけで計算する） */
export function seriesMvpScore(stats: PlayerSeasonStats): number {
  const b = stats.batting;
  const p = stats.pitching;
  const innings = p.outs / 3;
  const batting = b.hits * 1.2 + b.homeRuns * 3 + b.rbi * 1.4 + b.runs * 0.6 + b.steals * 0.5;
  const pitching =
    p.wins * 4 + p.saves * 2.4 + p.holds * 1.2 + p.strikeouts * 0.25 + innings * 0.6 -
    p.earnedRuns * 0.8;
  return batting + pitching;
}

/** その球団でいちばん活躍した選手を選ぶ */
export function pickSeriesMvp(
  state: GameState,
  stats: Record<string, PlayerSeasonStats>,
  teamId: string,
): string | null {
  let best: { playerId: string; score: number } | null = null;
  for (const [playerId, line] of Object.entries(stats)) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || player.teamId !== teamId) continue;
    const score = seriesMvpScore(line);
    if (score <= 0) continue;
    if (
      best === null ||
      score > best.score ||
      // 同点なら選手IDで決めて、実行するたびに変わらないようにする
      (score === best.score && playerId < best.playerId)
    ) {
      best = { playerId, score };
    }
  }
  return best?.playerId ?? null;
}

/* ---------------- 一気に進める ---------------- */

/** ポストシーズンが終わっているか */
export function isPostseasonComplete(state: GameState): boolean {
  return state.postseason?.phase === 'COMPLETE';
}

/**
 * ポストシーズンを最後まで自動で進める。
 * すでに終わっていれば何もしない（二重実行しても結果は変わらない）。
 */
export function autoCompletePostseason(state: GameState): void {
  if (!state.seasonFinished) return;
  ensurePostseason(state);
  if (!state.postseason) return;
  const gamesPlayed = () =>
    state.postseason?.series.reduce((sum, s) => sum + s.games.length, 0) ?? 0;
  // 最大でも 3 + 6 + 7 試合。余裕を持った回数で打ち切る
  for (let guard = 0; guard < 60; guard++) {
    if (isPostseasonComplete(state)) break;
    const before = gamesPlayed();
    playNextPostseasonGame(state);
    // 試合が増えず、次に進めるシリーズも無いなら、これ以上進めない
    if (gamesPlayed() === before && !isPostseasonComplete(state) && !currentSeries(state)) {
      break;
    }
  }
}
