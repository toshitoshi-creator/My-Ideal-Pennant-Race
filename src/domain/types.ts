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
  contract: null | { salary: number; years: number };
  faStatus: null | { serviceDays: number; eligible: boolean };
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
}

/** シーズン終了時の成長レポート（表示用） */
export interface GrowthReport {
  year: number;
  teamId: string;
  players: GrowthReportEntry[];
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

export type NoticeKind = 'injury' | 'return' | 'condition' | 'season' | 'growth';

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
