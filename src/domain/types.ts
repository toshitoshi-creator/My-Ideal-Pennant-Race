/**
 * データ構造。
 * PHASE 1 の基本能力・編成・試合に、PHASE 2 の個性（性格・潜在能力・成長タイプ・
 * 特殊能力・疲労・コンディション・モチベーション・怪我）を Player.ext として追加している。
 * PHASE 3 以降（契約・FA・ドラフト・施設など）も ext に足していける。
 */
import type { PersonalityId } from './personality';
import type { SpecialAbilityEntry } from './specialAbilities';
import type { GrowthTendencyId, GrowthTypeId } from './growth';

export type PositionId =
  | 'P'
  | 'C'
  | '1B'
  | '2B'
  | '3B'
  | 'SS'
  | 'LF'
  | 'CF'
  | 'RF';

export type RosterLevel = 'first' | 'second';

/** 1〜100 の能力値に対するランク */
export type AbilityRank = 'G' | 'F' | 'E' | 'D' | 'C' | 'B' | 'A';

export interface BatterAbilities {
  /**
   * 弾道 1〜100（他の能力値と同じスケール・G〜Aランク）。
   * ただし試合計算では他能力と同じ割合で加算せず、
   * domain/trajectory.ts の独立した係数を通して長打・本塁打率に影響する。
   */
  trajectory: number;
  /** ミート 1〜100 */
  contact: number;
  /** パワー 1〜100 */
  power: number;
  /** 走力 1〜100 */
  speed: number;
  /** 肩力 1〜100 */
  arm: number;
  /** 守備力 1〜100 */
  fielding: number;
  /** 捕球 1〜100 */
  catching: number;
}

export interface PitcherAbilities {
  /** 球速 km/h */
  velocity: number;
  /** 制球 1〜100 */
  control: number;
  /** スタミナ 1〜100 */
  stamina: number;
  /** 球威 1〜100（内部能力） */
  power: number;
  /** 変化量 1〜100（内部能力） */
  movement: number;
}

/** コンディション（5段階） */
export type ConditionId = 'best' | 'good' | 'normal' | 'bad' | 'worst';

/** 怪我の重さ */
export type InjuryLevel = 'minor' | 'moderate' | 'major';

export interface InjuryState {
  level: InjuryLevel;
  name: string;
  /** 発生日 */
  startDate: string;
  /** この日から出場可能 */
  returnDate: string;
}

export interface SlumpState {
  /** この日まで不調 */
  until: string;
  /** 実効能力の低下率（0.05 なら -5%） */
  severity: number;
}

/**
 * PHASE 2 で追加した選手の個性・状態。
 * PHASE 3 以降のフィールド（契約・FA・人気など）も既に器だけ用意してある。
 */
export interface PlayerExtensions {
  /** 誕生日（YYYY-MM-DD）。年齢は Player.age を正とし、こちらは表示用 */
  birthDate: string | null;
  /** 潜在能力 1〜100。プレイヤーには数値を見せない */
  potential: number;
  growthType: GrowthTypeId;
  /** 能力ごとの成長傾向 */
  growthTendency: GrowthTendencyId;
  /** 成長率 0.5〜1.5 */
  growthRate: number;
  personality: PersonalityId;
  specialAbilities: SpecialAbilityEntry[];
  /** 疲労 0〜100 */
  fatigue: number;
  condition: ConditionId;
  /** 調子を変えずに保つ残り日数（PHASE 2.5） */
  conditionTimer: number;
  /** 直近7日分の調子（古い順、最後が今日）。PHASE 2.5 */
  conditionHistory: ConditionId[];
  /** プロ入り年（通算年数の計算に使う）。PHASE 3.1 */
  debutYear: number | null;
  /** モチベーション 0〜100 */
  motivation: number;
  /** 個人の士気 0〜100 */
  morale: number;
  injury: InjuryState | null;
  /** 怪我で1軍を外れた選手（7日ルールの例外扱い） */
  injuryDemotion: boolean;
  slump: SlumpState | null;
  /** 直近の調子（0〜100、50が標準）。スランプ判定に使う */
  form: number;
  /** 連続出場日数 */
  consecutiveGames: number;
  /** 今シーズン1軍で出場した試合数 */
  firstTeamGames: number;
  /** 今シーズン2軍で過ごした日数（簡易） */
  secondTeamDays: number;
  /** 隠しパラメータ（PHASE 3 以降の拡張用） */
  hiddenAttributes: Record<string, number>;
  /** 以下は PHASE 3 以降で使用 */
  popularity: number | null;
  /** 契約（PHASE 3.3）。null は無契約 */
  contract: Contract | null;
  faStatus: null | { serviceDays: number; eligible: boolean };
  /**
   * 在籍した球団の履歴（古い順）。PHASE 3.5。
   * 入団・トレード・FA移籍のたびに1件追加する。
   */
  careerTeams: Array<{ year: number; teamId: string }>;
}

export interface Player {
  /** 同姓同名が発生しても必ず一意 */
  id: string;
  teamId: string;
  name: string;
  kana: string;
  age: number;
  uniformNumber: number;
  throws: 'R' | 'L';
  bats: 'R' | 'L';
  /** メインポジション */
  mainPosition: PositionId;
  /** サブポジション（PHASE 1 では生成のみ・守備適性の判定に使用） */
  subPositions: PositionId[];
  isPitcher: boolean;
  batting: BatterAbilities;
  /** 投手のみ */
  pitching: PitcherAbilities | null;
  roster: RosterLevel;
  /**
   * 1軍／2軍を最後に変更したゲーム内日付（YYYY-MM-DD）。
   * null なら制限なし。この日付 + 7日 が次に変更できる日。
   */
  lastRosterChangeDate: string | null;
  ext: PlayerExtensions;
}

export interface League {
  id: string;
  name: string;
  /** DH 制を採用するか */
  useDH: boolean;
}

export interface Team {
  id: string;
  leagueId: string;
  name: string;
  shortName: string;
  homeTown: string;
  color: string;
}

/** 守備位置つきの打順 1 枠 */
export interface LineupSlot {
  playerId: string;
  /** DH の打者は 'DH' */
  position: PositionId | 'DH';
}

export interface TeamSetup {
  teamId: string;
  /** 打順（DH 制なら 9 人すべて野手、非 DH 制なら 9 番が投手枠） */
  lineup: LineupSlot[];
  /** 先発ローテーション（最大 5 人の投手 ID） */
  rotation: string[];
  /** 次に先発する rotation のインデックス */
  rotationIndex: number;
}

export interface BattingStats {
  games: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  runs: number;
  steals: number;
  strikeouts: number;
  walks: number;
}

export interface PitchingStats {
  games: number;
  starts: number;
  /** アウト数（投球回 = outs / 3） */
  outs: number;
  wins: number;
  losses: number;
  holds: number;
  saves: number;
  strikeouts: number;
  walks: number;
  hitsAllowed: number;
  homeRunsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
}

export interface PlayerSeasonStats {
  playerId: string;
  batting: BattingStats;
  pitching: PitchingStats;
}

export interface TeamRecord {
  teamId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  runsScored: number;
  runsAllowed: number;
}

/** 試合の 1 チーム分の結果 */
export interface GameTeamResult {
  teamId: string;
  runs: number;
  hits: number;
  errors: number;
  /** 1回から順の得点。延長分も入る */
  inningRuns: number[];
}

export interface GameResult {
  id: string;
  date: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  home: GameTeamResult;
  away: GameTeamResult;
  innings: number;
  /** 引き分けなら null */
  winnerTeamId: string | null;
  loserTeamId: string | null;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  /** 簡易実況 */
  commentary: string[];
  /** 個人成績（この試合分） */
  playerLines: GamePlayerLine[];
}

export interface GamePlayerLine {
  playerId: string;
  teamId: string;
  batting: BattingStats | null;
  pitching: PitchingStats | null;
}

export interface ScheduledGame {
  id: string;
  date: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** 消化済みなら結果 ID（= ScheduledGame.id） */
  played: boolean;
}

export type SeasonLength = 10 | 30 | 143;

export interface GameState {
  /** セーブデータのスキーマバージョン */
  version: number;
  seed: number;
  rngState: number;
  year: number;
  /** ゲーム内日付 YYYY-MM-DD */
  date: string;
  seasonLength: SeasonLength;
  playerTeamId: string;
  leagues: League[];
  teams: Team[];
  players: Player[];
  setups: Record<string, TeamSetup>;
  schedule: ScheduledGame[];
  /** 消化済みの試合結果（新しいものが後ろ） */
  results: GameResult[];
  records: Record<string, TeamRecord>;
  stats: Record<string, PlayerSeasonStats>;
  /** シーズン終了フラグ */
  seasonFinished: boolean;
  /** 球団ごとのチーム士気 0〜100（PHASE 2） */
  teamMorale: Record<string, number>;
  /** 直近のシーズン終了時の成長結果（プレイヤー球団のみ保持） */
  lastGrowthReport: GrowthReport | null;
  /** 直近の怪我・復帰などの通知（新しいものが後ろ） */
  notices: GameNotice[];
  /** 引退選手の記録（PHASE 3.1） */
  retiredPlayers: RetiredPlayerRecord[];
  /** 進行中のドラフト（null ならドラフト中ではない）。PHASE 3.1 */
  draft: DraftState | null;
  /** 最後にドラフトを実施した年（二重実行の防止）。PHASE 3.1 */
  lastDraftYear: number | null;
  /** 球団ごとのスカウト能力・調査ポイント・調査結果。PHASE 3.2 */
  scouting: ScoutingState;
  /** 球団ごとの資金。PHASE 3.3 */
  finances: Record<string, TeamFinance>;
  /** 進行中の契約更改（null なら更改中ではない）。PHASE 3.3 */
  contractPhase: ContractPhase | null;
  /** 人件費を支払った年（二重支払いの防止）。PHASE 3.3 */
  lastPayrollYear: number | null;
  /** 契約年数を減算した年（二重減算の防止）。PHASE 3.3 */
  lastContractYear: number | null;
  /**
   * 直近のオフシーズンの増減（表示・検証用）。PHASE 3.3 / 3.4
   *
   * released は「今オフに球団を離れて未所属のまま終わった人数（差引）」。
   * FA市場で他球団と契約した選手はここから差し引かれるため、
   *   players 数 = 前年 - 引退 + 新人 - released
   * が常に成立する。
   */
  lastOffseason: {
    year: number;
    retired: number;
    rookies: number;
    released: number;
    /** 契約更改の対象になった選手数 */
    renewalTargets: number;
    /** FA市場に出た人数（PHASE 3.4） */
    faListed: number;
    /** FA市場で契約が成立した人数（PHASE 3.4） */
    faSigned: number;
    /** うちプレイヤー球団が獲得した人数（PHASE 3.4） */
    faSignedByPlayer: number;
    /** FA市場に残った人数（PHASE 3.4） */
    faUnsigned: number;
  } | null;
  /** 未所属（FA）の選手。teamId は '' で、state.players には含まれない。PHASE 3.4 */
  freeAgents: Player[];
  /** 進行中のFA市場（null ならFA期間ではない）。PHASE 3.4 */
  fa: FAState | null;
  /** FA市場を開催した年（二重開催の防止）。PHASE 3.4 */
  lastFaYear: number | null;
  /** トレード（期限・提案・履歴）。PHASE 3.5 */
  trade: TradeState;
}

/** シーズン終了時の成長レポート（表示用） */
export interface GrowthReport {
  year: number;
  teamId: string;
  players: GrowthReportEntry[];
  /** 今季かぎりで引退した選手（プレイヤー球団）。PHASE 3.1 */
  retirements: RetiredPlayerRecord[];
}

/**
 * 引退した選手の記録（PHASE 3.1）。
 * 将来の殿堂・歴代記録で使えるよう最小限の情報を残す。
 */
export interface RetiredPlayerRecord {
  playerId: string;
  name: string;
  teamId: string;
  age: number;
  /** 通算在籍年数 */
  years: number;
  finalOverall: number;
  mainPosition: PositionId;
  /** 引退した年 */
  retiredAt: number;
}

/** ドラフト候補（PHASE 3.1）。現役選手とは明確に分けて扱う */
export interface DraftProspect {
  id: string;
  /** 加入前の選手データ（teamId は空文字） */
  player: Player;
  /** 事前評価順（1が最上位） */
  draftRank: number;
  /** 表向きの現在能力の目安 */
  projectedAbility: number;
  /** 表向きの将来性ラベル（実数値は見せない） */
  projectedPotential: string;
  selectedBy?: string;
  selectedRound?: number;
  selectedPick?: number;
}

export interface DraftPick {
  round: number;
  pick: number;
  teamId: string;
  /** null は指名なし（パス） */
  prospectId: string | null;
}

/** 契約（PHASE 3.3）。年俸の単位は 1 = 100万円 */
export interface Contract {
  salary: number;
  yearsRemaining: number;
  totalYears: number;
  signedYear: number;
}

/** 契約の状態 */
export type ContractStatus = 'contracted' | 'expiring' | 'unsigned';

/** 球団の資金（PHASE 3.3） */
export interface TeamFinance {
  /** 球団資金の残高 */
  cash: number;
  /** 年間予算（人件費の目安） */
  budget: number;
  /**
   * 年間収入。PHASE 3.3 では内訳（チケット・グッズ・スポンサーなど）を持たず、
   * 1つの抽象値として扱う。
   */
  annualRevenue: number;
  /** 現在の総年俸 */
  payroll: number;
  /** 直近シーズンの収支 */
  lastResult: number;
}

/** オフシーズンの契約更改フェーズ（PHASE 3.3） */
export interface ContractPhase {
  year: number;
  /** プレイヤー球団の契約満了選手 */
  pending: string[];
  /** 交渉が済んだ選手 */
  resolved: Array<{
    playerId: string;
    name: string;
    accepted: boolean;
    salary: number;
    years: number;
  }>;
  completed: boolean;
}

/* ---------------- トレード：PHASE 3.5 ---------------- */

export type TradeOfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

/** 断られた理由（内部の数値は見せず、抽象的な理由だけを返す） */
export type TradeRejectReason = 'value' | 'position' | 'contract' | 'roster' | 'budget';

/** 球団の補強方針（seed から決まる軽い性格づけ） */
export type TradeTrait = 'WIN_NOW' | 'BALANCED' | 'YOUTH' | 'BUDGET';

/** トレードの提案 */
export interface TradeOffer {
  id: string;
  /** 提案した側 */
  fromTeamId: string;
  /** 提案された側 */
  toTeamId: string;
  /** fromTeam が渡す選手 */
  offeredPlayerIds: string[];
  /** toTeam が渡す選手 */
  requestedPlayerIds: string[];
  status: TradeOfferStatus;
  createdYear: number;
  createdDate: string;
  /** この日を過ぎると期限切れ */
  expiresDate: string;
  /** 提案された側から見た価値の比率（UIには数値を出さない） */
  evaluation?: number;
  reason?: TradeRejectReason;
}

/** 成立したトレードの記録 */
export interface TradeRecord {
  id: string;
  year: number;
  date: string;
  fromTeamId: string;
  toTeamId: string;
  playerIdsFrom: string[];
  playerIdsTo: string[];
  playerNamesFrom: string[];
  playerNamesTo: string[];
  /**
   * トレード時点での今季成績（選手ID→成績）。
   * 成績は選手についていくため、球団別の集計を復元するのに使う。
   */
  statsAtTrade: Record<string, PlayerSeasonStats>;
}

export interface TradeState {
  year: number;
  /** トレード期限（この日を過ぎると成立しない） */
  deadline: string;
  /** 進行中・処理済みの提案（今シーズン分） */
  offers: TradeOffer[];
  /** 成立したトレードの履歴（シーズンをまたいで残る） */
  history: TradeRecord[];
  /** 今シーズンにトレードされた選手ID（同じ選手を何度も動かさない） */
  tradedThisSeason: string[];
  /** 球団ごとの今季トレード成立数 */
  countByTeam: Record<string, number>;
}

/* ---------------- FA（フリーエージェント）：PHASE 3.4 ---------------- */

/** FA選手に期待される役割。市場での位置づけを表すラベル */
export type FARole = 'STARTER' | 'ROTATION' | 'BENCH' | 'PROSPECT';

/** FA市場での状態 */
export type FAListingStatus = 'AVAILABLE' | 'OFFERED' | 'SIGNED';

/** オファーの状態 */
export type FAOfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/** FA市場に出ている選手1人分の情報 */
export interface FAMarketPlayer {
  playerId: string;
  /** 市場に出た年 */
  listedYear: number;
  marketValue: number;
  /** 希望年俸 */
  askingSalary: number;
  /** これを下回るオファーは原則受け入れない（市場価値の70%） */
  minimumSalary: number;
  /** 希望契約年数 */
  preferredYears: number;
  role: FARole;
  status: FAListingStatus;
}

/** 1球団から1選手への契約提示 */
export interface FAOffer {
  id: string;
  playerId: string;
  teamId: string;
  salary: number;
  years: number;
  offeredYear: number;
  /** 解決時に計算された評価点（0〜1）。解決前は undefined */
  offerScore?: number;
  status: FAOfferStatus;
}

/** FA契約が成立した記録（表示・検証用） */
export interface FASignRecord {
  playerId: string;
  name: string;
  teamId: string;
  salary: number;
  years: number;
  /** その選手に届いていたオファー数 */
  offers: number;
}

/** 進行中のFA市場（PHASE 3.4） */
export interface FAState {
  year: number;
  /** open: 提示受付中 / resolved: 解決済み */
  phase: 'open' | 'resolved';
  listings: FAMarketPlayer[];
  offers: FAOffer[];
  results: FASignRecord[];
  /** 今オフ、契約先が決まらなかった選手数 */
  unsigned: number;
  completed: boolean;
}

/** スカウトの調査項目（PHASE 3.2） */
export type ScoutCategory = 'currentAbility' | 'potential' | 'personality' | 'skills';

/** 球団のスカウト能力（0〜100） */
export interface TeamScoutAbility {
  /** 現在能力の調査精度 */
  currentAbility: number;
  /** 潜在能力の調査精度 */
  potential: number;
  /** 性格・成長タイプの調査精度 */
  personality: number;
  /** 特殊能力の発見率 */
  skills: number;
}

/** 調査で判明した特殊能力（段階的に詳細になる） */
export interface DiscoveredAbility {
  id: string;
  polarity: 'positive' | 'negative';
  /** hint: 兆候だけ / name: 能力名まで / full: Lv まで */
  detail: 'hint' | 'name' | 'full';
  text: string;
  level?: number;
}

/** 調査で得られた推定情報（真の Player データとは別物） */
export interface ScoutEstimate {
  /** 推定現在能力の下限・上限（真の総合値そのものは持たない） */
  abilityLow: number;
  abilityHigh: number;
  /** 将来性のラベル。未調査なら null */
  potential: string | null;
  /** 成長タイプの推定テキスト。未調査なら null */
  growthType: string | null;
  /** 性格の推定テキスト。未調査なら null */
  personality: string | null;
  skills: DiscoveredAbility[];
}

/**
 * 球団がドラフト候補を調査した結果（PHASE 3.2）。
 * Player の真の能力値は一切書き換えない。
 */
export interface ScoutReport {
  prospectId: string;
  /** 項目ごとの調査進行度 0〜100 */
  progress: Record<ScoutCategory, number>;
  estimate: ScoutEstimate;
  /** 項目ごとの情報精度 0〜1（信頼度の表示に使う） */
  accuracy: Record<ScoutCategory, number>;
  updatedAt: number;
}

export interface TeamScouting {
  ability: TeamScoutAbility;
  /** 残りスカウトポイント */
  points: number;
  /** 候補ごとの調査結果（球団ごとに独立） */
  reports: Record<string, ScoutReport>;
}

export interface ScoutingState {
  year: number;
  teams: Record<string, TeamScouting>;
}

export interface DraftState {
  /** 'scouting' の間は調査だけ、'picking' で指名が始まる */
  phase: 'scouting' | 'picking';
  /** ドラフトを行うオフシーズンの年 */
  year: number;
  prospects: DraftProspect[];
  /** 1巡目の指名順（球団ID） */
  order: string[];
  rounds: number;
  /** 次の指名の通し番号（0始まり） */
  cursor: number;
  picks: DraftPick[];
  /** 球団ごとの必要人数 */
  needs: Record<string, number>;
  completed: boolean;
}

export interface GrowthReportEntry {
  playerId: string;
  name: string;
  ageBefore: number;
  ageAfter: number;
  awakened: boolean;
  total: number;
  changes: Array<{ label: string; before: number; after: number }>;
}

export type NoticeKind =
  | 'contract'
  | 'fa'
  | 'trade'
  | 'injury'
  | 'return'
  | 'condition'
  | 'season'
  | 'growth'
  | 'retire'
  | 'draft';

export interface GameNotice {
  date: string;
  kind: NoticeKind;
  message: string;
}

/** 1軍登録の上限 */
export const FIRST_TEAM_LIMIT = 31;
/** 球団の保有選手上限 */
export const ROSTER_LIMIT = 70;
/** 1軍／2軍を変更したあと再変更できるまでの日数 */
export const ROSTER_CHANGE_LOCK_DAYS = 7;
/** 延長は 12 回まで（それ以降は引き分け） */
export const MAX_INNINGS = 12;
