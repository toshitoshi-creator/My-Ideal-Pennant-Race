/**
 * シーズンの締めと翌シーズンの開始（PHASE 2 / PHASE 3.1）。
 *
 * ライフサイクル：
 *   シーズン終了 → 年齢+1・成長／衰退 → 引退判定 → ドラフト候補生成 → ドラフト
 *   → 新人加入 → ロスター再構築 → 翌シーズン開幕
 *
 * 年齢の加算は applySeasonGrowth の中の1回だけ。引退やドラフトでは加算しない。
 */
import type {
  GameState,
  GrowthReport,
  GrowthReportEntry,
  Player,
  RetiredPlayerRecord,
} from './types';
import { Rng } from './rng';
import { applySeasonGrowth, ABILITY_LABELS, type PlayerGrowthResult } from './growth';
import { generateSchedule, openingDate } from './schedule';
import { emptySeasonStats } from './stats';
import { defaultExtensions } from './playerGen';
import { playingTimeOf, rollRetirement } from './retirement';
import { overallRating } from './rating';
import { createDraft, finishDraft, runCpuPicks, autoPick, currentPick } from './draft';
import { repairAllSetups } from './engine';
import { ensureFirstTeamViable } from './daily';

/** 1軍・2軍の出場経験を 0〜1 に正規化する */
function experienceOf(state: GameState, player: Player): {
  first: number;
  second: number;
  performance: number;
} {
  const stats = state.stats[player.id];
  const games = state.seasonLength;
  if (!stats) return { first: 0, second: 0.3, performance: 0 };

  let first: number;
  let performance = 0;
  if (player.isPitcher) {
    const innings = stats.pitching.outs / 3;
    first = Math.min(1, innings / (games * 0.55));
    if (innings >= 10) {
      const era = (stats.pitching.earnedRuns * 9) / innings;
      performance = Math.max(-1, Math.min(1, (4.0 - era) / 2.5));
    }
  } else {
    first = Math.min(1, stats.batting.plateAppearances / (games * 3.5));
    if (stats.batting.atBats >= 50) {
      const avg = stats.batting.hits / stats.batting.atBats;
      const hrRate = stats.batting.homeRuns / stats.batting.atBats;
      performance = Math.max(-1, Math.min(1, (avg - 0.25) * 8 + hrRate * 12));
    }
  }

  // 2軍暮らしでも最低限の経験は積む（1軍経験の方が大きい）
  const second = Math.min(1, player.ext.secondTeamDays / (games * 1.2)) * 0.55;
  return { first, second, performance };
}

function toReportEntry(result: PlayerGrowthResult): GrowthReportEntry {
  return {
    playerId: result.playerId,
    name: result.name,
    ageBefore: result.ageBefore,
    ageAfter: result.ageAfter,
    awakened: result.awakened,
    total: Math.round(result.total * 10) / 10,
    changes: result.changes.map((c) => ({
      label: ABILITY_LABELS[c.key],
      before: c.before,
      after: c.after,
    })),
  };
}

export interface SeasonRolloverResult {
  report: GrowthReport;
  /** 全選手分の成長結果（バランス確認・テスト用） */
  all: PlayerGrowthResult[];
  /** 今オフに引退した選手 */
  retirements: RetiredPlayerRecord[];
}

/** 引退記録に残す最大件数（セーブサイズを抑えるため） */
const RETIRED_RECORD_LIMIT = 500;

/**
 * オフシーズンに入る：成長・衰退 → 年齢加算 → 引退 → ドラフト準備。
 * ドラフトはこの時点では未実施で、state.draft に指名待ちの状態が入る。
 */
export function startOffseason(state: GameState): SeasonRolloverResult {
  const rng = new Rng(state.rngState);
  const results: PlayerGrowthResult[] = [];

  for (const player of state.players) {
    const { first, second, performance } = experienceOf(state, player);
    results.push(
      applySeasonGrowth(rng, {
        player,
        firstTeamExperience: first,
        secondTeamExperience: second,
        performance,
      }),
    );
  }

  // ---- 引退判定（年齢は成長処理で加算済み。ここでは加算しない） ----
  const retirements: RetiredPlayerRecord[] = [];
  const remaining: Player[] = [];
  for (const player of state.players) {
    const stats = state.stats[player.id];
    const seriouslyInjured =
      player.ext.injury !== null && player.ext.injury.level !== 'minor';
    const retired = rollRetirement(rng, player, {
      playingTime: playingTimeOf(player, stats, state.seasonLength),
      seriouslyInjured,
    });
    if (!retired) {
      remaining.push(player);
      continue;
    }
    const debutYear = player.ext.debutYear ?? state.year;
    retirements.push({
      playerId: player.id,
      name: player.name,
      teamId: player.teamId,
      age: player.age,
      years: Math.max(1, state.year - debutYear + 1),
      finalOverall: overallRating(player),
      mainPosition: player.mainPosition,
      retiredAt: state.year,
    });
    delete state.stats[player.id];
  }
  state.players = remaining;
  state.retiredPlayers.push(...retirements);
  if (state.retiredPlayers.length > RETIRED_RECORD_LIMIT) {
    state.retiredPlayers.splice(0, state.retiredPlayers.length - RETIRED_RECORD_LIMIT);
  }
  for (const record of retirements) {
    if (record.teamId !== state.playerTeamId) continue;
    state.notices.push({
      date: state.date,
      kind: 'retire',
      message: `${record.name}（${record.age}歳・在籍${record.years}年）が現役を引退しました`,
    });
  }

  // 引退で穴が空いたオーダーを整える
  repairAllSetups(state);

  // ---- ドラフト準備 ----
  state.draft = createDraft(state, rng);
  if (state.draft) runCpuPicks(state, rng);

  state.rngState = rng.getState();

  const report: GrowthReport = {
    year: state.year,
    teamId: state.playerTeamId,
    players: results
      .filter((r) => r.teamId === state.playerTeamId)
      .filter((r) => state.players.some((p) => p.id === r.playerId))
      .sort((a, b) => b.total - a.total)
      .map(toReportEntry),
    retirements: retirements.filter((r) => r.teamId === state.playerTeamId),
  };
  state.lastGrowthReport = report;

  return { report, all: results, retirements };
}

/** ドラフトが残っていれば最後まで自動で進める */
export function autoCompleteDraft(state: GameState): void {
  const draft = state.draft;
  if (!draft || draft.completed) return;
  const rng = new Rng(state.rngState);
  let guard = 0;
  while (!draft.completed && currentPick(draft) && guard++ < 500) {
    autoPick(state, draft, rng);
  }
  draft.completed = true;
  state.rngState = rng.getState();
}

/**
 * オフシーズンを終えて翌シーズンを開幕する。
 * 指名された新人を加入させ、成績・日程をリセットする。
 */
export function completeOffseason(state: GameState): Player[] {
  autoCompleteDraft(state);

  const rookies = state.draft ? finishDraft(state, state.teams) : [];
  for (const rookie of rookies) {
    state.players.push(rookie);
    state.stats[rookie.id] = emptySeasonStats(rookie.id);
  }
  state.draft = null;

  const rng = new Rng(state.rngState);

  // シーズンをまたいで状態をリセットする
  for (const player of state.players) {
    const ext = player.ext;
    const defaults = defaultExtensions();
    ext.fatigue = 0;
    ext.consecutiveGames = 0;
    ext.condition = 'normal';
    ext.conditionTimer = rng.int(1, 5);
    ext.conditionHistory = [ext.condition];
    ext.slump = null;
    ext.form = 50;
    ext.firstTeamGames = 0;
    ext.secondTeamDays = 0;
    ext.motivation = Math.round((ext.motivation + 55) / 2);
    ext.morale = defaults.morale;
    // 怪我はシーズンをまたいで残る（復帰日が来れば自動で治る）
  }

  state.rngState = rng.getState();
  state.year += 1;
  state.date = openingDate(state.year);
  state.schedule = generateSchedule(state.year, state.seasonLength, state.leagues, state.teams);
  state.results = [];
  state.seasonFinished = false;
  state.notices = [];

  for (const team of state.teams) {
    state.records[team.id] = {
      teamId: team.id,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      runsScored: 0,
      runsAllowed: 0,
    };
    state.teamMorale[team.id] = 50;
  }
  // 成績は全選手ぶん作り直す（新人も含めて 0 から始まる）
  state.stats = {};
  for (const player of state.players) {
    state.stats[player.id] = emptySeasonStats(player.id);
  }

  // 新人加入・引退を反映してロスターとオーダーを整える
  for (const team of state.teams) {
    ensureFirstTeamViable(state, team.id);
  }
  repairAllSetups(state);

  return rookies;
}

/**
 * シーズン終了から翌シーズン開幕までを一気に行う（ドラフトは自動指名）。
 * テストやシミュレーションから使う。
 */
export function startNextSeason(state: GameState): SeasonRolloverResult {
  const result = startOffseason(state);
  completeOffseason(state);
  return result;
}
