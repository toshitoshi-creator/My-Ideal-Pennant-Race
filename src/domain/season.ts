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
  FAState,
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
import {
  resolveFreeAgency,
  runCpuFAOffers,
  startFreeAgency,
} from './freeAgency';
import { resetTradeSeason } from './trade';
import { refreshNeedsAfterDraft, refreshTeamPlans } from './teamAi';
import { finalizeSeason, recordRetirements } from './history';
import { autoCompletePostseason } from './postseason';
import { generateRetirementNews } from './news';
import { buildSeasonStory } from './story';
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

  // ---- PHASE 3.8: ポストシーズンを最後まで進める ----
  // 日本一が決まってから歴史を確定する。すでに終わっていれば何もしない。
  autoCompletePostseason(state);

  // ---- PHASE 3.7: 今季を歴史に確定する ----
  // 成長・引退でデータが変わる前に、いま残っている成績をそのまま記録する。
  // 同じ年に二度呼ばれても二重には記録されない。
  finalizeSeason(state);

  // ---- PHASE 3.3: 今季分の人件費を精算する（1シーズンに1回だけ） ----
  applySeasonFinance(state);

  // ---- PHASE 3.6: 各球団の戦力を分析し、今季の経営プランを決める ----
  // （成長・引退の前の戦力で判断する。契約更改・ドラフト・FA・トレードで共有する）
  refreshTeamPlans(state);

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

  // ---- PHASE 3.7: 引退した選手の歴史を確定し、殿堂入りを判定する ----
  const inducted = recordRetirements(
    state,
    retirements.map((r) => ({ playerId: r.playerId, finalOverall: r.finalOverall })),
  );
  for (const entry of inducted) {
    state.notices.push({
      date: state.date,
      kind: 'retire',
      message: `${entry.name}が殿堂入りしました`,
    });
  }

  state.retiredPlayers.push(...retirements);
  if (state.retiredPlayers.length > RETIRED_RECORD_LIMIT) {
    state.retiredPlayers.splice(0, state.retiredPlayers.length - RETIRED_RECORD_LIMIT);
  }
  // PHASE 3.9: 引退をニュースにする（通算成績は歴史から取る。理由は作らない）
  for (const record of retirements) {
    const history = state.history?.players?.[record.playerId];
    let career = '';
    if (history) {
      const b = history.career.batting;
      const p = history.career.pitching;
      career = p.games > b.games
        ? `通算${p.wins}勝${p.losses}敗、${p.strikeouts}奪三振。`
        : `通算${b.hits}安打、${b.homeRuns}本塁打。`;
    }
    generateRetirementNews(state, record, career);
  }

  for (const record of retirements) {
    if (record.teamId !== state.playerTeamId) continue;
    state.notices.push({
      date: state.date,
      kind: 'retire',
      message: `${record.name}（${record.age}歳・在籍${record.years}年）が現役を引退しました`,
    });
  }

  // ---- PHASE 3.9: 今季の物語をまとめる ----
  // 歴史の確定と引退のニュースが出そろってから作る。二度呼んでも作り直さない。
  buildSeasonStory(state, state.year);

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
    rookie.ext.careerTeams = [{ year: state.year, teamId: rookie.teamId }];
    state.players.push(rookie);
    state.stats[rookie.id] = emptySeasonStats(rookie.id);
  }
  state.draft = null;

  // PHASE 3.6: ドラフトの結果を補強ポイントに反映する
  refreshNeedsAfterDraft(state);

  // 契約年数を1年進める（1シーズンに1回だけ）
  const renewalTargets = tickContracts(state).length;
  state.lastOffseason = {
    year: state.year,
    retired: state.retiredPlayers.filter((r) => r.retiredAt === state.year).length,
    rookies: rookies.length,
    released: 0,
    renewalTargets,
    faListed: 0,
    faSigned: 0,
    faSignedByPlayer: 0,
    faUnsigned: 0,
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
  // すでにプレイヤーが交渉した選手（決裂も含む）は自動更改の対象から外す
  renewTeamContracts(state, state.playerTeamId, rng, {
    skip: phase.resolved.map((r) => r.playerId),
  });
  state.rngState = rng.getState();
  phase.pending = [];
  phase.completed = true;
}

/**
 * 契約更改を締めて FA 市場を開く（PHASE 3.4）。
 * 契約が成立しなかった選手は球団を離れ、FA 市場に並ぶ。
 * CPU 球団のオファーもこの時点で出そろう。
 */
export function startFAPhase(state: GameState): FAState {
  if (state.contractPhase) {
    autoCompleteContracts(state);

    // 退団の通知は自球団の選手だけに出す（解除すると teamId が消えるので先に控える）
    const ownRoster = new Set(
      state.players.filter((p) => p.teamId === state.playerTeamId).map((p) => p.id),
    );
    for (const player of releaseUnsignedPlayers(state)) {
      if (!ownRoster.has(player.id)) continue;
      state.notices.push({
        date: state.date,
        kind: 'contract',
        message: `${player.name} と契約が成立せず、FA市場へ移りました`,
      });
    }
    state.contractPhase = null;
  }

  const fa = startFreeAgency(state);
  runCpuFAOffers(state);
  return fa;
}

/** FA 市場を締め切って契約先を決める */
export function resolveFAPhase(state: GameState): void {
  if (!state.fa) return;
  resolveFreeAgency(state);
  for (const record of state.fa.results) {
    if (record.teamId !== state.playerTeamId) continue;
    state.notices.push({
      date: state.date,
      kind: 'fa',
      message: `${record.name} とFA契約が成立しました（${record.salary}／${record.years}年）`,
    });
  }
}

export function completeOffseason(state: GameState): Player[] {
  const rookies = state.contractPhase || state.fa ? [] : startContractPhase(state);
  const rookieCount =
    state.contractPhase || state.fa
      ? state.players.filter((p) => p.ext.debutYear === state.year + 1).length
      : rookies.length;

  // ---- PHASE 3.4: 契約更改 → FA 市場 → 解決 ----
  const listedBefore = state.freeAgents.length;
  startFAPhase(state);
  const faListed = state.fa?.listings.length ?? 0;
  resolveFAPhase(state);
  const signings = state.fa?.results ?? [];
  const faSigned = signings.length;
  const faSignedByPlayer = signings.filter((r) => r.teamId === state.playerTeamId).length;
  const faUnsigned = state.freeAgents.length;

  // 「今オフに球団を離れて未所属のまま終わった人数（差引）」
  // players 数 = 前年 - 引退 + 新人 - released が常に成立する
  const released = faUnsigned - listedBefore;

  state.fa = null;
  state.lastOffseason = {
    year: state.year,
    retired: state.retiredPlayers.filter((r) => r.retiredAt === state.year).length,
    rookies: rookieCount,
    released,
    renewalTargets: state.lastOffseason?.renewalTargets ?? 0,
    faListed,
    faSigned,
    faSignedByPlayer,
    faUnsigned,
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
  // 球団別の成績も作り直す（歴史には確定済み）。PHASE 3.7
  state.teamStats = {};
  // ポストシーズンは翌シーズンぶんを改めて作る（結果は歴史に残っている）。PHASE 3.8
  state.postseason = null;
  for (const player of state.players) {
    state.stats[player.id] = emptySeasonStats(player.id);
  }

  // PHASE 3.5: トレード期間を新シーズンぶん作り直す（履歴は残る）
  resetTradeSeason(state);

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
