/**
 * セーブデータの移行（PHASE 2）。
 *
 * v1: PHASE 1（弾道 1〜4）
 * v2: 弾道 1〜100
 * v3: PHASE 2（性格・潜在能力・成長タイプ・特殊能力・疲労・コンディション・怪我）
 * v4: PHASE 2.5（調子のカテゴリ別補正・調子の履歴）
 * v5: PHASE 3.1（引退記録・ドラフト）
 * v6: PHASE 3.2（スカウト能力・調査ポイント・ScoutReport）
 * v7: PHASE 3.3（契約・年俸・球団資金）
 * v8: PHASE 3.4（FA市場・未所属選手）
 * v9: PHASE 3.5（トレード・在籍履歴）
 * v10: PHASE 3.6（球団経営AIのプラン）
 *
 * 古いセーブは不足分を安全な初期値で補完し、既存のデータ（能力・成績・順位・日付・
 * 1軍/2軍・7日制限）は一切書き換えない。
 */
import type { Contract, GameState, Player } from './types';
import { Rng, seedFrom } from './rng';
import { LEGACY_TRAJECTORY_MAX, migrateLegacyTrajectory } from './trajectory';
import { defaultExtensions } from './playerGen';
import { PERSONALITY_IDS } from './personality';
import { GROWTH_TENDENCY_IDS, GROWTH_TYPE_IDS } from './growth';
import { overallRating } from './rating';
import { createScoutAbilities, createScoutingState, SCOUT_POINTS_PER_YEAR } from './scouting';
import { createContract, createTeamFinance, marketValue, refreshPayrolls } from './contract';
import { repairFreeAgents } from './freeAgency';
import { createHistoryState, ensureHistory } from './history';
import { createNewsState, ensureNews } from './news';
import { createTradeState, tradeDeadline } from './trade';
import { clamp1to100 } from './rank';

/** v1 → v2：弾道を 1〜4 から 1〜100 へ */
export function migrateV1ToV2(state: GameState): void {
  for (const player of state.players) {
    if (player.batting && player.batting.trajectory <= LEGACY_TRAJECTORY_MAX) {
      player.batting.trajectory = migrateLegacyTrajectory(player.batting.trajectory);
    }
  }
  state.version = 2;
}

/** v2 → v3：PHASE 2 のデータを補完する */
export function migrateV2ToV3(state: GameState): void {
  for (const player of state.players) {
    fillPhase2Extensions(player);
  }
  if (!state.teamMorale) state.teamMorale = {};
  for (const team of state.teams) {
    if (typeof state.teamMorale[team.id] !== 'number') state.teamMorale[team.id] = 50;
  }
  if (state.lastGrowthReport === undefined) state.lastGrowthReport = null;
  if (!Array.isArray(state.notices)) state.notices = [];
  state.version = 3;
}

/** v3 → v4：調子の履歴など PHASE 2.5 のフィールドを補う */
export function migrateV3ToV4(state: GameState): void {
  for (const player of state.players) {
    const ext = player.ext as Partial<Player['ext']>;
    if (!Array.isArray(ext.conditionHistory)) {
      // 履歴がない古いセーブは、今の調子だけを記録した状態から始める
      ext.conditionHistory = ext.condition ? [ext.condition] : [];
    }
    if (typeof ext.condition !== 'string') ext.condition = 'normal';
    if (typeof ext.conditionTimer !== 'number') ext.conditionTimer = 0;
  }
  state.version = 4;
}

/** v4 → v5：引退・ドラフト関連のフィールドを補う */
export function migrateV4ToV5(state: GameState): void {
  if (!Array.isArray(state.retiredPlayers)) state.retiredPlayers = [];
  if (state.draft === undefined) state.draft = null;
  if (state.lastDraftYear === undefined) state.lastDraftYear = null;
  for (const player of state.players) {
    const ext = player.ext as Partial<Player['ext']>;
    if (typeof ext.debutYear !== 'number') {
      // 20歳前後でプロ入りした想定で通算年数の起点を決める
      ext.debutYear = state.year - Math.max(0, player.age - 20);
    }
  }
  state.version = 5;
}

/** v5 → v6：スカウト情報を補う */
export function migrateV5ToV6(state: GameState): void {
  if (!state.scouting || typeof state.scouting !== 'object' || !state.scouting.teams) {
    state.scouting = createScoutingState(state.teams, new Rng(seedFrom(`scout${state.seed}`)), state.year);
  } else {
    for (const team of state.teams) {
      if (!state.scouting.teams[team.id]) {
        const rng = new Rng(seedFrom(`scout${state.seed}${team.id}`));
        state.scouting.teams[team.id] = {
          ability: createScoutAbilities([team], rng)[team.id],
          points: SCOUT_POINTS_PER_YEAR,
          reports: {},
        };
      }
    }
  }
  // 進行中の古いドラフトは指名段階として扱う
  if (state.draft && !state.draft.phase) state.draft.phase = 'picking';
  state.version = 6;
}

/** v6 → v7：契約・球団資金を補う */
export function migrateV6ToV7(state: GameState): void {
  if (!state.finances || typeof state.finances !== 'object') state.finances = {};
  for (const team of state.teams) {
    const finance = state.finances[team.id];
    if (!finance || !Number.isFinite(finance.cash) || !Number.isFinite(finance.budget)) {
      state.finances[team.id] = createTeamFinance(new Rng(seedFrom(`finance${state.seed}${team.id}`)));
      continue;
    }
    // 壊れた値は安全な既定値へ戻す
    if (!Number.isFinite(finance.annualRevenue)) finance.annualRevenue = finance.budget;
    if (!Number.isFinite(finance.payroll)) finance.payroll = 0;
    if (!Number.isFinite(finance.lastResult)) finance.lastResult = 0;
  }

  for (const player of state.players) {
    const ext = player.ext as Partial<Player['ext']>;
    const contract = ext.contract as Partial<Contract> | null | undefined;
    const valid =
      contract &&
      Number.isFinite(contract.salary) &&
      Number.isFinite(contract.yearsRemaining) &&
      (contract.salary ?? -1) >= 0 &&
      (contract.yearsRemaining ?? -1) >= 0;
    if (!valid) {
      const years = 1 + (seedFrom(player.id) % 4);
      ext.contract = createContract(
        marketValue(player, state.stats?.[player.id], state.year),
        years,
        state.year - (4 - years),
      );
    } else {
      // 型が古い（{salary, years}）場合の補完
      ext.contract = createContract(
        contract!.salary!,
        contract!.yearsRemaining ?? contract!.totalYears ?? 1,
        contract!.signedYear ?? state.year,
      );
    }
  }

  if (state.contractPhase === undefined) state.contractPhase = null;
  if (state.lastPayrollYear === undefined) state.lastPayrollYear = null;
  if (state.lastContractYear === undefined) state.lastContractYear = null;
  if (state.lastOffseason === undefined) state.lastOffseason = null;
  refreshPayrolls(state);
  state.version = 7;
}

/** v7 → v8：FA市場のフィールドを補う */
export function migrateV7ToV8(state: GameState): void {
  if (!Array.isArray(state.freeAgents)) state.freeAgents = [];
  if (state.fa === undefined) state.fa = null;
  if (state.lastFaYear === undefined) state.lastFaYear = null;

  // PHASE 3.3 までの lastOffseason には FA の項目がない
  if (state.lastOffseason) {
    const summary = state.lastOffseason as Partial<NonNullable<GameState['lastOffseason']>>;
    if (typeof summary.faListed !== 'number') summary.faListed = 0;
    if (typeof summary.faSigned !== 'number') summary.faSigned = 0;
    if (typeof summary.faSignedByPlayer !== 'number') summary.faSignedByPlayer = 0;
    if (typeof summary.faUnsigned !== 'number') summary.faUnsigned = state.freeAgents.length;
  }

  // 壊れた未所属データ（所属と二重・引退済み・teamId が残っている）を直す
  repairFreeAgents(state);
  state.version = 8;
}

/** v8 → v9：トレードのフィールドを補う */
export function migrateV8ToV9(state: GameState): void {
  // v8 から直接読み込む場合、FA のフィールドが無いことがある
  if (!Array.isArray(state.freeAgents)) state.freeAgents = [];
  if (state.fa === undefined) state.fa = null;
  if (!state.trade || typeof state.trade !== 'object') {
    state.trade = createTradeState(state);
  } else {
    const trade = state.trade as Partial<GameState['trade']>;
    if (typeof trade.year !== 'number') trade.year = state.year;
    if (typeof trade.deadline !== 'string') trade.deadline = tradeDeadline(state);
    if (!Array.isArray(trade.offers)) trade.offers = [];
    if (!Array.isArray(trade.history)) trade.history = [];
    if (!Array.isArray(trade.tradedThisSeason)) trade.tradedThisSeason = [];
    if (!trade.countByTeam || typeof trade.countByTeam !== 'object') trade.countByTeam = {};
  }

  // 在籍履歴がない選手は、今の球団から始まったものとして補う
  for (const player of [...state.players, ...state.freeAgents]) {
    const ext = player.ext as Partial<Player['ext']>;
    if (!Array.isArray(ext.careerTeams) || ext.careerTeams.length === 0) {
      ext.careerTeams = player.teamId
        ? [{ year: ext.debutYear ?? state.year, teamId: player.teamId }]
        : [];
    }
  }

  // 実在しない球団・選手を指す提案は落とす
  state.trade.offers = state.trade.offers.filter(
    (offer) =>
      state.teams.some((t) => t.id === offer.fromTeamId) &&
      state.teams.some((t) => t.id === offer.toTeamId),
  );
  state.version = 9;
}

/** v9 → v10：球団経営AIのプランを補う */
export function migrateV9ToV10(state: GameState): void {
  if (!state.teamPlans || typeof state.teamPlans !== 'object') state.teamPlans = {};
  if (state.teamPlansYear === undefined) state.teamPlansYear = null;

  // 実在しない球団のプランは落とす。壊れたプランも作り直させる
  for (const teamId of Object.keys(state.teamPlans)) {
    const plan = state.teamPlans[teamId];
    const valid =
      state.teams.some((t) => t.id === teamId) &&
      plan &&
      typeof plan.year === 'number' &&
      plan.needs &&
      typeof plan.needs === 'object' &&
      plan.profile &&
      typeof plan.faBudget === 'number';
    if (!valid) delete state.teamPlans[teamId];
  }
  // 古いセーブは次のオフシーズンで作り直す
  if (Object.keys(state.teamPlans).length === 0) state.teamPlansYear = null;
  state.version = 10;
}

/**
 * v10 → v11：PHASE 3.7 の歴史・記録を用意する。
 *
 * 古いセーブには過去の詳細成績が残っていないので、
 * 推測して作らず「まだ歴史が無い」状態から始める。
 * 今季ぶんの球団別成績も、どの球団で挙げたかを復元できないため、
 * 現在の所属球団の成績としてだけ引き継ぐ（合算値は変わらない）。
 */
export function migrateV10ToV11(state: GameState): void {
  if (!state.history || typeof state.history !== 'object') {
    state.history = createHistoryState();
  }
  ensureHistory(state);

  if (!state.teamStats || typeof state.teamStats !== 'object') state.teamStats = {};
  for (const player of state.players) {
    if (state.teamStats[player.id]) continue;
    const stats = state.stats?.[player.id];
    if (!stats) continue;
    state.teamStats[player.id] = { [player.teamId]: structuredClone(stats) };
  }
  state.version = 11;
}

/**
 * v11 → v12：PHASE 3.8 のポストシーズンを用意する。
 *
 * 過去の年度の順位・優勝は作り直さない（§25）。
 * ポストシーズンは、このセーブで次にレギュラーシーズンを終えた年から始まる。
 */
export function migrateV11ToV12(state: GameState): void {
  if (state.postseason === undefined) state.postseason = null;
  // 別の年のポストシーズンが残っていたら捨てる
  if (state.postseason && state.postseason.year !== state.year) state.postseason = null;
  state.version = 12;
}

/**
 * v12 → v13：PHASE 3.9 のニュースを用意する。
 *
 * 過去のニュースはさかのぼって作らない（§40）。
 * 空の状態から始め、次に起きた出来事からニュースが積まれていく。
 * 既存の歴史には一切手を入れない。
 */
export function migrateV12ToV13(state: GameState): void {
  if (!state.news || typeof state.news !== 'object') {
    state.news = createNewsState();
  }
  ensureNews(state);
  state.version = 13;
}

/**
 * PHASE 2 のフィールドが欠けている選手に、選手ごとに安定した初期値を入れる。
 * 既存の能力・年齢・成績には触れない。
 */
export function fillPhase2Extensions(player: Player): void {
  const defaults = defaultExtensions();
  const previous = (player.ext ?? {}) as Partial<typeof defaults>;
  const rng = new Rng(seedFrom(player.id));

  const ext = { ...defaults, ...previous } as typeof defaults;

  // 旧データは personality が null / 旧文字列のことがある
  if (!PERSONALITY_IDS.includes(ext.personality)) {
    ext.personality = rng.pick(PERSONALITY_IDS);
  }
  if (!GROWTH_TYPE_IDS.includes(ext.growthType)) {
    ext.growthType = rng.pick(GROWTH_TYPE_IDS);
  }
  if (!GROWTH_TENDENCY_IDS.includes(ext.growthTendency)) {
    ext.growthTendency = player.isPitcher
      ? rng.pick(['pitchingPower', 'pitchingControl'] as const)
      : rng.pick(['hitting', 'power', 'speed', 'defense', 'balanced'] as const);
  }
  if (typeof ext.growthRate !== 'number' || !Number.isFinite(ext.growthRate)) {
    ext.growthRate = Math.round((0.5 + rng.next()) * 100) / 100;
  }
  if (typeof ext.potential !== 'number' || !Number.isFinite(ext.potential)) {
    const current = overallRating(player);
    const youth = Math.max(0, 30 - player.age);
    ext.potential = clamp1to100(current + rng.normal(youth * 1.1 + 4, 8));
  }
  if (!Array.isArray(ext.specialAbilities)) ext.specialAbilities = [];
  if (typeof ext.fatigue !== 'number') ext.fatigue = 0;
  if (typeof ext.condition !== 'string') ext.condition = 'normal';
  if (typeof ext.conditionTimer !== 'number') ext.conditionTimer = rng.int(0, 2);
  if (!Array.isArray(ext.conditionHistory)) ext.conditionHistory = [ext.condition];
  if (typeof ext.debutYear !== 'number') ext.debutYear = null;
  if (typeof ext.motivation !== 'number') ext.motivation = 55;
  if (typeof ext.morale !== 'number') ext.morale = 50;
  if (ext.injury === undefined) ext.injury = null;
  if (typeof ext.injuryDemotion !== 'boolean') ext.injuryDemotion = false;
  if (ext.slump === undefined) ext.slump = null;
  if (typeof ext.form !== 'number') ext.form = 50;
  if (typeof ext.consecutiveGames !== 'number') ext.consecutiveGames = 0;
  if (typeof ext.firstTeamGames !== 'number') ext.firstTeamGames = 0;
  if (typeof ext.secondTeamDays !== 'number') ext.secondTeamDays = 0;
  if (!ext.hiddenAttributes || typeof ext.hiddenAttributes !== 'object') {
    ext.hiddenAttributes = {};
  }
  if (ext.popularity === undefined) ext.popularity = null;
  if (ext.contract === undefined) ext.contract = null;
  if (ext.faStatus === undefined) ext.faStatus = null;
  if (!Array.isArray(ext.careerTeams)) ext.careerTeams = [];

  // PHASE 1 の置き場所だった specialSkills は specialAbilities に統合済み
  delete (ext as unknown as Record<string, unknown>).specialSkills;

  player.ext = ext;
}
