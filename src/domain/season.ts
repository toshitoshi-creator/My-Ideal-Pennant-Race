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
import { createDraft, finishDraft, autoPick, currentPick, beginDraftPicks } from './draft';
import { resetScoutingForDraft, runCpuScouting } from './scouting';
import {
  applySeasonFinance,
  isExpiring,
  refreshPayrolls,
  releaseUnsignedPlayers,
  renewTeamContracts,
  rookieContract,
  runCpuRenewals,
  tickContracts,
} from './contract';
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

  // ---- PHASE 3.3: 今季分の人件費を精算する（1シーズンに1回だけ） ----
  applySeasonFinance(state);

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
    // 引退した選手には以後の年俸が発生しない
    player.ext.contract = null;
    delete state.stats[player.id];
  }
  state.players = remaining;
  refreshPayrolls(state);
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

  // ---- ドラフト準備（PHASE 3.2：まずスカウト期間から始まる） ----
  state.draft = createDraft(state, rng);
  if (state.draft) {
    resetScoutingForDraft(state.scouting, state.year);
    runCpuScouting(state, rng);
  }

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
  beginDraftPicks(state, rng);
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
/**
 * ドラフトを締めて新人を加入させ、契約更改フェーズに入る（PHASE 3.3）。
 * ここではまだシーズンを開幕しない。
 */
export function startContractPhase(state: GameState): Player[] {
  autoCompleteDraft(state);
  const draft = state.draft;
  const rng = new Rng(state.rngState);

  const rookies = draft ? finishDraft(state, state.teams) : [];
  for (const rookie of rookies) {
    // 新人は自動的に新人契約を結ぶ（無契約でシーズンに入らない）
    const pick = draft?.picks.find((p) => {
      const prospect = draft.prospects.find((x) => x.id === p.prospectId);
      return prospect?.player.id === rookie.id;
    });
    rookie.ext.contract = rookieContract(rookie, pick?.round ?? 4, state.year, rng);
    state.players.push(rookie);
    state.stats[rookie.id] = emptySeasonStats(rookie.id);
  }
  state.draft = null;

  // 契約年数を1年進める（1シーズンに1回だけ）
  const renewalTargets = tickContracts(state).length;
  state.lastOffseason = {
    year: state.year,
    retired: state.retiredPlayers.filter((r) => r.retiredAt === state.year).length,
    rookies: rookies.length,
    released: 0,
    renewalTargets,
  };

  // CPU球団の契約更改
  runCpuRenewals(state, rng);

  // プレイヤー球団の契約満了選手を交渉待ちにする
  const pending = state.players
    .filter((p) => p.teamId === state.playerTeamId && isExpiring(p))
    .sort((a, b) => (b.ext.contract?.salary ?? 0) - (a.ext.contract?.salary ?? 0))
    .map((p) => p.id);

  state.contractPhase = {
    year: state.year,
    pending,
    resolved: [],
    completed: pending.length === 0,
  };
  state.rngState = rng.getState();
  refreshPayrolls(state);
  return rookies;
}

/** 未交渉の選手をCPUと同じ基準で自動更改する */
export function autoCompleteContracts(state: GameState): void {
  const phase = state.contractPhase;
  if (!phase || phase.completed) return;
  const rng = new Rng(state.rngState);
  renewTeamContracts(state, state.playerTeamId, rng);
  state.rngState = rng.getState();
  phase.pending = [];
  phase.completed = true;
}

export function completeOffseason(state: GameState): Player[] {
  const rookies = state.contractPhase ? [] : startContractPhase(state);
  const rookieCount = state.contractPhase
    ? state.players.filter((p) => p.ext.debutYear === state.year + 1).length
    : rookies.length;
  autoCompleteContracts(state);

  // 契約が成立しなかった選手は球団を離れる（PHASE 3.4 の FA へ接続予定）
  const released = releaseUnsignedPlayers(state);
  for (const player of released) {
    if (player.teamId !== state.playerTeamId) continue;
    state.notices.push({
      date: state.date,
      kind: 'contract',
      message: `${player.name} と契約が成立せず、球団を去りました`,
    });
  }
  state.contractPhase = null;
  state.lastOffseason = {
    year: state.year,
    retired: state.retiredPlayers.filter((r) => r.retiredAt === state.year).length,
    rookies: rookieCount,
    released: released.length,
    renewalTargets: state.lastOffseason?.renewalTargets ?? 0,
  };

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
  refreshPayrolls(state);

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
