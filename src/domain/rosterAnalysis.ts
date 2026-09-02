/**
 * 戦力分析（PHASE 3.6）。
 *
 * CPU球団が「自分の戦力はどうなっているか」を把握するための土台。
 *
 * 設計上の約束：
 *  - この層は **CPUが知ってよい情報だけ** を受け取る（KnownPlayer）。
 *    真の潜在能力（Player.ext.potential）をそのまま渡せない型にしてある。
 *  - 人数だけでなく能力の高さで補強必要度を出す。
 *    「遊撃が3人いるが全員が総合30」は「2人だが55と50」より不足度が高い。
 *  - 純粋な計算だけを行い、状態は書き換えない。
 */
import type { GameState, PlayerSeasonStats, PositionId } from './types';
import { overallRating } from './rating';
import { teamPayroll } from './contract';
import { positionGroup } from './positions';

/** 補強を考える単位 */
export type PositionKey = 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'SP' | 'RP';

export const POSITION_KEYS: PositionKey[] = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'];

export const POSITION_KEY_LABELS: Record<PositionKey, string> = {
  C: '捕手',
  '1B': '一塁手',
  '2B': '二塁手',
  '3B': '三塁手',
  SS: '遊撃手',
  OF: '外野手',
  SP: '先発投手',
  RP: '救援投手',
};

/** その枠で必要な人数（1軍で使う想定の人数） */
export const POSITION_REQUIRED: Record<PositionKey, number> = {
  C: 2,
  '1B': 1,
  '2B': 1,
  '3B': 1,
  SS: 1,
  OF: 3,
  SP: 5,
  RP: 5,
};

/** 選手の役割 */
export type DepthSlot = 'STARTER' | 'BACKUP' | 'DEPTH' | 'PROSPECT';

/**
 * CPUが知ってよい選手情報だけをまとめた型。
 * 真の潜在能力は入らず、その球団から見た「推定」だけを持つ。
 */
export interface KnownPlayer {
  id: string;
  teamId: string;
  name: string;
  age: number;
  isPitcher: boolean;
  mainPosition: PositionId;
  /** 見えている現在能力 */
  overall: number;
  /** その球団から見た推定潜在能力（自球団の選手は正確に把握している） */
  estimatedPotential: number;
  salary: number;
  yearsRemaining: number;
  injured: boolean;
  stats: PlayerSeasonStats | undefined;
}

export interface PositionEntry {
  playerId: string;
  overall: number;
  age: number;
  slot: DepthSlot;
}

export interface PositionAnalysis {
  key: PositionKey;
  entries: PositionEntry[];
  count: number;
  starterOverall: number;
  backupOverall: number;
  averageAge: number;
  /** 0〜100 の補強必要度。100 が「完全な穴」 */
  need: number;
}

export interface RosterAnalysis {
  teamId: string;
  rosterSize: number;
  /** 主力の平均能力 */
  overall: number;
  averageAge: number;
  /** 25歳以下の比率 */
  youngRatio: number;
  /** 33歳以上の比率 */
  veteranRatio: number;
  payroll: number;
  budget: number;
  cash: number;
  /** これ以上使えない上限までの余力 */
  faRoom: number;
  /** 契約が今季で切れる人数 */
  expiringCount: number;
  positions: Record<PositionKey, PositionAnalysis>;
  /** 補強必要度が高い順の枠 */
  weakest: PositionKey[];
}

/* ---------------- 選手をどの枠で数えるか ---------------- */

/**
 * 投手を先発／救援に振り分ける。
 * スタミナが高い投手を先発候補として扱う（既存の先発ローテ選定と同じ考え方）。
 */
export function pitcherRole(player: { pitching: { stamina: number } | null }): 'SP' | 'RP' {
  const stamina = player.pitching?.stamina ?? 0;
  return stamina >= 45 ? 'SP' : 'RP';
}

export function positionKeyOf(player: KnownPlayer, stamina: number): PositionKey {
  if (player.isPitcher) return stamina >= 45 ? 'SP' : 'RP';
  const group = positionGroup(player.mainPosition);
  if (group === 'C') return 'C';
  if (group === 'OF') return 'OF';
  return player.mainPosition as PositionKey;
}

/* ---------------- 補強必要度 ---------------- */

/** 上位から順に重みをつけて、その枠の充実度を出す */
function qualityOf(overalls: number[], required: number): number {
  const weights: number[] = [];
  for (let i = 0; i < required + 1; i++) weights.push(1 - i * 0.18);
  const total = weights.reduce((a, b) => a + Math.max(0.2, b), 0);
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (overalls[i] ?? 0) * Math.max(0.2, weights[i]);
  }
  return sum / total;
}

/**
 * 充実度から補強必要度（0〜100）へ。
 * 総合55の主力＋45の控えなら 35 前後（現状維持可能）、
 * 全員が30台なら 75 前後（明確な弱点）になる。
 */
export function needFromQuality(quality: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - (quality - 20) * 2.2)));
}

function slotOf(index: number, required: number, age: number): DepthSlot {
  if (index < required) return 'STARTER';
  if (index < required + 1) return 'BACKUP';
  return age <= 23 ? 'PROSPECT' : 'DEPTH';
}

/* ---------------- 分析 ---------------- */

/**
 * 球団の戦力を分析する。
 * KnownPlayer しか受け取らないので、隠し情報が紛れ込むことはない。
 */
export function analyzeRoster(
  teamId: string,
  players: KnownPlayer[],
  staminaOf: (playerId: string) => number,
  finance: { payroll: number; budget: number; cash: number },
  payrollCeilingRatio: number,
): RosterAnalysis {
  const positions = {} as Record<PositionKey, PositionAnalysis>;
  const byKey = new Map<PositionKey, KnownPlayer[]>();
  for (const key of POSITION_KEYS) byKey.set(key, []);
  for (const player of players) {
    byKey.get(positionKeyOf(player, staminaOf(player.id)))!.push(player);
  }

  for (const key of POSITION_KEYS) {
    const required = POSITION_REQUIRED[key];
    const sorted = [...byKey.get(key)!].sort((a, b) => b.overall - a.overall);
    const entries: PositionEntry[] = sorted.map((p, i) => ({
      playerId: p.id,
      overall: p.overall,
      age: p.age,
      slot: slotOf(i, required, p.age),
    }));
    const quality = qualityOf(
      sorted.map((p) => p.overall),
      required,
    );
    positions[key] = {
      key,
      entries,
      count: sorted.length,
      starterOverall: sorted[0]?.overall ?? 0,
      backupOverall: sorted[required]?.overall ?? 0,
      averageAge: sorted.length
        ? Math.round((sorted.reduce((a, p) => a + p.age, 0) / sorted.length) * 10) / 10
        : 0,
      need: needFromQuality(quality),
    };
  }

  const core = [...players].sort((a, b) => b.overall - a.overall).slice(0, 18);
  const overall = core.length
    ? Math.round((core.reduce((a, p) => a + p.overall, 0) / core.length) * 10) / 10
    : 0;
  const averageAge = players.length
    ? Math.round((players.reduce((a, p) => a + p.age, 0) / players.length) * 10) / 10
    : 0;

  return {
    teamId,
    rosterSize: players.length,
    overall,
    averageAge,
    youngRatio: players.length
      ? players.filter((p) => p.age <= 25).length / players.length
      : 0,
    veteranRatio: players.length
      ? players.filter((p) => p.age >= 33).length / players.length
      : 0,
    payroll: finance.payroll,
    budget: finance.budget,
    cash: finance.cash,
    faRoom: Math.max(0, finance.budget * payrollCeilingRatio - finance.payroll),
    expiringCount: players.filter((p) => p.yearsRemaining <= 0).length,
    positions,
    weakest: [...POSITION_KEYS].sort((a, b) => positions[b].need - positions[a].need),
  };
}

/* ---------------- GameState からの取り出し ---------------- */

/**
 * その球団が知っている範囲で選手情報をまとめる。
 * 自球団の選手は潜在能力まで把握しているが、他球団の選手はスカウト精度ぶんの誤差が乗る。
 * （推定は estimate 関数として外から渡す。この層は隠し情報に触れない）
 */
export function knownPlayersOf(
  state: GameState,
  teamId: string,
  scope: 'own' | 'all',
  estimatePotential: (viewerTeamId: string, playerId: string) => number,
): KnownPlayer[] {
  const source =
    scope === 'own' ? state.players.filter((p) => p.teamId === teamId) : state.players;
  return source.map((player) => ({
    id: player.id,
    teamId: player.teamId,
    name: player.name,
    age: player.age,
    isPitcher: player.isPitcher,
    mainPosition: player.mainPosition,
    overall: overallRating(player),
    estimatedPotential: estimatePotential(teamId, player.id),
    salary: player.ext.contract?.salary ?? 0,
    yearsRemaining: player.ext.contract?.yearsRemaining ?? 0,
    injured: player.ext.injury !== null,
    stats: state.stats[player.id],
  }));
}

/** state.players から投手のスタミナを引く（先発／救援の振り分けに使う） */
export function staminaLookup(state: GameState): (playerId: string) => number {
  const map = new Map<string, number>();
  for (const player of state.players) {
    map.set(player.id, player.pitching?.stamina ?? 0);
  }
  return (playerId: string) => map.get(playerId) ?? 0;
}

/** 球団の財務をまとめる */
export function financeOf(
  state: GameState,
  teamId: string,
): { payroll: number; budget: number; cash: number } {
  const finance = state.finances[teamId];
  return {
    payroll: teamPayroll(state, teamId),
    budget: finance?.budget ?? 900,
    cash: finance?.cash ?? 0,
  };
}
