/**
 * シーズンの締めと翌シーズンの開始（PHASE 2）。
 * シーズン終了時に全選手の成長・衰退を処理し、成績・日程をリセットする。
 */
import type { GameState, GrowthReport, GrowthReportEntry, Player } from './types';
import { Rng } from './rng';
import { applySeasonGrowth, ABILITY_LABELS, type PlayerGrowthResult } from './growth';
import { generateSchedule, openingDate } from './schedule';
import { emptySeasonStats } from './stats';
import { defaultExtensions } from './playerGen';

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
}

/**
 * シーズンを締めて翌シーズンを開始する（state を直接更新する）。
 * 成長・年齢加算 → 状態リセット → 日程と成績のリセット。
 */
export function startNextSeason(state: GameState): SeasonRolloverResult {
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

    // シーズンをまたいで状態をリセットする
    const ext = player.ext;
    const defaults = defaultExtensions();
    ext.fatigue = 0;
    ext.consecutiveGames = 0;
    ext.condition = 'normal';
    ext.conditionTimer = rng.int(1, 5);
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
  for (const player of state.players) {
    state.stats[player.id] = emptySeasonStats(player.id);
  }

  const report: GrowthReport = {
    year: state.year - 1,
    teamId: state.playerTeamId,
    players: results
      .filter((r) => r.teamId === state.playerTeamId)
      .sort((a, b) => b.total - a.total)
      .map(toReportEntry),
  };
  state.lastGrowthReport = report;

  return { report, all: results };
}
